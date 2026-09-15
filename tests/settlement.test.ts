import assert from "node:assert/strict";
import test from "node:test";
import type { Seat, Vote } from "../src/game/model.ts";
import { settle } from "../src/game/settlement.ts";

const seats: Seat[] = [
  { seatId: "s1", displayNumber: 1, role: "human", participantId: "p1" },
  { seatId: "s2", displayNumber: 2, role: "shadow", participantId: "p2" },
  { seatId: "s3", displayNumber: 3, role: "ai" },
];

test("结算函数独立忽略非法目标、自投、重复投票和非普通人票", () => {
  const votes: Vote[] = [
    { voterSeatId: "s1", targetSeatId: "missing", at: 1 },
    { voterSeatId: "s1", targetSeatId: "s1", at: 2 },
    { voterSeatId: "s1", targetSeatId: "s3", at: 3 },
    { voterSeatId: "s1", targetSeatId: "s2", at: 4 },
    { voterSeatId: "s2", targetSeatId: "s3", at: 5 },
    { voterSeatId: "unknown", targetSeatId: "s3", at: 6 },
  ];
  const result = settle(seats, votes);
  assert.deepEqual(result.validVotes, [{ voterSeatId: "s1", targetSeatId: "s3", at: 3 }]);
  assert.deepEqual(result.eliminatedSeatIds, ["s3"]);
  assert.equal(result.winner, "human");
});

test("规则v1.1：普通人未全歼AI时影子胜，包括影子全部被投出", () => {
  const allShadowsOut = settle(seats, [
    { voterSeatId: "s1", targetSeatId: "s2", at: 1 },
    { voterSeatId: "s2", targetSeatId: "s3", at: 2 },
  ]);
  assert.deepEqual(allShadowsOut.eliminatedSeatIds, ["s2"]);
  assert.equal(allShadowsOut.winner, "shadow");

  const noHumanVotes = settle(seats, [{ voterSeatId: "s2", targetSeatId: "s3", at: 3 }]);
  assert.deepEqual(noHumanVotes.eliminatedSeatIds, []);
  assert.equal(noHumanVotes.winner, "shadow");
});
