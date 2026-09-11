import type { TopicProvider } from "../application/ports.ts";
import { StaticTopicProvider } from "./static-topic-provider.ts";
import { curatedTopicPacks } from "./static-topic-provider.ts";
import { CachedTopicProvider } from "./cached-topic-provider.ts";
import { VerifiedTopicProvider } from "./verified-topic-provider.ts";
import { ZhihuContentClient } from "./zhihu-content-client.ts";
import { ZhihuSearchQuestionGateway } from "./zhihu-search-gateway.ts";

export function createTopicProvider(environment: Readonly<Record<string, string | undefined>>,
  development: boolean): TopicProvider {
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
    const provider = new VerifiedTopicProvider(curatedTopicPacks,
      new ZhihuSearchQuestionGateway(new ZhihuContentClient({ accessSecret: secret })));
    const ttl = Number(environment.ZHIHU_TOPIC_CACHE_MS ?? 6 * 60 * 60 * 1_000);
    return new CachedTopicProvider(provider, ttl);
  }
  throw new Error("INVALID_TOPIC_MODE");
}
