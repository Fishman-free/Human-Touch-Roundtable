import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { handleAdminRequest, type AdminOperations } from "../src/server/admin.ts";

async function harness(token: string | undefined) {
  const calls: string[] = [];
  const operations: AdminOperations = {
    async listRooms() { calls.push("list"); return [{ roomId: "demo", matchId: "private-match", phase: "answering",
      version: 3, updatedAt: 100 }]; },
    async deleteRoom(id) { calls.push(`delete:${id}`); return id === "demo"; },
    async revokeSession(id) { calls.push(`revoke:${id}`); return id === "abcdefghij"; },
    async cleanup() { calls.push("cleanup"); return { sessionsDeleted: 2 }; },
  };
  const server = createServer((request, response) => {
    void handleAdminRequest(request, response, token, operations).then(handled => {
      if (!handled) { response.writeHead(404); response.end(); }
    });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert(address && typeof address === "object");
  return { origin: `http://127.0.0.1:${address.port}`, calls,
    close: () => new Promise<void>(resolve => server.close(() => resolve())) };
}

test("管理员路由未配置时隐藏，错误Token拒绝且不调用操作", async () => {
  for (const token of [undefined, "admin-token-at-least-32-bytes-long"]) {
    const app = await harness(token);
    try {
      const response = await fetch(`${app.origin}/api/admin/rooms`, token ? { headers: { authorization: "Bearer wrong" } } : {});
      assert.equal(response.status, token ? 401 : 404);
      assert.deepEqual(app.calls, []);
    } finally { await app.close(); }
  }
});

test("管理员只读房间摘要不泄露matchId、答案、身份或会话", async () => {
  const token = "admin-token-at-least-32-bytes-long";
  const app = await harness(token);
  try {
    const response = await fetch(`${app.origin}/api/admin/rooms`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(response.status, 200);
    const text = await response.text();
    assert.deepEqual(JSON.parse(text), { rooms: [{ roomId: "demo", phase: "answering", version: 3, updatedAt: 100 }] });
    for (const forbidden of ["private-match", "answers", "roles", "session", "tokenHash"]) assert.ok(!text.includes(forbidden));
  } finally { await app.close(); }
});

test("管理员可删除房间、撤销会话和触发清理", async () => {
  const token = "admin-token-at-least-32-bytes-long";
  const app = await harness(token);
  const options = { method: "POST", headers: { authorization: `Bearer ${token}` } };
  try {
    assert.equal((await fetch(`${app.origin}/api/admin/rooms/demo`, { ...options, method: "DELETE" })).status, 200);
    assert.equal((await fetch(`${app.origin}/api/admin/sessions/abcdefghij/revoke`, options)).status, 200);
    const cleanup = await fetch(`${app.origin}/api/admin/cleanup`, options);
    assert.deepEqual(await cleanup.json(), { ok: true, sessionsDeleted: 2 });
    assert.deepEqual(app.calls, ["delete:demo", "revoke:abcdefghij", "cleanup"]);
  } finally { await app.close(); }
});
