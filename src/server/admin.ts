import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { RoomSummary } from "../application/ports.ts";
import { createHash } from "node:crypto";
import { FixedWindowRateLimiter } from "./rate-limit.ts";

export interface AdminOperations {
  listRooms(): Promise<RoomSummary[]>;
  deleteRoom(roomId: string, expectedVersion?: number): Promise<boolean>;
  revokeSession(sessionId: string): Promise<boolean>;
  cleanup(): Promise<{ sessionsDeleted: number }>;
}
export interface AdminAuditEvent { operation: string; roomId?: string; adminFingerprint: string; at: string; success: boolean; durationMs: number; }
const limiter = new FixedWindowRateLimiter();
const fingerprint = (token: string) => createHash("sha256").update(token).digest("hex").slice(0, 16);

function authorized(header: string | undefined, expected: string): boolean {
  if (!header?.startsWith("Bearer ")) return false;
  const actual = Buffer.from(header.slice(7)); const token = Buffer.from(expected);
  return actual.length === token.length && timingSafeEqual(actual, token);
}
function json(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
}

export async function handleAdminRequest(request: IncomingMessage, response: ServerResponse,
  token: string | undefined, operations: AdminOperations, audit?: (event: AdminAuditEvent) => void): Promise<boolean> {
  const path = request.url?.split("?", 1)[0] ?? "";
  if (!path.startsWith("/api/admin/")) return false;
  if (!token) { json(response, 404, { error: "NOT_FOUND" }); return true; }
  const authorization = Array.isArray(request.headers.authorization) ? request.headers.authorization[0] : request.headers.authorization;
  if (!authorized(authorization, token)) { json(response, 401, { error: "UNAUTHORIZED" }); return true; }
  const adminFingerprint = fingerprint(token);
  if (!limiter.allow("admin", adminFingerprint, { limit: 30, windowMs: 60_000 })) { json(response, 429, { error: "RATE_LIMITED" }); return true; }
  const started = Date.now();
  const record = (operation: string, success: boolean, roomId?: string) => audit?.({ operation, roomId, adminFingerprint, at: new Date().toISOString(), success, durationMs: Date.now() - started });

  if (request.method === "GET" && path === "/api/admin/rooms") {
    const rooms = (await operations.listRooms()).map(({ roomId, phase, version, updatedAt }) =>
      ({ roomId, phase, version, updatedAt }));
    json(response, 200, { rooms }); record("list_rooms", true); return true;
  }
  if (request.method === "POST" && path === "/api/admin/cleanup") {
    json(response, 200, { ok: true, ...await operations.cleanup() }); record("cleanup", true); return true;
  }
  const room = /^\/api\/admin\/rooms\/([a-z0-9-]{1,24})$/.exec(path);
  if (request.method === "DELETE" && room) {
    const reason = request.headers["x-admin-reason"];
    const expectedVersion = Number(new URL(request.url ?? "", "http://localhost").searchParams.get("expectedVersion"));
    if (typeof reason !== "string" || !reason.trim() || !Number.isSafeInteger(expectedVersion)) { json(response, 400, { error: "REASON_AND_EXPECTED_VERSION_REQUIRED" }); record("delete_room", false, room[1]); return true; }
    const deleted = await operations.deleteRoom(room[1], expectedVersion);
    json(response, deleted ? 200 : 409, deleted ? { deleted: true } : { error: "VERSION_CONFLICT" }); record("delete_room", deleted, room[1]); return true;
  }
  const session = /^\/api\/admin\/sessions\/([A-Za-z0-9_-]{10,64})\/revoke$/.exec(path);
  if (request.method === "POST" && session) {
    const reason = request.headers["x-admin-reason"];
    if (typeof reason !== "string" || !reason.trim()) { json(response, 400, { error: "REASON_REQUIRED" }); record("revoke_session", false); return true; }
    const revoked = await operations.revokeSession(session[1]);
    json(response, revoked ? 200 : 404, revoked ? { revoked: true } : { error: "NOT_FOUND" }); record("revoke_session", revoked); return true;
  }
  json(response, 404, { error: "NOT_FOUND" }); return true;
}
