import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import type { AiProvider, Clock, RandomSource, TopicProvider } from "../src/application/ports.ts";
import { SqlitePersistence } from "../src/repository/sqlite-persistence.ts";
import { RoomRegistry } from "../src/server/room-registry.ts";

const clock: Clock = { now: () => 900_000, setTimeout: () => ({}), clearTimeout: () => {} };
const random: RandomSource = { integer: max => max - 1 };
const topics: TopicProvider = { candidateIds: [], resolve: async () => { throw new Error("NOT_USED"); } };
const ai: AiProvider = { act: (_request, signal) => new Promise((_, reject) =>
  signal.addEventListener("abort", () => reject(new Error("ABORTED")), { once: true })) };

test("进程被SIGKILL后从WAL恢复，补过全部截止并可从备份再次恢复", { timeout: 30_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "roundtable-crash-"));
  const path = join(directory, "crashed.db");
  const backup = join(directory, "backup.db");
  try {
    const child = spawn(process.execPath, [resolve("tests/fixtures/crash-writer.ts"), path], {
      cwd: resolve("."), stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = ""; child.stderr.on("data", chunk => { stderr += String(chunk).slice(0, 4096); });
    const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(resolveExit =>
      child.once("exit", (code, signal) => resolveExit({ code, signal })));
    assert.equal(exit.signal, "SIGKILL", stderr);

    const persistence = new SqlitePersistence(path);
    assert.equal(persistence.integrityCheck(), true);
    const before = await persistence.load("crash-room");
    assert.equal(before?.state.phase, "answering");
    assert.equal(before?.state.answers[1][0].text, "已持久化回答");

    const registry = new RoomRegistry({ clock, random, store: persistence, topics, ai }, {},
      { revealedRetentionMs: 1_000_000, cleanupIntervalMs: 1_000_000 });
    await registry.initialize();
    const runtime = await registry.get("crash-room");
    assert.ok(runtime);
    const view = runtime.view({ kind: "participant", participantId: "p0" });
    assert.equal(view.phase, "revealed");
    assert.equal(view.result?.winner, "shadow");
    assert.equal(view.answers[1].length, 3);
    assert.equal(view.votes.length, 3);
    await registry.close();
    await persistence.backup(backup);
    persistence.close();

    const restored = new SqlitePersistence(backup);
    assert.equal(restored.integrityCheck(), true);
    assert.equal((await restored.load("crash-room"))?.state.phase, "revealed");
    restored.close();
  } finally { await rm(directory, { recursive: true, force: true }); }
});
