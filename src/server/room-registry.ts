import { randomUUID } from "node:crypto";
import { RoomRuntime } from "../application/room-runtime.ts";
import type { RuntimeDependencies, RuntimeOptions } from "../application/ports.ts";

export interface RoomLifecycleOptions {
  revealedRetentionMs: number;
  cleanupIntervalMs: number;
}

const lifecycleDefaults: RoomLifecycleOptions = {
  revealedRetentionMs: 24 * 60 * 60 * 1_000,
  cleanupIntervalMs: 60 * 1_000,
};

export class RoomRegistry {
  private runtimes = new Map<string, Promise<RoomRuntime>>();
  private deps: RuntimeDependencies;
  private options: Partial<RuntimeOptions>;
  private lifecycle: RoomLifecycleOptions;
  private initialized = false;
  private closing = false;
  private cleanupHandle?: unknown;
  private cleanupJob: Promise<void> = Promise.resolve();
  private closePromise?: Promise<void>;
  private deleting = new Set<string>();

  constructor(deps: RuntimeDependencies, options: Partial<RuntimeOptions> = {}, lifecycle: Partial<RoomLifecycleOptions> = {}) {
    this.deps = deps;
    this.options = options;
    this.lifecycle = { ...lifecycleDefaults, ...lifecycle };
    if (Object.values(this.lifecycle).some(value => !Number.isSafeInteger(value) || value <= 0)) {
      throw new Error("INVALID_ROOM_LIFECYCLE_OPTIONS");
    }
  }

  async initialize() {
    if (this.initialized || this.closing) throw new Error(this.closing ? "ROOM_REGISTRY_CLOSED" : "ROOM_REGISTRY_ALREADY_INITIALIZED");
    this.initialized = true;
    let rooms;
    try { rooms = await this.deps.store.list(); }
    catch (error) { this.deps.diagnose?.({ roomId: "*", kind: "room-recovery-failed" }); throw error; }
    for (const room of rooms) {
      if (room.phase === "revealed") continue;
      try {
        if (!await this.get(room.roomId)) throw new Error("ROOM_DISAPPEARED_DURING_RECOVERY");
      } catch (error) {
        this.deps.diagnose?.({ roomId: room.roomId, kind: "room-recovery-failed" });
        throw error;
      }
    }
    this.scheduleCleanup();
  }

  async create(roomId: string): Promise<RoomRuntime | null> {
    if (this.closing) throw new Error("ROOM_REGISTRY_CLOSED");
    if (this.deleting.has(roomId)) return null;
    if (this.runtimes.has(roomId) || await this.deps.store.load(roomId)) return null;
    if (this.runtimes.has(roomId)) return null;
    const promise = RoomRuntime.open(roomId, randomUUID(), this.deps, this.options);
    this.runtimes.set(roomId, promise);
    try { return await promise; }
    catch (error) { this.runtimes.delete(roomId); throw error; }
  }

  async get(roomId: string): Promise<RoomRuntime | null> {
    if (this.closing) throw new Error("ROOM_REGISTRY_CLOSED");
    if (this.deleting.has(roomId)) return null;
    const active = this.runtimes.get(roomId);
    if (active) return active;
    const record = await this.deps.store.load(roomId);
    if (!record) return null;
    const openedWhileLoading = this.runtimes.get(roomId);
    if (openedWhileLoading) return openedWhileLoading;
    const promise = RoomRuntime.open(roomId, record.state.matchId, this.deps, this.options);
    this.runtimes.set(roomId, promise);
    try { return await promise; }
    catch (error) { this.runtimes.delete(roomId); throw error; }
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closing = true;
    if (this.cleanupHandle !== undefined) this.deps.clock.clearTimeout(this.cleanupHandle);
    this.closePromise = (async () => {
      await this.cleanupJob;
      const runtimes = await Promise.allSettled(this.runtimes.values());
      await Promise.all(runtimes.flatMap(item => item.status === "fulfilled" ? [item.value.close()] : []));
      this.runtimes.clear();
    })();
    return this.closePromise;
  }

  async cleanupExpired(now = this.deps.clock.now()) {
    const cutoff = now - this.lifecycle.revealedRetentionMs;
    const rooms = await this.deps.store.list();
    for (const room of rooms) {
      if (room.phase !== "revealed" || room.updatedAt > cutoff) continue;
      const active = this.runtimes.get(room.roomId);
      if (active) {
        const runtime = await active;
        await runtime.close();
        this.runtimes.delete(room.roomId);
      }
      if (!await this.deps.store.delete(room.roomId, room.version)) {
        this.deps.diagnose?.({ roomId: room.roomId, kind: "room-cleanup-failed" });
      }
    }
  }

  list() { return this.deps.store.list(); }

  async deleteLobby(roomId: string): Promise<boolean> {
    if (this.closing || this.deleting.has(roomId)) return false;
    const runtime = await this.get(roomId);
    if (!runtime) return true;
    if (this.closing || this.deleting.has(roomId)) return false;
    this.deleting.add(roomId);
    try {
      if (!await runtime.closeIfLobby()) return false;
      this.runtimes.delete(roomId);
      const record = await this.deps.store.load(roomId);
      return !record || (record.state.phase === "lobby" && await this.deps.store.delete(roomId, record.version));
    } finally { this.deleting.delete(roomId); }
  }

  async delete(roomId: string, expectedVersion?: number): Promise<boolean> {
    if (this.closing || this.deleting.has(roomId)) return false;
    this.deleting.add(roomId);
    try {
      const active = this.runtimes.get(roomId);
      if (active) {
        await (await active).close();
        this.runtimes.delete(roomId);
      }
      const record = await this.deps.store.load(roomId);
      return record && (expectedVersion === undefined || record.version === expectedVersion) ? this.deps.store.delete(roomId, record.version) : false;
    } finally { this.deleting.delete(roomId); }
  }

  private scheduleCleanup() {
    if (this.closing) return;
    this.cleanupHandle = this.deps.clock.setTimeout(() => {
      this.cleanupHandle = undefined;
      this.cleanupJob = this.cleanupExpired().catch(() => {
        this.deps.diagnose?.({ roomId: "*", kind: "room-cleanup-failed" });
      }).finally(() => this.scheduleCleanup());
    }, this.lifecycle.cleanupIntervalMs);
  }
}
