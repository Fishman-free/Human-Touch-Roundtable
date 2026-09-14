import type { IncomingMessage, ServerResponse } from "node:http";
import type { ZhihuOAuth } from "./zhihu-oauth.ts";
import type { Matchmaking } from "./matchmaking.ts";
import { FixedWindowRateLimiter } from "./rate-limit.ts";
import { resolveClientIp } from "./socket-security.ts";

const limits = new FixedWindowRateLimiter();

const loginCookie = "__Host-roundtable-account";
const stateCookie = "__Host-roundtable-oauth";
function cookie(request: IncomingMessage, name: string) {
  return request.headers.cookie?.split(";").map(item => item.trim()).find(item => item.startsWith(`${name}=`))?.slice(name.length + 1);
}
function setCookie(name: string, value: string, seconds: number) {
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${seconds}`;
}
function json(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" }); response.end(JSON.stringify(body));
}

export async function handleAccountRequest(request: IncomingMessage, response: ServerResponse,
  oauth: ZhihuOAuth, matches: Matchmaking, trustedProxyHops = 0): Promise<boolean> {
  const url = new URL(request.url ?? "/", "http://internal");
  if (!url.pathname.startsWith("/api/auth/") && url.pathname !== "/api/matchmaking") return false;
  response.setHeader("cache-control", "no-store");
  response.setHeader("referrer-policy", "no-referrer");
  response.setHeader("x-content-type-options", "nosniff");
  const session = cookie(request, loginCookie);
  const user = oauth.identify(session);
  const key = user?.id ?? resolveClientIp(request.socket.remoteAddress ?? "unknown", request.headers["x-forwarded-for"], trustedProxyHops);
  if (!limits.allow("account-http", key, { limit: user ? 120 : 60, windowMs: 60_000 })) {
    response.setHeader("retry-after", "60"); json(response, 429, { error: "RATE_LIMITED" }); return true;
  }
  if (url.pathname === "/api/auth/session" && request.method === "GET") {
    json(response, 200, { enabled: !!oauth.config, user: user ? { name: user.name } : null }); return true;
  }
  if (!oauth.config) { json(response, 503, { error: "LOGIN_UNAVAILABLE" }); return true; }
  if (url.pathname === "/api/auth/zhihu/start" && request.method === "GET") {
    if (request.headers["sec-fetch-site"] === "cross-site") { json(response, 403, { error: "FORBIDDEN" }); return true; }
    try {
      const start = oauth.start(cookie(request, stateCookie));
      response.setHeader("set-cookie", setCookie(stateCookie, start.browser, 300));
      response.writeHead(302, { location: start.url }); response.end();
    } catch { json(response, 503, { error: "LOGIN_UNAVAILABLE" }); }
    return true;
  }
  if (url.pathname === "/api/auth/zhihu/callback" && request.method === "GET") {
    try {
      const token = await oauth.finish(url.searchParams.get("state") ?? "", cookie(request, stateCookie) ?? "",
        url.searchParams.get("authorization_code") ?? url.searchParams.get("code") ?? "");
      oauth.logout(session);
      const identity = oauth.identify(token)!;
      response.setHeader("set-cookie", [setCookie(loginCookie, token, Math.max(1, Math.floor((identity.expiresAt - Date.now()) / 1_000))),
        setCookie(stateCookie, "", 0)]);
      response.writeHead(303, { location: "/" }); response.end();
    } catch {
      response.setHeader("set-cookie", setCookie(stateCookie, "", 0));
      response.writeHead(303, { location: "/?login=failed" }); response.end();
    }
    return true;
  }
  // All cookie-authenticated mutations, including queue heartbeats, require exact same origin.
  if (request.method !== "POST") { json(response, 405, { error: "METHOD_NOT_ALLOWED" }); return true; }
  if (request.headers.origin !== oauth.config.origin) { json(response, 403, { error: "FORBIDDEN" }); return true; }
  if (!user) { json(response, 401, { error: "LOGIN_REQUIRED" }); return true; }
  if (url.pathname === "/api/auth/logout") {
    await matches.update(user.id, "cancel", user.expiresAt);
    oauth.logout(session);
    response.setHeader("set-cookie", setCookie(loginCookie, "", 0));
    json(response, 200, { ok: true }); return true;
  }
  if (url.pathname === "/api/matchmaking") {
    const action = url.searchParams.get("action");
    if (action !== "join" && action !== "poll" && action !== "cancel") {
      json(response, 400, { error: "INVALID_INPUT" }); return true;
    }
    try { json(response, 200, await matches.update(user.id, action, user.expiresAt)); }
    catch { json(response, 503, { error: "MATCH_UNAVAILABLE" }); }
    return true;
  }
  json(response, 404, { error: "NOT_FOUND" }); return true;
}
