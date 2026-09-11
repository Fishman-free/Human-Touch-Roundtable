import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { RoomSummary } from "../application/ports.ts";

export interface AdminOperations {
  listRooms(): Promise<RoomSummary[]>;
  deleteRoom(roomId: string): Promise<boolean>;
  revokeSession(sessionId: string): Promise<boolean>;
  cleanup(): Promise<{ sessionsDeleted: number }>;
}

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
  token: string | undefined, operations: AdminOperations): Promise<boolean> {
  const path = request.url?.split("?", 1)[0] ?? "";
  if (!path.startsWith("/api/admin/")) return false;
  if (!token) { json(response, 404, { error: "NOT_FOUND" }); return true; }
  const authorization = Array.isArray(request.headers.authorization) ? request.headers.authorization[0] : request.headers.authorization;
  if (!authorized(authorization, token)) { json(response, 401, { error: "UNAUTHORIZED" }); return true; }

  if (request.method === "GET" && path === "/api/admin/rooms") {
    const rooms = (await operations.listRooms()).map(({ roomId, phase, version, updatedAt }) =>
      ({ roomId, phase, version, updatedAt }));
    json(response, 200, { rooms }); return true;
  }
  if (request.method === "POST" && path === "/api/admin/cleanup") {
    json(response, 200, { ok: true, ...await operations.cleanup() }); return true;
  }
  const room = /^\/api\/admin\/rooms\/([a-z0-9-]{1,24})$/.exec(path);
  if (request.method === "DELETE" && room) {
    const deleted = await operations.deleteRoom(room[1]);
    json(response, deleted ? 200 : 404, deleted ? { deleted: true } : { error: "NOT_FOUND" }); return true;
  }
  const session = /^\/api\/admin\/sessions\/([A-Za-z0-9_-]{10,64})\/revoke$/.exec(path);
  if (request.method === "POST" && session) {
    const revoked = await operations.revokeSession(session[1]);
    json(response, revoked ? 200 : 404, revoked ? { revoked: true } : { error: "NOT_FOUND" }); return true;
  }
  json(response, 404, { error: "NOT_FOUND" }); return true;
}
