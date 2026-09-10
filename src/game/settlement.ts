import type { Result, Seat, Vote } from "./model.ts";

// Called only after voting closes; all eliminations happen simultaneously.
export function settle(seats: readonly Seat[], votes: readonly Vote[]): Result {
  const seenVoters = new Set<string>();
  const validVotes = votes.filter(vote => {
    const valid = vote.targetSeatId !== null && vote.targetSeatId !== vote.voterSeatId &&
      seats.some(seat => seat.seatId === vote.voterSeatId && seat.role === "human") &&
      seats.some(seat => seat.seatId === vote.targetSeatId) && !seenVoters.has(vote.voterSeatId);
    if (valid) seenVoters.add(vote.voterSeatId);
    return valid;
  });
  const eliminated = new Set(validVotes.map(vote => vote.targetSeatId!));
  const humansWin = seats.filter(seat => seat.role === "ai").every(seat => eliminated.has(seat.seatId));
  const shadowsWin = seats.filter(seat => seat.role === "shadow").every(seat => !eliminated.has(seat.seatId));
  return {
    winner: humansWin ? "human" : shadowsWin ? "shadow" : "ai",
    eliminatedSeatIds: [...eliminated],
    validVotes: structuredClone(validVotes),
    roles: seats.map(({ seatId, role }) => ({ seatId, role })),
  };
}
