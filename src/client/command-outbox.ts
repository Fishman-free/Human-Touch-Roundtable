import type { ClientToServerEvents, SocketCommandAck } from "../contracts/public.ts";

export type CommandEvent = "room:ready" | "game:answer" | "game:accuse" | "game:respond" |
  "game:followup" | "game:skip-followup" | "game:vote";
export type CommandSubmission = { [K in CommandEvent]: {
  event: K;
  input: Parameters<ClientToServerEvents[K]>[0];
} }[CommandEvent];

export interface OutboxStorage {
  get(): string | null;
  set(value: string): void;
  remove(): void;
}
export interface OutboxTimer {
  set(callback: () => void, delayMs: number): unknown;
  clear(handle: unknown): void;
}
export type OutboxTransport = (submission: CommandSubmission, acknowledge: (ack: SocketCommandAck) => void) => void;

function parse(value: string | null): CommandSubmission | undefined {
  if (!value) return;
  let result: unknown;
  try { result = JSON.parse(value); } catch { return; }
  const item = result as { event?: unknown; input?: { commandId?: unknown; matchId?: unknown; phaseToken?: unknown } };
  if (!item || !["room:ready", "game:answer", "game:accuse", "game:respond", "game:followup",
    "game:skip-followup", "game:vote"].includes(String(item.event)) || !item.input ||
    typeof item.input.commandId !== "string" || typeof item.input.matchId !== "string" ||
    !Number.isSafeInteger(item.input.phaseToken)) return;
  return result as CommandSubmission;
}

export class CommandOutbox {
  private storage: OutboxStorage;
  private timer: OutboxTimer;
  private timeoutMs: number;
  private maxAttempts: number;
  private onAck: (ack: SocketCommandAck) => void;
  private onUncertain: () => void;
  private pending?: CommandSubmission;
  private attempts = 0;
  private handle?: unknown;

  constructor(options: { storage: OutboxStorage; timer?: OutboxTimer; timeoutMs?: number; maxAttempts?: number;
    onAck: (ack: SocketCommandAck) => void; onUncertain: () => void }) {
    this.storage = options.storage;
    this.timer = options.timer ?? { set: (callback, delay) => setTimeout(callback, delay),
      clear: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) };
    this.timeoutMs = options.timeoutMs ?? 5_000;
    this.maxAttempts = options.maxAttempts ?? 3;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs <= 0 ||
      !Number.isSafeInteger(this.maxAttempts) || this.maxAttempts <= 0) throw new Error("INVALID_OUTBOX_OPTIONS");
    this.onAck = options.onAck;
    this.onUncertain = options.onUncertain;
    this.pending = parse(this.storage.get());
    if (!this.pending) this.storage.remove();
  }

  hasPending() { return this.pending !== undefined; }
  current() { return this.pending ? structuredClone(this.pending) : undefined; }

  submit(submission: CommandSubmission, transport: OutboxTransport): boolean {
    if (this.pending) return false;
    this.pending = structuredClone(submission);
    this.attempts = 0;
    this.storage.set(JSON.stringify(this.pending));
    this.send(transport);
    return true;
  }

  resume(transport: OutboxTransport) {
    if (!this.pending || this.handle !== undefined) return;
    this.attempts = 0;
    this.send(transport);
  }

  pause() {
    if (this.handle !== undefined) this.timer.clear(this.handle);
    this.handle = undefined;
  }

  clear() {
    this.pause();
    this.pending = undefined;
    this.attempts = 0;
    this.storage.remove();
  }

  private send(transport: OutboxTransport) {
    const submission = this.pending;
    if (!submission) return;
    this.attempts++;
    this.handle = this.timer.set(() => {
      this.handle = undefined;
      if (!this.pending || this.pending.input.commandId !== submission.input.commandId) return;
      if (this.attempts < this.maxAttempts) this.send(transport);
      else this.onUncertain();
    }, this.timeoutMs);
    try {
      transport(structuredClone(submission), ack => {
        if (this.pending?.input.commandId !== submission.input.commandId) return;
        this.clear();
        this.onAck(ack);
      });
    } catch {
      this.pause();
      this.onUncertain();
    }
  }
}
