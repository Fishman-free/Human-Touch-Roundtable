import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { ConnectionQuota, FixedWindowRateLimiter } from "../src/server/rate-limit.ts";
import { handleOperationalRequest } from "../src/server/health.ts";
import { JsonLogger } from "../src/observability/logger.ts";
import { MetricsRegistry } from "../src/observability/metrics.ts";
import { originAllowed, parseOrigins, resolveClientIp, socketTransportOptions } from "../src/server/socket-security.ts";

test("固定窗口限流按作用域隔离并在窗口边界复位", () => {
  let now = 0;
  const limiter = new FixedWindowRateLimiter(() => now);
  const rule = { limit: 2, windowMs: 100 };
  assert.equal(limiter.allow("command", "session", rule), true);
  assert.equal(limiter.allow("command", "session", rule), true);
  assert.equal(limiter.allow("command", "session", rule), false);
  assert.equal(limiter.allow("create", "session", rule), true);
  now = 100;
  assert.equal(limiter.allow("command", "session", rule), true);
  now = 50;
  assert.equal(limiter.allow("command", "session", rule), true);
});

test("限流桶达到容量时拒绝新来源，并回收过期桶", () => {
  let now = 0;
  const limiter = new FixedWindowRateLimiter(() => now, 2);
  const rule = { limit: 1, windowMs: 100 };
  assert.equal(limiter.allow("scope", "a", rule), true);
  assert.equal(limiter.allow("scope", "b", rule), true);
  assert.equal(limiter.allow("scope", "c", rule), false);
  now = 100;
  assert.equal(limiter.allow("scope", "c", rule), true);
});

test("连接配额释放后允许新连接", () => {
  const quota = new ConnectionQuota();
  assert.equal(quota.acquire("ip", 1), true);
  assert.equal(quota.acquire("ip", 1), false);
  quota.release("ip");
  assert.equal(quota.acquire("ip", 1), true);
});

test("Origin仅精确匹配，生产配置拒绝空列表与无Origin请求", () => {
  const origins = parseOrigins("https://game.example.com, http://localhost:3000,https://game.example.com");
  assert.deepEqual(origins, ["https://game.example.com", "http://localhost:3000"]);
  assert.equal(originAllowed("https://game.example.com", origins, false), true);
  assert.equal(originAllowed("https://game.example.com.evil.test", origins, false), false);
  assert.equal(originAllowed(undefined, origins, false), false);
  assert.equal(originAllowed(undefined, origins, true), true);
  assert.throws(() => parseOrigins("https://game.example.com/path"), /INVALID_ALLOWED_ORIGIN/);
  assert.throws(() => socketTransportOptions([], false), /ALLOWED_ORIGINS_REQUIRED/);
});

test("客户端地址默认忽略转发头，只在显式可信代理跳数下解析", () => {
  assert.equal(resolveClientIp("::ffff:10.0.0.2", "203.0.113.8", 0), "10.0.0.2");
  assert.equal(resolveClientIp("10.0.0.2", "203.0.113.8", 1), "203.0.113.8");
  assert.equal(resolveClientIp("10.0.0.3", "203.0.113.8, 10.0.0.2", 2), "203.0.113.8");
  assert.equal(resolveClientIp("10.0.0.2", "forged", 1), "10.0.0.2");
});

test("健康端点区分存活与就绪并禁止缓存", async () => {
  let ready = false;
  const metrics = new MetricsRegistry(); metrics.increment("test_total", { status: "ok" });
  const server = createServer((request, response) => {
    void handleOperationalRequest(request, response, { ready: () => ready, metrics: () => metrics.render(), metricsToken: "monitor-token" })
      .then(handled => { if (!handled) { response.writeHead(404); response.end(); } });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address === "object");
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    assert.equal((await fetch(`${origin}/api/health/live`)).status, 200);
    const unavailable = await fetch(`${origin}/api/health/ready`);
    assert.equal(unavailable.status, 503);
    assert.equal(unavailable.headers.get("cache-control"), "no-store");
    ready = true;
    assert.equal((await fetch(`${origin}/api/health/ready`)).status, 200);
    assert.equal((await fetch(`${origin}/api/metrics`)).status, 401);
    const metricResponse = await fetch(`${origin}/api/metrics`, { headers: { authorization: "Bearer monitor-token" } });
    assert.equal(metricResponse.status, 200);
    assert.match(await metricResponse.text(), /test_total\{status="ok"\} 1/);
    assert.equal((await fetch(`${origin}/other`)).status, 404);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

test("结构化日志递归脱敏凭据并限制超长字段", () => {
  const lines: string[] = [];
  const logger = new JsonLogger(line => lines.push(line), () => new Date("2026-09-10T00:00:00.000Z"));
  logger.info("test.event", { sessionToken: "sensitive", nested: { apiKey: "sensitive", value: "x" }, long: "a".repeat(600) });
  assert.equal(lines.length, 1);
  assert.ok(!lines[0].includes("sensitive"));
  const value = JSON.parse(lines[0]) as Record<string, unknown>;
  assert.equal(value.event, "test.event");
  assert.equal((value.nested as Record<string, unknown>).apiKey, "[REDACTED]");
  assert.ok((value.long as string).length < 600);
});

test("指标按低基数标签聚合计数与观测值", () => {
  const metrics = new MetricsRegistry();
  metrics.increment("attempts_total", { provider: "one" });
  metrics.increment("attempts_total", { provider: "one" }, 2);
  metrics.observe("latency_ms", 10, { provider: "one" });
  metrics.observe("latency_ms", 20, { provider: "one" });
  const output = metrics.render();
  assert.match(output, /attempts_total\{provider="one"\} 3/);
  assert.match(output, /latency_ms_count\{provider="one"\} 2/);
  assert.match(output, /latency_ms_sum\{provider="one"\} 30/);
});
