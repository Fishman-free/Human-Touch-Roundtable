export interface LlmMessage { role: "system" | "user"; content: string }
export interface LlmRequest { messages: LlmMessage[]; temperature: number; maxTokens: number }
export interface LlmCompletion { content: string; inputTokens?: number; outputTokens?: number }

export interface LlmProvider {
  id: string;
  model: string;
  complete(request: LlmRequest, signal: AbortSignal): Promise<LlmCompletion>;
}
