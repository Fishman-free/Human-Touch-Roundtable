import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";

const path = resolve(process.argv[2] ?? "");
if (!path) throw new Error("BACKUP_PATH_REQUIRED");
const bytes = statSync(path).size;
const digest = createHash("sha256").update(readFileSync(path)).digest("hex");
const db = new DatabaseSync(path, { readOnly: true });
try {
  const integrity = (db.prepare("PRAGMA integrity_check").get() as { integrity_check: string })["integrity_check"];
  const version = (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
  if (integrity !== "ok") throw new Error(`SQLITE_INTEGRITY_FAILED:${integrity}`);
  process.stdout.write(JSON.stringify({ path, bytes, sha256: digest, databaseVersion: version, integrity }) + "\n");
} finally { db.close(); }
