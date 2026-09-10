import type { Seat } from "../game/model.ts";
import { roleCounts } from "../game/rules.ts";
import type { RandomSource } from "./ports.ts";

function shuffle<T>(items: T[], random: RandomSource): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = random.integer(i + 1);
    if (!Number.isInteger(j) || j < 0 || j > i) throw new Error("INVALID_RANDOM_SOURCE");
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

export function assignSeats(participantIds: readonly string[], random: RandomSource): Seat[] {
  const counts = roleCounts(participantIds.length);
  if (new Set(participantIds).size !== participantIds.length || participantIds.some(id => !id.trim())) {
    throw new Error("INVALID_PARTICIPANTS");
  }
  const players = shuffle([...participantIds], random);
  const assignments: Omit<Seat, "seatId" | "displayNumber">[] = players.map((participantId, i) => ({
    participantId, role: i < counts.shadow ? "shadow" : "human",
  }));
  for (let i = 0; i < counts.ai; i++) assignments.push({ role: "ai" });
  return shuffle(assignments, random).map((assignment, index) => ({
    ...assignment, seatId: `s${index + 1}`, displayNumber: index + 1,
  }));
}
