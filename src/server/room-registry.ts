import { randomUUID } from "node:crypto";
import { RoomRuntime } from "../application/room-runtime.ts";
import type { RuntimeDependencies, RuntimeOptions } from "../application/ports.ts";

export class RoomRegistry {
  private runtimes = new Map<string, Promise<RoomRuntime>>();
  private deps: RuntimeDependencies;
  private options: Partial<RuntimeOptions>;
  constructor(deps: RuntimeDependencies, options: Partial<RuntimeOptions> = {}) {
    this.deps = deps;
    this.options = options;
  }

  async create(roomId: string): Promise<RoomRuntime | null> {
    if (this.runtimes.has(roomId) || await this.deps.store.load(roomId)) return null;
    if (this.runtimes.has(roomId)) return null;
    const promise = RoomRuntime.open(roomId, randomUUID(), this.deps, this.options);
    this.runtimes.set(roomId, promise);
    try { return await promise; }
    catch (error) { this.runtimes.delete(roomId); throw error; }
  }

  async get(roomId: string): Promise<RoomRuntime | null> {
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

  async close() {
    const runtimes = await Promise.allSettled(this.runtimes.values());
    await Promise.all(runtimes.flatMap(item => item.status === "fulfilled" ? [item.value.close()] : []));
    this.runtimes.clear();
  }
}
