import assert from "node:assert/strict";
import test from "node:test";
import type { AiCommand, AiProvider, AiRequest, Clock, PlayerCommand, PlayerRequest, RandomSource, RoomRecord, RoomStore, TopicProvider } from "../src/application/ports.ts";
import { RoomRuntime } from "../src/application/room-runtime.ts";
import { assignSeats } from "../src/application/seat-assignment.ts";
import type { Topic } from "../src/game/model.ts";
import { ANSWER_MS, aiBeatWindow, roleCounts } from "../src/game/rules.ts";
import { MemoryRoomStore } from "../src/repository/memory-room-store.ts";
import { advanceTime } from "../src/game/transition.ts";
import { RoomRegistry } from "../src/server/room-registry.ts";

const topic: Topic = {
  provenance: { packId: "test-topic", source: "zhihu", curatedAt: "2026-09-10T00:00:00.000Z" },
  id: "123", title: "技术应当代替重复劳动吗？", url: "https://www.zhihu.com/question/123",
  topAnswerExcerpt: "重复劳动可以交给工具，判断仍需要人。", topConsensusSummary: "工具节省时间，责任仍在人。",
  defaults: {
    1: ["工具节省时间，责任仍在人。", "效率之外还要考虑责任。"],
    2: ["正方：可以把时间留给更重要的事。", "反方：完全依赖工具会失去判断。"],
    3: ["工具下班了，责任还在加班。", "省下的时间，最后又拿去开会了。"],
  },
};

// 运行时用例给模型留的预算，节拍窗口的下界由它和阶段剩余时间共同决定。
const AI_TIMEOUT_MS = 100;
// 用例都把随机源钉成 0，节拍因此恰为窗口下界；上面那道题面 12 字，落在缩放后的下界上。
const beatFloor = aiBeatWindow(ANSWER_MS, AI_TIMEOUT_MS, topic.title).min;

class FakeClock implements Clock {
  value = 0;
  private sequence = 0;
  private timers = new Map<number, { at: number; callback: () => void }>();
  now() { return this.value; }
  setTimeout(callback: () => void, delayMs: number) {
    const id = ++this.sequence;
    this.timers.set(id, { at: this.value + Math.max(0, delayMs), callback });
    return id;
  }
  clearTimeout(handle: unknown) { this.timers.delete(handle as number); }
  advance(ms: number) {
    const target = this.value + ms;
    while (true) {
      const due = [...this.timers].filter(([, timer]) => timer.at <= target)
        .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!due) break;
      this.timers.delete(due[0]);
      this.value = due[1].at;
      due[1].callback();
    }
    this.value = target;
  }
}

class SequenceRandom implements RandomSource {
  private values: number[];
  constructor(values: number[] = []) { this.values = values; }
  integer(exclusiveMax: number) { return (this.values.shift() ?? exclusiveMax - 1) % exclusiveMax; }
}

class TopicFixture implements TopicProvider {
  candidateIds: readonly string[];
  calls: string[] = [];
  private outcomes: Record<string, Topic | Error>;
  constructor(outcomes: Record<string, Topic | Error>, ids = Object.keys(outcomes)) {
    this.outcomes = outcomes;
    this.candidateIds = ids;
  }
  async resolve(id: string) {
    this.calls.push(id);
    const outcome = this.outcomes[id];
    if (outcome instanceof Error) throw outcome;
    return structuredClone(outcome);
  }
}

class PassiveAi implements AiProvider {
  requests: AiRequest[] = [];
  act(request: AiRequest, signal: AbortSignal): Promise<AiCommand> {
    this.requests.push(structuredClone(request));
    return new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("ABORTED")), { once: true }));
  }
}

class AnsweringAi implements AiProvider {
  requests: AiRequest[] = [];
  async act(request: AiRequest): Promise<AiCommand> {
    this.requests.push(structuredClone(request));
    if (request.action === "answer") return request.context.view.round === 2
      ? { type: "answer", round: 2, stance: "pro", text: "把时间留给更重要的事" }
      : { type: "answer", round: request.context.view.round!, text: "工具提高效率，选择仍然在人" };
    throw new Error("NOT_USED");
  }
}

class DeferredAi implements AiProvider {
  requests: AiRequest[] = [];
  resolve?: (command: AiCommand) => void;
  act(request: AiRequest, signal: AbortSignal): Promise<AiCommand> {
    this.requests.push(structuredClone(request));
    return new Promise((resolve, reject) => {
      if (this.requests.length === 1) this.resolve = resolve;
      signal.addEventListener("abort", () => reject(new Error("ABORTED")), { once: true });
    });
  }
}

class FailingStore implements RoomStore {
  fail = false;
  readonly inner: MemoryRoomStore;
  constructor(inner = new MemoryRoomStore()) { this.inner = inner; }
  load(roomId: string) { return this.inner.load(roomId); }
  list() { return this.inner.list(); }
  delete(roomId: string, expectedVersion: number) { return this.inner.delete(roomId, expectedVersion); }
  save(roomId: string, expectedVersion: number | null, record: RoomRecord) {
    if (this.fail) { this.fail = false; throw new Error("DISK_DOWN"); }
    return this.inner.save(roomId, expectedVersion, record);
  }
}

class BlockingStore implements RoomStore {
  readonly inner: MemoryRoomStore;
  block = false;
  entered?: () => void;
  release?: () => void;
  constructor(inner = new MemoryRoomStore()) { this.inner = inner; }
  load(roomId: string) { return this.inner.load(roomId); }
  list() { return this.inner.list(); }
  delete(roomId: string, expectedVersion: number) { return this.inner.delete(roomId, expectedVersion); }
  async save(roomId: string, expectedVersion: number | null, record: RoomRecord) {
    if (this.block) {
      this.block = false;
      await new Promise<void>(resolve => { this.entered?.(); this.release = resolve; });
    }
    return this.inner.save(roomId, expectedVersion, record);
  }
}

function deps(clock: FakeClock, store: RoomStore = new MemoryRoomStore(), topics: TopicProvider = new TopicFixture({ good: topic }), ai: AiProvider = new PassiveAi(), random: RandomSource = new SequenceRandom()) {
  return { clock, store, topics, ai, random,
    events: [] as string[], diagnose(event: { kind: string }) { this.events.push(event.kind); } };
}

async function flushUntil(condition: () => boolean, message = "condition", rounds = 50) {
  for (let i = 0; i < rounds; i++) {
    if (condition()) return;
    await new Promise<void>(resolve => setImmediate(resolve));
  }
  assert.fail(`Timed out waiting for ${message}`);
}

function request(runtime: RoomRuntime, id: string, command: PlayerCommand): PlayerRequest {
  const view = runtime.view({ kind: "spectator" });
  return { commandId: id, matchId: view.matchId, phaseToken: view.phaseToken, command };
}

// 走完 AI 座位的发言节拍。这里只推进到那一刻本身：再往前一步就会把节拍和任务超时
// 放进同一次 advance 里触发，而真实时钟上两者是分开的宏任务，顺序恰好相反。
async function elapseBeat(clock: FakeClock, beat = beatFloor) {
  clock.advance(beat);
  await new Promise<void>(resolve => setImmediate(resolve));
}

async function startRuntime(options: { count?: number; clock?: FakeClock; store?: RoomStore; topics?: TopicProvider; ai?: AiProvider; random?: RandomSource } = {}) {
  const clock = options.clock ?? new FakeClock();
  const dependencies = deps(clock, options.store, options.topics, options.ai, options.random);
  const runtime = await RoomRuntime.open("room", "match", dependencies, {
    topicTimeoutMs: 100, aiTimeoutMs: AI_TIMEOUT_MS, retryMs: 10, topicBackoffMs: 20, topicMaxBackoffMs: 80,
  });
  const count = options.count ?? 2;
  for (let i = 0; i < count; i++) assert.equal((await runtime.dispatch(`p${i}`, request(runtime, `j${i}`, { type: "join" }))).ok, true);
  for (let i = 0; i < count; i++) assert.equal((await runtime.dispatch(`p${i}`, request(runtime, `r${i}`, { type: "ready", ready: true }))).ok, true);
  await flushUntil(() => runtime.view({ kind: "spectator" }).phase === "answering", "topic resolution");
  return { runtime, clock, dependencies };
}

test("随机身份分配符合四档人数，匿名座位连续且真人一人一座", () => {
  for (const count of [2, 3, 4, 5]) {
    const ids = Array.from({ length: count }, (_, i) => `p${i}`);
    const seats = assignSeats(ids, new SequenceRandom([0, 1, 0, 2, 1, 0, 3, 2, 1, 0]));
    const counts = roleCounts(count);
    assert.deepEqual(seats.map(seat => seat.seatId), seats.map((_, i) => `s${i + 1}`));
    assert.equal(seats.filter(seat => seat.role === "human").length, counts.human);
    assert.equal(seats.filter(seat => seat.role === "shadow").length, counts.shadow);
    assert.equal(seats.filter(seat => seat.role === "ai").length, counts.ai);
    assert.deepEqual(new Set(seats.flatMap(seat => seat.participantId ?? [])).size, count);
  }
  assert.throws(() => assignSeats(["p", "p"], new SequenceRandom()), /INVALID_PARTICIPANTS/);
});

test("并发命令串行执行，同一命令幂等，不同载荷复用ID被拒绝", async () => {
  const clock = new FakeClock();
  const runtime = await RoomRuntime.open("concurrent", "m", deps(clock));
  const phaseToken = runtime.view({ kind: "spectator" }).phaseToken;
  const base = { matchId: "m", phaseToken, command: { type: "join" } as const };
  const first = { ...base, commandId: "same" };
  const [a, b] = await Promise.all([runtime.dispatch("p0", first), runtime.dispatch("p0", first)]);
  assert.deepEqual(a, b);
  assert.equal(a.ok, true);
  const reused = await runtime.dispatch("p0", { ...first, command: { type: "ready", ready: true } });
  assert.equal(reused.ok, false);
  if (!reused.ok) assert.equal(reused.error, "COMMAND_ID_REUSED");
  const joins = await Promise.all([1, 2, 3, 4, 5].map(i => runtime.dispatch(`p${i}`, {
    ...base, commandId: `j${i}`,
  })));
  assert.equal(joins.filter(ack => ack.ok).length, 4);
  assert.equal(runtime.view({ kind: "spectator" }).lobby!.count, 5);
  await runtime.close();
});

test("候场完成后轮换失败题目，取得有效题目才开局", async () => {
  const clock = new FakeClock();
  const topics = new TopicFixture({ bad: new Error("HTTP_500"), malformed: { ...topic, url: "https://example.com" }, good: topic });
  // Draw the first candidate so the assertion pins the failover order itself.
  const dependencies = deps(clock, undefined, topics, undefined, new SequenceRandom([0]));
  const runtime = await RoomRuntime.open("topics", "m", dependencies, { topicTimeoutMs: 100, topicBackoffMs: 20, topicMaxBackoffMs: 80 });
  for (let i = 0; i < 2; i++) await runtime.dispatch(`p${i}`, request(runtime, `j${i}`, { type: "join" }));
  for (let i = 0; i < 2; i++) await runtime.dispatch(`p${i}`, request(runtime, `r${i}`, { type: "ready", ready: true }));
  await flushUntil(() => runtime.view({ kind: "spectator" }).phase === "answering", "third topic candidate");
  assert.deepEqual(topics.calls, ["bad", "malformed", "good"]);
  assert.equal(runtime.view({ kind: "spectator" }).topic!.id, topic.id);
  assert.deepEqual(dependencies.events, ["topic-failed", "topic-failed"]);
  await runtime.close();
});

test("一轮候选全失败后退避重试，不高频循环", async () => {
  const clock = new FakeClock();
  const store = new MemoryRoomStore();
  const topics = new TopicFixture({ a: new Error("A"), b: new Error("B") });
  const runtime = await RoomRuntime.open("backoff", "m", deps(clock, store, topics, undefined, new SequenceRandom([0])), {
    topicTimeoutMs: 100, topicBackoffMs: 20, topicMaxBackoffMs: 80,
  });
  for (let i = 0; i < 2; i++) await runtime.dispatch(`p${i}`, request(runtime, `j${i}`, { type: "join" }));
  for (let i = 0; i < 2; i++) await runtime.dispatch(`p${i}`, request(runtime, `r${i}`, { type: "ready", ready: true }));
  await flushUntil(() => topics.calls.length === 2, "failed topic cycle");
  for (let i = 0; i < 50 && (await store.load("backoff"))!.preparation.cycles < 1; i++) {
    await new Promise<void>(resolve => setImmediate(resolve));
  }
  assert.equal((await store.load("backoff"))!.preparation.retryAt, 20);
  assert.deepEqual(topics.calls, ["a", "b"]);
  assert.equal(runtime.view({ kind: "spectator" }).phase, "preparing");
  clock.advance(19);
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(topics.calls.length, 2);
  clock.advance(1);
  await flushUntil(() => topics.calls.length >= 4, "backoff retry cycle");
  assert.deepEqual(topics.calls, ["a", "b", "a", "b"]);
  for (let i = 0; i < 50 && (await store.load("backoff"))!.preparation.cycles < 2; i++) {
    await new Promise<void>(resolve => setImmediate(resolve));
  }
  assert.equal((await store.load("backoff"))!.preparation.retryAt, 60);
  clock.advance(39);
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(topics.calls.length, 4);
  clock.advance(1);
  await flushUntil(() => topics.calls.length >= 6, "doubled backoff cycle");
  assert.deepEqual(topics.calls, ["a", "b", "a", "b", "a", "b"]);
  await runtime.close();
});

test("新房间使用抽到的候选，不再固定从第一个题目开始", async () => {
  const clock = new FakeClock();
  const topics = new TopicFixture({ a: topic, b: topic, c: topic });
  const runtime = await RoomRuntime.open("random-topic", "m",
    deps(clock, undefined, topics, undefined, new SequenceRandom([2])), { topicTimeoutMs: 100 });
  for (let i = 0; i < 2; i++) await runtime.dispatch(`p${i}`, request(runtime, `j${i}`, { type: "join" }));
  for (let i = 0; i < 2; i++) await runtime.dispatch(`p${i}`, request(runtime, `r${i}`, { type: "ready", ready: true }));
  await flushUntil(() => runtime.view({ kind: "spectator" }).phase === "answering", "drawn topic candidate");
  assert.deepEqual(topics.calls, ["c"]);
  await runtime.close();
});

test("重开已有房间沿用已抽取的候选，重启不换题", async () => {
  const store = new MemoryRoomStore();
  const topics = new TopicFixture({ a: topic, b: topic, c: topic });
  const first = await RoomRuntime.open("stable-topic", "m",
    deps(new FakeClock(), store, topics, undefined, new SequenceRandom([2])), { topicTimeoutMs: 100 });
  await first.close();
  const second = await RoomRuntime.open("stable-topic", "m",
    deps(new FakeClock(), store, topics, undefined, new SequenceRandom([0])), { topicTimeoutMs: 100 });
  assert.equal((await store.load("stable-topic"))!.preparation.candidateIndex, 2);
  await second.close();
});

test("随机源返回越界下标时拒绝开局", async () => {
  const topics = new TopicFixture({ a: topic, b: topic });
  await assert.rejects(() => RoomRuntime.open("bad-random", "m",
    deps(new FakeClock(), undefined, topics, undefined, { integer: () => 7 }), { topicTimeoutMs: 100 }),
    /INVALID_RANDOM_SOURCE/);
});

test("AI任务在队列外完成并通过核心提交，广播发生在保存后", async () => {
  const clock = new FakeClock();
  const store = new MemoryRoomStore();
  const ai = new AnsweringAi();
  const { runtime } = await startRuntime({ clock, store, ai, random: { integer: () => 0 } });
  await elapseBeat(clock);
  await flushUntil(() => ai.requests.length === 1 && runtime.view({ kind: "spectator" }).answers[1].length === 1, "AI answer");
  const persisted = await store.load("room");
  assert.equal(persisted!.state.answers[1].length, 1);
  assert.equal(ai.requests[0].context.roles.length, 3);
  const publicJson = JSON.stringify(runtime.view({ kind: "spectator" }));
  assert.ok(!publicJson.includes("participantId"));
  assert.ok(!publicJson.includes('"role"'));
  await runtime.close();
});

test("AI座位发言前先等待自己的节拍，不会在阶段开放瞬间抢答", async () => {
  const clock = new FakeClock();
  const ai = new AnsweringAi();
  // 固定随机源把座位分配和抽题钉死，节拍因此取下界，可以精确断言边界。
  const { runtime } = await startRuntime({ clock, ai, random: { integer: () => 0 } });
  assert.equal(ai.requests.length, 0, "阶段刚开放时不该有请求");
  clock.advance(beatFloor - 1);
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(ai.requests.length, 0, "节拍没走完不发请求");
  clock.advance(1);
  await flushUntil(() => ai.requests.length === 1, "节拍走完后的AI请求");
  await flushUntil(() => runtime.view({ kind: "spectator" }).answers[1].length === 1, "AI回答落库");
  await runtime.close();
});

test("题面越长节拍越晚，短题面更早开口，两端各自封顶", () => {
  const baseline = "字".repeat(30);
  assert.deepEqual(aiBeatWindow(90_000, 15_000, baseline), { min: 40_000, max: 70_000 }, "基准题面落在基准窗口");
  assert.deepEqual(aiBeatWindow(90_000, 15_000, "字".repeat(8)), { min: 24_000, max: 42_000 }, "短题面整体提前");
  assert.deepEqual(aiBeatWindow(90_000, 15_000, "字".repeat(60)), { min: 56_000, max: 75_000 }, "长题面推后并被轮次预算封顶");
  assert.deepEqual(aiBeatWindow(90_000, 15_000, "字".repeat(300)), { min: 56_000, max: 75_000 }, "再长也不超过上限");
});

test("节拍受阶段剩余时间约束，短阶段不会把生成预算等掉", () => {
  const baseline = "字".repeat(30);
  assert.deepEqual(aiBeatWindow(60_000, 15_000, baseline), { min: 40_000, max: 45_000 }, "投票阶段只剩四十五秒可以等");
  assert.deepEqual(aiBeatWindow(45_000, 15_000, baseline), { min: 30_000, max: 30_000 }, "应答阶段只等一半时间");
  assert.deepEqual(aiBeatWindow(20_000, 15_000, baseline), { min: 5_000, max: 5_000 }, "指认阶段只剩五秒");
  assert.deepEqual(aiBeatWindow(5_000, 15_000, baseline), { min: 0, max: 0 }, "剩余时间不够生成就直接发请求");
});

test("AI结果迟到后作废，截止时只补一条默认答案", async () => {
  const ai = new DeferredAi();
  const { runtime, clock } = await startRuntime({ ai, random: { integer: () => 0 } });
  await elapseBeat(clock);
  await flushUntil(() => ai.requests.length === 1, "pending AI request");
  for (let i = 0; i < 2; i++) {
    const view = runtime.view({ kind: "participant", participantId: `p${i}` });
    assert.equal((await runtime.dispatch(`p${i}`, {
      commandId: `a${i}`, matchId: view.matchId, phaseToken: view.phaseToken,
      command: { type: "answer", round: 1, text: "真人回答" },
    })).ok, true);
  }
  clock.advance(90_000);
  await flushUntil(() => runtime.view({ kind: "spectator" }).round === 2, "round deadline");
  const storedBefore = runtime.view({ kind: "spectator" }).answers[1];
  assert.equal(storedBefore.length, 3);
  ai.resolve?.({ type: "answer", round: 1, text: "迟到回答" });
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.deepEqual(runtime.view({ kind: "spectator" }).answers[1], storedBefore);
  await runtime.close();
});

test("保存失败不确认或广播未保存状态，原命令可以重试", async () => {
  const clock = new FakeClock();
  const store = new FailingStore();
  const runtime = await RoomRuntime.open("storage", "m", deps(clock, store));
  const revisions: number[] = [];
  const unsubscribe = runtime.subscribe({ kind: "spectator" }, view => { revisions.push(view.revision); });
  await new Promise<void>(resolve => setImmediate(resolve));
  store.fail = true;
  const input = request(runtime, "join", { type: "join" });
  const failed = await runtime.dispatch("p0", input);
  assert.equal(failed.ok, false);
  if (!failed.ok) assert.equal(failed.error, "STORAGE_UNAVAILABLE");
  assert.equal(runtime.view({ kind: "spectator" }).lobby!.count, 0);
  assert.deepEqual(revisions, [0]);
  const retried = await runtime.dispatch("p0", input);
  assert.equal(retried.ok, true);
  await flushUntil(() => revisions.at(-1) === 1, "committed broadcast");
  assert.deepEqual(revisions, [0, 1]);
  unsubscribe();
  await runtime.close();
});

test("内存存储复用可恢复房间、幂等回执和过期阶段", async () => {
  const clock = new FakeClock();
  const store = new MemoryRoomStore();
  const passive = new PassiveAi();
  const { runtime } = await startRuntime({ clock, store, ai: passive });
  const view = runtime.view({ kind: "participant", participantId: "p0" });
  const input = { commandId: "persisted-answer", matchId: view.matchId, phaseToken: view.phaseToken,
    command: { type: "answer", round: 1, text: "会被保存" } as const };
  const original = await runtime.dispatch("p0", input);
  await runtime.close();
  clock.advance(90_000);
  const reopened = await RoomRuntime.open("room", "match", deps(clock, store, undefined, new PassiveAi()), {
    topicTimeoutMs: 100, aiTimeoutMs: 100, retryMs: 10, topicBackoffMs: 20, topicMaxBackoffMs: 80,
  });
  assert.equal(reopened.view({ kind: "spectator" }).round, 2);
  assert.equal(reopened.view({ kind: "spectator" }).answers[1].length, 3);
  const repeated = await reopened.dispatch("p0", input);
  assert.deepEqual(repeated, original);
  assert.equal(reopened.view({ kind: "spectator" }).answers[1].length, 3);
  await reopened.close();
});

test("两个运行时竞争同一房间时旧版本写入失败并关闭冲突实例", async () => {
  const clock = new FakeClock();
  const store = new MemoryRoomStore();
  const dependencies = deps(clock, store);
  const first = await RoomRuntime.open("conflict", "m", dependencies);
  const second = await RoomRuntime.open("conflict", "m", dependencies);
  assert.equal((await first.dispatch("p0", request(first, "a", { type: "join" }))).ok, true);
  const conflicted = await second.dispatch("p1", request(second, "b", { type: "join" }));
  assert.equal(conflicted.ok, false);
  if (!conflicted.ok) assert.equal(conflicted.error, "ROOM_CONFLICT");
  const closed = await second.dispatch("p1", request(second, "c", { type: "join" }));
  assert.equal(closed.ok, false);
  if (!closed.ok) assert.equal(closed.error, "ROOM_CONFLICT");
  await first.close();
  await second.close();
});

test("注册表启动时主动恢复无人连接的活动房间并补做截止", async () => {
  const clock = new FakeClock();
  const store = new MemoryRoomStore(() => clock.now());
  const initial = await startRuntime({ clock, store, ai: new PassiveAi() });
  await initial.runtime.close();
  clock.advance(90_000);
  const registry = new RoomRegistry(deps(clock, store, undefined, new PassiveAi()), {
    topicTimeoutMs: 100, aiTimeoutMs: 100, retryMs: 10, topicBackoffMs: 20, topicMaxBackoffMs: 80,
  }, { revealedRetentionMs: 1_000, cleanupIntervalMs: 100 });
  await registry.initialize();
  const recovered = await registry.get("room");
  assert.ok(recovered);
  assert.equal(recovered.view({ kind: "spectator" }).round, 2);
  assert.equal(recovered.view({ kind: "spectator" }).answers[1].length, 3);
  assert.equal((await store.load("room"))!.state.round, 2);
  await registry.close();
});

test("注册表只清理超过保留期的终局，不删除活动房间", async () => {
  const clock = new FakeClock();
  const store = new MemoryRoomStore(() => clock.now());
  const active = await startRuntime({ clock, store, ai: new PassiveAi() });
  await active.runtime.close();
  const stored = (await store.load("room"))!;
  clock.value = 810_000;
  stored.state = advanceTime(stored.state, clock.now());
  const expectedVersion = stored.version;
  stored.version++;
  assert.equal(await store.save("room", expectedVersion, stored), true);
  const other = structuredClone(stored);
  other.state = { ...other.state, matchId: "active-match", phase: "lobby", phaseToken: 0,
    revision: 0, lastNow: clock.now(), members: [], seats: [], topic: undefined, round: undefined,
    answers: { 1: [], 2: [], 3: [] }, debate: undefined, deadlineAt: undefined, votes: [], log: [], result: undefined };
  other.version = 0;
  assert.equal(await store.save("active", null, other), true);
  const registry = new RoomRegistry(deps(clock, store), {}, { revealedRetentionMs: 100, cleanupIntervalMs: 1_000 });
  await registry.initialize();
  await registry.cleanupExpired(clock.now() + 99);
  assert.ok(await store.load("room"));
  await registry.cleanupExpired(clock.now() + 100);
  assert.equal(await store.load("room"), null);
  assert.ok(await store.load("active"));
  await registry.close();
});

test("优雅关闭排空已进入队列的命令，并立即拒绝新命令", async () => {
  const clock = new FakeClock();
  const store = new BlockingStore(new MemoryRoomStore(() => clock.now()));
  const runtime = await RoomRuntime.open("closing", "match", deps(clock, store));
  const entered = new Promise<void>(resolve => { store.entered = resolve; });
  store.block = true;
  const accepted = runtime.dispatch("p0", request(runtime, "accepted", { type: "join" }));
  await entered;
  const closing = runtime.close();
  const rejected = await runtime.dispatch("p1", request(runtime, "late", { type: "join" }));
  assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.equal(rejected.error, "ROOM_CLOSED");
  store.release?.();
  assert.equal((await accepted).ok, true);
  await closing;
  assert.equal((await store.load("closing"))!.state.members.length, 1);
});

test("注册表删除活动房间时先关闭运行时并删除持久记录", async () => {
  const clock = new FakeClock();
  const store = new MemoryRoomStore(() => clock.now());
  const registry = new RoomRegistry(deps(clock, store), {}, { revealedRetentionMs: 1_000, cleanupIntervalMs: 1_000 });
  await registry.initialize();
  const runtime = await registry.create("delete-me");
  assert.ok(runtime);
  assert.equal((await runtime.dispatch("p0", request(runtime, "join", { type: "join" }))).ok, true);
  assert.equal(await registry.delete("delete-me"), true);
  assert.equal(await store.load("delete-me"), null);
  const rejected = await runtime.dispatch("p1", request(runtime, "late", { type: "join" }));
  assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.equal(rejected.error, "ROOM_CLOSED");
  assert.equal(await registry.delete("delete-me"), false);
  await registry.close();
});
