import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import type { AiProvider, Clock, RandomSource, RoomRecord, TopicProvider } from "../src/application/ports.ts";
import { RoomRuntime } from "../src/application/room-runtime.ts";
import type { Actor, Command, GameState, Seat, Topic } from "../src/game/model.ts";
import { createGame, transition } from "../src/game/transition.ts";
import { SqlitePersistence } from "../src/repository/sqlite-persistence.ts";
import { SessionService } from "../src/server/session.ts";

const topic: Topic = {
  id: "123", title: "技术应当代替重复劳动吗？", url: "https://www.zhihu.com/question/123",
  topAnswerExcerpt: "重复劳动可以交给工具，判断仍需要人。", topConsensusSummary: "工具节省时间，责任仍在人。",
  defaults: {
    1: ["工具节省时间，责任仍在人。", "效率之外还要考虑责任。"],
    2: ["正方：可以把时间留给更重要的事。", "反方：完全依赖工具会失去判断。"],
    3: ["工具下班了，责任还在加班。", "省下的时间，最后又拿去开会了。"],
  },
};

class FixedClock implements Clock {
  value = 0;
  now() { return this.value; }
  setTimeout() { return {}; }
  clearTimeout() {}
}

const random: RandomSource = { integer: max => max - 1 };
const topics: TopicProvider = { candidateIds: ["topic"], async resolve() { return structuredClone(topic); } };
const ai: AiProvider = { act(_request, signal) {
  return new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("ABORTED")), { once: true }));
} };

function ok(state: GameState, actor: Actor, command: Command, now = state.lastNow) {
  const result = transition(state, actor, { matchId: state.matchId, phaseToken: state.phaseToken, command }, now);
  assert.equal(result.ok, true, result.ok ? undefined : result.error);
  return result.state;
}

function answeringState() {
  let state = createGame("match", 0);
  state = ok(state, { kind: "participant", participantId: "p0" }, { type: "join" });
  state = ok(state, { kind: "participant", participantId: "p1" }, { type: "join" });
  state = ok(state, { kind: "participant", participantId: "p0" }, { type: "ready", ready: true });
  state = ok(state, { kind: "participant", participantId: "p1" }, { type: "ready", ready: true });
  const seats: Seat[] = [
    { seatId: "s1", displayNumber: 1, role: "human", participantId: "p0" },
    { seatId: "s2", displayNumber: 2, role: "shadow", participantId: "p1" },
    { seatId: "s3", displayNumber: 3, role: "ai" },
  ];
  return ok(state, { kind: "system" }, { type: "resolve-topic", topic, seats });
}

function record(state = answeringState()): RoomRecord {
  return { version: 0, state, receipts: [], preparation: { candidateIndex: 0, cycles: 0, retryAt: 0 } };
}

async function databasePath() {
  const directory = await mkdtemp(join(tmpdir(), "roundtable-sqlite-"));
  return { directory, path: join(directory, "game.db") };
}

test("SQLite关闭重开后恢复私有房间、会话摘要，并补做截止阶段", async () => {
  const { directory, path } = await databasePath();
  try {
    const first = new SqlitePersistence(path);
    assert.equal(await first.save("room", null, record()), true);
    const sessions = new SessionService(first, Buffer.alloc(32, 3), () => 10);
    const issued = await sessions.issue("room", { kind: "participant", participantId: "p0" },
      "10000000-0000-4000-8000-000000000001");
    first.close();

    const second = new SqlitePersistence(path);
    assert.deepEqual((await second.load("room"))!.state.seats.map(seat => seat.role), ["human", "shadow", "ai"]);
    assert.deepEqual((await new SessionService(second, Buffer.alloc(32, 3)).verify("room", issued.token))?.viewer,
      { kind: "participant", participantId: "p0" });
    const clock = new FixedClock();
    clock.value = 90_000;
    const runtime = await RoomRuntime.open("room", "match", { clock, random, store: second, topics, ai }, {
      topicTimeoutMs: 100, aiTimeoutMs: 100, retryMs: 10, topicBackoffMs: 20, topicMaxBackoffMs: 80,
    });
    const view = runtime.view({ kind: "participant", participantId: "p0" });
    assert.equal(view.round, 2);
    assert.equal(view.answers[1].length, 3);
    assert.deepEqual(view.self, { seatId: "s1", role: "human" });
    await runtime.close();
    second.close();

    const third = new SqlitePersistence(path);
    assert.equal((await third.load("room"))!.state.round, 2);
    assert.equal((await third.load("room"))!.version, 1);
    third.close();
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("两个SQLite连接使用CAS版本更新，落后写者不能覆盖新状态", async () => {
  const { directory, path } = await databasePath();
  try {
    const first = new SqlitePersistence(path);
    const second = new SqlitePersistence(path);
    assert.equal(await first.save("room", null, record()), true);
    assert.equal(await second.save("room", null, record()), false);
    const fromFirst = (await first.load("room"))!;
    const fromSecond = (await second.load("room"))!;
    fromFirst.version = 1;
    fromFirst.state.revision++;
    fromSecond.version = 1;
    fromSecond.state.revision += 10;
    assert.equal(await first.save("room", 0, fromFirst), true);
    assert.equal(await second.save("room", 0, fromSecond), false);
    assert.equal((await second.load("room"))!.state.revision, fromFirst.state.revision);
    first.close();
    second.close();
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("SQLite会话主键幂等且房间外键阻止孤立会话", async () => {
  const db = new SqlitePersistence(":memory:");
  const session = { id: "session", roomId: "missing", viewer: { kind: "spectator" } as const,
    tokenHash: "hash", createdAt: 1 };
  await assert.rejects(db.create(session));
  assert.equal(await db.save("room", null, record()), true);
  const valid = { ...session, roomId: "room" };
  assert.equal(await db.create(valid), true);
  assert.equal(await db.create(valid), false);
  assert.deepEqual(await db.find("session"), valid);
  db.close();
});

test("SQLite拒绝结构合法但状态不完整或自相矛盾的房间JSON", async () => {
  const { directory, path } = await databasePath();
  try {
    const persistence = new SqlitePersistence(path);
    assert.equal(await persistence.save("room", null, record()), true);
    persistence.close();
    const raw = new DatabaseSync(path);
    const broken = record();
    broken.state.topic = undefined;
    raw.prepare("UPDATE rooms SET record_json = ? WHERE room_id = ?").run(JSON.stringify(broken), "room");
    raw.close();
    const reopened = new SqlitePersistence(path);
    await assert.rejects(reopened.load("room"), /CORRUPT_ROOM_RECORD/);
    reopened.close();
  } finally { await rm(directory, { recursive: true, force: true }); }
});
