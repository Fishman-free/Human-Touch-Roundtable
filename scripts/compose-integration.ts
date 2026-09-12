import assert from "node:assert/strict";
import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents, SessionResult, SyncResult } from "../src/server/socket-contracts.ts";
type Client = Socket<ServerToClientEvents, ClientToServerEvents>;
const origin = process.env.COMPOSE_ORIGIN ?? "http://127.0.0.1:3000";
const sockets: Client[] = [];
async function connect(socket: Client) { await new Promise<void>((resolve, reject) => { socket.once("connect", () => resolve()); socket.once("connect_error", reject); }); }
try {
  assert.equal((await fetch(`${origin}/api/health/live`)).status, 200);
  assert.equal((await fetch(`${origin}/api/health/ready`)).status, 200);
  const first = io(origin, { transports: ["websocket"], extraHeaders: { origin }, forceNew: true, reconnection: false });
  const second = io(origin, { transports: ["websocket"], extraHeaders: { origin }, forceNew: true, reconnection: false }); sockets.push(first, second);
  await Promise.all([connect(first), connect(second)]);
  const create = await new Promise<SessionResult>(resolve => first.emit("room:create", { requestId: "10000000-0000-4000-8000-000000000101", roomId: "compose-ci", mode: "spectator" }, resolve));
  assert.equal(create.ok, true);
  const join = await new Promise<SessionResult>(resolve => second.emit("room:join", { requestId: "10000000-0000-4000-8000-000000000102", roomId: "compose-ci", mode: "spectator" }, resolve));
  assert.equal(join.ok, true);
  const [left, right] = await Promise.all([new Promise<SyncResult>(resolve => first.emit("room:sync", resolve)), new Promise<SyncResult>(resolve => second.emit("room:sync", resolve))]);
  assert.equal(left.ok, true); assert.equal(right.ok, true);
  const denied = io(origin, { transports: ["websocket"], extraHeaders: { origin: "https://evil.example" }, forceNew: true, reconnection: false }); sockets.push(denied);
  await new Promise<void>((resolve, reject) => { denied.once("connect", () => reject(new Error("DISALLOWED_ORIGIN_CONNECTED"))); denied.once("connect_error", () => resolve()); setTimeout(() => reject(new Error("ORIGIN_TIMEOUT")), 5000); });
  process.stdout.write(JSON.stringify({ status: "ok", socketConnections: 2, room: "compose-ci", synchronized: true, disallowedOriginRejected: true }) + "\n");
} finally { sockets.forEach(socket => socket.disconnect()); }
