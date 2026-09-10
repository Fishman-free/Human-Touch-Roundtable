import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { Viewer } from "../game/projection.ts";

export interface SessionRecord {
  id: string;
  roomId: string;
  viewer: Viewer;
  tokenHash: string;
  createdAt: number;
  expiresAt: number;
  lastSeenAt: number;
  revokedAt: number | null;
}

export interface SessionStore {
  create(record: SessionRecord): Promise<boolean>;
  find(id: string): Promise<SessionRecord | null>;
  touch(id: string, seenAt: number): Promise<boolean>;
  revoke(id: string, revokedAt: number): Promise<boolean>;
  deleteExpired(now: number): Promise<number>;
}

export class MemorySessionStore implements SessionStore {
  private records = new Map<string, SessionRecord>();
  async create(record: SessionRecord): Promise<boolean> {
    if (this.records.has(record.id)) return false;
    this.records.set(record.id, structuredClone(record));
    return true;
  }
  async find(id: string): Promise<SessionRecord | null> {
    const record = this.records.get(id);
    return record ? structuredClone(record) : null;
  }
  async touch(id: string, seenAt: number): Promise<boolean> {
    const record = this.records.get(id);
    if (!record || record.revokedAt !== null || record.expiresAt <= seenAt) return false;
    record.lastSeenAt = Math.max(record.lastSeenAt, seenAt);
    return true;
  }
  async revoke(id: string, revokedAt: number): Promise<boolean> {
    const record = this.records.get(id);
    if (!record || record.revokedAt !== null) return false;
    record.revokedAt = revokedAt;
    return true;
  }
  async deleteExpired(now: number): Promise<number> {
    let deleted = 0;
    for (const [id, record] of this.records) {
      if (record.expiresAt <= now || record.revokedAt !== null) {
        this.records.delete(id);
        deleted++;
      }
    }
    return deleted;
  }
}

function digest(token: string): Buffer { return createHash("sha256").update(token).digest(); }
function encode(value: Buffer): string { return value.toString("base64url"); }

export class SessionService {
  private store: SessionStore;
  private key: Buffer;
  private now: () => number;
  private admissionTtlMs: number;
  private sessionTtlMs: number;
  private touchIntervalMs: number;

  constructor(store: SessionStore, key: Buffer | string, now: () => number = Date.now,
    admissionTtlMs = 120_000, sessionTtlMs = 48 * 60 * 60 * 1_000, touchIntervalMs = 60_000) {
    this.store = store;
    this.key = Buffer.isBuffer(key) ? Buffer.from(key) : Buffer.from(key, "utf8");
    this.now = now;
    if (this.key.length < 32) throw new Error("SESSION_KEY_TOO_SHORT");
    if ([admissionTtlMs, sessionTtlMs, touchIntervalMs].some(value => !Number.isSafeInteger(value) || value <= 0) ||
      admissionTtlMs >= sessionTtlMs) throw new Error("INVALID_SESSION_TTL");
    this.admissionTtlMs = admissionTtlMs;
    this.sessionTtlMs = sessionTtlMs;
    this.touchIntervalMs = touchIntervalMs;
  }

  participantId(roomId: string, requestId: string): string {
    this.validateAdmission(roomId, requestId);
    return `p_${this.derive("participant", roomId, requestId).subarray(0, 16).toString("base64url")}`;
  }

  async issue(roomId: string, viewer: Viewer, requestId: string): Promise<{ token: string; session: SessionRecord }> {
    this.validateAdmission(roomId, requestId);
    const id = encode(this.derive("session-id", roomId, requestId).subarray(0, 16));
    const secret = encode(this.derive("session-secret", roomId, requestId));
    const now = this.now();
    const record = { id, roomId, viewer: structuredClone(viewer), tokenHash: encode(digest(secret)),
      createdAt: now, expiresAt: now + this.sessionTtlMs, lastSeenAt: now, revokedAt: null };
    if (!await this.store.create(record)) {
      const existing = await this.store.find(id);
      if (!existing || existing.roomId !== roomId || existing.tokenHash !== record.tokenHash ||
        JSON.stringify(existing.viewer) !== JSON.stringify(record.viewer)) throw new Error("SESSION_COLLISION");
      if (existing.revokedAt !== null || existing.expiresAt <= now || now - existing.createdAt > this.admissionTtlMs) {
        throw new Error("ADMISSION_EXPIRED");
      }
      return { token: `${id}.${secret}`, session: existing };
    }
    return { token: `${id}.${secret}`, session: record };
  }

  async verify(roomId: string, token: string): Promise<SessionRecord | null> {
    if (typeof token !== "string" || token.length > 256) return null;
    const [id, secret, extra] = token.split(".");
    if (!id || !secret || extra) return null;
    const record = await this.store.find(id);
    if (!record || record.roomId !== roomId) return null;
    let stored: Buffer;
    try { stored = Buffer.from(record.tokenHash, "base64url"); } catch { return null; }
    const supplied = digest(secret);
    if (stored.length !== supplied.length || !timingSafeEqual(stored, supplied)) return null;
    return this.activate(record);
  }

  async authorize(id: string): Promise<SessionRecord | null> {
    const record = await this.store.find(id);
    return record ? this.activate(record) : null;
  }

  async revoke(id: string): Promise<boolean> { return this.store.revoke(id, this.now()); }
  async cleanupExpired(): Promise<number> { return this.store.deleteExpired(this.now()); }

  private async activate(record: SessionRecord): Promise<SessionRecord | null> {
    const now = this.now();
    if (record.revokedAt !== null || record.expiresAt <= now) return null;
    if (now - record.lastSeenAt < this.touchIntervalMs) return record;
    if (!await this.store.touch(record.id, now)) return null;
    return { ...record, lastSeenAt: now };
  }

  private derive(purpose: string, roomId: string, requestId: string): Buffer {
    return createHmac("sha256", this.key).update(`${purpose}\0${roomId}\0${requestId}`).digest();
  }

  private validateAdmission(roomId: string, requestId: string) {
    if (!/^[a-z0-9-]{1,24}$/.test(roomId) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
      throw new Error("INVALID_ADMISSION");
    }
  }
}
