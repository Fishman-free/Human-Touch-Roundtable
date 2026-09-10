import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createServer } from "node:http";
import next from "next";
import { Server } from "socket.io";
import { MockAiProvider } from "./src/ai/mock-ai-provider.ts";
import { createServerContext } from "./src/server/server-context.ts";
import type { ClientToServerEvents, ServerToClientEvents } from "./src/server/socket-contracts.ts";
import { StaticTopicProvider } from "./src/topics/static-topic-provider.ts";
import { handleHealth } from "./src/server/health.ts";
import { parseOrigins, socketTransportOptions } from "./src/server/socket-security.ts";

const development = process.env.NODE_ENV !== "production";
const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("INVALID_PORT");

const databasePath = resolve(process.env.DATABASE_PATH ?? "./data/roundtable.db");
mkdirSync(dirname(databasePath), { recursive: true });
const sessionHmacKey = process.env.SESSION_HMAC_KEY ??
  (development ? "development-only-key-change-before-production-2026" : "");
if (Buffer.byteLength(sessionHmacKey) < 32) throw new Error("SESSION_HMAC_KEY must contain at least 32 bytes");

const allowedOrigins = parseOrigins(process.env.ALLOWED_ORIGINS ??
  (development ? `http://localhost:${port},http://127.0.0.1:${port}` : ""));
const trustedProxyHops = Number(process.env.TRUST_PROXY_HOPS ?? 0);
if (!Number.isSafeInteger(trustedProxyHops) || trustedProxyHops < 0) throw new Error("INVALID_TRUST_PROXY_HOPS");

const app = next({ dev: development });
await app.prepare();
const nextHandler = app.getRequestHandler();
let ready = false;
const http = createServer((request, response) => {
  if (handleHealth(request, response, ready)) return;
  void nextHandler(request, response).catch(() => {
    if (!response.headersSent) response.writeHead(500, { "content-type": "application/json; charset=utf-8" });
    if (!response.writableEnded) response.end(JSON.stringify({ error: "INTERNAL_SERVER_ERROR" }));
  });
});
const io = new Server<ClientToServerEvents, ServerToClientEvents>(http, {
  ...socketTransportOptions(allowedOrigins, development),
});
const context = createServerContext({ databasePath, sessionHmacKey, socket: { trustedProxyHops } }, {
  topics: new StaticTopicProvider(),
  ai: new MockAiProvider(),
  diagnose: event => console.error(JSON.stringify({ scope: "game-runtime", ...event })),
});
await context.initialize();
ready = true;
context.register(io);

await new Promise<void>((resolveListen, reject) => {
  http.once("error", reject);
  http.listen(port, "0.0.0.0", () => resolveListen());
});
console.log(`人味圆桌局已启动：http://localhost:${port}`);

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  ready = false;
  await new Promise<void>(resolveClose => io.close(() => resolveClose()));
  await context.close();
  await new Promise<void>(resolveClose => http.close(() => resolveClose()));
}
process.on("SIGINT", () => { void shutdown().then(() => process.exit(0)); });
process.on("SIGTERM", () => { void shutdown().then(() => process.exit(0)); });
