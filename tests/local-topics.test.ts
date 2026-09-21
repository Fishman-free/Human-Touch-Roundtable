import assert from "node:assert/strict";
import test from "node:test";
import { createTopicProvider } from "../src/topics/config.ts";
import { createGame, transition, advanceTime } from "../src/game/transition.ts";
import { assignSeats } from "../src/application/seat-assignment.ts";
import { validateRoomRecord } from "../src/repository/validate-room-record.ts";
import { project } from "../src/game/projection.ts";

test("无平台凭据的生产原创题库通过开局、超时终局和存档校验", async () => {
  const provider = createTopicProvider({}, false);
  assert(provider.candidateIds.length >= 6);
  for (const id of provider.candidateIds) {
    let state = createGame(id, 0);
    for (const participantId of ["p1", "p2"]) {
      state = transition(state, { kind: "participant", participantId }, { matchId: id, phaseToken: state.phaseToken, command: { type: "join" } }, 0).state;
    }
    for (const participantId of ["p1", "p2"]) {
      state = transition(state, { kind: "participant", participantId }, { matchId: id, phaseToken: state.phaseToken, command: { type: "ready", ready: true } }, 0).state;
    }
    const topic = await provider.resolve(id, new AbortController().signal);
    const result = transition(state, { kind: "system" }, { matchId: id, phaseToken: state.phaseToken,
      command: { type: "resolve-topic", topic, seats: assignSeats(["p1", "p2"], { integer: max => max - 1 }) } }, 0);
    assert(result.ok, result.ok ? "" : result.error);
    state = advanceTime(result.state, 1_000_000);
    assert.equal(state.phase, "revealed");
    const saved = { version: 1, state, receipts: [], preparation: { candidateIndex: 0, cycles: 0, retryAt: 0 } };
    const serialized = JSON.parse(JSON.stringify(saved));
    assert.deepEqual(validateRoomRecord(serialized, 1), serialized);
    assert.equal(project(state, { kind: "spectator" }).topic?.source, "original");
    assert.equal(topic.url, "");
  }
});
