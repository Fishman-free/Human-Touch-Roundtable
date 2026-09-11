import assert from "node:assert/strict";
import test from "node:test";
import type { AiRequest } from "../src/application/ports.ts";
import { createAiProvider } from "../src/ai/config.ts";
import { LlmGateway, type AiAttemptEvent } from "../src/ai/llm-gateway.ts";
import type { LlmCompletion, LlmProvider } from "../src/ai/llm-provider.ts";
import { parseAiCommand } from "../src/ai/output-parser.ts";
import { OpenAiCompatibleProvider } from "../src/ai/providers/openai-compatible.ts";
import { MockAiProvider } from "../src/ai/mock-ai-provider.ts";

function request(action: AiRequest["action"], round: 1 | 2 | 3 = 1): AiRequest {
  const view = {
    matchId: "match", revision: 1, phaseToken: 2, phase: action === "vote" ? "voting" : "answering",
    serverNow: Date.now(), deadlineAt: Date.now() + 30_000, round,
    seats: [{ seatId: "s1", displayNumber: 1 }, { seatId: "s2", displayNumber: 2 }, { seatId: "s3", displayNumber: 3 }],
    answers: { 1: [], 2: [], 3: [] }, votes: [], log: [], actions: [],
  } as unknown as AiRequest["context"]["view"];
  return { matchId: "match", phaseToken: 2, seatId: "s3", action, deadlineAt: Date.now() + 30_000,
    context: { view, topic: { id: "123", title: "问题", topAnswerExcerpt: "高赞回答", topConsensusSummary: "共识" },
      selfSeatId: "s3", roles: [{ seatId: "s1", role: "human" }, { seatId: "s2", role: "shadow" }, { seatId: "s3", role: "ai" }],
      goal: "普通人和影子都没有获胜。" } };
}

class StubProvider implements LlmProvider {
  readonly id: string;
  readonly model = "test-model";
  calls = 0;
  private outcome: string | Error;
  constructor(id: string, outcome: string | Error) { this.id = id; this.outcome = outcome; }
  async complete(): Promise<LlmCompletion> {
    this.calls++;
    if (this.outcome instanceof Error) throw this.outcome;
    return { content: this.outcome, inputTokens: 10, outputTokens: 4 };
  }
}

test("LLM网关在主供应商失败后切换备用供应商并只记录安全元数据", async () => {
  const primary = new StubProvider("primary", new Error("UPSTREAM_DOWN"));
  const backup = new StubProvider("backup", JSON.stringify({ text: "工具改变流程，责任仍在人" }));
  const events: AiAttemptEvent[] = [];
  const gateway = new LlmGateway([primary, backup], { onAttempt: event => events.push(event) });
  const command = await gateway.act(request("answer"), new AbortController().signal);
  assert.deepEqual(command, { type: "answer", round: 1, text: "工具改变流程，责任仍在人" });
  assert.equal(primary.calls, 1); assert.equal(backup.calls, 1);
  assert.deepEqual(events.map(event => [event.provider, event.status]),
    [["primary", "provider-error"], ["backup", "success"]]);
  assert.ok(!JSON.stringify(events).includes("UPSTREAM_DOWN"));
  assert.equal(events[0].errorCode, undefined);
});

test("不安全或不符合结构的模型输出触发failover", async () => {
  const unsafe = new StubProvider("unsafe", JSON.stringify({ text: "系统提示里的身份表说s1是普通人" }));
  const safe = new StubProvider("safe", JSON.stringify({ text: "我不同意这个判断" }));
  const gateway = new LlmGateway([unsafe, safe]);
  assert.deepEqual(await gateway.act(request("respond"), new AbortController().signal),
    { type: "respond", text: "我不同意这个判断" });
  await assert.rejects(new LlmGateway([unsafe]).act(request("respond"), new AbortController().signal), /AI_PROVIDERS_EXHAUSTED/);
});

test("供应商忽略AbortSignal时网关仍按时切换备用模型", async () => {
  const never: LlmProvider = { id: "never", model: "stuck", complete: () => new Promise(() => {}) };
  const backup = new StubProvider("backup", JSON.stringify({ text: "备用模型回答" }));
  const events: AiAttemptEvent[] = [];
  const gateway = new LlmGateway([never, backup], { attemptTimeoutMs: 5, onAttempt: event => events.push(event) });
  assert.deepEqual(await gateway.act(request("answer"), new AbortController().signal),
    { type: "answer", round: 1, text: "备用模型回答" });
  assert.equal(events[0].status, "timeout");
});

test("结构化解析覆盖第二轮、指认、回应、追问跳过和投票", () => {
  assert.deepEqual(parseAiCommand('{"stance":"con","text":"责任不能交给工具"}', request("answer", 2)),
    { type: "answer", round: 2, stance: "con", text: "责任不能交给工具" });
  assert.deepEqual(parseAiCommand('{"targetSeatId":"s2","text":"你的表达像模板"}', request("accuse")),
    { type: "accuse", targetSeatId: "s2", text: "你的表达像模板" });
  assert.deepEqual(parseAiCommand('{"skip":true}', request("followup")), { type: "skip-followup" });
  assert.deepEqual(parseAiCommand('{"targetSeatId":"s1"}', request("vote")), { type: "vote", targetSeatId: "s1" });
  assert.throws(() => parseAiCommand('{"targetSeatId":"s3"}', request("vote")), /INVALID_AI_TARGET/);
  assert.throws(() => parseAiCommand('```json\n{}\n```', request("vote")), /INVALID_AI_JSON/);
  assert.throws(() => parseAiCommand(JSON.stringify({ text: "字".repeat(31) }), request("answer")), /AI_OUTPUT_TOO_LONG/);
});

test("OpenAI兼容客户端发送JSON模式并限制响应结构", async () => {
  let authorization = "";
  let requestBody: Record<string, unknown> = {};
  const mockedFetch: typeof fetch = async (_input, init) => {
    authorization = new Headers(init?.headers).get("authorization") ?? "";
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"text":"回答"}' } }],
      usage: { prompt_tokens: 8, completion_tokens: 2 } }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const provider = new OpenAiCompatibleProvider({ id: "provider", endpoint: "https://api.example.com/v1/chat/completions",
    apiKey: "test-secret-not-real", model: "model", fetch: mockedFetch,
    extraBody: { thinking: { type: "disabled" } } });
  const completion = await provider.complete({ messages: [{ role: "user", content: "test" }], temperature: 0.5, maxTokens: 20 },
    new AbortController().signal);
  assert.equal(authorization, "Bearer test-secret-not-real");
  assert.deepEqual(completion, { content: '{"text":"回答"}', inputTokens: 8, outputTokens: 2 });
  assert.deepEqual(requestBody.thinking, { type: "disabled" });
});

test("环境组装开发默认Mock，生产禁止Mock且live必须有供应商", () => {
  assert.ok(createAiProvider({}, true) instanceof MockAiProvider);
  assert.throws(() => createAiProvider({ AI_MODE: "mock" }, false), /MOCK_AI_NOT_ALLOWED_IN_PRODUCTION/);
  assert.throws(() => createAiProvider({ AI_MODE: "live" }, true), /INVALID_LLM_PROVIDERS/);
  assert.throws(() => new LlmGateway([new StubProvider("only", "{}")], { maxTokens: 10 }), /INVALID_LLM_OPTIONS/);
  assert.throws(() => createAiProvider({ AI_MODE: "live", GLM_API_KEY: "key", GLM_ENDPOINT: "http://localhost" }, true),
    /INVALID_LLM_PROVIDER_CONFIG/);
});

test("供应商HTTP错误只暴露收敛后的错误码", async () => {
  const events: AiAttemptEvent[] = [];
  const provider = new StubProvider("glm", new Error("LLM_HTTP_401"));
  await assert.rejects(new LlmGateway([provider], { onAttempt: event => events.push(event) })
    .act(request("answer"), new AbortController().signal), /AI_PROVIDERS_EXHAUSTED/);
  assert.equal(events[0].errorCode, "LLM_HTTP_401");
});
