// Keeps the dynamic half of the candidate pool rolling.
//
// Once per interval it pulls a fresh batch of platform-recommended questions,
// appends the ones the pool has not seen, drops the oldest once the pool exceeds
// its cap, writes the snapshot boot reads, and pre-warms the new candidates so
// the first room that draws one does not pay the cold-start cost.
//
// Everything here is best-effort by construction. A failed refresh leaves the
// previous pool exactly as it was, which is what keeps a background task from
// being able to break a running game.

import type { TopicProvider } from "../application/ports.ts";
import { attemptSignal } from "../ai/attempt-signal.ts";
import { candidateIdFor, type RecommendedTopicProvider } from "./recommended-topic-provider.ts";
import { candidatesFrom, saveSeed } from "./recommended-seed.ts";
import type { ZhihuContentClient } from "./zhihu-content-client.ts";

export interface RecommendedRefresherOptions {
  client: ZhihuContentClient;
  // The provider rooms resolve against, so an appended candidate is playable
  // immediately rather than at the next restart.
  provider: RecommendedTopicProvider;
  // The full stack, including the persistent cache. Warming has to go through it:
  // resolving on the inner provider would produce a topic that no room ever reads
  // from cache, and the cold path would still run for the first real room.
  stack: TopicProvider;
  count: number;
  max: number;
  intervalMs: number;
  query?: string;
  // Cycled one per round. A fixed query is not enough to keep the pool moving:
  // the platform's recommendation list is stable for a given query, so a refresh
  // that asks the same question every day can keep returning the candidates
  // already in the pool. Empty falls back to query alone.
  queries?: readonly string[];
  seedPath?: string;
  warmNew?: boolean;
  requestTimeoutMs?: number;
  warmTimeoutMs?: number;
  now?: () => number;
  onEvent?: (event: Record<string, unknown>) => void;
}

export interface RefreshResult { added: string[]; removed: string[]; warmed: number }

const EMPTY: RefreshResult = { added: [], removed: [], warmed: 0 };

// Node keeps the process alive for a pending timer, and a daily background task
// must never be the reason a shutdown hangs.
function unref(handle: ReturnType<typeof setTimeout>): void {
  (handle as { unref?: () => void }).unref?.();
}

export class RecommendedRefresher {
  private client: ZhihuContentClient;
  private provider: RecommendedTopicProvider;
  private stack: TopicProvider;
  private count: number;
  private max: number;
  private intervalMs: number;
  private query?: string;
  private queries: readonly string[];
  private seedPath?: string;
  private warmNew: boolean;
  private requestTimeoutMs: number;
  private warmTimeoutMs: number;
  private now: () => number;
  private onEvent?: (event: Record<string, unknown>) => void;

  private controller = new AbortController();
  private timer?: ReturnType<typeof setTimeout>;
  private running = false;
  private closed = false;
  private failures = 0;
  private rounds = 0;

  constructor(options: RecommendedRefresherOptions) {
    this.client = options.client;
    this.provider = options.provider;
    this.stack = options.stack;
    this.count = options.count;
    this.max = options.max;
    this.intervalMs = options.intervalMs;
    this.query = options.query;
    this.queries = options.queries ?? [];
    this.seedPath = options.seedPath;
    this.warmNew = options.warmNew ?? true;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 3_000;
    this.warmTimeoutMs = options.warmTimeoutMs ?? 30_000;
    this.now = options.now ?? Date.now;
    this.onEvent = options.onEvent;
    if (!Number.isInteger(this.count) || this.count < 1 || this.count > 20 ||
      !Number.isInteger(this.max) || this.max < 1 ||
      !Number.isSafeInteger(this.intervalMs) || this.intervalMs <= 0 ||
      !Number.isSafeInteger(this.requestTimeoutMs) || this.requestTimeoutMs <= 0 ||
      !Number.isSafeInteger(this.warmTimeoutMs) || this.warmTimeoutMs <= 0 ||
      this.queries.some(value => !value || value.length > 100)) {
      throw new Error("INVALID_TOPIC_REFRESH_OPTIONS");
    }
  }

  start(): void {
    if (this.closed || this.timer !== undefined) return;
    this.schedule();
  }

  // Synchronous on purpose: shutdown must not block on a warm loop that can run
  // for minutes. Aborting the controller stops it at the next candidate boundary
  // and cancels whatever request is in flight.
  close(): void {
    this.closed = true;
    this.controller.abort();
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }

  // Public so an operator can force a refresh instead of waiting out the
  // interval. Never rejects: every failure is reported as an event.
  async runOnce(): Promise<RefreshResult> {
    // A warm of twenty candidates can outlast a short interval; overlapping runs
    // would spend quota twice for the same batch.
    if (this.running || this.closed) return EMPTY;
    this.running = true;
    const attempt = attemptSignal(this.controller.signal, this.requestTimeoutMs);
    try {
      const items = await this.client.recommendQuestions(this.nextQuery(), this.count, attempt.signal);
      const candidates = candidatesFrom(items);
      if (!candidates.length) {
        this.failures = 0;
        this.emit({ event: "topic.refresh.empty" });
        return EMPTY;
      }
      // Filtered against the live pool, curated packs included: a duplicate id
      // would make RoomRuntime's modulo alias two candidates onto one topic.
      const known = new Set(this.stack.candidateIds);
      const added = this.provider.append(
        candidates.filter(candidate => !known.has(candidateIdFor(candidate.questionId))));
      const removed = this.provider.trim(this.max);
      await this.persist();
      // Only the new candidates are warmed: the rest are either already cached or
      // already failed once, and retrying them every day would spend the quota
      // that the next batch needs.
      const warmed = this.warmNew ? await this.warm(added) : 0;
      this.failures = 0;
      this.emit({ event: "topic.refresh.ok", added: added.length, removed: removed.length,
        warmed, total: this.provider.candidateIds.length });
      return { added, removed, warmed };
    } catch (error) {
      this.failures++;
      this.emit({ event: "topic.refresh.failed", failures: this.failures,
        reason: error instanceof Error ? error.message : "UNKNOWN" });
      return EMPTY;
    } finally {
      attempt.close();
      this.running = false;
    }
  }

  // Advances one step per round, so consecutive batches are asked different
  // questions instead of the same one. Bounded by the client's own 100-character
  // query limit, which the constructor checks.
  private nextQuery(): string | undefined {
    if (!this.queries.length) return this.query;
    const query = this.queries[this.rounds % this.queries.length];
    this.rounds++;
    return query;
  }

  private async persist(): Promise<void> {
    if (!this.seedPath) return;
    // Derived from the live pool rather than from this batch, so a crash between
    // append and save can only lose candidates, never resurrect trimmed ones.
    await saveSeed(this.seedPath, { candidates: this.provider.snapshot(),
      fetchedAt: new Date(this.now()).toISOString() });
  }

  // Sequential on purpose: each candidate costs one question_answers unit and one
  // model call, and the model relay is the slow part. A candidate that fails to
  // warm stays cold and is handled by the room path exactly as it is today.
  private async warm(ids: readonly string[]): Promise<number> {
    let ready = 0;
    for (const candidateId of ids) {
      if (this.closed || this.controller.signal.aborted) break;
      const attempt = attemptSignal(this.controller.signal, this.warmTimeoutMs);
      try {
        await this.stack.resolve(candidateId, attempt.signal);
        ready++;
      } catch {
        this.emit({ event: "topic.refresh.warm_failed", candidateId });
      } finally { attempt.close(); }
    }
    return ready;
  }

  private schedule(): void {
    const handle = setTimeout(() => {
      this.timer = undefined;
      void this.runOnce().finally(() => { if (!this.closed) this.schedule(); });
    }, this.delayMs());
    unref(handle);
    this.timer = handle;
  }

  // Backs off after consecutive failures, so a deliberately short interval cannot
  // turn an exhausted daily quota into a request loop. Capped rather than
  // permanent, so recovery still needs no restart.
  private delayMs(): number {
    return this.intervalMs * Math.min(2 ** this.failures, 8);
  }

  private emit(event: Record<string, unknown>): void {
    try { this.onEvent?.(event); } catch { /* Observability cannot alter the pool. */ }
  }
}
