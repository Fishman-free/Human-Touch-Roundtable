import type { JoinMode, RoomView } from "../contracts/public.ts";
import type { MatchmakingControls } from "./use-matchmaking.ts";

// Stable presentation boundary: collaborators can provide a fixture implementation
// without starting Socket.IO, SQLite or a model provider.
export interface GameSession {
  matchmaking?: MatchmakingControls;
  connected: boolean;
  view?: RoomView;
  roomId: string;
  mode: JoinMode;
  busy: boolean;
  error: string;
  setRoomId(value: string): void;
  setMode(value: JoinMode): void;
  create(): void;
  join(): void;
  leave(): void;
  ready(value: boolean): void;
  answer(text: string, stance?: "pro" | "con"): void;
  accuse(targetSeatId: string, text: string): void;
  respond(text: string): void;
  followup(text: string): void;
  skipFollowup(): void;
  castVote(targetSeatId: string): void;
}
