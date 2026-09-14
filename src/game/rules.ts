import { charCount, PLAYER_LIMITS } from "../contracts/rules.ts";
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
// answers in milliseconds, so a seat that speaks the moment its phase opens is the
// loudest tell at this table; a wide window keeps the beats from lining up. The
// window below is the baseline for a question of BEAT_BASELINE_CHARS characters.
export const AI_BEAT_MS = { min: 40_000, max: 70_000 };
// A long question takes longer to think about, so the whole window slides right
// with the question's length and left for a short one. Reading is faster than
// composing, so only the question itself is measured, not the answer excerpt.
const BEAT_BASELINE_CHARS = 30;
const BEAT_SCALE = { min: 0.6, max: 1.4 };
// The window a phase can actually afford. Waiting must never eat the generation
// budget — the accusation step is only 20 seconds — so the ceiling drops to what
// is left after the model's own timeout and the floor follows it down. Scaling the
// draw with the phase, rather than clamping the drawn value, keeps a spread even
// in short phases instead of collapsing every beat onto one number.
export function aiBeatWindow(remainingMs: number, aiTimeoutMs: number, question: string) {
  const scale = Math.min(BEAT_SCALE.max, Math.max(BEAT_SCALE.min, charCount(question) / BEAT_BASELINE_CHARS));
  const ceiling = Math.floor(Math.max(0, Math.min(AI_BEAT_MS.max * scale, remainingMs - aiTimeoutMs)));
  return { min: Math.floor(Math.min(AI_BEAT_MS.min * scale, ceiling)), max: ceiling };
}
// Technical payload guard, not a product-level debate word limit.
export const MAX_DEBATE_BYTES = 4096;

export function roleCounts(humans: number) {
  if (!Number.isInteger(humans) || humans < PLAYER_LIMITS.min || humans > PLAYER_LIMITS.max) throw new Error("INVALID_PLAYER_COUNT");
  const shadows = humans <= 3 ? 1 : 2;
  return { human: humans - shadows, shadow: shadows, ai: humans - shadows };
}
