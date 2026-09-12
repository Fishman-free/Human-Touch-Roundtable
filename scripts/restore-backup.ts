import { copyFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const source = resolve(process.argv[2] ?? "");
const target = resolve(process.argv[3] ?? "");
if (!source || !target) throw new Error("USAGE: npm run restore:backup -- backup.db target.db");
if (existsSync(target)) throw new Error(`TARGET_EXISTS:${target}`);
const check = spawnSync(process.execPath, ["scripts/verify-backup.ts", source], { stdio: "inherit" });
if (check.status !== 0) throw new Error("BACKUP_VERIFICATION_FAILED");
await mkdir(dirname(target), { recursive: true });
await copyFile(source, target);
process.stdout.write(`Restored verified backup to ${target}\n`);
