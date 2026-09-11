import { SqlitePersistence } from "../../src/repository/sqlite-persistence.ts";
import { createGame, transition } from "../../src/game/transition.ts";
import type { Actor, Command, GameState, Seat, Topic } from "../../src/game/model.ts";

const path = process.argv[2];
if (!path) throw new Error("DATABASE_PATH_REQUIRED");
const topic: Topic = {
  id: "123", title: "恢复测试", url: "https://www.zhihu.com/question/123",
  topAnswerExcerpt: "回答片段", topConsensusSummary: "共识摘要",
  defaults: { 1: ["默认一", "默认二"], 2: ["正方：默认一", "反方：默认二"], 3: ["回复一", "回复二"] },
  provenance: { packId: "recovery-test", source: "zhihu", curatedAt: "2026-09-11T00:00:00.000Z" },
};
function apply(state: GameState, actor: Actor, command: Command) {
  const result = transition(state, actor, { matchId: state.matchId, phaseToken: state.phaseToken, command }, state.lastNow);
  if (!result.ok) throw new Error(result.error);
  return result.state;
}
let state = createGame("crash-match", 0);
for (const id of ["p0", "p1"]) state = apply(state, { kind: "participant", participantId: id }, { type: "join" });
for (const id of ["p0", "p1"]) state = apply(state, { kind: "participant", participantId: id }, { type: "ready", ready: true });
const seats: Seat[] = [{ seatId: "s1", displayNumber: 1, role: "human", participantId: "p0" },
  { seatId: "s2", displayNumber: 2, role: "shadow", participantId: "p1" }, { seatId: "s3", displayNumber: 3, role: "ai" }];
state = apply(state, { kind: "system" }, { type: "resolve-topic", topic, seats });
state = apply(state, { kind: "participant", participantId: "p0" }, { type: "answer", round: 1, text: "已持久化回答" });
const persistence = new SqlitePersistence(path);
await persistence.save("crash-room", null, { version: 0, state, receipts: [],
  preparation: { candidateIndex: 0, cycles: 0, retryAt: 0 } });
// Deliberately skip close/checkpoint to exercise WAL recovery.
process.kill(process.pid, "SIGKILL");
