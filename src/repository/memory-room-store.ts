import type { RoomRecord, RoomStore } from "../application/ports.ts";

// Development/test adapter. Reusing this instance simulates a process restart;
// real process durability requires the later SQLite adapter.
export class MemoryRoomStore implements RoomStore {
  private rooms = new Map<string, RoomRecord>();

  async load(roomId: string): Promise<RoomRecord | null> {
    const record = this.rooms.get(roomId);
    return record ? structuredClone(record) : null;
  }

  async save(roomId: string, expectedVersion: number | null, record: RoomRecord): Promise<boolean> {
    const current = this.rooms.get(roomId);
    if ((current?.version ?? null) !== expectedVersion) return false;
    if (record.version !== (expectedVersion === null ? 0 : expectedVersion + 1)) {
      throw new Error("INVALID_STORE_VERSION");
    }
    this.rooms.set(roomId, structuredClone(record));
    return true;
  }
}
