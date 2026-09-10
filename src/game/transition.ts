import type { Actor, Command, CommandEnvelope, ErrorCode, GameLogEntry, GameState, Phase, Round, Seat, Topic, TransitionResult } from "./model.ts";
import { ANSWER_LIMIT, ANSWER_MS, charCount, DEBATE_MS, DEBATE_STEP_MS, MAX_DEBATE_BYTES, roleCounts, VOTE_MS } from "./rules.ts";
import { settle } from "./settlement.ts";
import { PLAYER_LIMITS } from "../contracts/rules.ts";

class RuleError extends Error {
  code: ErrorCode;
  constructor(code: ErrorCode) { super(code); this.code = code; }
}
function requireRule(condition: unknown, code: ErrorCode): asserts condition {
  if (!condition) throw new RuleError(code);
}

export function createGame(matchId: string, now: number): GameState {
  requireRule(typeof matchId === "string" && matchId.trim() && Number.isFinite(now), "INVALID_INPUT");
  return { matchId, phase: "lobby", phaseToken: 0, revision: 0, lastNow: now,
    members: [], seats: [], answers: { 1: [], 2: [], 3: [] }, votes: [], log: [] };
}

function log(state: GameState, entry: Omit<GameLogEntry, "seq">) {
  state.log.push({ ...entry, seq: state.log.length + 1 });
}
function phase(state: GameState, next: Phase, now: number, duration?: number) {
  state.phase = next;
  state.phaseToken++;
  state.deadlineAt = duration === undefined ? undefined : now + duration;
  log(state, { type: "phase", phase: next, round: state.round, at: now });
}
function beginRound(state: GameState, round: Round, now: number) {
  state.round = round;
  phase(state, "answering", now, ANSWER_MS);
}
function endRound(state: GameState, now: number) {
  if (state.round! < 3) beginRound(state, (state.round! + 1) as Round, now);
  else {
    state.debate = { turnIndex: 0, step: "accusation", globalDeadlineAt: now + DEBATE_MS };
    phase(state, "debating", now, DEBATE_STEP_MS.accusation);
  }
}
function beginVoting(state: GameState, now: number) { phase(state, "voting", now, VOTE_MS); }
function finish(state: GameState, now: number) {
  state.result = settle(state.seats, state.votes);
  phase(state, "revealed", now);
}
function nextDebate(state: GameState, now: number) {
  const debate = state.debate!;
  if (debate.step === "accusation") debate.step = "response";
  else if (debate.step === "response") debate.step = "followup";
  else { debate.turnIndex++; debate.step = "accusation"; delete debate.targetSeatId; }
  if (debate.turnIndex === state.seats.length) { beginVoting(state, now); return; }
  state.phaseToken++;
  state.deadlineAt = Math.min(now + DEBATE_STEP_MS[debate.step], debate.globalDeadlineAt);
}
function addAnswer(state: GameState, seatId: string, text: string, now: number) {
  state.answers[state.round!].push({ seatId, text, at: now });
  log(state, { type: "answer", seatId, text, round: state.round, at: now });
}
function addVote(state: GameState, voterSeatId: string, targetSeatId: string | null, now: number) {
  state.votes.push({ voterSeatId, targetSeatId, at: now });
  log(state, { type: "vote", seatId: voterSeatId, targetSeatId, at: now });
}

// Replays every expired deadline using its original timestamp, including after restart.
export function advanceTime(input: GameState, now: number): GameState {
  requireRule(Number.isFinite(now) && now >= input.lastNow, "INVALID_INPUT");
  const state = structuredClone(input);
  state.lastNow = now;
  while (state.deadlineAt !== undefined && now >= state.deadlineAt) {
    const at = state.deadlineAt;
    if (state.phase === "answering") {
      const pool = state.topic!.defaults[state.round!];
      state.seats.forEach((seat, index) => {
        if (!state.answers[state.round!].some(answer => answer.seatId === seat.seatId)) {
          addAnswer(state, seat.seatId, pool[index % pool.length], at);
        }
      });
      endRound(state, at);
    } else if (state.phase === "debating") {
      const debate = state.debate!;
      if (at >= debate.globalDeadlineAt) { beginVoting(state, at); }
      else {
        const accuser = state.seats[debate.turnIndex].seatId;
        const step = debate.step;
        if (step === "accusation") {
          debate.targetSeatId = state.seats[(debate.turnIndex + 1) % state.seats.length].seatId;
          log(state, { type: step, seatId: accuser, targetSeatId: debate.targetSeatId,
            text: "我认为你是AI。", turnIndex: debate.turnIndex, at });
        } else if (step === "response") {
          log(state, { type: step, seatId: debate.targetSeatId,
            text: "仅凭刚才的回答，还不足以下这个结论。", turnIndex: debate.turnIndex, at });
        } else log(state, { type: "skip-followup", seatId: accuser, turnIndex: debate.turnIndex, at });
        nextDebate(state, at);
      }
    } else if (state.phase === "voting") {
      for (const seat of state.seats) {
        if (!state.votes.some(vote => vote.voterSeatId === seat.seatId)) addVote(state, seat.seatId, null, at);
      }
      finish(state, at);
    } else throw new Error("Unexpected timed phase");
    state.revision++;
  }
  return state;
}

function text(value: unknown, limit?: number): string {
  requireRule(typeof value === "string", "INVALID_INPUT");
  const clean = value.trim();
  requireRule(clean.length > 0 && new TextEncoder().encode(clean).length <= MAX_DEBATE_BYTES, "INVALID_INPUT");
  if (limit !== undefined) requireRule(charCount(clean) <= limit, "INVALID_INPUT");
  return clean;
}
function validateTopic(topic: Topic) {
  requireRule(topic && typeof topic === "object", "INVALID_INPUT");
  for (const value of [topic.id, topic.title, topic.topAnswerExcerpt, topic.topConsensusSummary]) text(value);
  requireRule(typeof topic.url === "string" && /^https:\/\/www\.zhihu\.com\/question\/\d+\/?$/.test(topic.url), "INVALID_INPUT");
  requireRule(topic.provenance && /^[a-z0-9][a-z0-9-]{2,79}$/.test(topic.provenance.packId) &&
    topic.provenance.source === "zhihu" && !Number.isNaN(Date.parse(topic.provenance.curatedAt)) &&
    (topic.provenance.verifiedAt === undefined || !Number.isNaN(Date.parse(topic.provenance.verifiedAt))), "INVALID_INPUT");
  for (const round of [1, 2, 3] as const) {
    const pool = topic.defaults?.[round];
    requireRule(Array.isArray(pool) && pool.length >= 2, "INVALID_INPUT");
    for (const item of pool) requireRule(text(item, ANSWER_LIMIT[round]) === item, "INVALID_INPUT");
    if (round === 2) requireRule(pool.some(item => /^正方：\S/.test(item)) &&
      pool.some(item => /^反方：\S/.test(item)) && pool.every(item => /^(正方|反方)：\S/.test(item)), "INVALID_INPUT");
  }
}
function validateSeats(state: GameState, seats: Seat[]) {
  const counts = roleCounts(state.members.length);
  requireRule(Array.isArray(seats) && seats.length === counts.human + counts.shadow + counts.ai, "INVALID_INPUT");
  const ids = new Set<string>();
  const participants = new Set<string>();
  seats.forEach((seat, index) => {
    requireRule(seat && seat.seatId === `s${index + 1}` && seat.displayNumber === index + 1 && !ids.has(seat.seatId), "INVALID_INPUT");
    ids.add(seat.seatId);
    requireRule(["human", "shadow", "ai"].includes(seat.role), "INVALID_INPUT");
    if (seat.role === "ai") requireRule(seat.participantId === undefined, "INVALID_INPUT");
    else {
      requireRule(typeof seat.participantId === "string" && !participants.has(seat.participantId) &&
        state.members.some(member => member.participantId === seat.participantId), "INVALID_INPUT");
      participants.add(seat.participantId);
    }
  });
  for (const role of ["human", "shadow", "ai"] as const) {
    requireRule(seats.filter(seat => seat.role === role).length === counts[role], "INVALID_INPUT");
  }
  requireRule(participants.size === state.members.length, "INVALID_INPUT");
}
function actingSeat(state: GameState, actor: Actor): Seat {
  const seat = state.seats.find(seat => actor.kind === "participant"
    ? seat.participantId === actor.participantId
    : actor.kind === "ai" && seat.role === "ai" && seat.seatId === actor.seatId);
  requireRule(seat, "FORBIDDEN");
  return seat;
}
function target(state: GameState, source: string, value: unknown): asserts value is string {
  requireRule(typeof value === "string" && value !== source && state.seats.some(seat => seat.seatId === value), "INVALID_TARGET");
}

function apply(state: GameState, actor: Actor, command: Command, now: number) {
  if (command.type === "join" || command.type === "ready") {
    requireRule(state.phase === "lobby", "WRONG_PHASE");
    requireRule(actor.kind === "participant", "FORBIDDEN");
    text(actor.participantId);
    const member = state.members.find(member => member.participantId === actor.participantId);
    if (command.type === "join") {
      requireRule(!member, "DUPLICATE");
      requireRule(state.members.length < PLAYER_LIMITS.max, "ROOM_FULL");
      state.members.push({ participantId: actor.participantId, ready: false });
    } else {
      requireRule(member, "FORBIDDEN");
      requireRule(typeof command.ready === "boolean", "INVALID_INPUT");
      member.ready = command.ready;
      if (state.members.length >= PLAYER_LIMITS.min && state.members.every(item => item.ready)) phase(state, "preparing", now);
    }
    return;
  }
  if (command.type === "resolve-topic") {
    requireRule(actor.kind === "system", "FORBIDDEN");
    requireRule(state.phase === "preparing", "WRONG_PHASE");
    validateTopic(command.topic);
    validateSeats(state, command.seats);
    state.topic = structuredClone(command.topic);
    state.seats = structuredClone(command.seats);
    beginRound(state, 1, now);
    return;
  }
  const seat = actingSeat(state, actor);
  if (command.type === "answer") {
    requireRule(state.phase === "answering" && command.round === state.round, "WRONG_PHASE");
    requireRule(!state.answers[state.round!].some(answer => answer.seatId === seat.seatId), "DUPLICATE");
    let answer = text(command.text);
    if (state.round === 2) {
      requireRule(command.stance === "pro" || command.stance === "con", "INVALID_INPUT");
      answer = `${command.stance === "pro" ? "正方" : "反方"}：${answer}`;
    } else requireRule(command.stance === undefined, "INVALID_INPUT");
    text(answer, ANSWER_LIMIT[state.round!]);
    addAnswer(state, seat.seatId, answer, now);
    if (state.answers[state.round!].length === state.seats.length) endRound(state, now);
    return;
  }
  if (command.type === "vote") {
    requireRule(state.phase === "voting", "WRONG_PHASE");
    requireRule(!state.votes.some(vote => vote.voterSeatId === seat.seatId), "DUPLICATE");
    target(state, seat.seatId, command.targetSeatId);
    addVote(state, seat.seatId, command.targetSeatId, now);
    if (state.votes.length === state.seats.length) finish(state, now);
    return;
  }
  requireRule(state.phase === "debating", "WRONG_PHASE");
  const debate = state.debate!;
  const accuser = state.seats[debate.turnIndex].seatId;
  if (command.type === "accuse") {
    requireRule(debate.step === "accusation", "WRONG_PHASE");
    requireRule(seat.seatId === accuser, "FORBIDDEN");
    target(state, accuser, command.targetSeatId);
    debate.targetSeatId = command.targetSeatId;
    log(state, { type: "accusation", seatId: accuser, targetSeatId: command.targetSeatId,
      text: text(command.text), turnIndex: debate.turnIndex, at: now });
  } else if (command.type === "respond") {
    requireRule(debate.step === "response", "WRONG_PHASE");
    requireRule(seat.seatId === debate.targetSeatId, "FORBIDDEN");
    log(state, { type: "response", seatId: seat.seatId, text: text(command.text), turnIndex: debate.turnIndex, at: now });
  } else if (command.type === "followup" || command.type === "skip-followup") {
    requireRule(debate.step === "followup", "WRONG_PHASE");
    requireRule(seat.seatId === accuser, "FORBIDDEN");
    log(state, { type: command.type, seatId: accuser,
      ...(command.type === "followup" ? { text: text(command.text) } : {}), turnIndex: debate.turnIndex, at: now });
  } else throw new RuleError("INVALID_INPUT");
  nextDebate(state, now);
}

// Always retain the returned state: deadlines may have advanced even if the action is rejected.
export function transition(input: GameState, actor: Actor, envelope: CommandEnvelope, now: number): TransitionResult {
  const current = advanceTime(input, now);
  const next = structuredClone(current);
  try {
    requireRule(envelope.matchId === current.matchId, "WRONG_MATCH");
    requireRule(envelope.phaseToken === current.phaseToken, "STALE_PHASE");
    apply(next, actor, envelope.command, now);
    next.revision++;
    return { ok: true, state: next };
  } catch (error) {
    if (error instanceof RuleError) return { ok: false, error: error.code, state: current };
    throw error;
  }
}
