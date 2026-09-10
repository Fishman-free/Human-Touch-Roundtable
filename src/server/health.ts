import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

export interface OperationalEndpoints {
  ready(): boolean | Promise<boolean>;
  metrics?: () => string;
  metricsToken?: string;
}

function authorized(header: string | undefined, expected: string): boolean {
  if (!header?.startsWith("Bearer ")) return false;
  const actual = Buffer.from(header.slice(7));
  const token = Buffer.from(expected);
  return actual.length === token.length && timingSafeEqual(actual, token);
}

export async function handleOperationalRequest(request: IncomingMessage, response: ServerResponse,
  endpoints: OperationalEndpoints): Promise<boolean> {
  const path = request.url?.split("?", 1)[0];
  if (request.method !== "GET") return false;
  if (path === "/api/health/live" || path === "/api/health/ready") {
    const healthy = path === "/api/health/live" || await endpoints.ready();
    response.writeHead(healthy ? 200 : 503, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    response.end(JSON.stringify({ status: healthy ? "ok" : "not-ready" }));
    return true;
  }
  if (path !== "/api/metrics" || !endpoints.metrics || !endpoints.metricsToken) return false;
  if (!authorized(Array.isArray(request.headers.authorization) ? request.headers.authorization[0] : request.headers.authorization,
    endpoints.metricsToken)) {
    response.writeHead(401, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    response.end(JSON.stringify({ error: "UNAUTHORIZED" }));
    return true;
  }
  response.writeHead(200, { "content-type": "text/plain; version=0.0.4; charset=utf-8", "cache-control": "no-store" });
  response.end(endpoints.metrics());
  return true;
}
