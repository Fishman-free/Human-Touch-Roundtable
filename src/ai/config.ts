import type { AiProvider } from "../application/ports.ts";
import { MockAiProvider } from "./mock-ai-provider.ts";
import { LlmGateway, type AiAttemptEvent } from "./llm-gateway.ts";
import { OpenAiCompatibleProvider } from "./providers/openai-compatible.ts";

export function createAiProvider(environment: Readonly<Record<string, string | undefined>>, development: boolean,
  onAttempt?: (event: AiAttemptEvent) => void): AiProvider {
  const mode = environment.AI_MODE ?? (development ? "mock" : "live");
  if (mode === "mock") {
    if (!development) throw new Error("MOCK_AI_NOT_ALLOWED_IN_PRODUCTION");
    return new MockAiProvider();
  }
  if (mode !== "live") throw new Error("INVALID_AI_MODE");
  const providers = [];
  if (environment.DEEPSEEK_API_KEY) providers.push(new OpenAiCompatibleProvider({
    id: "deepseek", endpoint: environment.DEEPSEEK_ENDPOINT ?? "https://api.deepseek.com/chat/completions", apiKey: environment.DEEPSEEK_API_KEY,
    model: environment.DEEPSEEK_MODEL ?? "deepseek-chat",
  }));
  if (environment.GLM_API_KEY) providers.push(new OpenAiCompatibleProvider({
    id: "glm", endpoint: environment.GLM_ENDPOINT ?? "https://open.bigmodel.cn/api/paas/v4/chat/completions", apiKey: environment.GLM_API_KEY,
    model: environment.GLM_MODEL ?? "glm-4-flash",
    ...(environment.GLM_THINKING ? { extraBody: { thinking: { type: environment.GLM_THINKING } } } : {}),
  }));
  const timeout = Number(environment.AI_ATTEMPT_TIMEOUT_MS ?? 14_000);
  const maxTokens = Number(environment.AI_MAX_TOKENS ?? 1_024);
  return new LlmGateway(providers, { attemptTimeoutMs: timeout, maxTokens, onAttempt });
}
