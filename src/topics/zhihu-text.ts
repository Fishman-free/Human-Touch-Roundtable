// Shared text helpers for Zhihu-sourced strings. excerpt() and title() were
// moved here verbatim from zhihu-search-gateway.ts when a second consumer
// appeared; clamp() is the same grapheme-safe clip without the ellipsis, for
// sentences we build ourselves and do not want ending in "…".

function segments(value: string): string[] {
  const clean = value.replace(/\s+/g, " ").trim();
  return [...new Intl.Segmenter("zh-CN", { granularity: "grapheme" }).segment(clean)].map(item => item.segment);
}

export function excerpt(value: string, max: number) {
  const parts = segments(value);
  return parts.length <= max ? parts.join("") : `${parts.slice(0, max - 1).join("")}…`;
}

export function clamp(value: string, max: number) {
  const parts = segments(value);
  return parts.length <= max ? parts.join("") : parts.slice(0, max).join("");
}

export function title(value: string) {
  return value.replace(/\s*-\s*知乎\s*$/, "").normalize("NFKC").toLowerCase().replace(/[\p{P}\p{S}\s]/gu, "");
}
