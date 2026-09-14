import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { Server } from "socket.io";
import { io as connect, type Socket } from "socket.io-client";
import { MemoryRoomStore } from "../src/repository/memory-room-store.ts";
import { RoomRegistry } from "../src/server/room-registry.ts";
import { AdmissionService } from "../src/server/admission-service.ts";
import { MemorySessionStore, SessionService } from "../src/server/session.ts";
import { Matchmaking } from "../src/server/matchmaking.ts";
import { SocketGateway } from "../src/server/socket-gateway.ts";
import { handleAccountRequest } from "../src/server/account-http.ts";
import { ZhihuOAuth } from "../src/server/zhihu-oauth.ts";
import type { ClientToServerEvents, ServerToClientEvents, SessionResult } from "../src/contracts/public.ts";

function harness() {
  let now = Date.now();
  const rooms = new RoomRegistry({ store: new MemoryRoomStore(), random: { integer: () => 0 },
    clock: { now: () => now, setTimeout: () => 0, clearTimeout: () => {} },
    topics: { candidateIds: [], resolve: async () => { throw new Error("NOT_USED"); } },
    ai: { act: async () => { throw new Error("NOT_USED"); } },
  });
  const sessions = new SessionService(new MemorySessionStore(), Buffer.alloc(32, 7), () => now);
  const admissions = new AdmissionService(rooms, sessions);
  const matches = new Matchmaking(admissions, rooms, () => now);
  return { rooms, admissions, matches, expiresAt: now + 3600_000, advance: (ms: number) => { now += ms; },
    close: async () => { await matches.close(); await rooms.close(); } };
}

test("并发重复排队只占一席，两账号取得不同令牌，可经原Socket恢复匿名房间", async () => {
  const h = harness();
  const http = createServer(); const io = new Server<ClientToServerEvents, ServerToClientEvents>(http);
  new SocketGateway(io, h.admissions).register();
  const clients: Socket<ServerToClientEvents, ClientToServerEvents>[] = [];
  try {
    const duplicate = await Promise.all(Array.from({ length: 8 }, () => h.matches.update("account-a", "join", h.expiresAt)));
    for (const result of duplicate) assert.deepEqual(result, { status: "waiting", waiting: 1 });
    const b = await h.matches.update("account-b", "join", h.expiresAt);
    const a = await h.matches.update("account-a", "poll", h.expiresAt);
    assert(a.status === "matched" && b.status === "matched");
    assert.equal(a.roomId, b.roomId); assert.notEqual(a.sessionToken, b.sessionToken);
    assert.deepEqual(await h.matches.update("account-a", "join", h.expiresAt), a);
    assert.equal((await h.rooms.list()).length, 1);
    await new Promise<void>(resolve => http.listen(0, "127.0.0.1", resolve));
    const address = http.address(); assert(address && typeof address === "object");
    for (const item of [a, b]) {
      const socket: Socket<ServerToClientEvents, ClientToServerEvents> = connect(`http://127.0.0.1:${address.port}`, { transports: ["websocket"], forceNew: true });
      clients.push(socket);
      await new Promise<void>(resolve => socket.once("connect", resolve));
      const result = await new Promise<SessionResult>(resolve => socket.emit("room:resume", { roomId: item.roomId, sessionToken: item.sessionToken }, resolve));
      assert(result.ok); assert.equal(result.view.lobby?.count, 2);
      assert(result.view.actions.includes("ready"));
      assert(!JSON.stringify(result.view).includes("account-"));
    }
  } finally {
    for (const socket of clients) socket.disconnect();
    await new Promise<void>(resolve => io.close(() => resolve())); await h.close();
  }
});

test("取消、心跳过期、登录过期不会留下可匹配席位，poll不自动重新排队", async () => {
  const h = harness();
  try {
    await h.matches.update("a", "join", h.expiresAt);
    assert.deepEqual(await h.matches.update("a", "cancel", h.expiresAt), { status: "idle" });
    assert.deepEqual(await h.matches.update("a", "poll", h.expiresAt), { status: "idle" });
    await h.matches.update("a", "join", h.expiresAt);
    h.advance(30_000);
    assert.deepEqual(await h.matches.update("b", "join", h.expiresAt), { status: "waiting", waiting: 1 });
    assert.deepEqual(await h.matches.update("a", "poll", h.expiresAt), { status: "idle" });
    await h.matches.update("b", "cancel", h.expiresAt);
    assert.deepEqual(await h.matches.update("expired", "join", 0), { status: "idle" });
    assert.equal((await h.rooms.list()).length, 0);
  } finally { await h.close(); }
});

test("第二人入场失败时回滚房间，原队列可重试成功", async () => {
  const h = harness(); const original = h.admissions.join.bind(h.admissions);
  try {
    await h.matches.update("a", "join", h.expiresAt);
    let joins = 0;
    h.admissions.join = async (...args) => ++joins === 2 ? { ok: false, error: "ROOM_UNAVAILABLE" } : original(...args);
    await assert.rejects(h.matches.update("b", "join", h.expiresAt), /MATCH_UNAVAILABLE/);
    assert.equal((await h.rooms.list()).length, 0);
    h.admissions.join = original;
    assert.equal((await h.matches.update("b", "poll", h.expiresAt)).status, "matched");
    assert.equal((await h.matches.update("a", "poll", h.expiresAt)).status, "matched");
  } finally { await h.close(); }
});

test("无人准备的公共候场过期后可重新匹配", async () => {
  const h = harness();
  try {
    await h.matches.update("a", "join", h.expiresAt);
    const b = await h.matches.update("b", "join", h.expiresAt); assert(b.status === "matched");
    h.advance(120_000);
    assert.deepEqual(await h.matches.update("a", "poll", h.expiresAt), { status: "idle" });
    assert.equal((await h.rooms.list()).length, 0);
    assert.equal((await h.admissions.resume(b.roomId, b.sessionToken)).ok, false);
    assert.deepEqual(await h.matches.update("b", "join", h.expiresAt), { status: "waiting", waiting: 1 });
  } finally { await h.close(); }
});

test("排在候场清理前的准备命令成功开局，清理不能关闭进行中的房间", async () => {
  const h = harness();
  try {
    await h.matches.update("a", "join", h.expiresAt);
    const b = await h.matches.update("b", "join", h.expiresAt);
    const a = await h.matches.update("a", "poll", h.expiresAt);
    assert(a.status === "matched" && b.status === "matched");
    const first = await h.admissions.resume(a.roomId, a.sessionToken);
    const second = await h.admissions.resume(b.roomId, b.sessionToken);
    assert(first.ok && second.ok);
    assert(first.session.viewer.kind === "participant" && second.session.viewer.kind === "participant");
    const runtime = first.runtime; const view = runtime.view({ kind: "spectator" });
    const one = runtime.dispatch(first.session.viewer.participantId, { commandId: "ready_first", matchId: view.matchId,
      phaseToken: view.phaseToken, command: { type: "ready", ready: true } });
    const two = runtime.dispatch(second.session.viewer.participantId, { commandId: "ready_second", matchId: view.matchId,
      phaseToken: view.phaseToken, command: { type: "ready", ready: true } });
    const close = runtime.closeIfLobby();
    assert.equal((await one).ok, true); assert.equal((await two).ok, true); assert.equal(await close, false);
    h.advance(120_000);
    assert.equal((await h.matches.update("a", "poll", h.expiresAt)).status, "matched");
    assert.equal((await runtime.sync({ kind: "spectator" })).phase, "preparing");
  } finally { await h.close(); }
});

test("HTTP匹配拒绝游客和跨站请求，OAuth Cookie安全且当前账号响应不泄露Token", async () => {
  const h = harness();
  const oauth = new ZhihuOAuth({ appId: "fixture", appKey: "fixture", origin: "https://airoundtable.stream",
    redirectUri: "https://airoundtable.stream/api/auth/zhihu/callback" }, async input => Response.json(String(input).endsWith("access_token") ?
    { access_token: "fixture-provider-token", expires_in: 3600 } : { hash_id: "fixture-user", fullname: "当前用户", phone: "private" }));
  const http = createServer((request, response) => {
    void handleAccountRequest(request, response, oauth, h.matches).then(handled => { if (!handled) response.end(); });
  });
  await new Promise<void>(resolve => http.listen(0, "127.0.0.1", resolve));
  const address = http.address(); assert(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const post = { method: "POST", headers: { origin: "https://airoundtable.stream" } };
    assert.equal((await fetch(`${base}/api/matchmaking?action=join`, post)).status, 401);
    const start = await fetch(`${base}/api/auth/zhihu/start`, { redirect: "manual" });
    const state = new URL(start.headers.get("location")!).searchParams.get("state")!;
    const stateCookie = start.headers.getSetCookie()[0];
    assert.match(stateCookie, /HttpOnly; Secure; SameSite=Lax/);
    const callback = await fetch(`${base}/api/auth/zhihu/callback?authorization_code=fixture-code&state=${state}`, {
      redirect: "manual", headers: { cookie: stateCookie.split(";")[0] },
    });
    assert.equal(callback.headers.get("location"), "/");
    const cookie = callback.headers.getSetCookie()[0].split(";")[0];
    const account = await fetch(`${base}/api/auth/session`, { headers: { cookie } });
    assert.equal(account.headers.get("cache-control"), "no-store");
    assert.deepEqual(await account.json(), { enabled: true, user: { name: "当前用户" } });
    assert.equal((await fetch(`${base}/api/matchmaking?action=join`, { method: "POST", headers: { cookie, origin: "https://evil.example" } })).status, 403);
    const own = { method: "POST", headers: { ...post.headers, cookie } };
    assert.deepEqual(await (await fetch(`${base}/api/matchmaking?action=join`, own)).json(), { status: "waiting", waiting: 1 });
    assert.equal((await fetch(`${base}/api/auth/logout`, own)).status, 200);
    assert.equal((await fetch(`${base}/api/matchmaking?action=poll`, own)).status, 401);
    assert.equal((await h.matches.update("other", "join", h.expiresAt)).status, "waiting");
  } finally { await new Promise<void>(resolve => http.close(() => resolve())); await h.close(); }
});
