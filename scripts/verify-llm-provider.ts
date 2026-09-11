import type { AiAction, AiRequest } from "../src/application/ports.ts";
import { createAiProvider } from "../src/ai/config.ts";
import type { AiAttemptEvent } from "../src/ai/llm-gateway.ts";

type Check = { action: AiAction; round?: 1 | 2 | 3 };
const checks: Check[] = [
  { action: "answer", round: 1 }, { action: "answer", round: 2 }, { action: "answer", round: 3 },
  { action: "accuse" }, { action: "respond" }, { action: "followup" }, { action: "vote" },
];
const requested = process.argv.includes("--all") ? checks : [checks.find(check => check.action ===
  (process.argv[process.argv.indexOf("--action") + 1] ?? "answer")) ?? checks[0]];
const events: AiAttemptEvent[] = [];
const provider = createAiProvider({ ...process.env, AI_MODE: "live" }, false, event => events.push(event));

function request(check: Check): AiRequest {
  const now = Date.now();
  const phase = check.action === "vote" ? "voting" : check.action === "answer" ? "answering" : "debating";
  const round = check.round ?? 3;
  const view = {
    matchId: "live-validation", revision: 1, phaseToken: 2, phase, serverNow: now,
    deadlineAt: now + 30_000, round, lobby: undefined, self: undefined,
    seats: [{ seatId: "s1", displayNumber: 1 }, { seatId: "s2", displayNumber: 2 }, { seatId: "s3", displayNumber: 3 }],
    topic: { id: "2071256746484392995", title: "做饭是否存在万能调味公式？",
      url: "https://www.zhihu.com/question/2071256746484392995", topAnswerExcerpt: "固定比例可供新手参考，但需要结合食材调整。" },
    answers: { 1: [{ seatId: "s1", text: "模板能保底，不能代替判断。", at: now }],
      2: [{ seatId: "s2", text: "反方：食材不同，固定比例会串味。", at: now }],
      3: [] },
    debate: phase === "debating" ? { turnIndex: 0, step: check.action === "respond" ? "response" : "accusation",
      accuserSeatId: "s3", targetSeatId: check.action === "respond" ? "s3" : "s2", globalDeadlineAt: now + 30_000 } : undefined,
    votes: [], log: [], result: undefined, actions: [],
  } as AiRequest["context"]["view"];
  return { matchId: view.matchId, phaseToken: view.phaseToken, seatId: "s3", action: check.action,
    deadlineAt: view.deadlineAt!, context: { view, selfSeatId: "s3",
      roles: [{ seatId: "s1", role: "human" }, { seatId: "s2", role: "shadow" }, { seatId: "s3", role: "ai" }],
      topic: { id: view.topic!.id, title: view.topic!.title, topAnswerExcerpt: view.topic!.topAnswerExcerpt!,
        topConsensusSummary: "固定比例只是模板，实际调味需要判断。" }, goal: "普通人和影子都没有获胜。" } };
}

for (const check of requested) {
  const start = events.length;
  try {
    const command = await provider.act(request(check), new AbortController().signal);
    const attempts = events.slice(start);
    process.stdout.write(`${JSON.stringify({ action: check.action, round: check.round, status: "valid",
      commandType: command.type, attempts: attempts.map(({ provider, model, status, latencyMs, inputTokens, outputTokens, errorCode }) =>
        ({ provider, model, status, latencyMs, inputTokens, outputTokens, errorCode })) })}\n`);
  } catch (error) {
    const attempts = events.slice(start);
    process.stdout.write(`${JSON.stringify({ action: check.action, round: check.round, status: "failed",
      reason: error instanceof Error ? error.message : "UNKNOWN",
      attempts: attempts.map(({ provider, model, status, latencyMs, errorCode }) =>
        ({ provider, model, status, latencyMs, errorCode })) })}\n`);
    process.exitCode = 1;
  }
}
