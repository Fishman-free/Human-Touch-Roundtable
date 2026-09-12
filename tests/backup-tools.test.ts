import assert from "node:assert/strict";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

function run(script: string, args: string[], env: Record<string, string> = {}) {
  return new Promise<{ code: number | null; output: string }>((resolveRun) => {
    const child = spawn(process.execPath, [script, ...args], { cwd: resolve("."), env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] }); let output = "";
    child.stdout.on("data", chunk => { output += String(chunk); }); child.stderr.on("data", chunk => { output += String(chunk); });
    child.once("exit", code => resolveRun({ code, output }));
  });
}

test("备份校验拒绝损坏文件，恢复工具拒绝覆盖并可恢复独立副本", async () => {
  const directory = await mkdtemp(join("/tmp", "roundtable-backup-tools-"));
  try {
    const source = join(directory, "source.db"); const backup = join(directory, "backup.db"); const restored = join(directory, "restored.db");
    const created = await run("scripts/backup.ts", [backup], { DATABASE_PATH: source }); assert.equal(created.code, 0, created.output);
    const checked = await run("scripts/verify-backup.ts", [backup]); assert.equal(checked.code, 0, checked.output); assert.match(checked.output, /"integrity":"ok"/);
    const copied = JSON.parse(await readFile(`${backup}.json`, "utf8")); assert.equal(copied.sha256.length, 64); assert.equal(copied.databaseVersion, 2);
    const restoredResult = await run("scripts/restore-backup.ts", [backup, restored]); assert.equal(restoredResult.code, 0, restoredResult.output);
    const overwrite = await run("scripts/restore-backup.ts", [backup, restored]); assert.notEqual(overwrite.code, 0); assert.match(overwrite.output, /TARGET_EXISTS/);
    await copyFile(backup, source); await writeFile(source, Buffer.from("corrupt"));
    const invalid = await run("scripts/verify-backup.ts", [source]); assert.notEqual(invalid.code, 0); assert.match(invalid.output, /SQLITE|not a database|header/i);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
