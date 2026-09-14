// Disk snapshot of the recommended-question candidate list. It exists so that
// boot never depends on a network call: without it, a DNS failure or an
// exhausted daily quota at container start would leave the dynamic half of the
// candidate pool empty until the next restart.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { questionIdFromUrl, type ZhihuRecommendedQuestion } from "./zhihu-content-client.ts";
import { checkHumanContent } from "../safety/content-policy.ts";
import { charCount } from "../contracts/rules.ts";

export const SEED_VERSION = 1;
export const CANDIDATE_TITLE_LIMIT = 120;

export interface RecommendedCandidate { questionId: string; title: string; url: string }
export interface RecommendedSeed { candidates: RecommendedCandidate[]; fetchedAt: string }

export function canonicalQuestionUrl(questionId: string): string {
  return `https://www.zhihu.com/question/${questionId}`;
}

// Structural parsing only: the URL is rebuilt from the parsed id so tracking
// parameters never reach the topic. Unresolvable entries are dropped rather than
// failing the whole seed, because a candidate that cannot resolve would occupy a
// pool slot and fail on every retry.
export function candidatesFrom(items: readonly ZhihuRecommendedQuestion[]): RecommendedCandidate[] {
  const seen = new Set<string>();
  const candidates: RecommendedCandidate[] = [];
  for (const item of items) {
    const questionId = questionIdFromUrl(item.url);
    if (!questionId || seen.has(questionId)) continue;
    const title = item.title.trim();
    // Screened here so a candidate that could never be published never enters
    // the pool; RecommendedTopicProvider screens again before it publishes.
    const decision = checkHumanContent(title);
    if (!decision.ok || charCount(decision.text) > CANDIDATE_TITLE_LIMIT) continue;
    seen.add(questionId);
    candidates.push({ questionId, title: decision.text, url: canonicalQuestionUrl(questionId) });
  }
  return candidates;
}

export function parseSeed(input: unknown): RecommendedSeed | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
  const value = input as Record<string, unknown>;
  if (value.version !== SEED_VERSION || typeof value.fetchedAt !== "string" ||
    !Number.isFinite(Date.parse(value.fetchedAt)) || !Array.isArray(value.candidates)) return null;
  const candidates: RecommendedCandidate[] = [];
  const seen = new Set<string>();
  for (const entry of value.candidates) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) continue;
    const { questionId, title, url } = entry as Record<string, unknown>;
    if (typeof questionId !== "string" || !/^\d+$/.test(questionId) || typeof title !== "string" || !title ||
      typeof url !== "string" || url !== canonicalQuestionUrl(questionId) || seen.has(questionId)) continue;
    seen.add(questionId);
    candidates.push({ questionId, title, url });
  }
  return candidates.length ? { candidates, fetchedAt: value.fetchedAt } : null;
}

export function isFresh(seed: RecommendedSeed, ttlMs: number, now = Date.now): boolean {
  return now() - Date.parse(seed.fetchedAt) <= ttlMs;
}

export async function loadSeed(path: string): Promise<RecommendedSeed | null> {
  try {
    return parseSeed(JSON.parse(await readFile(path, "utf8")));
  } catch {
    // Missing or unreadable seed is a normal first run, not an error.
    return null;
  }
}

export async function saveSeed(path: string, seed: RecommendedSeed): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify({ version: SEED_VERSION, ...seed }, null, 2), { mode: 0o600 });
}
