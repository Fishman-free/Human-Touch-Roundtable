import type { AiCommand, AiProvider, AiRequest } from "../application/ports.ts";
import type { LlmProvider } from "./llm-provider.ts";
import { parseAiCommand } from "./output-parser.ts";
import { buildPrompt, PROMPT_VERSION } from "./prompt-builder.ts";
import { attemptSignal } from "./attempt-signal.ts";

export interface AiAttemptEvent {
  provider: string;
  model: string;
  action: AiRequest["action"];
  promptVersion: string;
  status: "success" | "timeout" | "provider-error" | "invalid-output" | "aborted";
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
  errorCode?: string;
}

function complete(provider: LlmProvider, request: ReturnType<typeof buildPrompt>, signal: AbortSignal) {
  if (signal.aborted) return Promise.reject(new Error("AI_ATTEMPT_ABORTED"));
  return new Promise<Awaited<ReturnType<LlmProvider["complete"]>>>((resolve, reject) => {
    const abort = () => reject(new Error("AI_ATTEMPT_ABORTED"));
    signal.addEventListener("abort", abort, { once: true });
    void provider.complete(request, signal).then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

export class LlmGateway implements AiProvider {
  private providers: readonly LlmProvider[];
  private attemptTimeoutMs: number;
  private maxTokens: number;
  private onAttempt?: (event: AiAttemptEvent) => void;

  constructor(providers: readonly LlmProvider[], options: { attemptTimeoutMs?: number; maxTokens?: number;
    onAttempt?: (event: AiAttemptEvent) => void } = {}) {
    if (!providers.length || new Set(providers.map(provider => provider.id)).size !== providers.length) throw new Error("INVALID_LLM_PROVIDERS");
    this.providers = providers;
    this.attemptTimeoutMs = options.attemptTimeoutMs ?? 8_000;
    this.maxTokens = options.maxTokens ?? 1_024;
    if (!Number.isSafeInteger(this.attemptTimeoutMs) || this.attemptTimeoutMs <= 0 ||
      !Number.isSafeInteger(this.maxTokens) || this.maxTokens < 64 || this.maxTokens > 4_096) throw new Error("INVALID_LLM_OPTIONS");
    this.onAttempt = options.onAttempt;
  }

  async act(request: AiRequest, signal: AbortSignal): Promise<AiCommand> {
    const prompt = buildPrompt(request, this.maxTokens);
    for (const provider of this.providers) {
      const startedAt = Date.now();
      const attempt = attemptSignal(signal, Math.min(this.attemptTimeoutMs, Math.max(1, request.deadlineAt - Date.now())));
      try {
        const completion = await complete(provider, prompt, attempt.signal);
        const command = parseAiCommand(completion.content, request);
        this.report({ provider: provider.id, model: provider.model, action: request.action, promptVersion: PROMPT_VERSION,
          status: "success", latencyMs: Date.now() - startedAt,
          inputTokens: completion.inputTokens, outputTokens: completion.outputTokens });
        return command;
      } catch (error) {
        const status: AiAttemptEvent["status"] = signal.aborted ? "aborted" : attempt.timedOut() ? "timeout" :
          error instanceof Error && /AI_(?:JSON|OUTPUT|TARGET)|UNSAFE/.test(error.message) ? "invalid-output" : "provider-error";
        const message = error instanceof Error ? error.message : "";
        const errorCode = /^(?:LLM_HTTP_\d{3}|LLM_RESPONSE_TOO_LARGE|INVALID_LLM_RESPONSE|INVALID_AI_[A-Z_]+|AI_OUTPUT_TOO_LONG|UNSAFE_AI_OUTPUT)$/.test(message)
          ? message : undefined;
        this.report({ provider: provider.id, model: provider.model, action: request.action,
          promptVersion: PROMPT_VERSION, status, latencyMs: Date.now() - startedAt, errorCode });
        if (signal.aborted) throw new Error("AI_ABORTED");
      } finally { attempt.close(); }
    }
    throw new Error("AI_PROVIDERS_EXHAUSTED");
  }

  private report(event: AiAttemptEvent) {
    try { this.onAttempt?.(event); } catch { /* Observability cannot alter gameplay. */ }
  }
}
