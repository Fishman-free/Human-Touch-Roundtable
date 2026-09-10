import { DatabaseSync } from "node:sqlite";
import type { RoomRecord, RoomStore, RoomSummary } from "../application/ports.ts";
import type { Viewer } from "../game/projection.ts";
import type { SessionRecord, SessionStore } from "../server/session.ts";
import { validateRoomRecord } from "./validate-room-record.ts";

type Row = Record<string, unknown>;

function object(value: unknown): value is Row {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function roomRecord(json: unknown, columnVersion: number): RoomRecord {
  if (typeof json !== "string") throw new Error("CORRUPT_ROOM_RECORD");
  let value: unknown;
  try { value = JSON.parse(json); } catch { throw new Error("CORRUPT_ROOM_RECORD"); }
  return validateRoomRecord(value, columnVersion);
}

function viewer(json: unknown): Viewer {
  if (typeof json !== "string") throw new Error("CORRUPT_SESSION_RECORD");
  let value: unknown;
  try { value = JSON.parse(json); } catch { throw new Error("CORRUPT_SESSION_RECORD"); }
  if (!object(value) || (value.kind !== "spectator" &&
    !(value.kind === "participant" && typeof value.participantId === "string" && value.participantId.length > 0))) {
    throw new Error("CORRUPT_SESSION_RECORD");
  }
  return value as Viewer;
}

function integer(value: unknown, error: string): number {
  const number = typeof value === "bigint" ? Number(value) : value;
  if (!Number.isSafeInteger(number) || (number as number) < 0) throw new Error(error);
  return number as number;
}

export class SqlitePersistence implements RoomStore, SessionStore {
  private db: DatabaseSync;

  constructor(path: string) {
    if (!path) throw new Error("INVALID_DATABASE_PATH");
    this.db = new DatabaseSync(path, { allowExtension: false });
    this.db.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = FULL;");
    if (path !== ":memory:") this.db.exec("PRAGMA journal_mode = WAL;");
    const versionRow = this.db.prepare("PRAGMA user_version").get() as Row;
    const version = integer(versionRow.user_version, "INVALID_SCHEMA_VERSION");
    if (version === 0) this.migrateFromZero();
    else if (version === 1) this.migrateFromOne();
    else if (version !== 2) { this.db.close(); throw new Error("UNSUPPORTED_SCHEMA_VERSION"); }
  }

  async load(roomId: string): Promise<RoomRecord | null> {
    const row = this.db.prepare("SELECT version, record_json FROM rooms WHERE room_id = ?").get(roomId) as Row | undefined;
    if (!row) return null;
    const version = integer(row.version, "CORRUPT_ROOM_RECORD");
    return structuredClone(roomRecord(row.record_json, version));
  }

  async save(roomId: string, expectedVersion: number | null, record: RoomRecord): Promise<boolean> {
    if (!roomId || !Number.isSafeInteger(record.version) || record.version < 0) throw new Error("INVALID_ROOM_RECORD");
    const expectedRecordVersion = expectedVersion === null ? 0 : expectedVersion + 1;
    if (record.version !== expectedRecordVersion) throw new Error("INVALID_ROOM_RECORD_VERSION");
    const json = JSON.stringify(record);
    const result = expectedVersion === null
      ? this.db.prepare("INSERT OR IGNORE INTO rooms(room_id, version, record_json, updated_at) VALUES (?, ?, ?, ?)")
        .run(roomId, record.version, json, Date.now())
      : this.db.prepare("UPDATE rooms SET version = ?, record_json = ?, updated_at = ? WHERE room_id = ? AND version = ?")
        .run(record.version, json, Date.now(), roomId, expectedVersion);
    return result.changes === 1 || result.changes === 1n;
  }

  async list(): Promise<RoomSummary[]> {
    const rows = this.db.prepare("SELECT room_id, version, record_json, updated_at FROM rooms ORDER BY room_id").all() as Row[];
    return rows.map(row => {
      if (typeof row.room_id !== "string") throw new Error("CORRUPT_ROOM_RECORD");
      const version = integer(row.version, "CORRUPT_ROOM_RECORD");
      const record = roomRecord(row.record_json, version);
      return { roomId: row.room_id, matchId: record.state.matchId, phase: record.state.phase,
        version, updatedAt: integer(row.updated_at, "CORRUPT_ROOM_RECORD") };
    });
  }

  async delete(roomId: string, expectedVersion: number): Promise<boolean> {
    const result = this.db.prepare("DELETE FROM rooms WHERE room_id = ? AND version = ?").run(roomId, expectedVersion);
    return result.changes === 1 || result.changes === 1n;
  }

  async create(record: SessionRecord): Promise<boolean> {
    if (!record.id || !record.roomId || !record.tokenHash || !Number.isSafeInteger(record.createdAt) || record.createdAt < 0 ||
      !Number.isSafeInteger(record.expiresAt) || record.expiresAt <= record.createdAt ||
      !Number.isSafeInteger(record.lastSeenAt) || record.lastSeenAt < record.createdAt ||
      (record.revokedAt !== null && (!Number.isSafeInteger(record.revokedAt) || record.revokedAt < record.createdAt))) {
      throw new Error("INVALID_SESSION_RECORD");
    }
    const result = this.db.prepare(`
      INSERT OR IGNORE INTO sessions(id, room_id, viewer_json, token_hash, created_at, expires_at, last_seen_at, revoked_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(record.id, record.roomId, JSON.stringify(record.viewer), record.tokenHash, record.createdAt,
      record.expiresAt, record.lastSeenAt, record.revokedAt);
    return result.changes === 1 || result.changes === 1n;
  }

  async find(id: string): Promise<SessionRecord | null> {
    const row = this.db.prepare(`
      SELECT id, room_id, viewer_json, token_hash, created_at, expires_at, last_seen_at, revoked_at FROM sessions WHERE id = ?
    `).get(id) as Row | undefined;
    if (!row) return null;
    if (typeof row.id !== "string" || typeof row.room_id !== "string" || typeof row.token_hash !== "string") {
      throw new Error("CORRUPT_SESSION_RECORD");
    }
    return {
      id: row.id,
      roomId: row.room_id,
      viewer: viewer(row.viewer_json),
      tokenHash: row.token_hash,
      createdAt: integer(row.created_at, "CORRUPT_SESSION_RECORD"),
      expiresAt: integer(row.expires_at, "CORRUPT_SESSION_RECORD"),
      lastSeenAt: integer(row.last_seen_at, "CORRUPT_SESSION_RECORD"),
      revokedAt: row.revoked_at === null ? null : integer(row.revoked_at, "CORRUPT_SESSION_RECORD"),
    };
  }

  async touch(id: string, seenAt: number): Promise<boolean> {
    const result = this.db.prepare(`
      UPDATE sessions SET last_seen_at = ?
      WHERE id = ? AND revoked_at IS NULL AND expires_at > ? AND last_seen_at < ?
    `).run(seenAt, id, seenAt, seenAt);
    return result.changes === 1 || result.changes === 1n;
  }

  async revoke(id: string, revokedAt: number): Promise<boolean> {
    const result = this.db.prepare(`
      UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL
    `).run(revokedAt, id);
    return result.changes === 1 || result.changes === 1n;
  }

  async deleteExpired(now: number): Promise<number> {
    const result = this.db.prepare("DELETE FROM sessions WHERE expires_at <= ? OR revoked_at IS NOT NULL").run(now);
    return Number(result.changes);
  }

  close() { this.db.close(); }

  private migrateFromZero() {
    this.db.exec(`
      BEGIN IMMEDIATE;
      CREATE TABLE rooms (
        room_id TEXT PRIMARY KEY NOT NULL,
        version INTEGER NOT NULL CHECK(version >= 0),
        record_json TEXT NOT NULL CHECK(json_valid(record_json)),
        updated_at INTEGER NOT NULL
      ) STRICT;
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY NOT NULL,
        room_id TEXT NOT NULL REFERENCES rooms(room_id) ON DELETE CASCADE,
        viewer_json TEXT NOT NULL CHECK(json_valid(viewer_json)),
        token_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL CHECK(expires_at > created_at),
        last_seen_at INTEGER NOT NULL CHECK(last_seen_at >= created_at),
        revoked_at INTEGER CHECK(revoked_at IS NULL OR revoked_at >= created_at)
      ) STRICT;
      CREATE INDEX sessions_room_id ON sessions(room_id);
      CREATE INDEX sessions_expiry ON sessions(expires_at);
      PRAGMA user_version = 2;
      COMMIT;
    `);
  }

  private migrateFromOne() {
    this.db.exec(`
      BEGIN IMMEDIATE;
      ALTER TABLE sessions ADD COLUMN expires_at INTEGER NOT NULL DEFAULT 4102444800000;
      ALTER TABLE sessions ADD COLUMN last_seen_at INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE sessions ADD COLUMN revoked_at INTEGER;
      UPDATE sessions SET last_seen_at = created_at;
      CREATE INDEX sessions_expiry ON sessions(expires_at);
      PRAGMA user_version = 2;
      COMMIT;
    `);
  }
}
