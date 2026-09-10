import type { RoomRuntime } from "../application/room-runtime.ts";
import type { Viewer } from "../game/projection.ts";
import type { JoinMode, SessionError } from "./socket-contracts.ts";
import { RoomRegistry } from "./room-registry.ts";
import { SessionService, type SessionRecord } from "./session.ts";

export type AdmissionResult = { ok: true; roomId: string; token: string; session: SessionRecord; runtime: RoomRuntime } |
  { ok: false; error: SessionError };

export class AdmissionService {
  private rooms: RoomRegistry;
  private sessions: SessionService;

  constructor(rooms: RoomRegistry, sessions: SessionService) {
    this.rooms = rooms;
    this.sessions = sessions;
  }

  async create(roomId: string, mode: JoinMode, requestId: string): Promise<AdmissionResult> {
    const runtime = await this.rooms.create(roomId);
    return runtime ? this.admit(runtime, roomId, mode, requestId) : { ok: false, error: "ROOM_EXISTS" };
  }

  async join(roomId: string, mode: JoinMode, requestId: string): Promise<AdmissionResult> {
    const runtime = await this.rooms.get(roomId);
    return runtime ? this.admit(runtime, roomId, mode, requestId) : { ok: false, error: "ROOM_NOT_FOUND" };
  }

  async resume(roomId: string, token: string): Promise<AdmissionResult> {
    const session = await this.sessions.verify(roomId, token);
    if (!session) return { ok: false, error: "INVALID_SESSION" };
    const runtime = await this.rooms.get(roomId);
    return runtime ? { ok: true, roomId, token, session, runtime } : { ok: false, error: "ROOM_NOT_FOUND" };
  }

  authorize(sessionId: string): Promise<SessionRecord | null> { return this.sessions.authorize(sessionId); }

  private async admit(runtime: RoomRuntime, roomId: string, mode: JoinMode, requestId: string): Promise<AdmissionResult> {
    const viewer: Viewer = mode === "player"
      ? { kind: "participant", participantId: this.sessions.participantId(roomId, requestId) }
      : { kind: "spectator" };
    let issued;
    try { issued = await this.sessions.issue(roomId, viewer, requestId); }
    catch (error) {
      return { ok: false, error: error instanceof Error && error.message === "ADMISSION_EXPIRED"
        ? "INVALID_SESSION" : "ROOM_UNAVAILABLE" };
    }
    if (viewer.kind === "participant") {
      const current = runtime.view({ kind: "spectator" });
      const result = await runtime.dispatch(viewer.participantId, {
        commandId: `admit_${issued.session.id}`, matchId: current.matchId,
        phaseToken: 0, command: { type: "join" },
      });
      if (!result.ok) {
        if (result.error !== "STORAGE_UNAVAILABLE") await this.sessions.revoke(issued.session.id);
        return { ok: false, error: this.error(result.error) };
      }
    }
    return { ok: true, roomId, token: issued.token, session: issued.session, runtime };
  }

  private error(error: string): SessionError {
    if (error === "STALE_PHASE") return "WRONG_PHASE";
    if (["STORAGE_UNAVAILABLE", "ROOM_CONFLICT", "FORBIDDEN", "ROOM_FULL", "WRONG_PHASE"].includes(error)) {
      return error as SessionError;
    }
    return "ROOM_UNAVAILABLE";
  }
}
