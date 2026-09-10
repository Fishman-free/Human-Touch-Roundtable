import { PLAYER_LIMITS } from "../contracts/rules.ts";
export { ANSWER_LIMIT, charCount } from "../contracts/rules.ts";

export const ANSWER_MS = 90_000;
export const VOTE_MS = 60_000;
export const DEBATE_MS = 480_000;
export const DEBATE_STEP_MS = { accusation: 20_000, response: 45_000, followup: 20_000 };
// Technical payload guard, not a product-level debate word limit.
export const MAX_DEBATE_BYTES = 4096;

export function roleCounts(humans: number) {
  if (!Number.isInteger(humans) || humans < PLAYER_LIMITS.min || humans > PLAYER_LIMITS.max) throw new Error("INVALID_PLAYER_COUNT");
  const shadows = humans <= 3 ? 1 : 2;
  return { human: humans - shadows, shadow: shadows, ai: humans - shadows };
}
