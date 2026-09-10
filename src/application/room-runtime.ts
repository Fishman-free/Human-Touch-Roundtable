import { createHash } from "node:crypto";
import type { GameState, Topic } from "../game/model.ts";
import { aiContext, project, type Viewer } from "../game/projection.ts";
import { advanceTime, createGame, transition } from "../game/transition.ts";
import { assignSeats } from "./seat-assignment.ts";
import type { AiAction, AiCommand, CommandAck, DiagnosticKind, PlayerRequest, RoomRecord,
  RoomView, RuntimeDependencies, RuntimeErrorCode, RuntimeOptions } from "./ports.ts";

const defaults: RuntimeOptions = {
  topicTimeoutMs: 10_000, aiTimeoutMs: 15_000, retryMs: 1_000,
  topicBackoffMs: 5_000, topicMaxBackoffMs: 60_000, maxReceipts: 4096,
};
const playerCommands = new Set(["join", "ready", "answer", "accuse", "respond", "followup", "skip-followup", "vote"]);
type Task = { token: number; controller: AbortController; settled: boolean; cancelTimer: () => void };
type Outcome<T> = { ok: true; value: T } | { ok: false };
class StorageUnavailable extends Error {}

// Canonical JSON hashing allows equivalent request objects with different key order.
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value)
    .filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => [key, canonical(item)]));
  return value;
}
function fingerprint(request: PlayerRequest): string {
  return createHash("sha256").update(JSON.stringify(canonical(request))).digest("hex");
}

export class RoomRuntime {
  readonly roomId: string;
  private deps: RuntimeDependencies;
  private options: RuntimeOptions;
  private record: RoomRecord;
  private tail: Promise<void> = Promise.resolve();
  private closed = false;
  private closing = false;
  private closePromise?: Promise<void>;
  private conflict = false;
  private timers = new Set<() => void>();
  private cancelWake?: () => void;
  private tasks = new Map<string, Task>();
  private aiAttempts = new Set<string>();
  private taskToken = -1;
  private subscribers = new Set<{ viewer: Viewer; send: (view: RoomView) => void | Promise<void> }>();

  private constructor(roomId: string, record: RoomRecord, deps: RuntimeDependencies, options: RuntimeOptions) {
    this.roomId = roomId;
    this.record = record;
    this.deps = deps;
    this.options = options;
  }

  static async open(roomId: string, matchId: string, deps: RuntimeDependencies, options: Partial<RuntimeOptions> = {}) {
    if (!roomId.trim() || !matchId.trim()) throw new Error("INVALID_ROOM");
    const config = { ...defaults, ...options };
    if (Object.values(config).some(value => !Number.isSafeInteger(value) || value <= 0) ||
      config.topicMaxBackoffMs < config.topicBackoffMs) throw new Error("INVALID_RUNTIME_OPTIONS");
    let record = await deps.store.load(roomId);
    if (!record) {
      record = { version: 0, state: createGame(matchId, deps.clock.now()), receipts: [],
        preparation: { candidateIndex: 0, cycles: 0, retryAt: 0 } };
      if (!await deps.store.save(roomId, null, structuredClone(record))) throw new Error("ROOM_CONFLICT");
    }
    if (record.state.matchId !== matchId) throw new Error("WRONG_MATCH");
    const runtime = new RoomRuntime(roomId, structuredClone(record), deps, config);
    try {
      await runtime.enqueue(() => runtime.expire());
      runtime.reconcile();
      return runtime;
    } catch (error) {
      await runtime.close();
      throw error;
    }
  }

  // Trusted authenticated participant ID. Network payloads must never select actors.
  dispatch(participantId: string, request: PlayerRequest): Promise<CommandAck> {
    if (this.closing || this.closed) return Promise.resolve(this.failure(request?.commandId ?? "", this.conflict ? "ROOM_CONFLICT" : "ROOM_CLOSED"));
    const input = structuredClone(request);
    return this.enqueue(async () => {
      if (this.closed) return this.failure(input.commandId, this.conflict ? "ROOM_CONFLICT" : "ROOM_CLOSED");
      if (typeof participantId !== "string" || !participantId.trim() || !input ||
        typeof input.commandId !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(input.commandId) ||
        !input.command || !playerCommands.has(input.command.type)) return this.failure(input?.commandId, "INVALID_INPUT");
      const hash = fingerprint(input);
      const previous = this.record.receipts.find(receipt => receipt.participantId === participantId && receipt.commandId === input.commandId);
      if (previous) return previous.fingerprint === hash ? structuredClone(previous.ack) : this.failure(input.commandId, "COMMAND_ID_REUSED");
      if (this.record.receipts.length >= this.options.maxReceipts) return this.failure(input.commandId, "COMMAND_LIMIT");
      const result = transition(this.record.state, { kind: "participant", participantId }, input, this.now());
      const ack: CommandAck = result.ok
        ? { commandId: input.commandId, ok: true, revision: result.state.revision }
        : { commandId: input.commandId, ok: false, error: result.error, revision: result.state.revision };
      const next = structuredClone(this.record);
      next.state = result.state;
      next.receipts.push({ participantId, commandId: input.commandId, fingerprint: hash, ack });
      try {
        await this.commit(next);
        return structuredClone(ack);
      } catch (error) {
        if (this.conflict) return this.failure(input.commandId, "ROOM_CONFLICT");
        if (error instanceof StorageUnavailable) return this.failure(input.commandId, "STORAGE_UNAVAILABLE");
        throw error;
      }
    });
  }

  // Last committed view. sync() additionally catches up any elapsed deadlines.
  view(viewer: Viewer): RoomView {
    const view = project(this.record.state, viewer);
    view.serverNow = this.now();
    return view;
  }

  sync(viewer: Viewer): Promise<RoomView> {
    if (this.closing || this.closed) return Promise.reject(new Error(this.conflict ? "ROOM_CONFLICT" : "ROOM_CLOSED"));
    const identity = structuredClone(viewer);
    return this.enqueue(async () => {
      if (this.closed) throw new Error(this.conflict ? "ROOM_CONFLICT" : "ROOM_CLOSED");
      await this.expire();
      return this.view(identity);
    });
  }

  subscribe(viewer: Viewer, send: (view: RoomView) => void | Promise<void>): () => void {
    if (this.closing || this.closed) throw new Error("ROOM_CLOSED");
    const subscription = { viewer: structuredClone(viewer), send };
    this.subscribers.add(subscription);
    this.deliver(subscription);
    return () => { this.subscribers.delete(subscription); };
  }

  async close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closing = true;
    this.closePromise = this.enqueue(async () => { this.stop(); });
    return this.closePromise;
  }

  private enqueue<T>(action: () => Promise<T>): Promise<T> {
    const job = this.tail.then(action);
    this.tail = job.then(() => {}, () => {});
    return job;
  }

  private now(): number { return Math.max(this.deps.clock.now(), this.record.state.lastNow); }
  private failure(commandId: string, error: RuntimeErrorCode): CommandAck {
    return { commandId, ok: false, error, revision: this.record.state.revision };
  }
  private report(kind: DiagnosticKind) {
    try { this.deps.diagnose?.({ roomId: this.roomId, kind }); } catch { /* Diagnostics cannot stop a room. */ }
  }
  private deliver(subscription: { viewer: Viewer; send: (view: RoomView) => void | Promise<void> }) {
    try { void Promise.resolve(subscription.send(this.view(subscription.viewer))).catch(() => this.report("subscriber-failed")); }
    catch { this.report("subscriber-failed"); }
  }

  private schedule(callback: () => void, delay: number): () => void {
    if (this.closed) return () => {};
    let active = true;
    const cancel = () => {
      if (!active) return;
      active = false;
      this.deps.clock.clearTimeout(handle);
      this.timers.delete(cancel);
    };
    const handle = this.deps.clock.setTimeout(() => {
      if (!active) return;
      active = false;
      this.timers.delete(cancel);
      if (!this.closed) callback();
    }, Math.max(0, delay));
    this.timers.add(cancel);
    return cancel;
  }

  private background(action: () => Promise<void>) {
    if (this.closing || this.closed) return;
    void this.enqueue(async () => { if (!this.closing && !this.closed) await action(); }).catch(error => {
      if (this.closed) return;
      if (error instanceof StorageUnavailable) this.schedule(() => this.background(action), this.options.retryMs);
      else this.report("runtime-failed");
    });
  }

  private async commit(next: RoomRecord) {
    next.version = this.record.version + 1;
    let saved: boolean;
    try { saved = await this.deps.store.save(this.roomId, this.record.version, structuredClone(next)); }
    catch { this.report("storage-failed"); throw new StorageUnavailable(); }
    if (!saved) {
      this.conflict = true;
      this.report("room-conflict");
      this.stop();
      throw new Error("ROOM_CONFLICT");
    }
    const changed = this.record.state.revision !== next.state.revision;
    this.record = next;
    if (this.closed) return;
    if (changed) for (const subscription of this.subscribers) this.deliver(subscription);
    this.reconcile();
  }

  private async expire() {
    const state = advanceTime(this.record.state, this.now());
    if (state.revision !== this.record.state.revision) {
      await this.commit({ ...structuredClone(this.record), state });
    }
  }

  private reconcile() {
    if (this.closed) return;
    const state = this.record.state;
    if (this.taskToken !== state.phaseToken) {
      for (const task of this.tasks.values()) { task.cancelTimer(); task.controller.abort(); }
      this.tasks.clear();
      this.aiAttempts.clear();
      this.taskToken = state.phaseToken;
    }
    this.cancelWake?.();
    this.cancelWake = undefined;
    if (state.deadlineAt !== undefined) {
      this.cancelWake = this.schedule(() => this.background(() => this.expire()), state.deadlineAt - this.now());
      if (state.deadlineAt <= this.now()) return;
    }
    if (state.phase === "preparing") {
      if (this.record.preparation.retryAt > this.now()) {
        this.cancelWake = this.schedule(() => this.reconcile(), this.record.preparation.retryAt - this.now());
      } else this.startTopic();
    } else this.startAi(state);
  }

  private task<T>(key: string, timeoutMs: number, work: (signal: AbortSignal) => Promise<T>,
    receive: (outcome: Outcome<T>, task: Task) => Promise<void>) {
    if (this.tasks.has(key) || this.closed) return;
    const task: Task = { token: this.record.state.phaseToken, controller: new AbortController(), settled: false, cancelTimer: () => {} };
    this.tasks.set(key, task);
    const finish = (outcome: Outcome<T>) => {
      if (task.settled || task.controller.signal.aborted || this.closed) return;
      task.settled = true;
      task.cancelTimer();
      if (!outcome.ok) task.controller.abort();
      this.background(async () => {
        if (this.tasks.get(key) !== task || this.record.state.phaseToken !== task.token) return;
        await this.expire();
        if (this.tasks.get(key) !== task || this.record.state.phaseToken !== task.token) return;
        await receive(outcome, task);
        if (this.tasks.get(key) === task) this.tasks.delete(key);
        this.reconcile();
      });
    };
    task.cancelTimer = this.schedule(() => finish({ ok: false }), timeoutMs);
    // No provider call awaits inside the room's command queue.
    void Promise.resolve().then(() => {
      if (task.controller.signal.aborted) throw new Error("ABORTED");
      return work(task.controller.signal);
    }).then(value => finish({ ok: true, value }), () => finish({ ok: false }));
  }

  private startTopic() {
    const candidates = this.deps.topics.candidateIds;
    const index = this.record.preparation.candidateIndex % Math.max(1, candidates.length);
    this.task<Topic>("topic", this.options.topicTimeoutMs,
      signal => candidates.length ? this.deps.topics.resolve(candidates[index], signal) : Promise.reject(new Error("NO_TOPICS")),
      async outcome => {
        if (outcome.ok) {
          const seats = assignSeats(this.record.state.members.map(member => member.participantId), this.deps.random);
          let result;
          try {
            result = transition(this.record.state, { kind: "system" }, {
              matchId: this.record.state.matchId, phaseToken: this.record.state.phaseToken,
              command: { type: "resolve-topic", topic: outcome.value, seats },
            }, this.now());
          } catch { /* A malformed provider payload behaves like a failed candidate. */ }
          if (result?.ok) { await this.commit({ ...structuredClone(this.record), state: result.state }); return; }
        }
        this.report("topic-failed");
        const next = structuredClone(this.record);
        const wrapped = index + 1 >= candidates.length;
        next.preparation.candidateIndex = wrapped ? 0 : index + 1;
        if (wrapped) next.preparation.cycles++;
        const backoff = Math.min(this.options.topicMaxBackoffMs,
          this.options.topicBackoffMs * 2 ** Math.min(next.preparation.cycles - 1, 20));
        next.preparation.retryAt = this.now() + (wrapped ? backoff : 0);
        await this.commit(next);
      });
  }

  private startAi(state: GameState) {
    const work: { seatId: string; action: AiAction }[] = [];
    for (const seat of state.seats.filter(seat => seat.role === "ai")) {
      if (state.phase === "answering" && !state.answers[state.round!].some(answer => answer.seatId === seat.seatId)) {
        work.push({ seatId: seat.seatId, action: "answer" });
      } else if (state.phase === "voting" && !state.votes.some(vote => vote.voterSeatId === seat.seatId)) {
        work.push({ seatId: seat.seatId, action: "vote" });
      } else if (state.phase === "debating") {
        const debate = state.debate!;
        const accuser = state.seats[debate.turnIndex].seatId;
        if (debate.step === "response" && seat.seatId === debate.targetSeatId) work.push({ seatId: seat.seatId, action: "respond" });
        else if (seat.seatId === accuser && debate.step !== "response") {
          work.push({ seatId: seat.seatId, action: debate.step === "accusation" ? "accuse" : "followup" });
        }
      }
    }
    for (const { seatId, action } of work) {
      const key = `ai:${state.phaseToken}:${seatId}`;
      if (this.aiAttempts.has(key)) continue;
      this.aiAttempts.add(key);
      const request = { matchId: state.matchId, phaseToken: state.phaseToken, seatId, action,
        deadlineAt: state.deadlineAt!, context: aiContext(state, seatId) };
      this.task<AiCommand>(key, Math.min(this.options.aiTimeoutMs, state.deadlineAt! - this.now()),
        signal => this.deps.ai.act(request, signal), async outcome => {
          if (!outcome.ok) { this.report("ai-failed"); return; }
          const command = outcome.value;
          if (!command || (command.type !== action && !(action === "followup" && command.type === "skip-followup"))) {
            this.report("ai-invalid"); return;
          }
          let result;
          try {
            result = transition(this.record.state, { kind: "ai", seatId }, {
              matchId: request.matchId, phaseToken: request.phaseToken, command,
            }, this.now());
          } catch { this.report("ai-invalid"); return; }
          if (!result.ok) { this.report("ai-invalid"); return; }
          await this.commit({ ...structuredClone(this.record), state: result.state });
        });
    }
  }

  private stop() {
    this.closed = true;
    for (const cancel of [...this.timers]) cancel();
    for (const task of this.tasks.values()) task.controller.abort();
    this.tasks.clear();
    this.subscribers.clear();
  }
}
