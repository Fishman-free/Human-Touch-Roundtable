import type { ComponentType } from "react";
import type { RoomView } from "../contracts/public.ts";
import type { GameSession } from "../client/game-session.ts";
import type { GameTheme } from "./theme/types.tsx";

export interface RoomSlots {
  Lobby: ComponentType<{ view: RoomView; busy: boolean; ready: GameSession["ready"] }>;
  Preparing: ComponentType<{ view: RoomView }>;
  StageRail: ComponentType<{ view: RoomView }>;
  Roundtable: ComponentType<{ view: RoomView; theme: GameTheme }>;
  Answer: ComponentType<{ view: RoomView; busy: boolean; submit: GameSession["answer"] }>;
  Debate: ComponentType<{ view: RoomView; busy: boolean; accuse: GameSession["accuse"];
    respond: GameSession["respond"]; followup: GameSession["followup"]; skip: GameSession["skipFollowup"] }>;
  Voting: ComponentType<{ view: RoomView; busy: boolean; vote: GameSession["castVote"] }>;
  Reveal: ComponentType<{ view: RoomView; theme: GameTheme }>;
}
