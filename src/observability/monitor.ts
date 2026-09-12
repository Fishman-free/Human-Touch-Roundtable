import type { AiAttemptEvent } from "../ai/llm-gateway.ts";
import type { DiagnosticKind } from "../application/ports.ts";
import type { SecurityEvent } from "../server/socket-gateway.ts";
import { JsonLogger } from "./logger.ts";
import { MetricsRegistry } from "./metrics.ts";

export class OperationalMonitor {
  readonly metrics: MetricsRegistry;
  private logger: JsonLogger;
  constructor(logger = new JsonLogger(), metrics = new MetricsRegistry()) { this.logger = logger; this.metrics = metrics; }

  runtime(event: { roomId: string; kind: DiagnosticKind }) {
    this.metrics.increment("roundtable_runtime_events_total", { kind: event.kind });
    this.logger.warn("runtime.event", { kind: event.kind });
  }
  ai(event: AiAttemptEvent) {
    const labels = { provider: event.provider, model: event.model, action: event.action, status: event.status };
    this.metrics.increment("roundtable_ai_attempts_total", labels);
    this.metrics.observe("roundtable_ai_latency_ms", event.latencyMs, labels);
    if (event.inputTokens !== undefined) this.metrics.increment("roundtable_ai_input_tokens_total", { provider: event.provider, model: event.model }, event.inputTokens);
    if (event.outputTokens !== undefined) this.metrics.increment("roundtable_ai_output_tokens_total", { provider: event.provider, model: event.model }, event.outputTokens);
    this.logger.info("ai.attempt", event as unknown as Record<string, unknown>);
  }
  security(event: SecurityEvent) {
    this.metrics.increment("roundtable_security_events_total", { kind: event.kind });
    this.logger.warn("security.event", { kind: event.kind });
  }
  lifecycle(event: string, fields: Record<string, unknown> = {}) {
    this.logger.info(event, fields);
  }
}
