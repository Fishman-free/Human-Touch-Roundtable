import type { Command, CommandEnvelope, ErrorCode, GameState, Topic } from "../game/model.ts";
import type { aiContext, project } from "../game/projection.ts";

export interface Clock {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface RandomSource {
  integer(exclusiveMax: number): number;
}

export type PlayerCommand = Exclude<Command, { type: "resolve-topic" }>;
export type PlayerRequest = Omit<CommandEnvelope, "command"> & {
  commandId: string;
  command: PlayerCommand;
};
export type RuntimeErrorCode = ErrorCode | "COMMAND_ID_REUSED" | "COMMAND_LIMIT" |
  "STORAGE_UNAVAILABLE" | "ROOM_CLOSED" | "ROOM_CONFLICT";
export type CommandAck = { commandId: string; revision: number } & (
  { ok: true } | { ok: false; error: RuntimeErrorCode }
);

export interface Receipt {
  participantId: string;
  commandId: string;
  fingerprint: string;
  ack: CommandAck;
}

export interface RoomRecord {
  version: number;
  state: GameState;
  receipts: Receipt[];
  preparation: { candidateIndex: number; cycles: number; retryAt: number };
}

export interface RoomSummary {
  roomId: string;
  matchId: string;
  phase: GameState["phase"];
  version: number;
  updatedAt: number;
}

// Atomically save the entire record, including state/log/receipts. False means
// another writer won. An exception must mean no write was committed.
export interface RoomStore {
  load(roomId: string): Promise<RoomRecord | null>;
  save(roomId: string, expectedVersion: number | null, record: RoomRecord): Promise<boolean>;
  list(): Promise<RoomSummary[]>;
  delete(roomId: string, expectedVersion: number): Promise<boolean>;
}

export interface TopicProvider {
  // Stable ordering while a room is preparing, including across restarts.
  candidateIds: readonly string[];
  resolve(candidateId: string, signal: AbortSignal): Promise<Topic>;
}

export type AiCommand = Exclude<PlayerCommand, { type: "join" | "ready" }>;
export type AiAction = "answer" | "accuse" | "respond" | "followup" | "vote";
export interface AiRequest {
  matchId: string;
  phaseToken: number;
  seatId: string;
  action: AiAction;
  deadlineAt: number;
  context: ReturnType<typeof aiContext>;
}
export interface AiProvider {
  act(request: AiRequest, signal: AbortSignal): Promise<AiCommand>;
}

export type RoomView = ReturnType<typeof project>;
export type DiagnosticKind = "topic-failed" | "ai-failed" | "ai-invalid" |
  "storage-failed" | "room-conflict" | "subscriber-failed" | "runtime-failed" |
  "room-recovery-failed" | "room-cleanup-failed" | "session-cleanup-failed";
export interface RuntimeDependencies {
  clock: Clock;
  random: RandomSource;
  store: RoomStore;
  topics: TopicProvider;
  ai: AiProvider;
  // Internal codes only; provider errors and raw payloads are not published.
  diagnose?(event: { roomId: string; kind: DiagnosticKind }): void;
}

export interface RuntimeOptions {
  topicTimeoutMs: number;
  aiTimeoutMs: number;
  retryMs: number;
  topicBackoffMs: number;
  topicMaxBackoffMs: number;
  maxReceipts: number;
}
