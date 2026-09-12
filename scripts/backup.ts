import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { statSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { SqlitePersistence } from "../src/repository/sqlite-persistence.ts";

const source = resolve(process.env.DATABASE_PATH ?? "./data/roundtable.db");
const timestamp = new Date().toISOString().replaceAll(":", "-");
const destination = resolve(process.argv[2] ?? `./backups/roundtable-${timestamp}.db`);
await mkdir(dirname(destination), { recursive: true });
const persistence = new SqlitePersistence(source);
try { await persistence.backup(destination); }
finally { persistence.close(); }
const digest = createHash("sha256").update(readFileSync(destination)).digest("hex");
const bytes = statSync(destination).size;
const metadata = { createdAt: new Date().toISOString(), databasePath: source, databaseVersion: 2, bytes, sha256: digest };
await writeFile(`${destination}.json`, `${JSON.stringify(metadata, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`${destination}\n${destination}.json\n`);
