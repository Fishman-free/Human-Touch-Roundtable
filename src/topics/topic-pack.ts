import { ANSWER_LIMIT, charCount } from "../contracts/rules.ts";
import type { Round, Topic } from "../game/model.ts";

export interface TopicPackV1 {
  schemaVersion: 1;
  packId: string;
  source: "zhihu";
  curatedAt: string;
  question: {
    id: string;
    title: string;
    url: string;
    topAnswerExcerpt: string;
    topConsensusSummary: string;
  };
  tags: string[];
  defaults: Record<Round, string[]>;
}

type Value = Record<string, unknown>;
function object(value: unknown): value is Value { return typeof value === "object" && value !== null && !Array.isArray(value); }
function exact(value: Value, fields: readonly string[]) {
  return Object.keys(value).every(key => fields.includes(key)) && fields.every(key => key in value);
}
function clean(value: unknown, max = 500): string {
  if (typeof value !== "string" || value !== value.trim() || !value || charCount(value) > max) throw new Error("INVALID_TOPIC_PACK");
  return value;
}
function date(value: unknown): string {
  const result = clean(value, 64);
  if (!result.endsWith("Z") || Number.isNaN(Date.parse(result))) throw new Error("INVALID_TOPIC_PACK");
  return result;
}

export function parseTopicPack(input: unknown): TopicPackV1 {
  if (!object(input) || !exact(input, ["schemaVersion", "packId", "source", "curatedAt", "question", "tags", "defaults"]) ||
    input.schemaVersion !== 1 || input.source !== "zhihu" || !object(input.question) || !object(input.defaults) ||
    !exact(input.question, ["id", "title", "url", "topAnswerExcerpt", "topConsensusSummary"]) || !Array.isArray(input.tags)) {
    throw new Error("INVALID_TOPIC_PACK");
  }
  const packId = clean(input.packId, 80);
  if (!/^[a-z0-9][a-z0-9-]{2,79}$/.test(packId)) throw new Error("INVALID_TOPIC_PACK");
  const id = clean(input.question.id, 40);
  if (!/^\d+$/.test(id)) throw new Error("INVALID_TOPIC_PACK");
  const url = clean(input.question.url, 300);
  if (url !== `https://www.zhihu.com/question/${id}`) throw new Error("INVALID_TOPIC_PACK");
  const defaults = {} as Record<Round, string[]>;
  for (const round of [1, 2, 3] as const) {
    const pool = input.defaults[String(round)];
    if (!Array.isArray(pool) || pool.length < 2 || pool.length > 16) throw new Error("INVALID_TOPIC_PACK");
    defaults[round] = pool.map(item => clean(item, ANSWER_LIMIT[round]));
    if (round === 2 && (!defaults[round].some(item => /^正方：\S/.test(item)) ||
      !defaults[round].some(item => /^反方：\S/.test(item)) || !defaults[round].every(item => /^(正方|反方)：\S/.test(item)))) {
      throw new Error("INVALID_TOPIC_PACK");
    }
  }
  const tags = input.tags.map(item => clean(item, 24));
  if (new Set(tags).size !== tags.length || tags.length > 12) throw new Error("INVALID_TOPIC_PACK");
  return {
    schemaVersion: 1, packId, source: "zhihu", curatedAt: date(input.curatedAt),
    question: { id, title: clean(input.question.title, 120), url,
      topAnswerExcerpt: clean(input.question.topAnswerExcerpt, 200),
      topConsensusSummary: clean(input.question.topConsensusSummary, 120) },
    tags, defaults,
  };
}

export function normalizeTopicPack(pack: TopicPackV1, verifiedAt?: string): Topic {
  const valid = parseTopicPack(pack);
  if (verifiedAt !== undefined) date(verifiedAt);
  return {
    id: valid.question.id, title: valid.question.title, url: valid.question.url,
    topAnswerExcerpt: valid.question.topAnswerExcerpt,
    topConsensusSummary: valid.question.topConsensusSummary,
    defaults: structuredClone(valid.defaults),
    provenance: { packId: valid.packId, source: valid.source, curatedAt: valid.curatedAt, ...(verifiedAt ? { verifiedAt } : {}) },
  };
}
