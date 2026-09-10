import type { RoomRecord, RoomStore, RoomSummary } from "../application/ports.ts";

// Development/test adapter. Reusing this instance simulates a process restart;
// real process durability requires the later SQLite adapter.
export class MemoryRoomStore implements RoomStore {
  private rooms = new Map<string, { record: RoomRecord; updatedAt: number }>();
  private now: () => number;

  constructor(now: () => number = Date.now) { this.now = now; }

  async load(roomId: string): Promise<RoomRecord | null> {
    const value = this.rooms.get(roomId);
    return value ? structuredClone(value.record) : null;
  }

  async save(roomId: string, expectedVersion: number | null, record: RoomRecord): Promise<boolean> {
    const current = this.rooms.get(roomId)?.record;
    if ((current?.version ?? null) !== expectedVersion) return false;
    if (record.version !== (expectedVersion === null ? 0 : expectedVersion + 1)) {
      throw new Error("INVALID_STORE_VERSION");
    }
    this.rooms.set(roomId, { record: structuredClone(record), updatedAt: this.now() });
    return true;
  }

  async list(): Promise<RoomSummary[]> {
    return [...this.rooms].map(([roomId, value]) => ({ roomId, matchId: value.record.state.matchId,
      phase: value.record.state.phase, version: value.record.version, updatedAt: value.updatedAt }));
  }

  async delete(roomId: string, expectedVersion: number): Promise<boolean> {
    const current = this.rooms.get(roomId);
    if (!current || current.record.version !== expectedVersion) return false;
    return this.rooms.delete(roomId);
  }
}
