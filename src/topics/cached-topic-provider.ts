import type { TopicProvider } from "../application/ports.ts";
import type { Topic } from "../game/model.ts";

export class CachedTopicProvider implements TopicProvider {
  readonly candidateIds: readonly string[];
  private source: TopicProvider;
  private ttlMs: number;
  private now: () => number;
  private cache = new Map<string, { expiresAt: number; topic: Topic }>();

  constructor(source: TopicProvider, ttlMs: number, now: () => number = Date.now) {
    if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) throw new Error("INVALID_TOPIC_CACHE_TTL");
    this.source = source;
    this.candidateIds = source.candidateIds;
    this.ttlMs = ttlMs;
    this.now = now;
  }

  async resolve(candidateId: string, signal: AbortSignal): Promise<Topic> {
    if (signal.aborted) throw new Error("ABORTED");
    const now = this.now();
    const cached = this.cache.get(candidateId);
    if (cached && cached.expiresAt > now) return structuredClone(cached.topic);
    const topic = await this.source.resolve(candidateId, signal);
    this.cache.set(candidateId, { expiresAt: now + this.ttlMs, topic: structuredClone(topic) });
    return structuredClone(topic);
  }
}
