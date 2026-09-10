import type { GameState } from "./model.ts";

// Viewer identity is resolved by the authenticated server session.
export type Viewer = { kind: "participant"; participantId: string } | { kind: "spectator" };

export function project(state: GameState, viewer: Viewer) {
  const self = viewer.kind === "participant"
    ? state.seats.find(seat => seat.participantId === viewer.participantId) : undefined;
  const member = viewer.kind === "participant"
    ? state.members.find(member => member.participantId === viewer.participantId) : undefined;
  const actions: string[] = [];
  const showTopAnswer = state.phase === "debating" || state.phase === "voting" || state.phase === "revealed" ||
    (state.phase === "answering" && state.round === 3);
  if (state.phase === "lobby" && member) actions.push("ready");
  if (self && state.phase === "answering" && !state.answers[state.round!].some(answer => answer.seatId === self.seatId)) actions.push("answer");
  if (self && state.phase === "voting" && !state.votes.some(vote => vote.voterSeatId === self.seatId)) actions.push("vote");
  if (self && state.phase === "debating") {
    const debate = state.debate!;
    const accuser = state.seats[debate.turnIndex].seatId;
    if (debate.step === "accusation" && self.seatId === accuser) actions.push("accuse");
    if (debate.step === "response" && self.seatId === debate.targetSeatId) actions.push("respond");
    if (debate.step === "followup" && self.seatId === accuser) actions.push("followup", "skip-followup");
  }
  // Explicit allowlist: never serialize the private state or its seats directly.
  return structuredClone({
    matchId: state.matchId,
    revision: state.revision,
    phaseToken: state.phaseToken,
    phase: state.phase,
    serverNow: state.lastNow,
    deadlineAt: state.deadlineAt,
    round: state.round,
    lobby: state.phase === "lobby" ? {
      count: state.members.length, readyCount: state.members.filter(member => member.ready).length,
      selfReady: member?.ready,
    } : undefined,
    self: self ? { seatId: self.seatId, role: self.role } : undefined,
    seats: state.seats.map(({ seatId, displayNumber }) => ({ seatId, displayNumber })),
    topic: state.topic ? {
      id: state.topic.id, title: state.topic.title, url: state.topic.url,
      ...(showTopAnswer ? { topAnswerExcerpt: state.topic.topAnswerExcerpt } : {}),
    } : undefined,
    answers: Object.fromEntries(([1, 2, 3] as const).map(round => [round,
      state.answers[round].map(({ seatId, text, at }) => ({ seatId, text, at })),
    ])),
    debate: state.phase === "debating" ? {
      turnIndex: state.debate!.turnIndex, step: state.debate!.step,
      accuserSeatId: state.seats[state.debate!.turnIndex].seatId,
      targetSeatId: state.debate!.targetSeatId,
      globalDeadlineAt: state.debate!.globalDeadlineAt,
    } : undefined,
    votes: state.votes.map(({ voterSeatId, targetSeatId, at }) => ({ voterSeatId, targetSeatId, at })),
    log: state.log.map(({ seq, type, at, seatId, targetSeatId, text, round, turnIndex, phase }) =>
      ({ seq, type, at, seatId, targetSeatId, text, round, turnIndex, phase })),
    result: state.phase === "revealed" && state.result ? {
      winner: state.result.winner,
      eliminatedSeatIds: [...state.result.eliminatedSeatIds],
      validVotes: state.result.validVotes.map(({ voterSeatId, targetSeatId, at }) => ({ voterSeatId, targetSeatId, at })),
      roles: state.result.roles.map(({ seatId, role }) => ({ seatId, role })),
    } : undefined,
    actions,
  });
}

// Server-only context; never sent through the player/spectator projection.
export function aiContext(state: GameState, seatId: string) {
  if (!state.seats.some(seat => seat.seatId === seatId && seat.role === "ai")) throw new Error("FORBIDDEN");
  return {
    view: project(state, { kind: "spectator" }),
    topic: state.topic ? {
      id: state.topic.id,
      title: state.topic.title,
      topAnswerExcerpt: state.topic.topAnswerExcerpt,
      topConsensusSummary: state.topic.topConsensusSummary,
    } : undefined,
    selfSeatId: seatId,
    roles: state.seats.map(({ seatId, role }) => ({ seatId, role })),
    goal: "普通人和影子都没有获胜。",
  };
}
