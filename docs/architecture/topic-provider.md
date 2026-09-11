# 题目包与知乎接入边界

## TopicPack v1

外部策划数据先按`TopicPackV1`解析，再规范化为游戏核心使用的`Topic`。字段事实来源为`src/topics/topic-pack.ts`。

```json
{
  "schemaVersion": 1,
  "packId": "zhihu-2026-09-13-001",
  "source": "zhihu",
  "curatedAt": "2026-09-10T00:00:00.000Z",
  "question": {
    "id": "123456",
    "title": "知乎问题标题",
    "url": "https://www.zhihu.com/question/123456",
    "topAnswerExcerpt": "人工审核的高赞回答备用片段；生产核验后替换",
    "topConsensusSummary": "人工审核的高赞共识摘要"
  },
  "tags": ["AI"],
  "defaults": {
    "1": ["第一条不超过30字", "第二条不超过30字"],
    "2": ["正方：至少一条", "反方：至少一条"],
    "3": ["第一条不超过40字", "第二条不超过40字"]
  }
}
```

解析器拒绝未知顶级/问题字段、非知乎问题URL、URL与问题ID不一致、重复/超量标签、无效时间、默认池不足、超长内容及第二轮立场不全。`provenance`随规范化Topic进入私有房间记录，但不下发浏览器。

旧版本房间可能没有provenance，恢复校验为已有本地数据保留兼容；所有新开局都由核心强制要求provenance。

## 提供器

- `StaticTopicProvider`：开发替身，数据经过TopicPack解析，但不调用知乎，不能在产品说明中称为实时接口。
- `ZhihuContentClient`：调用官方`hot_list`和`zhihu_search`，校验HTTP/业务响应并限制响应体；热榜用于发现候选，当前开局仍以人工片单顺序为准。
- `ZhihuSearchQuestionGateway`：优先用标题中的最长引语搜索，完整标题回退；只接受标题规范化一致、回答URL问题ID精确一致的结果，并按`VoteUpCount`、`RankingScore`选取。
- `VerifiedTopicProvider`：把核验结果绑定到人工题目包，写入verifiedAt、选中回答URL及赞同数，并用接口回答片段替换题目包备用片段。
- `CachedTopicProvider`：可包装任意TopicProvider，按候选和TTL缓存成功结果，返回深拷贝；进程重启后缓存消失。

当前使用官方接口：`GET /api/v1/content/hot_list`与`GET /api/v1/content/zhihu_search`，均使用Bearer Access Secret和秒级`X-Request-Timestamp`。禁止抓取网页冒充官方接口。

`createTopicProvider`负责环境门禁：开发默认static；生产默认verified并要求`ZHIHU_ACCESS_SECRET`。成功结果默认缓存6小时，可用`ZHIHU_TOPIC_CACHE_MS`调整。static只有同时设置`ALLOW_STATIC_TOPICS_IN_PRODUCTION=true`才可用于基础设施冒烟，不能用于公开游戏。

## 排序与覆盖限制

搜索接口单次最多返回10条、`HasMore=false`，没有按赞同数排序参数。因此本局选择的是“本次搜索结果中，同问题回答的最高赞项”，不能宣称是全站绝对最高赞。题目包的共识、默认答案和内容适宜性仍需人工审核。

2026-09-11已用真实Access Secret完成热榜、搜索和生产提供器单次核验；凭据未写入仓库。普通CI使用脱敏最小响应夹具，不发起在线请求。后续仍需验证长期额度、缓存许可、标题变化、内容授权和更多题目包。

手动在线核验使用：

```sh
ZHIHU_ACCESS_SECRET="通过安全环境注入" npm run verify:zhihu
```

脚本只输出packId、问题ID、选中回答URL、赞同数、片段长度和核验时间，不输出凭据或完整回答。
