import { randomBytes, randomUUID } from "node:crypto";
import type { MatchStatus } from "../contracts/account.ts";
import type { AdmissionService } from "./admission-service.ts";
import type { RoomRegistry } from "./room-registry.ts";

interface Ticket { heartbeat: number; expiresAt: number; assignedAt?: number; assignment?: { roomId: string; sessionToken: string } }

/** FIFO pairs; serialized together with cancellation so a user cannot occupy two matched seats. */
export class Matchmaking {
  private tickets = new Map<string, Ticket>();
  private tail: Promise<unknown> = Promise.resolve();
  private closed = false;
  private admissions: AdmissionService;
  private rooms: RoomRegistry;
  private now: () => number;

  constructor(admissions: AdmissionService, rooms: RoomRegistry, now: () => number = Date.now) {
    this.admissions = admissions; this.rooms = rooms; this.now = now;
  }

  update(userId: string, action: "join" | "poll" | "cancel", expiresAt: number): Promise<MatchStatus> {
    const task = this.tail.then(() => this.execute(userId, action, expiresAt));
    this.tail = task.catch(() => {}); return task;
  }
  async close() { this.closed = true; await this.tail; this.tickets.clear(); }
  cleanup(): Promise<void> {
    const task = this.tail.then(async () => { if (!this.closed) await this.sweep(); });
    this.tail = task.catch(() => {}); return task;
  }

  private async sweep() {
    const now = this.now();
    // Abandoned public lobbies must not pin an account forever when the other player never readies.
    const checked = new Set<string>();
    for (const item of this.tickets.values()) {
      if (!item.assignment || item.assignedAt === undefined || item.assignedAt + 120_000 > now || checked.has(item.assignment.roomId)) continue;
      const roomId = item.assignment.roomId; checked.add(roomId);
      const runtime = await this.rooms.get(roomId);
      const expired = !runtime || await this.rooms.deleteLobby(roomId);
      for (const [id, member] of this.tickets) if (member.assignment?.roomId === roomId) {
        if (expired) this.tickets.delete(id);
        else if (runtime?.view({ kind: "spectator" }).phase !== "lobby") member.assignedAt = undefined;
      }
    }
    for (const [id, item] of this.tickets) {
      if ((!item.assignment && (item.heartbeat + 30_000 <= now || item.expiresAt <= now)) ||
        (item.assignment && item.heartbeat + 48 * 60 * 60_000 <= now)) this.tickets.delete(id);
    }
  }

  private async execute(userId: string, action: "join" | "poll" | "cancel", expiresAt: number): Promise<MatchStatus> {
    if (this.closed) throw new Error("MATCH_UNAVAILABLE");
    await this.sweep();
    const now = this.now();
    let ticket = this.tickets.get(userId);
    if (ticket?.assignment) {
      const result = await this.admissions.resume(ticket.assignment.roomId, ticket.assignment.sessionToken);
      if (result.ok && result.runtime.view({ kind: "spectator" }).phase !== "revealed") {
        ticket.heartbeat = now;
        return { status: "matched", ...ticket.assignment };
      }
      this.tickets.delete(userId); ticket = undefined;
    }
    if (action === "cancel" || expiresAt <= now) {
      this.tickets.delete(userId); return { status: "idle" };
    }
    if (!ticket && action === "join") {
      if (this.tickets.size >= 1_000) throw new Error("MATCH_BUSY");
      ticket = { heartbeat: now, expiresAt }; this.tickets.set(userId, ticket);
    }
    if (!ticket) return { status: "idle" };
    ticket.heartbeat = now; ticket.expiresAt = expiresAt;
    const waiting = [...this.tickets.entries()].filter(([, item]) => !item.assignment);
    if (waiting.length >= 2) {
      const pair = waiting.slice(0, 2);
      const roomId = `m-${randomBytes(10).toString("hex")}`;
      let created = false;
      try {
        if (!await this.rooms.create(roomId)) throw new Error("MATCH_UNAVAILABLE");
        created = true;
        const first = await this.admissions.join(roomId, "player", randomUUID());
        if (!first.ok) throw new Error("MATCH_UNAVAILABLE");
        const second = await this.admissions.join(roomId, "player", randomUUID());
        if (!second.ok) throw new Error("MATCH_UNAVAILABLE");
        pair[0][1].assignment = { roomId, sessionToken: first.token };
        pair[1][1].assignment = { roomId, sessionToken: second.token };
        pair[0][1].assignedAt = now; pair[1][1].assignedAt = now;
      } catch {
        // Delete only the room this operation created, never a pre-existing room on ID collision.
        if (created) await this.rooms.delete(roomId);
        throw new Error("MATCH_UNAVAILABLE");
      }
    }
    return ticket.assignment ? { status: "matched", ...ticket.assignment } :
      { status: "waiting", waiting: [...this.tickets.values()].filter(item => !item.assignment).length };
  }
}
