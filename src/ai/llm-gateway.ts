import type { AiCommand, AiProvider, AiRequest } from "../application/ports.ts";
import type { LlmProvider } from "./llm-provider.ts";
import { parseAiCommand } from "./output-parser.ts";
import { buildPrompt, PROMPT_VERSION } from "./prompt-builder.ts";

export interface AiAttemptEvent {
  provider: string;
  model: string;
  action: AiRequest["action"];
  promptVersion: string;
  status: "success" | "timeout" | "provider-error" | "invalid-output" | "aborted";
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
}

function attemptSignal(outer: AbortSignal, timeoutMs: number) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  outer.addEventListener("abort", abort, { once: true });
  if (outer.aborted) controller.abort();
  const timeout = setTimeout(abort, timeoutMs);
  return { signal: controller.signal, timedOut: () => !outer.aborted && controller.signal.aborted,
    close: () => { clearTimeout(timeout); outer.removeEventListener("abort", abort); } };
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
  private onAttempt?: (event: AiAttemptEvent) => void;

  constructor(providers: readonly LlmProvider[], options: { attemptTimeoutMs?: number; onAttempt?: (event: AiAttemptEvent) => void } = {}) {
    if (!providers.length || new Set(providers.map(provider => provider.id)).size !== providers.length) throw new Error("INVALID_LLM_PROVIDERS");
    this.providers = providers;
    this.attemptTimeoutMs = options.attemptTimeoutMs ?? 8_000;
    if (!Number.isSafeInteger(this.attemptTimeoutMs) || this.attemptTimeoutMs <= 0) throw new Error("INVALID_LLM_TIMEOUT");
    this.onAttempt = options.onAttempt;
  }

  async act(request: AiRequest, signal: AbortSignal): Promise<AiCommand> {
    const prompt = buildPrompt(request);
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
        this.report({ provider: provider.id, model: provider.model, action: request.action,
          promptVersion: PROMPT_VERSION, status, latencyMs: Date.now() - startedAt });
        if (signal.aborted) throw new Error("AI_ABORTED");
      } finally { attempt.close(); }
    }
    throw new Error("AI_PROVIDERS_EXHAUSTED");
  }

  private report(event: AiAttemptEvent) {
    try { this.onAttempt?.(event); } catch { /* Observability cannot alter gameplay. */ }
  }
}
