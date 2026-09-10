import type { LlmCompletion, LlmProvider, LlmRequest } from "../llm-provider.ts";

export interface OpenAiCompatibleConfig {
  id: string;
  endpoint: string;
  apiKey: string;
  model: string;
  fetch?: typeof globalThis.fetch;
}

export class OpenAiCompatibleProvider implements LlmProvider {
  readonly id: string;
  readonly model: string;
  private endpoint: string;
  private apiKey: string;
  private fetch: typeof globalThis.fetch;

  constructor(config: OpenAiCompatibleConfig) {
    const endpoint = new URL(config.endpoint);
    if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash ||
      !config.id || !config.apiKey || !config.model) throw new Error("INVALID_LLM_PROVIDER_CONFIG");
    this.id = config.id;
    this.model = config.model;
    this.endpoint = endpoint.toString();
    this.apiKey = config.apiKey;
    this.fetch = config.fetch ?? globalThis.fetch;
  }

  async complete(request: LlmRequest, signal: AbortSignal): Promise<LlmCompletion> {
    const response = await this.fetch(this.endpoint, {
      method: "POST", signal,
      headers: { "authorization": `Bearer ${this.apiKey}`, "content-type": "application/json", "accept": "application/json" },
      body: JSON.stringify({ model: this.model, messages: request.messages, temperature: request.temperature,
        max_tokens: request.maxTokens, response_format: { type: "json_object" } }),
    });
    if (!response.ok) throw new Error(`LLM_HTTP_${response.status}`);
    const declared = Number(response.headers.get("content-length") ?? 0);
    if (declared > 64 * 1024) throw new Error("LLM_RESPONSE_TOO_LARGE");
    const body = await response.text();
    if (new TextEncoder().encode(body).length > 64 * 1024) throw new Error("LLM_RESPONSE_TOO_LARGE");
    let data: unknown;
    try { data = JSON.parse(body); } catch { throw new Error("INVALID_LLM_RESPONSE"); }
    const value = data as { choices?: { message?: { content?: unknown } }[];
      usage?: { prompt_tokens?: unknown; completion_tokens?: unknown } };
    const content = value.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) throw new Error("INVALID_LLM_RESPONSE");
    const inputTokens = Number.isSafeInteger(value.usage?.prompt_tokens) ? value.usage!.prompt_tokens as number : undefined;
    const outputTokens = Number.isSafeInteger(value.usage?.completion_tokens) ? value.usage!.completion_tokens as number : undefined;
    return { content, inputTokens, outputTokens };
  }
}
