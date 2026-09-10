import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { Viewer } from "../game/projection.ts";

export interface SessionRecord {
  id: string;
  roomId: string;
  viewer: Viewer;
  tokenHash: string;
  createdAt: number;
}

export interface SessionStore {
  create(record: SessionRecord): Promise<boolean>;
  find(id: string): Promise<SessionRecord | null>;
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
}

function digest(token: string): Buffer { return createHash("sha256").update(token).digest(); }
function encode(value: Buffer): string { return value.toString("base64url"); }

export class SessionService {
  private store: SessionStore;
  private key: Buffer;
  private now: () => number;
  private admissionTtlMs: number;

  constructor(store: SessionStore, key: Buffer | string, now: () => number = Date.now, admissionTtlMs = 120_000) {
    this.store = store;
    this.key = Buffer.isBuffer(key) ? Buffer.from(key) : Buffer.from(key, "utf8");
    this.now = now;
    if (this.key.length < 32) throw new Error("SESSION_KEY_TOO_SHORT");
    if (!Number.isSafeInteger(admissionTtlMs) || admissionTtlMs <= 0) throw new Error("INVALID_ADMISSION_TTL");
    this.admissionTtlMs = admissionTtlMs;
  }

  participantId(roomId: string, requestId: string): string {
    this.validateAdmission(roomId, requestId);
    return `p_${this.derive("participant", roomId, requestId).subarray(0, 16).toString("base64url")}`;
  }

  async issue(roomId: string, viewer: Viewer, requestId: string): Promise<{ token: string; session: SessionRecord }> {
    this.validateAdmission(roomId, requestId);
    const id = encode(this.derive("session-id", roomId, requestId).subarray(0, 16));
    const secret = encode(this.derive("session-secret", roomId, requestId));
    const record = { id, roomId, viewer: structuredClone(viewer), tokenHash: encode(digest(secret)), createdAt: this.now() };
    if (!await this.store.create(record)) {
      const existing = await this.store.find(id);
      if (!existing || existing.roomId !== roomId || existing.tokenHash !== record.tokenHash ||
        JSON.stringify(existing.viewer) !== JSON.stringify(record.viewer)) throw new Error("SESSION_COLLISION");
      if (this.now() - existing.createdAt > this.admissionTtlMs) throw new Error("ADMISSION_EXPIRED");
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
    return stored.length === supplied.length && timingSafeEqual(stored, supplied) ? record : null;
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
