import assert from "node:assert/strict";
import test from "node:test";
import { normalizeTopicPack, parseTopicPack } from "../src/topics/topic-pack.ts";
import { VerifiedTopicProvider } from "../src/topics/verified-topic-provider.ts";
import { CachedTopicProvider } from "../src/topics/cached-topic-provider.ts";
import { createTopicProvider } from "../src/topics/config.ts";
import { StaticTopicProvider } from "../src/topics/static-topic-provider.ts";

const pack = {
  schemaVersion: 1, packId: "test-topic", source: "zhihu", curatedAt: "2026-09-10T00:00:00.000Z",
  question: { id: "123", title: "一个测试问题", url: "https://www.zhihu.com/question/123",
    topAnswerExcerpt: "这是最高赞回答片段。", topConsensusSummary: "这是共识摘要。" },
  tags: ["测试"], defaults: {
    1: ["共识一", "共识二"],
    2: ["正方：理由一", "反方：理由二"],
    3: ["回复一", "回复二"],
  },
} as const;

test("题目包解析并规范化来源元数据", () => {
  const parsed = parseTopicPack(pack);
  const topic = normalizeTopicPack(parsed, "2026-09-11T00:00:00.000Z");
  assert.equal(topic.id, "123");
  assert.deepEqual(topic.provenance, { packId: "test-topic", source: "zhihu",
    curatedAt: "2026-09-10T00:00:00.000Z", verifiedAt: "2026-09-11T00:00:00.000Z" });
  assert.notEqual(topic.defaults, parsed.defaults);
});

test("题目包拒绝未知字段、URL不匹配、超长答案和不完整立场", () => {
  const invalid = [
    { ...pack, extra: true },
    { ...pack, question: { ...pack.question, url: "https://www.zhihu.com/question/456" } },
    { ...pack, defaults: { ...pack.defaults, 1: ["字".repeat(31), "短"] } },
    { ...pack, defaults: { ...pack.defaults, 2: ["正方：一", "正方：二"] } },
    { ...pack, curatedAt: "not-a-date" },
  ];
  for (const value of invalid) assert.throws(() => parseTopicPack(value), /INVALID_TOPIC_PACK/);
});

test("正式题目提供器只接受官方网关核验结果与片单完全一致", async () => {
  const provider = new VerifiedTopicProvider([pack], { async verify(id) {
    return { id, title: pack.question.title, url: pack.question.url };
  } }, () => new Date("2026-09-12T00:00:00.000Z"));
  assert.deepEqual(provider.candidateIds, ["test-topic"]);
  const topic = await provider.resolve("test-topic", new AbortController().signal);
  assert.equal(topic.provenance?.verifiedAt, "2026-09-12T00:00:00.000Z");

  const mismatch = new VerifiedTopicProvider([pack], { async verify(id) {
    return { id, title: "被修改的问题", url: pack.question.url };
  } });
  await assert.rejects(mismatch.resolve("test-topic", new AbortController().signal), /TOPIC_REFERENCE_MISMATCH/);
});

test("题目缓存按候选隔离、返回副本并在TTL后重新核验", async () => {
  let now = 0;
  let calls = 0;
  const source = { candidateIds: ["test-topic"], async resolve() {
    calls++;
    return normalizeTopicPack(parseTopicPack(pack), new Date(now).toISOString());
  } };
  const cached = new CachedTopicProvider(source, 100, () => now);
  const first = await cached.resolve("test-topic", new AbortController().signal);
  first.title = "被调用方修改";
  assert.equal((await cached.resolve("test-topic", new AbortController().signal)).title, pack.question.title);
  assert.equal(calls, 1);
  now = 100;
  await cached.resolve("test-topic", new AbortController().signal);
  assert.equal(calls, 2);
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(cached.resolve("test-topic", aborted.signal), /ABORTED/);
});

test("题目环境组装开发默认静态，生产默认要求真实核验网关", () => {
  assert.ok(createTopicProvider({}, true) instanceof StaticTopicProvider);
  assert.throws(() => createTopicProvider({}, false), /ZHIHU_GATEWAY_NOT_CONFIGURED/);
  assert.throws(() => createTopicProvider({ TOPIC_MODE: "static" }, false), /STATIC_TOPICS_NOT_ALLOWED_IN_PRODUCTION/);
  assert.ok(createTopicProvider({ TOPIC_MODE: "static", ALLOW_STATIC_TOPICS_IN_PRODUCTION: "true" }, false)
    instanceof StaticTopicProvider);
  assert.throws(() => createTopicProvider({ TOPIC_MODE: "unknown" }, true), /INVALID_TOPIC_MODE/);
});
