import type { Server, Socket } from "socket.io";
import type { PlayerCommand, PlayerRequest, RoomView } from "../application/ports.ts";
import type { Viewer } from "../game/projection.ts";
import type { RoomRuntime } from "../application/room-runtime.ts";
import { RoomRegistry } from "./room-registry.ts";
import { SessionService, type SessionRecord } from "./session.ts";
import type { ClientToServerEvents, JoinMode, ServerToClientEvents, SessionError, SessionResult, SocketCommandAck } from "./socket-contracts.ts";

type GameServer = Server<ClientToServerEvents, ServerToClientEvents>;
type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents>;
type Connection = { runtime: RoomRuntime; session: SessionRecord; unsubscribe: () => void };
type ObjectValue = Record<string, unknown>;

function object(value: unknown): value is ObjectValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function exact(value: ObjectValue, fields: readonly string[]) {
  return Object.keys(value).every(key => fields.includes(key)) && fields.every(key => key in value);
}
function roomId(value: unknown): value is string { return typeof value === "string" && /^[a-z0-9-]{1,24}$/.test(value); }
function requestId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
function mode(value: unknown): value is JoinMode { return value === "player" || value === "spectator"; }
function text(value: unknown): value is string { return typeof value === "string" && new TextEncoder().encode(value).length <= 4096; }
function base(value: ObjectValue) {
  return typeof value.commandId === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(value.commandId) &&
    typeof value.matchId === "string" && value.matchId.length >= 1 && value.matchId.length <= 128 &&
    Number.isSafeInteger(value.phaseToken) && (value.phaseToken as number) >= 0;
}
function commandAck(commandId: unknown, revision: number, error: "NOT_JOINED" | "INVALID_INPUT" | "ROOM_UNAVAILABLE"): SocketCommandAck {
  return { commandId: typeof commandId === "string" ? commandId : "", revision, ok: false, error };
}

export class SocketGateway {
  private connections = new Map<string, Connection>();
  private activeSessions = new Map<string, GameSocket>();
  private io: GameServer;
  private rooms: RoomRegistry;
  private sessions: SessionService;

  constructor(io: GameServer, rooms: RoomRegistry, sessions: SessionService) {
    this.io = io;
    this.rooms = rooms;
    this.sessions = sessions;
  }

  register() {
    this.io.on("connection", socket => this.connection(socket));
  }

  private connection(socket: GameSocket) {
    socket.on("room:create", (input, ack) => this.handleSession(ack, async () => {
      const parsed = this.admission(input);
      if (!parsed) return { ok: false, error: "INVALID_INPUT" };
      const runtime = await this.rooms.create(parsed.roomId);
      if (!runtime) return { ok: false, error: "ROOM_EXISTS" };
      return this.admit(socket, runtime, parsed.roomId, parsed.mode, parsed.requestId);
    }));

    socket.on("room:join", (input, ack) => this.handleSession(ack, async () => {
      const parsed = this.admission(input);
      if (!parsed) return { ok: false, error: "INVALID_INPUT" };
      const runtime = await this.rooms.get(parsed.roomId);
      if (!runtime) return { ok: false, error: "ROOM_NOT_FOUND" };
      return this.admit(socket, runtime, parsed.roomId, parsed.mode, parsed.requestId);
    }));

    socket.on("room:resume", (input, ack) => this.handleSession(ack, async () => {
      if (!object(input) || !exact(input, ["roomId", "sessionToken"]) || !roomId(input.roomId) ||
        typeof input.sessionToken !== "string") return { ok: false, error: "INVALID_INPUT" };
      const session = await this.sessions.verify(input.roomId, input.sessionToken);
      if (!session) return { ok: false, error: "INVALID_SESSION" };
      const runtime = await this.rooms.get(input.roomId);
      if (!runtime) return { ok: false, error: "ROOM_NOT_FOUND" };
      const view = await this.attach(socket, runtime, session);
      return { ok: true, roomId: input.roomId, sessionToken: input.sessionToken, view };
    }));

    socket.on("room:sync", ack => {
      if (typeof ack !== "function") return;
      const connection = this.connections.get(socket.id);
      if (!connection) { ack({ ok: false, error: "NOT_JOINED" }); return; }
      void connection.runtime.sync(connection.session.viewer)
        .then(view => ack({ ok: true, view }), () => ack({ ok: false, error: "ROOM_UNAVAILABLE" }));
    });

    this.onCommand(socket, "room:ready", input => object(input) && exact(input, ["commandId", "matchId", "phaseToken", "ready"]) &&
      base(input) && typeof input.ready === "boolean" ? { type: "ready", ready: input.ready } : null);
    this.onCommand(socket, "game:answer", input => object(input) &&
      Object.keys(input).every(key => ["commandId", "matchId", "phaseToken", "round", "text", "stance"].includes(key)) &&
      ["commandId", "matchId", "phaseToken", "round", "text"].every(key => key in input) && base(input) &&
      (input.round === 1 || input.round === 2 || input.round === 3) && text(input.text) &&
      (input.stance === undefined || input.stance === "pro" || input.stance === "con")
      ? { type: "answer", round: input.round, text: input.text, ...(input.stance ? { stance: input.stance } : {}) } : null);
    this.onCommand(socket, "game:accuse", input => object(input) && exact(input,
      ["commandId", "matchId", "phaseToken", "targetSeatId", "text"]) && base(input) &&
      typeof input.targetSeatId === "string" && text(input.text)
      ? { type: "accuse", targetSeatId: input.targetSeatId, text: input.text } : null);
    this.onCommand(socket, "game:respond", input => object(input) && exact(input,
      ["commandId", "matchId", "phaseToken", "text"]) && base(input) && text(input.text)
      ? { type: "respond", text: input.text } : null);
    this.onCommand(socket, "game:followup", input => object(input) && exact(input,
      ["commandId", "matchId", "phaseToken", "text"]) && base(input) && text(input.text)
      ? { type: "followup", text: input.text } : null);
    this.onCommand(socket, "game:skip-followup", input => object(input) && exact(input,
      ["commandId", "matchId", "phaseToken"]) && base(input) ? { type: "skip-followup" } : null);
    this.onCommand(socket, "game:vote", input => object(input) && exact(input,
      ["commandId", "matchId", "phaseToken", "targetSeatId"]) && base(input) && typeof input.targetSeatId === "string"
      ? { type: "vote", targetSeatId: input.targetSeatId } : null);

    socket.on("disconnect", () => this.detach(socket));
  }

  private admission(input: unknown): { requestId: string; roomId: string; mode: JoinMode } | null {
    return object(input) && exact(input, ["requestId", "roomId", "mode"]) && requestId(input.requestId) &&
      roomId(input.roomId) && mode(input.mode)
      ? { requestId: input.requestId, roomId: input.roomId, mode: input.mode } : null;
  }

  private async admit(socket: GameSocket, runtime: RoomRuntime, id: string, joinMode: JoinMode, admissionId: string): Promise<SessionResult> {
    const viewer: Viewer = joinMode === "player"
      ? { kind: "participant", participantId: this.sessions.participantId(id, admissionId) }
      : { kind: "spectator" };
    const issued = await this.sessions.issue(id, viewer, admissionId);
    if (viewer.kind === "participant") {
      const current = runtime.view({ kind: "spectator" });
      const result = await runtime.dispatch(viewer.participantId, {
        commandId: `admit_${issued.session.id}`, matchId: current.matchId,
        // Admission retries must keep the original lobby token even after start.
        phaseToken: 0, command: { type: "join" },
      });
      if (!result.ok) return { ok: false, error: this.sessionError(result.error) };
    }
    const view = await this.attach(socket, runtime, issued.session);
    return { ok: true, roomId: id, sessionToken: issued.token, view };
  }

  private async attach(socket: GameSocket, runtime: RoomRuntime, session: SessionRecord): Promise<RoomView> {
    // No await between choosing the previous connection and installing the new one.
    const view = await runtime.sync(session.viewer);
    if (!socket.connected) throw new Error("SOCKET_DISCONNECTED");
    this.detach(socket);
    const previous = this.activeSessions.get(session.id);
    if (previous && previous.id !== socket.id) {
      previous.emit("session:replaced");
      previous.disconnect(true);
    }
    const unsubscribe = runtime.subscribe(session.viewer, state => { socket.emit("room:state", state); });
    this.connections.set(socket.id, { runtime, session, unsubscribe });
    this.activeSessions.set(session.id, socket);
    return view;
  }

  private detach(socket: GameSocket) {
    const connection = this.connections.get(socket.id);
    if (!connection) return;
    connection.unsubscribe();
    this.connections.delete(socket.id);
    if (this.activeSessions.get(connection.session.id)?.id === socket.id) this.activeSessions.delete(connection.session.id);
  }

  private onCommand<E extends keyof Pick<ClientToServerEvents, "room:ready" | "game:answer" | "game:accuse" |
    "game:respond" | "game:followup" | "game:skip-followup" | "game:vote">>(
    socket: GameSocket, event: E, parse: (input: unknown) => PlayerCommand | null,
  ) {
    socket.on(event, ((input: unknown, ack: (result: SocketCommandAck) => void) => {
      if (typeof ack !== "function") return;
      const connection = this.connections.get(socket.id);
      const revision = connection?.runtime.view({ kind: "spectator" }).revision ?? 0;
      if (!connection) { ack(commandAck(object(input) ? input.commandId : "", revision, "NOT_JOINED")); return; }
      if (connection.session.viewer.kind !== "participant") {
        ack({ commandId: object(input) && typeof input.commandId === "string" ? input.commandId : "",
          revision, ok: false, error: "FORBIDDEN" });
        return;
      }
      const command = parse(input);
      if (!command || !object(input)) { ack(commandAck(object(input) ? input.commandId : "", revision, "INVALID_INPUT")); return; }
      const request: PlayerRequest = {
        commandId: input.commandId as string, matchId: input.matchId as string,
        phaseToken: input.phaseToken as number, command,
      };
      void connection.runtime.dispatch(connection.session.viewer.participantId, request)
        .then(ack, () => ack(commandAck(request.commandId, revision, "ROOM_UNAVAILABLE")));
    }) as never);
  }

  private handleSession(ack: (result: SessionResult) => void, action: () => Promise<SessionResult>) {
    if (typeof ack !== "function") return;
    void action().then(ack, () => ack({ ok: false, error: "ROOM_UNAVAILABLE" }));
  }

  private sessionError(error: string): SessionError {
    if (error === "STALE_PHASE") return "WRONG_PHASE";
    if (["STORAGE_UNAVAILABLE", "ROOM_CONFLICT", "FORBIDDEN", "ROOM_FULL", "WRONG_PHASE"].includes(error)) return error as SessionError;
    return "ROOM_UNAVAILABLE";
  }
}
