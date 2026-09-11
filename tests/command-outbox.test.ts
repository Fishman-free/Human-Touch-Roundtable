import assert from "node:assert/strict";
import test from "node:test";
import { CommandOutbox, type CommandSubmission, type OutboxStorage, type OutboxTimer } from "../src/client/command-outbox.ts";
import type { SocketCommandAck } from "../src/contracts/public.ts";

class MemoryStorage implements OutboxStorage {
  value: string | null = null;
  get() { return this.value; }
  set(value: string) { this.value = value; }
  remove() { this.value = null; }
}
class FakeTimer implements OutboxTimer {
  sequence = 0;
  timers = new Map<number, () => void>();
  set(callback: () => void) { const id = ++this.sequence; this.timers.set(id, callback); return id; }
  clear(handle: unknown) { this.timers.delete(handle as number); }
  fire() { const first = [...this.timers][0]; assert.ok(first); this.timers.delete(first[0]); first[1](); }
}
const submission: CommandSubmission = { event: "game:answer", input: {
  commandId: "same-command", matchId: "match", phaseToken: 2, round: 1, text: "回答",
} };

test("Outbox超时使用完全相同载荷重发三次，之后保留待确认项", () => {
  const storage = new MemoryStorage(); const timer = new FakeTimer();
  const sent: CommandSubmission[] = []; let uncertain = 0;
  const outbox = new CommandOutbox({ storage, timer, timeoutMs: 1, maxAttempts: 3,
    onAck: () => assert.fail("unexpected ack"), onUncertain: () => uncertain++ });
  assert.equal(outbox.submit(submission, item => sent.push(item)), true);
  assert.equal(outbox.submit(submission, item => sent.push(item)), false);
  timer.fire(); timer.fire(); timer.fire();
  assert.equal(sent.length, 3);
  assert.deepEqual(sent[0], sent[2]);
  assert.equal(uncertain, 1);
  assert.equal(outbox.hasPending(), true);
  assert.ok(storage.value?.includes("same-command"));
});

test("任意一次迟到确定回执清除Outbox和定时器且只通知一次", () => {
  const storage = new MemoryStorage(); const timer = new FakeTimer(); const acks: SocketCommandAck[] = [];
  const callbacks: ((ack: SocketCommandAck) => void)[] = [];
  const outbox = new CommandOutbox({ storage, timer, timeoutMs: 1, maxAttempts: 3,
    onAck: ack => acks.push(ack), onUncertain: () => assert.fail("unexpected timeout") });
  outbox.submit(submission, (_item, ack) => callbacks.push(ack));
  timer.fire();
  callbacks[0]({ commandId: "same-command", revision: 3, ok: true });
  callbacks[1]({ commandId: "same-command", revision: 3, ok: true });
  assert.equal(acks.length, 1);
  assert.equal(outbox.hasPending(), false);
  assert.equal(storage.value, null);
  assert.equal(timer.timers.size, 0);
});

test("刷新恢复持久化命令，断线暂停，恢复后沿用原commandId", () => {
  const storage = new MemoryStorage(); storage.value = JSON.stringify(submission);
  const timer = new FakeTimer(); const sent: CommandSubmission[] = [];
  const outbox = new CommandOutbox({ storage, timer, onAck: () => {}, onUncertain: () => {} });
  assert.deepEqual(outbox.current(), submission);
  outbox.resume(item => sent.push(item));
  outbox.pause();
  assert.equal(timer.timers.size, 0);
  outbox.resume(item => sent.push(item));
  assert.equal(sent.length, 2);
  assert.ok(sent.every(item => item.input.commandId === "same-command"));
});

test("损坏或非命令事件的持久化内容会被清除", () => {
  for (const value of ["not-json", JSON.stringify({ event: "room:create", input: { commandId: "x", matchId: "m", phaseToken: 1 } })]) {
    const storage = new MemoryStorage(); storage.value = value;
    const outbox = new CommandOutbox({ storage, onAck: () => {}, onUncertain: () => {} });
    assert.equal(outbox.hasPending(), false);
    assert.equal(storage.value, null);
  }
});
