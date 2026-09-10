import type { RoomRecord } from "../application/ports.ts";
import type { GameState, Round, Seat, Topic, Vote } from "../game/model.ts";
import { roleCounts } from "../game/rules.ts";
import { settle } from "../game/settlement.ts";

type Value = Record<string, unknown>;
const phases = new Set(["lobby", "preparing", "answering", "debating", "voting", "revealed"]);
const roles = new Set(["human", "shadow", "ai"]);
const logTypes = new Set(["answer", "accusation", "response", "followup", "skip-followup", "vote", "phase"]);

function object(value: unknown): value is Value { return typeof value === "object" && value !== null && !Array.isArray(value); }
function integer(value: unknown, min = 0): value is number { return Number.isSafeInteger(value) && (value as number) >= min; }
function timestamp(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value) && value >= 0; }
function nonempty(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0; }
function fail(): never { throw new Error("CORRUPT_ROOM_RECORD"); }
function requireValid(condition: unknown): asserts condition { if (!condition) fail(); }

function validateTopic(value: unknown): asserts value is Topic {
  requireValid(object(value) && nonempty(value.id) && nonempty(value.title) &&
    typeof value.url === "string" && /^https:\/\/www\.zhihu\.com\/question\/\d+\/?$/.test(value.url) &&
    nonempty(value.topAnswerExcerpt) && nonempty(value.topConsensusSummary) && object(value.defaults));
  // Legacy records created before topic-pack v1 have no provenance. All newly
  // resolved topics are required to include it by the core transition.
  if (value.provenance !== undefined) requireValid(object(value.provenance) && nonempty(value.provenance.packId) &&
    value.provenance.source === "zhihu" && nonempty(value.provenance.curatedAt));
  for (const round of [1, 2, 3] as const) {
    const pool = value.defaults[String(round)];
    requireValid(Array.isArray(pool) && pool.length >= 2 && pool.every(nonempty));
  }
}

function validateSeats(state: Value, members: { participantId: string; ready: boolean }[]): Seat[] {
  requireValid(Array.isArray(state.seats));
  if (state.phase === "lobby" || state.phase === "preparing") { requireValid(state.seats.length === 0); return []; }
  const counts = roleCounts(members.length);
  requireValid(state.seats.length === counts.human + counts.shadow + counts.ai);
  const participantIds = new Set<string>();
  const seats = state.seats as unknown[];
  seats.forEach((value, index) => {
    requireValid(object(value) && value.seatId === `s${index + 1}` && value.displayNumber === index + 1 && roles.has(value.role as string));
    if (value.role === "ai") requireValid(value.participantId === undefined);
    else {
      requireValid(nonempty(value.participantId) && members.some(member => member.participantId === value.participantId) &&
        !participantIds.has(value.participantId));
      participantIds.add(value.participantId);
    }
  });
  requireValid(participantIds.size === members.length);
  for (const role of roles) requireValid(seats.filter(value => (value as Value).role === role).length === counts[role as keyof typeof counts]);
  return seats as Seat[];
}

function validateAnswers(state: Value, seats: Seat[]) {
  requireValid(object(state.answers));
  const seatIds = new Set(seats.map(seat => seat.seatId));
  for (const round of [1, 2, 3] as const) {
    const values = state.answers[String(round)];
    requireValid(Array.isArray(values));
    const answered = new Set<string>();
    for (const value of values) {
      requireValid(object(value) && typeof value.seatId === "string" && seatIds.has(value.seatId) &&
        !answered.has(value.seatId) && nonempty(value.text) && timestamp(value.at) && value.at <= (state.lastNow as number));
      answered.add(value.seatId);
    }
    if (state.phase === "lobby" || state.phase === "preparing") requireValid(values.length === 0);
    else if (state.phase === "answering") {
      requireValid(integer(state.round, 1) && state.round <= 3);
      if (round < state.round) requireValid(values.length === seats.length);
      if (round > state.round) requireValid(values.length === 0);
    } else requireValid(values.length === seats.length);
  }
}

function validateVotes(state: Value, seats: Seat[]): Vote[] {
  requireValid(Array.isArray(state.votes));
  if (state.phase !== "voting" && state.phase !== "revealed") requireValid(state.votes.length === 0);
  const seatIds = new Set(seats.map(seat => seat.seatId));
  const voters = new Set<string>();
  for (const value of state.votes) {
    requireValid(object(value) && typeof value.voterSeatId === "string" && seatIds.has(value.voterSeatId) &&
      !voters.has(value.voterSeatId) && (value.targetSeatId === null ||
        (typeof value.targetSeatId === "string" && seatIds.has(value.targetSeatId) && value.targetSeatId !== value.voterSeatId)) &&
      timestamp(value.at) && value.at <= (state.lastNow as number));
    voters.add(value.voterSeatId);
  }
  requireValid(state.votes.length <= seats.length);
  if (state.phase === "revealed") requireValid(state.votes.length === seats.length);
  return state.votes as Vote[];
}

function validateState(value: unknown): asserts value is GameState {
  requireValid(object(value) && nonempty(value.matchId) && phases.has(value.phase as string) &&
    integer(value.phaseToken) && integer(value.revision) && timestamp(value.lastNow) && Array.isArray(value.members));
  const memberIds = new Set<string>();
  const members = value.members.map(member => {
    requireValid(object(member) && nonempty(member.participantId) && typeof member.ready === "boolean" && !memberIds.has(member.participantId));
    memberIds.add(member.participantId);
    return member as unknown as { participantId: string; ready: boolean };
  });
  requireValid(members.length <= 5);
  if (value.phase !== "lobby") requireValid(members.length >= 2 && members.every(member => member.ready));
  const seats = validateSeats(value, members);
  if (value.phase === "lobby" || value.phase === "preparing") {
    requireValid(value.topic === undefined && value.round === undefined && value.deadlineAt === undefined && value.debate === undefined && value.result === undefined);
  } else {
    validateTopic(value.topic);
    requireValid(integer(value.round, 1) && value.round <= 3);
    if (value.phase === "answering") requireValid(timestamp(value.deadlineAt) && value.deadlineAt >= value.lastNow && value.debate === undefined);
    if (value.phase === "debating") requireValid(object(value.debate) && integer(value.debate.turnIndex) &&
      value.debate.turnIndex < seats.length && ["accusation", "response", "followup"].includes(value.debate.step as string) &&
      timestamp(value.debate.globalDeadlineAt) && timestamp(value.deadlineAt) && value.deadlineAt >= value.lastNow &&
      value.deadlineAt <= value.debate.globalDeadlineAt);
    if (value.phase === "voting") requireValid(timestamp(value.deadlineAt) && value.deadlineAt >= value.lastNow && object(value.debate));
    if (value.phase === "revealed") requireValid(value.deadlineAt === undefined && object(value.debate) && object(value.result));
  }
  validateAnswers(value, seats);
  const votes = validateVotes(value, seats);
  requireValid(Array.isArray(value.log));
  const lastNow = value.lastNow as number;
  value.log.forEach((entry, index) => requireValid(object(entry) && entry.seq === index + 1 && logTypes.has(entry.type as string) &&
    timestamp(entry.at) && entry.at <= lastNow));
  if (value.phase === "revealed") {
    const expected = settle(seats, votes);
    requireValid(JSON.stringify(value.result) === JSON.stringify(expected));
  } else requireValid(value.result === undefined);
}

export function validateRoomRecord(value: unknown, columnVersion: number): RoomRecord {
  requireValid(object(value) && value.version === columnVersion && integer(value.version) &&
    Array.isArray(value.receipts) && object(value.preparation));
  validateState(value.state);
  requireValid(integer(value.preparation.candidateIndex) && integer(value.preparation.cycles) && timestamp(value.preparation.retryAt));
  for (const receipt of value.receipts) {
    requireValid(object(receipt) && nonempty(receipt.participantId) && nonempty(receipt.commandId) &&
      typeof receipt.fingerprint === "string" && /^[0-9a-f]{64}$/.test(receipt.fingerprint) && object(receipt.ack) &&
      receipt.ack.commandId === receipt.commandId && typeof receipt.ack.ok === "boolean" && integer(receipt.ack.revision));
  }
  return value as unknown as RoomRecord;
}
