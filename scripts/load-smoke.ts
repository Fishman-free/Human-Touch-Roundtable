import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents, SessionResult, SyncResult } from "../src/server/socket-contracts.ts";

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;
const clients = Number(process.env.LOAD_CLIENTS ?? 40);
if (!Number.isInteger(clients) || clients < 1 || clients > 200) throw new Error("INVALID_LOAD_CLIENTS");
const directory = await mkdtemp(join(tmpdir(), "roundtable-load-"));
const root = resolve(import.meta.dirname, "..");
const port = await new Promise<number>((resolvePort, reject) => {
  const probe = createServer(); probe.once("error", reject);
  probe.listen(0, "127.0.0.1", () => {
    const address = probe.address();
    if (!address || typeof address === "string") { reject(new Error("PORT_PROBE_FAILED")); return; }
    probe.close(error => error ? reject(error) : resolvePort(address.port));
  });
});
const origin = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ["server.ts"], { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: {
  ...process.env, NODE_ENV: "production", PORT: String(port), DATABASE_PATH: join(directory, "load.db"),
  SESSION_HMAC_KEY: "load-smoke-session-key-at-least-32-bytes", ALLOWED_ORIGINS: origin,
  TRUST_PROXY_HOPS: "1", TOPIC_MODE: "static", ALLOW_STATIC_TOPICS_IN_PRODUCTION: "true",
  AI_MODE: "live", GLM_API_KEY: "ci-placeholder-not-a-real-key",
} });
let output = ""; child.stdout.on("data", chunk => { output += String(chunk).slice(0, 4096); });
child.stderr.on("data", chunk => { output += String(chunk).slice(0, 4096); });
const sockets: Client[] = [];
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error(`SERVER_EXITED_${child.exitCode}: ${output}`);
    try { ready = (await fetch(`${origin}/api/health/ready`)).ok; } catch { /* Starting. */ }
    if (ready) break;
    await new Promise(wait => setTimeout(wait, 50));
  }
  assert.equal(ready, true, output);

  const latencies = await Promise.all(Array.from({ length: clients }, async (_, index) => {
    const startedAt = performance.now();
    const socket: Client = io(origin, { transports: ["websocket"], forceNew: true, reconnection: false,
      timeout: 5_000, extraHeaders: { origin, "x-forwarded-for": `203.0.113.${index + 1}` } });
    sockets.push(socket);
    await new Promise<void>((resolveConnect, reject) => {
      socket.once("connect", resolveConnect); socket.once("connect_error", reject);
    });
    const admitted = await new Promise<SessionResult>(resolveAck => socket.emit("room:create", {
      requestId: randomUUID(), roomId: `load-${index.toString().padStart(3, "0")}`, mode: "spectator",
    }, resolveAck));
    assert.equal(admitted.ok, true, admitted.ok ? undefined : admitted.error);
    const synced = await new Promise<SyncResult>(resolveAck => socket.emit("room:sync", resolveAck));
    assert.equal(synced.ok, true);
    return performance.now() - startedAt;
  }));
  const sorted = [...latencies].sort((a, b) => a - b);
  const percentile = (value: number) => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * value) - 1)];
  const result = { clients, succeeded: latencies.length, p50Ms: Math.round(percentile(0.5)),
    p95Ms: Math.round(percentile(0.95)), maxMs: Math.round(sorted.at(-1)!) };
  assert.ok(result.p95Ms < 10_000, `p95 exceeded smoke threshold: ${JSON.stringify(result)}`);
  process.stdout.write(`${JSON.stringify(result)}\n`);
} finally {
  for (const socket of sockets) socket.disconnect();
  if (child.exitCode === null) child.kill("SIGTERM");
  await new Promise<void>(resolveExit => {
    if (child.exitCode !== null) resolveExit();
    else { child.once("exit", () => resolveExit()); setTimeout(() => { child.kill("SIGKILL"); resolveExit(); }, 5_000).unref(); }
  });
  await rm(directory, { recursive: true, force: true });
}
