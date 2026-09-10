import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createServer } from "node:http";
import next from "next";
import { Server } from "socket.io";
import { createAiProvider } from "./src/ai/config.ts";
import { createServerContext } from "./src/server/server-context.ts";
import type { ClientToServerEvents, ServerToClientEvents } from "./src/server/socket-contracts.ts";
import { StaticTopicProvider } from "./src/topics/static-topic-provider.ts";
import { handleOperationalRequest } from "./src/server/health.ts";
import { parseOrigins, socketTransportOptions } from "./src/server/socket-security.ts";
import { OperationalMonitor } from "./src/observability/monitor.ts";

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
const monitor = new OperationalMonitor();
const metricsToken = process.env.METRICS_TOKEN;
if (metricsToken !== undefined && Buffer.byteLength(metricsToken) < 24) throw new Error("METRICS_TOKEN must contain at least 24 bytes");
const http = createServer((request, response) => {
  void (async () => {
    if (await handleOperationalRequest(request, response, {
      ready: () => ready && context.check(), metrics: () => monitor.metrics.render(), metricsToken,
    })) return;
    await nextHandler(request, response);
  })().catch(() => {
    if (!response.headersSent) response.writeHead(500, { "content-type": "application/json; charset=utf-8" });
    if (!response.writableEnded) response.end(JSON.stringify({ error: "INTERNAL_SERVER_ERROR" }));
  });
});
const io = new Server<ClientToServerEvents, ServerToClientEvents>(http, {
  ...socketTransportOptions(allowedOrigins, development),
});
const context = createServerContext({ databasePath, sessionHmacKey,
  socket: { trustedProxyHops, onSecurityEvent: event => monitor.security(event) } }, {
  topics: new StaticTopicProvider(),
  ai: createAiProvider(process.env, development, event => monitor.ai(event)),
  diagnose: event => monitor.runtime(event),
});
await context.initialize();
ready = true;
context.register(io);

await new Promise<void>((resolveListen, reject) => {
  http.once("error", reject);
  http.listen(port, "0.0.0.0", () => resolveListen());
});
monitor.lifecycle("server.started", { port, development });

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  ready = false;
  monitor.lifecycle("server.stopping");
  await new Promise<void>(resolveClose => io.close(() => resolveClose()));
  await context.close();
  await new Promise<void>(resolveClose => http.close(() => resolveClose()));
}
process.on("SIGINT", () => { void shutdown().then(() => process.exit(0)); });
process.on("SIGTERM", () => { void shutdown().then(() => process.exit(0)); });
