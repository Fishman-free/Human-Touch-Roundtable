import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { dirname } from "node:path";
import type { TopicProvider } from "../application/ports.ts";
import type { Topic } from "../game/model.ts";

export const TOPIC_CACHE_VERSION = 1;
export type TopicVerificationStatus = "verified" | "pending" | "failed";
export type TopicVerificationRecord = { status: TopicVerificationStatus; checkedAt?: string; expiresAt?: number; source: string; cacheVersion: number; reason?: string; topic?: Topic };

function classify(error: unknown) {
  const message = error instanceof Error ? error.message : "UNKNOWN";
  // 30001 is the platform's single code for rate limiting, concurrency limits
  // and daily quota exhaustion. Without it here, an exhausted quota classified as
  // a generic verification failure and the alert below never fired.
  if (/429|QUOTA|RATE|30001/i.test(message)) return "QUOTA_EXHAUSTED";
  if (/ABORT|TIMEOUT/i.test(message)) return "TEMPORARY_TIMEOUT";
  if (/NOT_FOUND|MISMATCH|UNSAFE|INVALID/i.test(message)) return "CONTENT_OR_REFERENCE_INVALID";
  return "VERIFICATION_FAILED";
}

export interface TopicCacheAlert { candidateId: string; reason: string; at: string }
export class PersistentTopicCache implements TopicProvider {
  private records = new Map<string, TopicVerificationRecord>();
  private inFlight = new Map<string, Promise<Topic>>();
  private loaded = false;
  private source: TopicProvider; private path: string; private ttlMs: number; private now: () => number;
  private alert?: (event: TopicCacheAlert) => void;
  constructor(source: TopicProvider, path: string, ttlMs: number, now = Date.now, alert?: (event: TopicCacheAlert) => void) {
    this.source = source; this.path = path; this.ttlMs = ttlMs; this.now = now;
    if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) throw new Error("INVALID_TOPIC_CACHE_TTL");
    this.alert = alert;
  }
  // Read through rather than snapshotted: the refresh loop appends candidates to
  // the wrapped provider while rooms are being served.
  get candidateIds(): readonly string[] { return this.source.candidateIds; }
  private async load() { if (this.loaded) return; this.loaded = true; try { const data = JSON.parse(await readFile(this.path, "utf8")) as Record<string, TopicVerificationRecord>; for (const [id, record] of Object.entries(data)) this.records.set(id, record); } catch { /* first run */ } }
  private async save() { await mkdir(dirname(this.path), { recursive: true }); await writeFile(this.path, JSON.stringify(Object.fromEntries(this.records), null, 2), { mode: 0o600 }); }
  private async lock() { const lock = `${this.path}.lock`; for (let attempt = 0; attempt < 30; attempt++) { try { await mkdir(lock); return async () => { await rm(lock, { recursive: true, force: true }); }; } catch { await new Promise(resolve => setTimeout(resolve, 100)); } } throw new Error("TOPIC_CACHE_LOCK_TIMEOUT"); }
  async resolve(candidateId: string, signal: AbortSignal): Promise<Topic> {
    await this.load(); if (signal.aborted) throw new Error("ABORTED");
    const cached = this.records.get(candidateId); if (cached?.status === "verified" && cached.topic && (cached.expiresAt ?? 0) > this.now()) return structuredClone(cached.topic);
    const running = this.inFlight.get(candidateId); if (running) return structuredClone(await running);
    const request = (async () => { const unlock = await this.lock(); try { const topic = await this.source.resolve(candidateId, signal); this.records.set(candidateId, { status: "verified", checkedAt: new Date(this.now()).toISOString(), expiresAt: this.now() + this.ttlMs, source: "zhihu", cacheVersion: TOPIC_CACHE_VERSION, topic: structuredClone(topic) }); await this.save(); return topic; } catch (error) { const reason = classify(error); this.records.set(candidateId, { status: "failed", checkedAt: new Date(this.now()).toISOString(), source: "zhihu", cacheVersion: TOPIC_CACHE_VERSION, reason }); await this.save(); if (reason === "QUOTA_EXHAUSTED") this.alert?.({ candidateId, reason, at: new Date(this.now()).toISOString() }); throw error; } finally { await unlock(); } })().finally(() => this.inFlight.delete(candidateId));
    this.inFlight.set(candidateId, request); return structuredClone(await request);
  }
  async statuses() { await this.load(); return this.candidateIds.map(packId => ({ packId, ...(this.records.get(packId) ?? { status: "pending", source: "zhihu", cacheVersion: TOPIC_CACHE_VERSION }) })); }
}
