import type { Server, Socket } from "socket.io";
import type { PlayerCommand, PlayerRequest, RoomView } from "../application/ports.ts";
import type { RoomRuntime } from "../application/room-runtime.ts";
import type { SessionRecord } from "./session.ts";
import { AdmissionService, type AdmissionResult } from "./admission-service.ts";
import type { ClientToServerEvents, JoinMode, ServerToClientEvents, SessionResult, SocketCommandAck } from "./socket-contracts.ts";
import type { Clock } from "../application/ports.ts";
import { ConnectionQuota, FixedWindowRateLimiter, type RateLimitRule } from "./rate-limit.ts";
import { resolveClientIp } from "./socket-security.ts";
import { systemClock } from "./runtime-dependencies.ts";

type GameServer = Server<ClientToServerEvents, ServerToClientEvents>;
type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents>;
type Connection = { runtime: RoomRuntime; session: SessionRecord; unsubscribe: () => void };
type Transport = { ip: string; timeout: unknown; authenticated: boolean };
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
function commandAck(commandId: unknown, revision: number, error: "NOT_JOINED" | "INVALID_SESSION" | "INVALID_INPUT" | "ROOM_UNAVAILABLE" | "RATE_LIMITED"): SocketCommandAck {
  return { commandId: typeof commandId === "string" ? commandId : "", revision, ok: false, error };
}

export interface SocketGatewayOptions {
  clock: Clock;
  trustedProxyHops: number;
  maxConnectionsPerIp: number;
  unauthenticatedTimeoutMs: number;
  create: RateLimitRule;
  admission: RateLimitRule;
  command: RateLimitRule;
  onSecurityEvent?: (event: SecurityEvent) => void;
}

export interface SecurityEvent { kind: "connection-limited" | "create-limited" | "admission-limited" |
  "command-limited" | "unauthenticated-timeout" | "session-expired" }

const securityDefaults: SocketGatewayOptions = {
  clock: systemClock, trustedProxyHops: 0, maxConnectionsPerIp: 20, unauthenticatedTimeoutMs: 30_000,
  create: { limit: 5, windowMs: 60_000 }, admission: { limit: 20, windowMs: 60_000 },
  command: { limit: 20, windowMs: 10_000 },
};

export class SocketGateway {
  private connections = new Map<string, Connection>();
  private activeSessions = new Map<string, GameSocket>();
  private io: GameServer;
  private admissions: AdmissionService;
  private security: SocketGatewayOptions;
  private limiter: FixedWindowRateLimiter;
  private quota = new ConnectionQuota();
  private transports = new Map<string, Transport>();

  constructor(io: GameServer, admissions: AdmissionService, options: Partial<SocketGatewayOptions> = {}) {
    this.io = io;
    this.admissions = admissions;
    this.security = { ...securityDefaults, ...options,
      create: { ...securityDefaults.create, ...options.create },
      admission: { ...securityDefaults.admission, ...options.admission },
      command: { ...securityDefaults.command, ...options.command } };
    this.limiter = new FixedWindowRateLimiter(() => this.security.clock.now());
    if (![this.security.maxConnectionsPerIp, this.security.unauthenticatedTimeoutMs, this.security.trustedProxyHops]
      .every(value => Number.isSafeInteger(value) && value >= 0) || this.security.maxConnectionsPerIp === 0 ||
      this.security.unauthenticatedTimeoutMs === 0) throw new Error("INVALID_SOCKET_SECURITY_OPTIONS");
    for (const rule of [this.security.create, this.security.admission, this.security.command]) {
      if (!Number.isSafeInteger(rule.limit) || rule.limit <= 0 || !Number.isSafeInteger(rule.windowMs) || rule.windowMs <= 0) {
        throw new Error("INVALID_SOCKET_SECURITY_OPTIONS");
      }
    }
  }

  register() {
    this.io.on("connection", socket => this.connection(socket));
  }

  private connection(socket: GameSocket) {
    const forwarded = socket.handshake.headers["x-forwarded-for"];
    const ip = resolveClientIp(socket.handshake.address, forwarded, this.security.trustedProxyHops);
    if (!this.quota.acquire(ip, this.security.maxConnectionsPerIp)) {
      this.reportSecurity("connection-limited");
      socket.emit("server:error", "CONNECTION_LIMIT"); socket.disconnect(true); return;
    }
    const timeout = this.security.clock.setTimeout(() => {
      const transport = this.transports.get(socket.id);
      if (transport && !transport.authenticated) { this.reportSecurity("unauthenticated-timeout"); socket.conn.close(); }
    }, this.security.unauthenticatedTimeoutMs);
    this.transports.set(socket.id, { ip, timeout, authenticated: false });

    socket.on("room:create", (input, ack) => this.handleSession(ack, async () => {
      if (!this.allow(socket, "create", this.security.create)) { this.reportSecurity("create-limited"); return { ok: false, error: "RATE_LIMITED" }; }
      const parsed = this.admission(input);
      if (!parsed) return { ok: false, error: "INVALID_INPUT" };
      return this.finishAdmission(socket, await this.admissions.create(parsed.roomId, parsed.mode, parsed.requestId));
    }));

    socket.on("room:join", (input, ack) => this.handleSession(ack, async () => {
      if (!this.allow(socket, "admission", this.security.admission)) { this.reportSecurity("admission-limited"); return { ok: false, error: "RATE_LIMITED" }; }
      const parsed = this.admission(input);
      if (!parsed) return { ok: false, error: "INVALID_INPUT" };
      return this.finishAdmission(socket, await this.admissions.join(parsed.roomId, parsed.mode, parsed.requestId));
    }));

    socket.on("room:resume", (input, ack) => this.handleSession(ack, async () => {
      if (!this.allow(socket, "admission", this.security.admission)) { this.reportSecurity("admission-limited"); return { ok: false, error: "RATE_LIMITED" }; }
      if (!object(input) || !exact(input, ["roomId", "sessionToken"]) || !roomId(input.roomId) ||
        typeof input.sessionToken !== "string") return { ok: false, error: "INVALID_INPUT" };
      return this.finishAdmission(socket, await this.admissions.resume(input.roomId, input.sessionToken));
    }));

    socket.on("room:sync", ack => {
      if (typeof ack !== "function") return;
      const connection = this.connections.get(socket.id);
      if (!connection) { ack({ ok: false, error: "NOT_JOINED" }); return; }
      if (!this.limiter.allow("command", connection.session.id, this.security.command)) {
        this.reportSecurity("command-limited");
        ack({ ok: false, error: "RATE_LIMITED" }); return;
      }
      void this.admissions.authorize(connection.session.id).then(active => {
        if (!active) { ack({ ok: false, error: "INVALID_SESSION" }); this.expire(socket); return; }
        connection.session = active;
        return connection.runtime.sync(active.viewer).then(view => ack({ ok: true, view }));
      }).catch(() => ack({ ok: false, error: "ROOM_UNAVAILABLE" }));
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

    socket.on("disconnect", () => { this.detach(socket); this.release(socket); });
  }

  private admission(input: unknown): { requestId: string; roomId: string; mode: JoinMode } | null {
    return object(input) && exact(input, ["requestId", "roomId", "mode"]) && requestId(input.requestId) &&
      roomId(input.roomId) && mode(input.mode)
      ? { requestId: input.requestId, roomId: input.roomId, mode: input.mode } : null;
  }

  private async finishAdmission(socket: GameSocket, result: AdmissionResult): Promise<SessionResult> {
    if (!result.ok) return result;
    const view = await this.attach(socket, result.runtime, result.session);
    return { ok: true, roomId: result.roomId, sessionToken: result.token, view };
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
    const unsubscribe = runtime.subscribe(session.viewer, state => {
      void this.admissions.authorize(session.id).then(active => {
        const connection = this.connections.get(socket.id);
        if (!connection || connection.session.id !== session.id) return;
        if (!active) { this.expire(socket); return; }
        connection.session = active;
        socket.emit("room:state", state);
      }).catch(() => {});
    });
    this.connections.set(socket.id, { runtime, session, unsubscribe });
    this.activeSessions.set(session.id, socket);
    const transport = this.transports.get(socket.id);
    if (transport) { transport.authenticated = true; this.security.clock.clearTimeout(transport.timeout); }
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
      if (!this.limiter.allow("command", connection.session.id, this.security.command)) {
        this.reportSecurity("command-limited");
        ack(commandAck(object(input) ? input.commandId : "", revision, "RATE_LIMITED")); return;
      }
      if (connection.session.viewer.kind !== "participant") {
        ack({ commandId: object(input) && typeof input.commandId === "string" ? input.commandId : "",
          revision, ok: false, error: "FORBIDDEN" });
        return;
      }
      const command = parse(input);
      if (!command || !object(input)) { ack(commandAck(object(input) ? input.commandId : "", revision, "INVALID_INPUT")); return; }
      const request: PlayerRequest = { commandId: input.commandId as string, matchId: input.matchId as string,
        phaseToken: input.phaseToken as number, command };
      void this.admissions.authorize(connection.session.id).then(active => {
        if (!active || active.viewer.kind !== "participant") {
          ack(commandAck(request.commandId, revision, "INVALID_SESSION"));
          this.expire(socket); return;
        }
        connection.session = active;
        return connection.runtime.dispatch(active.viewer.participantId, request).then(ack);
      }).catch(() => ack(commandAck(request.commandId, revision, "ROOM_UNAVAILABLE")));
    }) as never);
  }

  private handleSession(ack: (result: SessionResult) => void, action: () => Promise<SessionResult>) {
    if (typeof ack !== "function") return;
    void action().then(ack, () => ack({ ok: false, error: "ROOM_UNAVAILABLE" }));
  }

  private allow(socket: GameSocket, scope: string, rule: RateLimitRule): boolean {
    const ip = this.transports.get(socket.id)?.ip;
    return ip ? this.limiter.allow(scope, ip, rule) : false;
  }

  private release(socket: GameSocket) {
    const transport = this.transports.get(socket.id);
    if (!transport) return;
    this.security.clock.clearTimeout(transport.timeout);
    this.quota.release(transport.ip);
    this.transports.delete(socket.id);
  }

  private expire(socket: GameSocket) {
    this.reportSecurity("session-expired");
    socket.emit("session:expired");
    this.detach(socket);
    socket.disconnect(true);
  }

  private reportSecurity(kind: SecurityEvent["kind"]) {
    try { this.security.onSecurityEvent?.({ kind }); } catch { /* Monitoring cannot change protocol behavior. */ }
  }

}
