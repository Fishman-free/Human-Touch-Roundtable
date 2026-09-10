import assert from "node:assert/strict";
import test from "node:test";
import type { Actor, Command, GameState, Role, Seat, Topic } from "../src/game/model.ts";
import { advanceTime, createGame, transition } from "../src/game/transition.ts";
import { aiContext, project } from "../src/game/projection.ts";
import { charCount, roleCounts } from "../src/game/rules.ts";

const topic: Topic = {
  provenance: { packId: "test-topic", source: "zhihu", curatedAt: "2026-09-10T00:00:00.000Z" },
  id: "123", title: "技术应当代替重复劳动吗？", url: "https://www.zhihu.com/question/123",
  topAnswerExcerpt: "重复劳动可以交给工具，判断仍需要人。", topConsensusSummary: "工具节省时间，责任仍在人。",
  defaults: { 1: ["工具节省时间，责任仍在人。", "效率之外还要考虑责任。"],
    2: ["正方：可以把时间留给更重要的事。", "反方：完全依赖工具会失去判断。"],
    3: ["工具下班了，责任还在加班。", "省下的时间，最后又拿去开会了。"] },
};
const system: Actor = { kind: "system" };
const person = (i: number): Actor => ({ kind: "participant", participantId: `p${i}` });
function actor(seat: Seat): Actor {
  return seat.role === "ai" ? { kind: "ai", seatId: seat.seatId } : { kind: "participant", participantId: seat.participantId! };
}
function send(state: GameState, actor: Actor, command: Command, now = state.lastNow) {
  return transition(state, actor, { matchId: state.matchId, phaseToken: state.phaseToken, command }, now);
}
function ok(state: GameState, actor: Actor, command: Command, now = state.lastNow) {
  const result = send(state, actor, command, now);
  assert.equal(result.ok, true, result.ok ? undefined : result.error);
  return result.state;
}
function preparing(count: number) {
  let state = createGame("match-1", 0);
  for (let i = 0; i < count; i++) state = ok(state, person(i), { type: "join" });
  for (let i = 0; i < count; i++) state = ok(state, person(i), { type: "ready", ready: true });
  assert.equal(state.phase, "preparing");
  return state;
}
function seatsFor(count: number): Seat[] {
  const counts = roleCounts(count);
  // Fixed fixture ordering; production application must randomize allocation.
  const roles: Role[] = [...Array<Role>(counts.human).fill("human"),
    ...Array<Role>(counts.shadow).fill("shadow"), ...Array<Role>(counts.ai).fill("ai")];
  return roles.map((role, i) => ({ role, seatId: `s${i + 1}`, displayNumber: i + 1,
    ...(role !== "ai" ? { participantId: `p${i}` } : {}) }));
}
function started(count = 3) {
  return ok(preparing(count), system, { type: "resolve-topic", topic, seats: seatsFor(count) });
}
function answered(count = 3) {
  let state = started(count);
  for (const round of [1, 2, 3] as const) {
    for (const seat of state.seats) state = ok(state, actor(seat), {
      type: "answer", round, text: "这是我的回答", ...(round === 2 ? { stance: "pro" as const } : {}),
    });
  }
  assert.equal(state.phase, "debating");
  return state;
}
function voting(count = 3) {
  let state = answered(count);
  while (state.phase === "debating") {
    const index = state.debate!.turnIndex;
    const accuser = state.seats[index];
    const target = state.seats[(index + 1) % state.seats.length];
    state = ok(state, actor(accuser), { type: "accuse", targetSeatId: target.seatId, text: "你像AI。" });
    state = ok(state, actor(target), { type: "respond", text: "理由是什么？" });
    state = ok(state, actor(accuser), { type: "skip-followup" });
  }
  assert.equal(state.phase, "voting");
  return state;
}
function finishWith(state: GameState, humanTargets: string[]) {
  let h = 0;
  for (const seat of state.seats) {
    const targetSeatId = seat.role === "human" ? humanTargets[h++] : state.seats.find(other => other.seatId !== seat.seatId)!.seatId;
    state = ok(state, actor(seat), { type: "vote", targetSeatId });
  }
  assert.equal(state.phase, "revealed");
  return state;
}

for (const count of [2, 3, 4, 5]) test(`${count}名真人完整对局：三轮、逐座辩论、分散投票获胜`, () => {
  const state = voting(count);
  const counts = roleCounts(count);
  assert.equal(state.seats.length, count + counts.ai);
  for (const round of [1, 2, 3] as const) assert.equal(state.answers[round].length, state.seats.length);
  assert.equal(state.log.filter(entry => entry.type === "accusation").length, state.seats.length);
  const result = finishWith(state, state.seats.filter(seat => seat.role === "ai").map(seat => seat.seatId));
  assert.equal(result.result!.winner, "human");
  assert.equal(result.result!.eliminatedSeatIds.length, counts.ai);
  assert.deepEqual(result.log.map(entry => entry.seq), result.log.map((_, i) => i + 1));
  assert.equal(project(result, { kind: "spectator" }).result!.roles.length, state.seats.length);
});

test("候场需全员准备；锁定后禁止加入；只有系统能接受有效题目和身份配置", () => {
  let state = createGame("x", 0);
  state = ok(state, person(0), { type: "join" });
  state = ok(state, person(0), { type: "ready", ready: true });
  assert.equal(state.phase, "lobby");
  state = ok(state, person(1), { type: "join" });
  state = ok(state, person(0), { type: "ready", ready: false });
  state = ok(state, person(1), { type: "ready", ready: true });
  assert.equal(state.phase, "lobby");
  state = ok(state, person(0), { type: "ready", ready: true });
  assert.equal(send(state, person(2), { type: "join" }).ok, false);
  const command: Command = { type: "resolve-topic", topic, seats: seatsFor(2) };
  assert.equal(send(state, person(0), command).ok, false);
  for (const bad of [
    { ...topic, topAnswerExcerpt: "" }, { ...topic, url: "https://example.com" },
    { ...topic, defaults: { ...topic.defaults, 1: [] } },
    { ...topic, defaults: { ...topic.defaults, 2: ["正方：好", "正方：好"] } },
  ]) assert.equal(send(state, system, { ...command, topic: bad }).ok, false);
  const seats = seatsFor(2); seats[0].participantId = "stranger";
  assert.equal(send(state, system, { ...command, seats }).ok, false);
  assert.equal(advanceTime(state, 1_000_000).phase, "preparing");
  assert.equal(ok(state, system, command).phase, "answering");
});

test("空白、超长、重复、错误轮次和旁观操作被拒绝，失败不改变答案", () => {
  let state = started();
  const original = structuredClone(state);
  for (const value of [" ", "字".repeat(31)]) assert.equal(send(state, person(0), { type: "answer", round: 1, text: value }).ok, false);
  assert.equal(send(state, { kind: "spectator" }, { type: "answer", round: 1, text: "答案" }).ok, false);
  assert.equal(send(state, { kind: "ai", seatId: "s1" }, { type: "answer", round: 1, text: "答案" }).ok, false);
  assert.equal(send(state, person(0), { type: "answer", round: 2, text: "答案" }).ok, false);
  assert.deepEqual(state, original);
  state = ok(state, person(0), { type: "answer", round: 1, text: "字".repeat(30) });
  const result = send(state, person(0), { type: "answer", round: 1, text: "修改" });
  assert.equal(result.ok, false);
  assert.equal(result.state.answers[1][0].text, "字".repeat(30));
  assert.equal(charCount("👨‍👩‍👧‍👦"), 1);
});

test("第二轮强制立场，前缀计入50字且不会截断", () => {
  let state = advanceTime(started(), 90_000);
  assert.equal(send(state, person(0), { type: "answer", round: 2, text: "理由" }).ok, false);
  assert.equal(send(state, person(0), { type: "answer", round: 2, text: "字".repeat(48), stance: "pro" }).ok, false);
  state = ok(state, person(0), { type: "answer", round: 2, text: "字".repeat(47), stance: "con" });
  assert.equal(charCount(state.answers[2][0].text), 50);
});

test("边界时刻先补默认答案再拒绝迟到动作；旧轮次令牌不能进入新轮次", () => {
  const initial = started();
  const result = send(initial, person(0), { type: "answer", round: 1, text: "迟到" }, 90_000);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error, "STALE_PHASE");
  assert.equal(result.state.round, 2);
  assert.equal(result.state.answers[1].length, initial.seats.length);
  assert.equal(result.state.answers[1].some(answer => answer.text === "迟到"), false);
  assert.deepEqual(initial.answers[1], []);
  assert.deepEqual(advanceTime(result.state, 90_000), result.state);
  const otherMatch = transition(initial, person(0), { matchId: "other", phaseToken: 0, command: { type: "vote", targetSeatId: "s2" } }, 0);
  assert.equal(otherMatch.ok, false);
});

test("全员离线：补全三轮，辩论8分钟截断，投票未投票，影子胜", () => {
  const start = started(5);
  let state = advanceTime(start, 270_000);
  assert.equal(state.phase, "debating");
  state = advanceTime(state, 750_000);
  assert.equal(state.phase, "voting");
  assert.equal(state.deadlineAt, 810_000);
  assert.equal(state.log.filter(entry => entry.type === "accusation").length, 6);
  assert.ok(state.log.filter(entry => entry.type === "accusation").every(entry => entry.targetSeatId !== entry.seatId));
  state = advanceTime(state, 810_000);
  assert.equal(state.phase, "revealed");
  assert.equal(state.result!.winner, "shadow");
  assert.ok(state.votes.every(vote => vote.targetSeatId === null));
  assert.deepEqual(state, advanceTime(start, 810_000));
});

test("辩论只有行动者和被指认者能发言，自指认无效，追问可提交", () => {
  let state = answered();
  assert.equal(send(state, person(1), { type: "accuse", targetSeatId: "s1", text: "指认" }).ok, false);
  assert.equal(send(state, person(0), { type: "accuse", targetSeatId: "s1", text: "指认" }).ok, false);
  state = ok(state, person(0), { type: "accuse", targetSeatId: "s2", text: "你是AI" });
  assert.equal(send(state, person(0), { type: "respond", text: "抢答" }).ok, false);
  state = ok(state, person(1), { type: "respond", text: "我不同意" });
  state = ok(state, person(0), { type: "followup", text: "请解释一下" });
  assert.equal(state.debate!.turnIndex, 1);
  assert.equal(state.debate!.step, "accusation");
});

test("只能辩论后投票，禁止自投、空目标和改票，投票中不显示有效性", () => {
  assert.equal(send(started(), person(0), { type: "vote", targetSeatId: "s2" }).ok, false);
  assert.equal(send(answered(), person(0), { type: "vote", targetSeatId: "s2" }).ok, false);
  let state = voting();
  for (const targetSeatId of ["s1", "", "unknown", null as unknown as string]) {
    assert.equal(send(state, person(0), { type: "vote", targetSeatId }).ok, false);
  }
  state = ok(state, person(0), { type: "vote", targetSeatId: "s4" });
  assert.equal(send(state, person(0), { type: "vote", targetSeatId: "s5" }).ok, false);
  const view = project(state, { kind: "spectator" });
  assert.deepEqual(view.votes, [{ voterSeatId: "s1", targetSeatId: "s4", at: 0 }]);
  assert.equal(view.result, undefined);
});

test("普通人重复命中AI无法全歼；影子全存活时影子胜", () => {
  const state = finishWith(voting(), ["s4", "s4"]);
  assert.equal(state.result!.winner, "shadow");
  assert.deepEqual(state.result!.eliminatedSeatIds, ["s4"]);
});

test("普通人未全歼且两个影子中任意一个出局，AI胜", () => {
  const state = finishWith(voting(4), ["s3", "s5"]);
  assert.equal(state.result!.winner, "ai");
  assert.ok(state.result!.eliminatedSeatIds.includes("s3"));
  assert.ok(!state.result!.eliminatedSeatIds.includes("s4"));
});

test("被投出的普通人所投票仍有效，AI与影子票没有杀伤力", () => {
  const state = finishWith(voting(), ["s2", "s4"]);
  assert.deepEqual(state.result!.eliminatedSeatIds, ["s2", "s4"]);
  assert.equal(state.result!.validVotes.length, 2);
  assert.equal(state.result!.winner, "shadow");
});

test("只公布本人身份；观战无身份，默认池与账号标识不外泄，AI服务上下文知道全身份", () => {
  const state = started();
  const spectator = project(state, { kind: "spectator" });
  const self = project(state, { kind: "participant", participantId: "p0" });
  const stranger = project(state, { kind: "participant", participantId: "not-a-player" });
  assert.equal(spectator.self, undefined);
  assert.equal(stranger.self, undefined);
  assert.deepEqual(self.self, { seatId: "s1", role: "human" });
  assert.deepEqual(spectator.actions, []);
  assert.deepEqual(self.actions, ["answer"]);
  for (const forbidden of ["participantId", "defaults", '"role"', "controller", '"p0"']) {
    assert.ok(!JSON.stringify(spectator).includes(forbidden), forbidden);
  }
  assert.equal(aiContext(state, "s4").roles.length, 5);
  assert.equal(aiContext(state, "s4").topic?.topConsensusSummary, topic.topConsensusSummary);
  assert.throws(() => aiContext(state, "s1"), /FORBIDDEN/);
  self.seats[0].seatId = "changed";
  assert.equal(state.seats[0].seatId, "s1");
  const restored = JSON.parse(JSON.stringify(state)) as GameState;
  assert.deepEqual(project(restored, { kind: "participant", participantId: "p0" }), project(state, { kind: "participant", participantId: "p0" }));
});

test("高赞共识永不公开，最高赞回答只在第三轮开始后下发", () => {
  const firstRound = started();
  for (const viewer of [{ kind: "spectator" } as const, { kind: "participant", participantId: "p0" } as const]) {
    const json = JSON.stringify(project(firstRound, viewer));
    assert.ok(!json.includes("topConsensusSummary"));
    assert.ok(!json.includes("topAnswerExcerpt"));
    assert.ok(!json.includes(topic.topConsensusSummary));
    assert.ok(!json.includes(topic.topAnswerExcerpt));
  }
  const thirdRound = advanceTime(firstRound, 180_000);
  assert.equal(thirdRound.round, 3);
  const view = project(thirdRound, { kind: "spectator" });
  assert.equal(view.topic?.topAnswerExcerpt, topic.topAnswerExcerpt);
  assert.ok(!JSON.stringify(view).includes("topConsensusSummary"));
});
