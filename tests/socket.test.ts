import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { Server } from "socket.io";
import { io as createClient, type Socket as ClientSocketType } from "socket.io-client";
import type { AiProvider, RandomSource, TopicProvider } from "../src/application/ports.ts";
import type { Topic } from "../src/game/model.ts";
import { MemoryRoomStore } from "../src/repository/memory-room-store.ts";
import { RoomRegistry } from "../src/server/room-registry.ts";
import { MemorySessionStore, SessionService } from "../src/server/session.ts";
import { SocketGateway } from "../src/server/socket-gateway.ts";
import { AdmissionService } from "../src/server/admission-service.ts";
import type { ClientToServerEvents, ServerToClientEvents, SessionResult, SocketCommandAck, SyncResult } from "../src/server/socket-contracts.ts";
import { systemClock } from "../src/server/runtime-dependencies.ts";
import type { SocketGatewayOptions } from "../src/server/socket-gateway.ts";

type ClientSocket = ClientSocketType<ServerToClientEvents, ClientToServerEvents>;
const ids = {
  first: "10000000-0000-4000-8000-000000000001",
  second: "10000000-0000-4000-8000-000000000002",
  spectator: "10000000-0000-4000-8000-000000000003",
  extra: "10000000-0000-4000-8000-000000000004",
};
const topic: Topic = {
  id: "123", title: "技术应当代替重复劳动吗？", url: "https://www.zhihu.com/question/123",
  topAnswerExcerpt: "重复劳动可以交给工具，判断仍需要人。", topConsensusSummary: "工具节省时间，责任仍在人。",
  defaults: {
    1: ["工具节省时间，责任仍在人。", "效率之外还要考虑责任。"],
    2: ["正方：可以把时间留给更重要的事。", "反方：完全依赖工具会失去判断。"],
    3: ["工具下班了，责任还在加班。", "省下的时间，最后又拿去开会了。"],
  },
};

const random: RandomSource = { integer: max => max - 1 };
const topics: TopicProvider = { candidateIds: ["topic"], async resolve() { return structuredClone(topic); } };
const ai: AiProvider = { act(_request, signal) {
  return new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("ABORTED")), { once: true }));
} };

function ack<T>(emit: (done: (result: T) => void) => void): Promise<T> {
  return new Promise(resolve => emit(resolve));
}

function socketEvent(socket: ClientSocket, event: "connect" | "disconnect" | "session:replaced"): Promise<void> {
  return new Promise(resolve => socket.once(event, () => resolve()));
}

async function harness(gatewayOptions: Partial<SocketGatewayOptions> = {}) {
  const http = createServer();
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(http);
  const store = new MemoryRoomStore();
  const rooms = new RoomRegistry({ clock: systemClock, random, store, topics, ai }, {
    topicTimeoutMs: 100, aiTimeoutMs: 100, retryMs: 10, topicBackoffMs: 20, topicMaxBackoffMs: 80,
  });
  const sessions = new SessionService(new MemorySessionStore(), Buffer.alloc(32, 7));
  new SocketGateway(io, new AdmissionService(rooms, sessions), gatewayOptions).register();
  await new Promise<void>(resolve => http.listen(0, "127.0.0.1", resolve));
  const address = http.address();
  assert(address && typeof address === "object");
  const clients: ClientSocket[] = [];
  const connect = async () => {
    const client: ClientSocket = createClient(`http://127.0.0.1:${address.port}`, { transports: ["websocket"], forceNew: true });
    clients.push(client);
    if (!client.connected) await socketEvent(client, "connect");
    return client;
  };
  const close = async () => {
    for (const client of clients) client.disconnect();
    await rooms.close();
    await new Promise<void>(resolve => io.close(() => resolve()));
    await new Promise<void>(resolve => http.close(() => resolve()));
  };
  return { connect, close };
}

async function sync(socket: ClientSocket) {
  return ack<SyncResult>(done => socket.emit("room:sync", done));
}

async function waitFor(socket: ClientSocket, predicate: (result: Extract<SyncResult, { ok: true }>) => boolean) {
  for (let i = 0; i < 50; i++) {
    const result = await sync(socket);
    if (result.ok && predicate(result)) return result;
    await new Promise<void>(resolve => setImmediate(resolve));
  }
  assert.fail("Timed out waiting for room state");
}

test("真实Socket连接隔离玩家与观战视图，并严格校验输入", async () => {
  const app = await harness();
  try {
    const first = await app.connect();
    const second = await app.connect();
    const watcher = await app.connect();
    const created = await ack<SessionResult>(done => first.emit("room:create", { requestId: ids.first, roomId: "demo", mode: "player" }, done));
    assert.equal(created.ok, true);
    const joined = await ack<SessionResult>(done => second.emit("room:join", { requestId: ids.second, roomId: "demo", mode: "player" }, done));
    const watched = await ack<SessionResult>(done => watcher.emit("room:join", { requestId: ids.spectator, roomId: "demo", mode: "spectator" }, done));
    assert.equal(joined.ok, true);
    assert.equal(watched.ok, true);
    if (!created.ok || !joined.ok || !watched.ok) return;
    assert.equal(created.view.lobby!.count, 1);
    assert.equal(joined.view.lobby!.count, 2);
    assert.equal(watched.view.self, undefined);
    assert.ok(!JSON.stringify(watched.view).includes("participantId"));

    const forbidden = await ack<SocketCommandAck>(done => watcher.emit("room:ready", {
      commandId: "spectator-ready", matchId: watched.view.matchId, phaseToken: watched.view.phaseToken, ready: true,
    }, done));
    assert.equal(forbidden.ok, false);
    if (!forbidden.ok) assert.equal(forbidden.error, "FORBIDDEN");

    const malformed = await ack<SocketCommandAck>(done => first.emit("game:answer", {
      commandId: "bad", matchId: created.view.matchId, phaseToken: created.view.phaseToken,
      round: 1, text: 7,
    } as never, done));
    assert.equal(malformed.ok, false);
    if (!malformed.ok) assert.equal(malformed.error, "INVALID_INPUT");

    const ready1 = await ack<SocketCommandAck>(done => first.emit("room:ready", {
      commandId: "ready-1", matchId: created.view.matchId, phaseToken: created.view.phaseToken, ready: true,
    }, done));
    assert.equal(ready1.ok, true);
    const beforeSecond = await sync(second);
    assert.equal(beforeSecond.ok, true);
    if (!beforeSecond.ok) return;
    const ready2 = await ack<SocketCommandAck>(done => second.emit("room:ready", {
      commandId: "ready-2", matchId: beforeSecond.view.matchId, phaseToken: beforeSecond.view.phaseToken, ready: true,
    }, done));
    assert.equal(ready2.ok, true);
    const playerView = await waitFor(first, result => result.view.phase === "answering");
    const spectatorView = await waitFor(watcher, result => result.view.phase === "answering");
    assert.ok(playerView.view.self?.role === "human" || playerView.view.self?.role === "shadow");
    assert.equal(spectatorView.view.self, undefined);
    assert.ok(!JSON.stringify(spectatorView.view).includes('"role"'));

    const retry = await ack<SessionResult>(done => first.emit("room:join", {
      requestId: ids.first, roomId: "demo", mode: "player",
    }, done));
    assert.equal(retry.ok, true);
    if (retry.ok) {
      assert.equal(retry.sessionToken, created.sessionToken);
      assert.equal(retry.view.self?.seatId, playerView.view.self?.seatId);
    }

    const late = await app.connect();
    const lateJoin = await ack<SessionResult>(done => late.emit("room:join", {
      requestId: ids.extra, roomId: "demo", mode: "player",
    }, done));
    assert.equal(lateJoin.ok, false);
    if (!lateJoin.ok) assert.equal(lateJoin.error, "WRONG_PHASE");
  } finally { await app.close(); }
});

test("同时恢复同一会话只保留一个活动连接", { timeout: 10_000 }, async () => {
  const app = await harness();
  try {
    const original = await app.connect();
    const created = await ack<SessionResult>(done => original.emit("room:create", {
      requestId: ids.first, roomId: "race", mode: "player",
    }, done));
    assert.ok(created.ok);
    if (!created.ok) return;
    const a = await app.connect();
    const b = await app.connect();
    const replaced = Promise.race([socketEvent(a, "disconnect"), socketEvent(b, "disconnect")]);
    a.emit("room:resume", { roomId: "race", sessionToken: created.sessionToken }, () => {});
    b.emit("room:resume", { roomId: "race", sessionToken: created.sessionToken }, () => {});
    await replaced;
    assert.notEqual(a.connected, b.connected);
    assert.ok((await sync(a.connected ? a : b)).ok);
  } finally { await app.close(); }
});

test("同一加入请求幂等且新连接接管会话；错误凭据不能恢复", async () => {
  const app = await harness();
  try {
    const first = await app.connect();
    const created = await ack<SessionResult>(done => first.emit("room:create", {
      requestId: ids.first, roomId: "resume", mode: "player",
    }, done));
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const replaced = socketEvent(first, "session:replaced");
    const disconnected = socketEvent(first, "disconnect");
    const second = await app.connect();
    const repeated = await ack<SessionResult>(done => second.emit("room:join", {
      requestId: ids.first, roomId: "resume", mode: "player",
    }, done));
    assert.equal(repeated.ok, true);
    if (!repeated.ok) return;
    assert.equal(repeated.sessionToken, created.sessionToken);
    assert.equal(repeated.view.lobby!.count, 1);
    await replaced;
    await disconnected;

    const replacedAgain = socketEvent(second, "session:replaced");
    const third = await app.connect();
    const resumed = await ack<SessionResult>(done => third.emit("room:resume", {
      roomId: "resume", sessionToken: created.sessionToken,
    }, done));
    assert.equal(resumed.ok, true);
    await replacedAgain;
    assert.equal(resumed.ok && resumed.view.lobby!.count, 1);

    const stranger = await app.connect();
    const invalid = await ack<SessionResult>(done => stranger.emit("room:resume", {
      roomId: "resume", sessionToken: `${created.sessionToken}x`,
    }, done));
    assert.deepEqual(invalid, { ok: false, error: "INVALID_SESSION" });
    assert.deepEqual(await sync(stranger), { ok: false, error: "NOT_JOINED" });
  } finally { await app.close(); }
});

test("会话凭据可跨服务实例验证，错误房间和篡改密钥均失败", async () => {
  const store = new MemorySessionStore();
  const key = Buffer.alloc(32, 9);
  const first = new SessionService(store, key, () => 123);
  const participantId = first.participantId("room", ids.first);
  const issued = await first.issue("room", { kind: "participant", participantId }, ids.first);
  const repeated = await first.issue("room", { kind: "participant", participantId }, ids.first);
  assert.equal(repeated.token, issued.token);
  const restored = await new SessionService(store, key, () => 123).verify("room", issued.token);
  assert.deepEqual(restored?.viewer, { kind: "participant", participantId });
  assert.equal(await first.verify("other", issued.token), null);
  assert.equal(await first.verify("room", `${issued.token}x`), null);
  assert.throws(() => new SessionService(store, "short"), /SESSION_KEY_TOO_SHORT/);
});

test("Socket按会话限制命令频率", async () => {
  const app = await harness({ command: { limit: 1, windowMs: 60_000 } });
  try {
    const client = await app.connect();
    const created = await ack<SessionResult>(done => client.emit("room:create", {
      requestId: ids.first, roomId: "limited", mode: "player",
    }, done));
    assert.ok(created.ok);
    if (!created.ok) return;
    const first = await ack<SocketCommandAck>(done => client.emit("room:ready", {
      commandId: "first", matchId: created.view.matchId, phaseToken: created.view.phaseToken, ready: true,
    }, done));
    assert.equal(first.ok, true);
    const second = await ack<SocketCommandAck>(done => client.emit("room:ready", {
      commandId: "second", matchId: created.view.matchId, phaseToken: created.view.phaseToken, ready: false,
    }, done));
    assert.equal(second.ok, false);
    if (!second.ok) assert.equal(second.error, "RATE_LIMITED");
  } finally { await app.close(); }
});

test("加入requestId只能在短期幂等窗口内重新换取会话Token", async () => {
  const store = new MemorySessionStore();
  let now = 0;
  const sessions = new SessionService(store, Buffer.alloc(32, 4), () => now, 1_000);
  const participantId = sessions.participantId("room", ids.first);
  const viewer = { kind: "participant", participantId } as const;
  const issued = await sessions.issue("room", viewer, ids.first);
  now = 1_000;
  assert.equal((await sessions.issue("room", viewer, ids.first)).token, issued.token);
  now = 1_001;
  await assert.rejects(sessions.issue("room", viewer, ids.first), /ADMISSION_EXPIRED/);
  assert.deepEqual((await sessions.verify("room", issued.token))?.viewer, viewer);
});

test("会话更新最近活动时间，到期或撤销后拒绝并可清理", async () => {
  const store = new MemorySessionStore();
  let now = 0;
  const sessions = new SessionService(store, Buffer.alloc(32, 5), () => now, 100, 1_000, 50);
  const viewer = { kind: "spectator" } as const;
  const issued = await sessions.issue("room", viewer, ids.first);
  now = 49;
  assert.equal((await sessions.authorize(issued.session.id))?.lastSeenAt, 0);
  now = 50;
  assert.equal((await sessions.authorize(issued.session.id))?.lastSeenAt, 50);
  assert.equal(await sessions.revoke(issued.session.id), true);
  assert.equal(await sessions.verify("room", issued.token), null);
  assert.equal(await sessions.cleanupExpired(), 1);
  assert.equal(await store.find(issued.session.id), null);

  const other = await sessions.issue("room", viewer, ids.second);
  now = 1_050;
  assert.equal(await sessions.verify("room", other.token), null);
  assert.equal(await sessions.cleanupExpired(), 1);
});
