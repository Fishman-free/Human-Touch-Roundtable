export type Role = "human" | "shadow" | "ai";
export type Phase = "lobby" | "preparing" | "answering" | "debating" | "voting" | "revealed";
export type Round = 1 | 2 | 3;
export type DebateStep = "accusation" | "response" | "followup";

// Topic resolution is a trusted server operation; the core performs no HTTP requests.
export interface Topic {
  id: string;
  title: string;
  url: string;
  topAnswerExcerpt: string;
  topConsensusSummary: string;
  defaults: Record<Round, string[]>;
  provenance?: {
    packId: string;
    source: "zhihu";
    curatedAt: string;
    verifiedAt?: string;
    selectedAnswerUrl?: string;
    selectedVoteUpCount?: number;
  };
}

export interface Seat {
  seatId: string;
  displayNumber: number;
  role: Role;
  participantId?: string;
}

export interface Answer {
  seatId: string;
  text: string;
  at: number;
}

export interface Vote {
  voterSeatId: string;
  targetSeatId: string | null;
  at: number;
}

export interface Debate {
  turnIndex: number;
  step: DebateStep;
  targetSeatId?: string;
  globalDeadlineAt: number;
}

export interface GameLogEntry {
  seq: number;
  type: "answer" | "accusation" | "response" | "followup" | "skip-followup" | "vote" | "phase";
  at: number;
  seatId?: string;
  targetSeatId?: string | null;
  text?: string;
  round?: Round;
  turnIndex?: number;
  phase?: Phase;
}

export interface Result {
  winner: Role;
  eliminatedSeatIds: string[];
  validVotes: Vote[];
  roles: { seatId: string; role: Role }[];
}

export interface GameState {
  matchId: string;
  phase: Phase;
  phaseToken: number;
  revision: number;
  lastNow: number;
  members: { participantId: string; ready: boolean }[];
  seats: Seat[];
  topic?: Topic;
  round?: Round;
  answers: Record<Round, Answer[]>;
  debate?: Debate;
  deadlineAt?: number;
  votes: Vote[];
  log: GameLogEntry[];
  result?: Result;
}

// Actors are supplied by the trusted application layer, never by client payloads.
export type Actor =
  | { kind: "participant"; participantId: string }
  | { kind: "ai"; seatId: string }
  | { kind: "system" }
  | { kind: "spectator" };

export type Command =
  | { type: "join" }
  | { type: "ready"; ready: boolean }
  | { type: "resolve-topic"; topic: Topic; seats: Seat[] }
  | { type: "answer"; round: Round; text: string; stance?: "pro" | "con" }
  | { type: "accuse"; targetSeatId: string; text: string }
  | { type: "respond"; text: string }
  | { type: "followup"; text: string }
  | { type: "skip-followup" }
  | { type: "vote"; targetSeatId: string };

export interface CommandEnvelope {
  matchId: string;
  phaseToken: number;
  command: Command;
}

export type ErrorCode = "INVALID_INPUT" | "WRONG_MATCH" | "STALE_PHASE" | "WRONG_PHASE" |
  "FORBIDDEN" | "DUPLICATE" | "INVALID_TARGET" | "ROOM_FULL" | "CONTENT_REJECTED";

export type TransitionResult = { state: GameState } & (
  { ok: true } | { ok: false; error: ErrorCode }
);
