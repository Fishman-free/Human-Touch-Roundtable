import type { TopicProvider } from "../application/ports.ts";
import type { LlmProvider } from "../ai/llm-provider.ts";
import { StaticTopicProvider } from "./static-topic-provider.ts";
import { productionTopicPacks } from "./static-topic-provider.ts";
import { CachedTopicProvider } from "./cached-topic-provider.ts";
import { VerifiedTopicProvider } from "./verified-topic-provider.ts";
import { ZhihuContentClient } from "./zhihu-content-client.ts";
import { ZhihuSearchQuestionGateway } from "./zhihu-search-gateway.ts";
import { PersistentTopicCache } from "./persistent-topic-cache.ts";
import { RecommendedTopicProvider } from "./recommended-topic-provider.ts";
import { UnionTopicProvider } from "./union-topic-provider.ts";
import { candidatesFrom, isFresh, loadSeed, saveSeed, type RecommendedSeed } from "./recommended-seed.ts";
import { RecommendedRefresher, type RecommendedRefresherOptions } from "./recommended-refresher.ts";
import { LlmTopicContentGenerator } from "./topic-content-generator.ts";

const DAY_MS = 24 * 60 * 60 * 1_000;

// The pieces the refresh loop has to share with the rooms it feeds. Rebuilding
// any of them outside would produce a second pool that nothing ever reads, so
// recommended mode hands the originals back through onRecommended instead of
// widening the TopicProvider port with fields only one caller uses.
export interface RecommendedWiring {
  client: ZhihuContentClient;
  provider: RecommendedTopicProvider;
  stack: TopicProvider;
}

export interface TopicProviderOptions {
  // Supplied by openTopicProvider in recommended mode. Undefined there is a
  // programming error: the boot path always passes a seed, possibly empty.
  recommended?: RecommendedSeed;
  llm?: readonly LlmProvider[];
  onAlert?: (event: Record<string, unknown>) => void;
  onRecommended?: (wiring: RecommendedWiring) => void;
}

export interface TopicBootOptions extends TopicProviderOptions {
  fetch?: typeof globalThis.fetch;
  now?: () => number;
}

function persistent(provider: TopicProvider, environment: Readonly<Record<string, string | undefined>>) {
  const ttl = Number(environment.ZHIHU_TOPIC_CACHE_MS ?? 6 * 60 * 60 * 1_000);
  const cachePath = environment.ZHIHU_TOPIC_CACHE_PATH;
  return cachePath ? new PersistentTopicCache(provider, cachePath, ttl, Date.now, event => console.warn(JSON.stringify({ event: "topic.verification.alert", ...event }))) : new CachedTopicProvider(provider, ttl);
}

// No I/O on purpose: scripts and tests call this synchronously. The recommended
// mode's boot fetch lives in openTopicProvider.
export function createTopicProvider(environment: Readonly<Record<string, string | undefined>>,
  development: boolean, options: TopicProviderOptions = {}): TopicProvider {
  const mode = environment.TOPIC_MODE ?? (development ? "static" : "verified");
  if (mode === "static") {
    if (!development && environment.ALLOW_STATIC_TOPICS_IN_PRODUCTION !== "true") {
      throw new Error("STATIC_TOPICS_NOT_ALLOWED_IN_PRODUCTION");
    }
    return new StaticTopicProvider();
  }
  if (mode === "verified") {
    const secret = environment.ZHIHU_ACCESS_SECRET;
    if (!secret) throw new Error("ZHIHU_ACCESS_SECRET_REQUIRED");
    const interval = Number(environment.ZHIHU_MIN_REQUEST_INTERVAL_MS ?? 1_000);
    const provider = new VerifiedTopicProvider(productionTopicPacks,
      new ZhihuSearchQuestionGateway(new ZhihuContentClient({ accessSecret: secret, minRequestIntervalMs: interval })));
    return persistent(provider, environment);
  }
  if (mode === "recommended") {
    const secret = environment.ZHIHU_ACCESS_SECRET;
    if (!secret) throw new Error("ZHIHU_ACCESS_SECRET_REQUIRED");
    const seed = options.recommended;
    if (!seed) throw new Error("RECOMMENDED_TOPICS_REQUIRE_BOOTSTRAP");
    const client = new ZhihuContentClient({
      accessSecret: secret, minRequestIntervalMs: Number(environment.ZHIHU_MIN_REQUEST_INTERVAL_MS ?? 1_000) });
    const dynamic = new RecommendedTopicProvider(seed, {
      client,
      content: new LlmTopicContentGenerator(options.llm ?? [], {
        maxTokens: Number(environment.TOPIC_AI_MAX_TOKENS ?? 2_048),
        attemptTimeoutMs: Number(environment.TOPIC_AI_TIMEOUT_MS ?? 18_000),
      }),
      answerLimit: Number(environment.ZHIHU_ANSWERS_LIMIT ?? 20),
      fallback: environment.ZHIHU_TOPIC_FALLBACK === "fail" ? "fail" : "static",
      onEvent: options.onAlert,
    });
    // Always merged, even when the pool is empty: an empty dynamic half degrades
    // this mode to exactly `verified`, which is what keeps the server usable when
    // boot had neither a seed nor a network, and leaving the provider in place is
    // what lets the refresh loop fill the pool in later.
    const union = new UnionTopicProvider([
      new VerifiedTopicProvider(productionTopicPacks, new ZhihuSearchQuestionGateway(client)),
      dynamic,
    ], environment.ZHIHU_TOPIC_UNION_ORDER === "dynamic-first" ? "dynamic-first" : "curated-first");
    const stack = persistent(union, environment);
    options.onRecommended?.({ client, provider: dynamic, stack });
    return stack;
  }
  throw new Error("INVALID_TOPIC_MODE");
}

async function fetchSeed(environment: Readonly<Record<string, string | undefined>>, secret: string,
  options: TopicBootOptions): Promise<RecommendedSeed | null> {
  const timeoutMs = Number(environment.ZHIHU_TOPIC_CANDIDATE_TIMEOUT_MS ?? 3_000);
  try {
    // Hard budget: a hanging fetch here would delay http.listen and stall the
    // container healthcheck, so the boot path never waits indefinitely.
    const signal = AbortSignal.timeout(Number.isSafeInteger(timeoutMs) && timeoutMs > 0 ? timeoutMs : 3_000);
    const client = new ZhihuContentClient({ accessSecret: secret, fetch: options.fetch,
      minRequestIntervalMs: Number(environment.ZHIHU_MIN_REQUEST_INTERVAL_MS ?? 1_000) });
    const count = Number(environment.ZHIHU_TOPIC_CANDIDATE_COUNT ?? 20);
    const items = await client.recommendQuestions(environment.ZHIHU_TOPIC_CANDIDATE_QUERY ?? "生活方式",
      Number.isInteger(count) && count >= 1 && count <= 20 ? count : 20, signal);
    const candidates = candidatesFrom(items);
    if (!candidates.length) return null;
    return { candidates, fetchedAt: new Date(options.now?.() ?? Date.now()).toISOString() };
  } catch {
    return null;
  }
}

// Boot ladder, most reliable source first: a fresh snapshot needs no network at
// all; otherwise fetch; otherwise a stale snapshot is still real questions; and
// failing everything leaves the curated packs alone.
async function resolveSeed(environment: Readonly<Record<string, string | undefined>>, secret: string,
  options: TopicBootOptions): Promise<RecommendedSeed> {
  const path = environment.ZHIHU_TOPIC_CANDIDATE_PATH;
  const ttlMs = Number(environment.ZHIHU_TOPIC_CANDIDATE_TTL_MS ?? 7 * DAY_MS);
  const stored = path ? await loadSeed(path) : null;
  if (stored && isFresh(stored, ttlMs, options.now)) return stored;

  const fetched = await fetchSeed(environment, secret, options);
  if (fetched) {
    if (path) {
      try { await saveSeed(path, fetched); } catch { /* An unwritable snapshot must not stop boot. */ }
    }
    return fetched;
  }
  if (stored) return stored;
  options.onAlert?.({ event: "topic.candidates.unavailable" });
  return { candidates: [], fetchedAt: new Date(options.now?.() ?? Date.now()).toISOString() };
}

// Boot entry point. Every mode other than recommended returns synchronously
// without touching the network.
export async function openTopicProvider(environment: Readonly<Record<string, string | undefined>>,
  development: boolean, options: TopicBootOptions = {}): Promise<TopicProvider> {
  const mode = environment.TOPIC_MODE ?? (development ? "static" : "verified");
  if (mode !== "recommended") return createTopicProvider(environment, development, options);
  const secret = environment.ZHIHU_ACCESS_SECRET;
  if (!secret) throw new Error("ZHIHU_ACCESS_SECRET_REQUIRED");
  return createTopicProvider(environment, development, { ...options, recommended: await resolveSeed(environment, secret, options) });
}

export interface TopicSystem {
  topics: TopicProvider;
  // Stops the refresh loop. A no-op in the modes that have none, so callers never
  // have to branch on TOPIC_MODE.
  close(): Promise<void>;
}

// Rolling-pool entry point for the server. openTopicProvider stays the
// provider-only view, for scripts and tests that have no reason to run a refresh
// loop.
export async function openTopicSystem(environment: Readonly<Record<string, string | undefined>>,
  development: boolean, options: TopicBootOptions = {}): Promise<TopicSystem> {
  let wiring: RecommendedWiring | undefined;
  const topics = await openTopicProvider(environment, development,
    { ...options, onRecommended: value => { wiring = value; } });
  const refresher = wiring ? startRefresher(environment, wiring, options) : undefined;
  return { topics, close: async () => { refresher?.close(); } };
}

function startRefresher(environment: Readonly<Record<string, string | undefined>>,
  wiring: RecommendedWiring, options: TopicBootOptions): RecommendedRefresher | undefined {
  // Zero is the documented off switch, which makes rolling revertible with an
  // environment change and a force-recreate rather than a rebuild. A typo must
  // not silently disable it, so anything else non-numeric is a hard error.
  const configured = environment.ZHIHU_TOPIC_REFRESH_MS;
  const intervalMs = Number(configured ?? DAY_MS);
  if (configured !== undefined && (!Number.isSafeInteger(intervalMs) || intervalMs < 0)) {
    throw new Error("INVALID_TOPIC_REFRESH_MS");
  }
  if (intervalMs === 0) return undefined;
  const max = Number(environment.ZHIHU_TOPIC_CANDIDATE_MAX ?? 60);
  if (!Number.isInteger(max) || max < 1) throw new Error("INVALID_TOPIC_CANDIDATE_MAX");

  const count = Number(environment.ZHIHU_TOPIC_CANDIDATE_COUNT ?? 20);
  const refresher: RecommendedRefresherOptions = {
    client: wiring.client, provider: wiring.provider, stack: wiring.stack,
    query: environment.ZHIHU_TOPIC_CANDIDATE_QUERY ?? "生活方式",
    queries: (environment.ZHIHU_TOPIC_CANDIDATE_QUERIES ?? "").split(",")
      .map(value => value.trim()).filter(Boolean),
    count: Number.isInteger(count) && count >= 1 && count <= 20 ? count : 20,
    max, intervalMs,
    seedPath: environment.ZHIHU_TOPIC_CANDIDATE_PATH,
    // Only an explicit "false" turns warming off; every other value leaves it on,
    // because a cold candidate costs the first room that draws it a model call.
    warmNew: environment.ZHIHU_TOPIC_REFRESH_WARM !== "false",
    requestTimeoutMs: Number(environment.ZHIHU_TOPIC_CANDIDATE_TIMEOUT_MS ?? 3_000),
    warmTimeoutMs: Number(environment.TOPIC_TIMEOUT_MS ?? 20_000),
    now: options.now,
    onEvent: options.onAlert,
  };
  const started = new RecommendedRefresher(refresher);
  started.start();
  return started;
}
