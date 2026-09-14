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
  // Leaves the finished room and re-enters public matchmaking in one step, so a
  // player who just finished a game does not have to walk back through the hall.
  // Falls back to a plain leave when matchmaking cannot accept them.
  rematch(): void;
  // Whether rematch() would actually queue. The reveal screen labels the button
  // from this rather than promising a queue it cannot deliver.
  canRematch: boolean;
  ready(value: boolean): void;
  answer(text: string, stance?: "pro" | "con"): void;
  accuse(targetSeatId: string, text: string): void;
  respond(text: string): void;
  followup(text: string): void;
  skipFollowup(): void;
  castVote(targetSeatId: string): void;
}
