import type { TopicProvider } from "../application/ports.ts";
import type { Topic } from "../game/model.ts";

export class CachedTopicProvider implements TopicProvider {
  private source: TopicProvider;
  private ttlMs: number;
  private now: () => number;
  private cache = new Map<string, { expiresAt: number; topic: Topic }>();
  private inFlight = new Map<string, Promise<Topic>>();

  constructor(source: TopicProvider, ttlMs: number, now: () => number = Date.now) {
    if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) throw new Error("INVALID_TOPIC_CACHE_TTL");
    this.source = source;
    this.ttlMs = ttlMs;
    this.now = now;
  }

  // Read through rather than snapshotted: the refresh loop appends candidates to
  // the wrapped provider while rooms are being served.
  get candidateIds(): readonly string[] { return this.source.candidateIds; }

  async resolve(candidateId: string, signal: AbortSignal): Promise<Topic> {
    if (signal.aborted) throw new Error("ABORTED");
    const now = this.now();
    const cached = this.cache.get(candidateId);
    if (cached && cached.expiresAt > now) return structuredClone(cached.topic);
    const running = this.inFlight.get(candidateId);
    if (running) return structuredClone(await running);
    const request = this.source.resolve(candidateId, signal).then(topic => {
      this.cache.set(candidateId, { expiresAt: this.now() + this.ttlMs, topic: structuredClone(topic) });
      return topic;
    }).finally(() => this.inFlight.delete(candidateId));
    this.inFlight.set(candidateId, request);
    return structuredClone(await request);
  }
}
