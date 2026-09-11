import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents, SessionResult } from "../src/server/socket-contracts.ts";

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;
const root = resolve(import.meta.dirname, "..");
const directory = await mkdtemp(join(tmpdir(), "roundtable-smoke-"));
const port = await new Promise<number>((resolvePort, reject) => {
  const probe = createServer();
  probe.once("error", reject);
  probe.listen(0, "127.0.0.1", () => {
    const address = probe.address();
    if (!address || typeof address === "string") { reject(new Error("PORT_PROBE_FAILED")); return; }
    probe.close(error => error ? reject(error) : resolvePort(address.port));
  });
});
const origin = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ["server.ts"], {
  cwd: root, stdio: ["ignore", "pipe", "pipe"], env: {
    ...process.env, NODE_ENV: "production", PORT: String(port), DATABASE_PATH: join(directory, "smoke.db"),
    SESSION_HMAC_KEY: "production-smoke-session-key-32-bytes-minimum",
    ALLOWED_ORIGINS: origin, TRUST_PROXY_HOPS: "0", TOPIC_MODE: "static",
    ALLOW_STATIC_TOPICS_IN_PRODUCTION: "true", AI_MODE: "live",
    DEEPSEEK_API_KEY: "ci-placeholder-not-a-real-key", METRICS_TOKEN: "production-smoke-metrics-token",
    ADMIN_TOKEN: "production-smoke-admin-token-at-least-32-bytes",
  },
});
let output = "";
child.stdout.on("data", chunk => { output += String(chunk).slice(0, 4096); });
child.stderr.on("data", chunk => { output += String(chunk).slice(0, 4096); });
const clients: Client[] = [];
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error(`SERVER_EXITED_${child.exitCode}: ${output}`);
    try { ready = (await fetch(`${origin}/api/health/ready`)).ok; } catch { /* Starting. */ }
    if (ready) break;
    await new Promise(resolveWait => setTimeout(resolveWait, 50));
  }
  assert.equal(ready, true, output);
  assert.equal((await fetch(origin)).status, 200);
  assert.equal((await fetch(`${origin}/api/health/live`)).status, 200);
  assert.equal((await fetch(`${origin}/api/metrics`)).status, 401);
  assert.equal((await fetch(`${origin}/api/metrics`, { headers: { authorization: "Bearer production-smoke-metrics-token" } })).status, 200);

  const socket: Client = io(origin, { transports: ["websocket"], extraHeaders: { origin }, forceNew: true });
  clients.push(socket);
  await new Promise<void>((resolveConnect, reject) => {
    const timeout = setTimeout(() => reject(new Error("SOCKET_CONNECT_TIMEOUT")), 5_000);
    socket.once("connect", () => { clearTimeout(timeout); resolveConnect(); });
    socket.once("connect_error", error => { clearTimeout(timeout); reject(error); });
  });
  const admitted = await new Promise<SessionResult>(resolveAck => socket.emit("room:create", {
    requestId: "10000000-0000-4000-8000-000000000001", roomId: "smoke", mode: "spectator",
  }, resolveAck));
  assert.equal(admitted.ok, true);
  assert.equal((await fetch(`${origin}/api/admin/rooms`)).status, 401);
  const admin = await fetch(`${origin}/api/admin/rooms`, {
    headers: { authorization: "Bearer production-smoke-admin-token-at-least-32-bytes" },
  });
  assert.equal(admin.status, 200);
  const adminText = await admin.text();
  assert.match(adminText, /"roomId":"smoke"/);
  for (const forbidden of ["matchId", "answers", "roles", "session", "tokenHash"]) assert.ok(!adminText.includes(forbidden));

  const denied: Client = io(origin, { transports: ["websocket"], extraHeaders: { origin: "https://evil.example" },
    forceNew: true, reconnection: false });
  clients.push(denied);
  await new Promise<void>((resolveDenied, reject) => {
    const timeout = setTimeout(() => reject(new Error("ORIGIN_CHECK_TIMEOUT")), 5_000);
    denied.once("connect", () => { clearTimeout(timeout); reject(new Error("DISALLOWED_ORIGIN_CONNECTED")); });
    denied.once("connect_error", () => { clearTimeout(timeout); resolveDenied(); });
  });
  process.stdout.write(`Production smoke passed on ${origin}\n`);
} finally {
  for (const client of clients) client.disconnect();
  if (child.exitCode === null) child.kill("SIGTERM");
  await new Promise<void>(resolveExit => {
    if (child.exitCode !== null) resolveExit();
    else { child.once("exit", () => resolveExit()); setTimeout(() => { child.kill("SIGKILL"); resolveExit(); }, 5_000).unref(); }
  });
  await rm(directory, { recursive: true, force: true });
}
