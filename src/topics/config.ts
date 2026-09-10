import type { TopicProvider } from "../application/ports.ts";
import { StaticTopicProvider } from "./static-topic-provider.ts";

export function createTopicProvider(environment: Readonly<Record<string, string | undefined>>,
  development: boolean): TopicProvider {
  const mode = environment.TOPIC_MODE ?? (development ? "static" : "verified");
  if (mode === "static") {
    if (!development && environment.ALLOW_STATIC_TOPICS_IN_PRODUCTION !== "true") {
      throw new Error("STATIC_TOPICS_NOT_ALLOWED_IN_PRODUCTION");
    }
    return new StaticTopicProvider();
  }
  if (mode === "verified") throw new Error("ZHIHU_GATEWAY_NOT_CONFIGURED");
  throw new Error("INVALID_TOPIC_MODE");
}
