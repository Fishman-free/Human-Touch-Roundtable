import { PLAYER_LIMITS } from "../contracts/rules.ts";
export { ANSWER_LIMIT, charCount } from "../contracts/rules.ts";

export const ANSWER_MS = 90_000;
export const VOTE_MS = 60_000;
export const DEBATE_MS = 480_000;
export const DEBATE_STEP_MS = { accusation: 20_000, response: 45_000, followup: 20_000 };
// Everyone has spoken, but the round deliberately outlives them by this much: the
// last answers still have to be read, and a phase that flips the instant the final
// seat submits leaves them unread. A round that expires instead is not paused —
// its time was already given.
export const READ_PAUSE_MS = 8_000;
// AI seats wait their own private beat before their request goes out. A model
// answers in milliseconds, and three seats speaking within the same second is the
// loudest tell at this table; the window keeps the beats spread instead of shared.
export const AI_BEAT_MS = { min: 3_000, max: 10_000 };
// A beat must never eat the generation budget: the accusation step is only 20
// seconds, and waiting most of it leaves no time to answer. Capping by the phase's
// own remaining time gives short steps short beats.
export function aiBeatMs(drawn: number, remainingMs: number, aiTimeoutMs: number): number {
  return Math.max(0, Math.min(drawn, remainingMs - aiTimeoutMs));
}
// Technical payload guard, not a product-level debate word limit.
export const MAX_DEBATE_BYTES = 4096;

export function roleCounts(humans: number) {
  if (!Number.isInteger(humans) || humans < PLAYER_LIMITS.min || humans > PLAYER_LIMITS.max) throw new Error("INVALID_PLAYER_COUNT");
  const shadows = humans <= 3 ? 1 : 2;
  return { human: humans - shadows, shadow: shadows, ai: humans - shadows };
}
