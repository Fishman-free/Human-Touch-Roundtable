import assert from "node:assert/strict";
import test from "node:test";
import { normalizeTopicPack, parseTopicPack } from "../src/topics/topic-pack.ts";
import { VerifiedTopicProvider } from "../src/topics/verified-topic-provider.ts";
import { CachedTopicProvider } from "../src/topics/cached-topic-provider.ts";
import { createTopicProvider } from "../src/topics/config.ts";
import { candidateTopicPacks, productionTopicPacks, StaticTopicProvider } from "../src/topics/static-topic-provider.ts";
import { ZhihuContentClient, questionIdFromUrl } from "../src/topics/zhihu-content-client.ts";
import { ZhihuSearchQuestionGateway } from "../src/topics/zhihu-search-gateway.ts";

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
  const provider = new VerifiedTopicProvider([pack], { async verify(question) {
    return { ...question, topAnswerExcerpt: "接口返回的高赞回答", selectedAnswerUrl: `${question.url}/answer/9`,
      selectedVoteUpCount: 88, comments: ["精选评论"] };
  } }, () => new Date("2026-09-12T00:00:00.000Z"));
  assert.deepEqual(provider.candidateIds, ["test-topic"]);
  const topic = await provider.resolve("test-topic", new AbortController().signal);
  assert.equal(topic.provenance?.verifiedAt, "2026-09-12T00:00:00.000Z");
  assert.equal(topic.provenance?.selectedVoteUpCount, 88);
  assert.equal(topic.topAnswerExcerpt, "接口返回的高赞回答");

  const mismatch = new VerifiedTopicProvider([pack], { async verify(question) {
    return { ...question, title: "被修改的问题", topAnswerExcerpt: "回答", selectedAnswerUrl: `${question.url}/answer/9`,
      selectedVoteUpCount: 1, comments: [] };
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
  assert.equal(candidateTopicPacks.length, 11);
  assert.equal(productionTopicPacks.length, 9);
  assert.ok(productionTopicPacks.every(pack => candidateTopicPacks.includes(pack)));
  assert.ok(createTopicProvider({}, true) instanceof StaticTopicProvider);
  assert.throws(() => createTopicProvider({}, false), /ZHIHU_ACCESS_SECRET_REQUIRED/);
  assert.throws(() => createTopicProvider({ TOPIC_MODE: "static" }, false), /STATIC_TOPICS_NOT_ALLOWED_IN_PRODUCTION/);
  assert.ok(createTopicProvider({ TOPIC_MODE: "static", ALLOW_STATIC_TOPICS_IN_PRODUCTION: "true" }, false)
    instanceof StaticTopicProvider);
  assert.ok(createTopicProvider({ ZHIHU_ACCESS_SECRET: "test-only-secret" }, false) instanceof CachedTopicProvider);
  assert.throws(() => createTopicProvider({ TOPIC_MODE: "unknown" }, true), /INVALID_TOPIC_MODE/);
});

function response(data: unknown) {
  return new Response(JSON.stringify({ Code: 0, Message: "success", Data: data }), {
    status: 200, headers: { "content-type": "application/json" },
  });
}

test("知乎HTTP客户端使用官方字段解析热榜和搜索，并兼容缺失精选评论", async () => {
  const calls: URL[] = [];
  const client = new ZhihuContentClient({ accessSecret: "test-only-secret", minRequestIntervalMs: 0, fetch: async input => {
    const url = new URL(String(input)); calls.push(url);
    if (url.pathname.endsWith("hot_list")) return response({ Total: 1, Items: [
      { Title: "问题", Url: "https://www.zhihu.com/question/123", Summary: "摘要", ThumbnailUrl: "" },
    ] });
    return response({ HasMore: false, SearchHashId: "hash", Items: [
      { Title: "问题 - 知乎", ContentType: "Answer", ContentID: "9", ContentText: "回答内容",
        Url: "https://www.zhihu.com/question/123/answer/9?utm_source=test", VoteUpCount: 12,
        CommentCount: 0, AuthorityLevel: "4", RankingScore: 1.2 },
    ] });
  } });
  assert.equal((await client.hot(1, new AbortController().signal))[0].title, "问题");
  const found = await client.search("问题", 10, new AbortController().signal);
  assert.equal(found[0].voteUpCount, 12);
  assert.deepEqual(found[0].comments, []);
  assert.equal(calls[0].origin, "https://developer.zhihu.com");
  assert.equal(calls[1].searchParams.get("Query"), "问题");
});

test("搜索核验只选同问题回答，并按赞同数后排序分数确定片段", async () => {
  const client = new ZhihuContentClient({ accessSecret: "test-only-secret", minRequestIntervalMs: 0, fetch: async () => response({
    HasMore: false, SearchHashId: "hash", Items: [
      { Title: "一个测试问题 - 知乎", ContentType: "Answer", ContentID: "1", ContentText: "低赞回答",
        Url: "https://www.zhihu.com/question/123/answer/1", VoteUpCount: 10, CommentCount: 0,
        CommentInfoList: [], AuthorityLevel: "4", RankingScore: 2 },
      { Title: "一个测试问题 - 知乎", ContentType: "Answer", ContentID: "2", ContentText: "高赞回答".repeat(80),
        Url: "https://www.zhihu.com/question/123/answer/2?utm_source=test", VoteUpCount: 99, CommentCount: 1,
        CommentInfoList: [{ Content: "精选评论" }], AuthorityLevel: "4", RankingScore: 1 },
      { Title: "其他问题 - 知乎", ContentType: "Answer", ContentID: "3", ContentText: "无关高赞",
        Url: "https://www.zhihu.com/question/456/answer/3", VoteUpCount: 999, CommentCount: 0,
        CommentInfoList: [], AuthorityLevel: "4", RankingScore: 9 },
    ],
  }) });
  const verified = await new ZhihuSearchQuestionGateway(client).verify(pack.question, new AbortController().signal);
  assert.equal(verified.selectedVoteUpCount, 99);
  assert.match(verified.selectedAnswerUrl, /\/answer\/2/);
  assert.ok(verified.topAnswerExcerpt.endsWith("…"));
  assert.ok(verified.topAnswerExcerpt.length <= 200);
  assert.deepEqual(verified.comments, ["精选评论"]);
});

test("搜索核验优先使用标题引语，并容忍标题标点差异", async () => {
  const queries: string[] = [];
  const client = new ZhihuContentClient({ accessSecret: "test-only-secret", minRequestIntervalMs: 0, fetch: async input => {
    const query = new URL(String(input)).searchParams.get("Query")!; queries.push(query);
    return response({ HasMore: false, SearchHashId: "hash", Items: [{
      Title: "为什么教程都用“两勺生抽一勺老抽”? - 知乎", ContentType: "Answer", ContentID: "1",
      ContentText: "回答", Url: "https://www.zhihu.com/question/123/answer/1", VoteUpCount: 1,
      CommentCount: 0, CommentInfoList: [], AuthorityLevel: "4", RankingScore: 1,
    }] });
  } });
  const question = { id: "123", title: "为什么教程都用「两勺生抽一勺老抽」？", url: "https://www.zhihu.com/question/123" };
  await new ZhihuSearchQuestionGateway(client).verify(question, new AbortController().signal);
  assert.deepEqual(queries, ["两勺生抽一勺老抽"]);
});

test("无引语问题先使用去问句框架的关键词查询", async () => {
  const queries: string[] = [];
  const client = new ZhihuContentClient({ accessSecret: "test-only-secret", minRequestIntervalMs: 0, fetch: async input => {
    queries.push(new URL(String(input)).searchParams.get("Query")!);
    return response({ HasMore: false, SearchHashId: "hash", Items: [{ Title: "不上班为什么也很疲惫？ - 知乎",
      ContentType: "Answer", ContentID: "1", ContentText: "回答", Url: "https://www.zhihu.com/question/123/answer/1",
      VoteUpCount: 1, CommentCount: 0, CommentInfoList: [], AuthorityLevel: "4", RankingScore: 1 }] });
  } });
  await new ZhihuSearchQuestionGateway(client).verify({ id: "123", title: "不上班为什么也很疲惫？",
    url: "https://www.zhihu.com/question/123" }, new AbortController().signal);
  assert.deepEqual(queries, ["不上班 也很疲惫"]);
});

test("知乎URL关联只接受官方问题及回答路径", () => {
  assert.equal(questionIdFromUrl("https://www.zhihu.com/question/123/answer/9?utm_source=test"), "123");
  assert.equal(questionIdFromUrl("https://www.zhihu.com/question/123"), "123");
  assert.equal(questionIdFromUrl("https://evil.example/question/123/answer/9"), null);
  assert.equal(questionIdFromUrl("not-a-url"), null);
});

test("题目缓存合并同候选并发请求并返回独立副本", async () => {
  let calls = 0;
  let release!: (topic: ReturnType<typeof normalizeTopicPack>) => void;
  const source = { candidateIds: ["test-topic"], resolve: () => {
    calls++;
    return new Promise<ReturnType<typeof normalizeTopicPack>>(resolve => { release = resolve; });
  } };
  const cached = new CachedTopicProvider(source, 100);
  const first = cached.resolve("test-topic", new AbortController().signal);
  const second = cached.resolve("test-topic", new AbortController().signal);
  release(normalizeTopicPack(parseTopicPack(pack)));
  const [left, right] = await Promise.all([first, second]);
  assert.equal(calls, 1);
  left.title = "changed";
  assert.equal(right.title, pack.question.title);
});
