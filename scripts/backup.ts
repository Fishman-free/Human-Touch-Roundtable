import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { SqlitePersistence } from "../src/repository/sqlite-persistence.ts";

const source = resolve(process.env.DATABASE_PATH ?? "./data/roundtable.db");
const timestamp = new Date().toISOString().replaceAll(":", "-");
const destination = resolve(process.argv[2] ?? `./backups/roundtable-${timestamp}.db`);
await mkdir(dirname(destination), { recursive: true });
const persistence = new SqlitePersistence(source);
try { await persistence.backup(destination); }
finally { persistence.close(); }
process.stdout.write(`${destination}\n`);
