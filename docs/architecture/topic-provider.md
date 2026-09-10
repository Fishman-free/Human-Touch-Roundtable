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
    "topAnswerExcerpt": "经许可使用的最高赞回答片段",
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
- `VerifiedTopicProvider`：先从人工题目包取得材料，再调用`ZhihuQuestionGateway.verify`核验问题ID、标题、URL；三者完全一致才返回，并写入verifiedAt。
- `CachedTopicProvider`：可包装任意TopicProvider，按候选和TTL缓存成功结果，返回深拷贝；进程重启后缓存消失。

`ZhihuQuestionGateway`只描述项目真正需要的核验能力，不假定任何未确认HTTP路径。具体网关必须使用知乎批准的开放能力；禁止抓取网页冒充官方接口。

## 为什么仍未提供真实网关

当前GitHub仓库没有Access Secret，已知开放平台文档也未确认“按问题ID取得最高赞回答及点赞排序”的端点。热榜/搜索可以作为发现或核验来源，但最高赞回答片段和共识仍应人工审核绑定到题目包。

接入真实网关前需确认：凭据注入、可用接口及响应字段、调用额度、缓存许可、标题变化策略和原文展示授权。真实响应契约测试应使用脱敏录制夹具；带凭据在线测试不进入普通CI。
