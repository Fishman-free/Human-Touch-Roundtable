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
import { LlmTopicContentGenerator } from "./topic-content-generator.ts";

const DAY_MS = 24 * 60 * 60 * 1_000;

export interface TopicProviderOptions {
  // Supplied by openTopicProvider in recommended mode. Undefined there is a
  // programming error: the boot path always passes a seed, possibly empty.
  recommended?: RecommendedSeed;
  llm?: readonly LlmProvider[];
  onAlert?: (event: Record<string, unknown>) => void;
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
    const providers: TopicProvider[] = [
      new VerifiedTopicProvider(productionTopicPacks, new ZhihuSearchQuestionGateway(client)),
    ];
    // An empty dynamic half degrades this mode to exactly `verified`, which is
    // what keeps the server usable when boot had neither a seed nor a network.
    if (seed.candidates.length) providers.push(new RecommendedTopicProvider(seed, {
      client,
      content: new LlmTopicContentGenerator(options.llm ?? [], {
        maxTokens: Number(environment.TOPIC_AI_MAX_TOKENS ?? 2_048),
        attemptTimeoutMs: Number(environment.TOPIC_AI_TIMEOUT_MS ?? 8_000),
      }),
      answerLimit: Number(environment.ZHIHU_ANSWERS_LIMIT ?? 20),
      fallback: environment.ZHIHU_TOPIC_FALLBACK === "fail" ? "fail" : "static",
      onEvent: options.onAlert,
    }));
    const union = new UnionTopicProvider(providers,
      environment.ZHIHU_TOPIC_UNION_ORDER === "dynamic-first" ? "dynamic-first" : "curated-first");
    return persistent(union, environment);
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
