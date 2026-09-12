import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { TopicProvider } from "../application/ports.ts";
import type { Topic } from "../game/model.ts";

export const TOPIC_CACHE_VERSION = 1;
export type TopicVerificationStatus = "verified" | "pending" | "failed";
export type TopicVerificationRecord = { status: TopicVerificationStatus; checkedAt?: string; expiresAt?: number; source: string; cacheVersion: number; reason?: string; topic?: Topic };

function classify(error: unknown) {
  const message = error instanceof Error ? error.message : "UNKNOWN";
  if (/429|QUOTA|RATE/i.test(message)) return "QUOTA_EXHAUSTED";
  if (/ABORT|TIMEOUT/i.test(message)) return "TEMPORARY_TIMEOUT";
  if (/NOT_FOUND|MISMATCH|UNSAFE|INVALID/i.test(message)) return "CONTENT_OR_REFERENCE_INVALID";
  return "VERIFICATION_FAILED";
}

export class PersistentTopicCache implements TopicProvider {
  readonly candidateIds: readonly string[];
  private records = new Map<string, TopicVerificationRecord>();
  private inFlight = new Map<string, Promise<Topic>>();
  private loaded = false;
  private source: TopicProvider; private path: string; private ttlMs: number; private now: () => number;
  constructor(source: TopicProvider, path: string, ttlMs: number, now = Date.now) {
    this.source = source; this.path = path; this.ttlMs = ttlMs; this.now = now;
    if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) throw new Error("INVALID_TOPIC_CACHE_TTL");
    this.candidateIds = source.candidateIds;
  }
  private async load() { if (this.loaded) return; this.loaded = true; try { const data = JSON.parse(await readFile(this.path, "utf8")) as Record<string, TopicVerificationRecord>; for (const [id, record] of Object.entries(data)) this.records.set(id, record); } catch { /* first run */ } }
  private async save() { await mkdir(dirname(this.path), { recursive: true }); await writeFile(this.path, JSON.stringify(Object.fromEntries(this.records), null, 2), { mode: 0o600 }); }
  async resolve(candidateId: string, signal: AbortSignal): Promise<Topic> {
    await this.load(); if (signal.aborted) throw new Error("ABORTED");
    const cached = this.records.get(candidateId); if (cached?.status === "verified" && cached.topic && (cached.expiresAt ?? 0) > this.now()) return structuredClone(cached.topic);
    const running = this.inFlight.get(candidateId); if (running) return structuredClone(await running);
    const request = this.source.resolve(candidateId, signal).then(async topic => { this.records.set(candidateId, { status: "verified", checkedAt: new Date(this.now()).toISOString(), expiresAt: this.now() + this.ttlMs, source: "zhihu", cacheVersion: TOPIC_CACHE_VERSION, topic: structuredClone(topic) }); await this.save(); return topic; }).catch(async error => { this.records.set(candidateId, { status: "failed", checkedAt: new Date(this.now()).toISOString(), source: "zhihu", cacheVersion: TOPIC_CACHE_VERSION, reason: classify(error) }); await this.save(); throw error; }).finally(() => this.inFlight.delete(candidateId));
    this.inFlight.set(candidateId, request); return structuredClone(await request);
  }
  async statuses() { await this.load(); return this.candidateIds.map(packId => ({ packId, ...(this.records.get(packId) ?? { status: "pending", source: "zhihu", cacheVersion: TOPIC_CACHE_VERSION }) })); }
}
