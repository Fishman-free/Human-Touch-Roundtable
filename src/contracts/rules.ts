// Public rule constants, shared by validation and UI hints. No private state.
export const PLAYER_LIMITS = { min: 2, max: 5 } as const;
export const ANSWER_LIMIT = { 1: 30, 2: 50, 3: 40 } as const;
const segmenter = new Intl.Segmenter("zh-CN", { granularity: "grapheme" });
export function charCount(text: string): number {
  return [...segmenter.segment(text)].length;
}
