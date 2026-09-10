import type { CommandAck, RoomView } from "../application/ports.ts";

export type JoinMode = "player" | "spectator";
export type SessionError = "INVALID_INPUT" | "ROOM_NOT_FOUND" | "ROOM_EXISTS" | "ROOM_UNAVAILABLE" |
  "INVALID_SESSION" | "STORAGE_UNAVAILABLE" | "ROOM_CONFLICT" | "FORBIDDEN" | "ROOM_FULL" | "WRONG_PHASE";
export type SessionResult = { ok: true; roomId: string; sessionToken: string; view: RoomView } |
  { ok: false; error: SessionError };
export type SyncResult = { ok: true; view: RoomView } |
  { ok: false; error: "NOT_JOINED" | "INVALID_SESSION" | "ROOM_UNAVAILABLE" };
export type SocketCommandAck = CommandAck | {
  commandId: string;
  revision: number;
  ok: false;
  error: "NOT_JOINED" | "INVALID_SESSION" | "INVALID_INPUT" | "ROOM_UNAVAILABLE";
};

export type CommandBase = { commandId: string; matchId: string; phaseToken: number };

export interface ClientToServerEvents {
  "room:create": (input: { requestId: string; roomId: string; mode: JoinMode }, ack: (result: SessionResult) => void) => void;
  "room:join": (input: { requestId: string; roomId: string; mode: JoinMode }, ack: (result: SessionResult) => void) => void;
  "room:resume": (input: { roomId: string; sessionToken: string }, ack: (result: SessionResult) => void) => void;
  "room:sync": (ack: (result: SyncResult) => void) => void;
  "room:ready": (input: CommandBase & { ready: boolean }, ack: (result: SocketCommandAck) => void) => void;
  "game:answer": (input: CommandBase & { round: 1 | 2 | 3; text: string; stance?: "pro" | "con" }, ack: (result: SocketCommandAck) => void) => void;
  "game:accuse": (input: CommandBase & { targetSeatId: string; text: string }, ack: (result: SocketCommandAck) => void) => void;
  "game:respond": (input: CommandBase & { text: string }, ack: (result: SocketCommandAck) => void) => void;
  "game:followup": (input: CommandBase & { text: string }, ack: (result: SocketCommandAck) => void) => void;
  "game:skip-followup": (input: CommandBase, ack: (result: SocketCommandAck) => void) => void;
  "game:vote": (input: CommandBase & { targetSeatId: string }, ack: (result: SocketCommandAck) => void) => void;
}

export interface ServerToClientEvents {
  "room:state": (view: RoomView) => void;
  "session:replaced": () => void;
}
