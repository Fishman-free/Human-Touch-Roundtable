import type { IncomingMessage, ServerResponse } from "node:http";

export function handleHealth(request: IncomingMessage, response: ServerResponse, ready: boolean): boolean {
  const path = request.url?.split("?", 1)[0];
  if (request.method !== "GET" || (path !== "/api/health/live" && path !== "/api/health/ready")) return false;
  const healthy = path === "/api/health/live" || ready;
  response.writeHead(healthy ? 200 : 503, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify({ status: healthy ? "ok" : "not-ready" }));
  return true;
}
