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
- `ZhihuContentClient`：调用官方`hot_list`、`zhihu_search`、`question_answers`和`question_recommendations`，校验HTTP/业务响应并限制响应体；热榜用于发现候选，人工片单固定候选集合及其顺序，每个新房间从中随机抽取一个起始候选。
- `ZhihuSearchQuestionGateway`：优先用标题中的最长引语搜索，完整标题回退；只接受标题规范化一致、回答URL问题ID精确一致的结果，并按`VoteUpCount`、`RankingScore`选取。
- `VerifiedTopicProvider`：把核验结果绑定到人工题目包，写入verifiedAt、选中回答URL及赞同数，并用接口回答片段替换题目包备用片段。
- `CachedTopicProvider`：可包装任意TopicProvider，按候选和TTL缓存成功结果，返回深拷贝；进程重启后缓存消失。
- `PersistentTopicCache`：设置`ZHIHU_TOPIC_CACHE_PATH`时替代上者（生产compose默认写入数据卷），把成功结果连同核验时间、TTL和失败分类落盘，容器重建后仍然有效；失败记录不粘滞，下次仍会重试。
- `RecommendedTopicProvider`：`TOPIC_MODE=recommended`时新增，候选来自平台问题推荐，回答摘要来自`question_answers`；`topConsensusSummary`与`defaults`由模型生成，失败时退回确定性文案。候选列表是实时视图，可被刷新器追加和淘汰。
- `RecommendedRefresher`：`TOPIC_MODE=recommended`时随服务器启动，按`ZHIHU_TOPIC_REFRESH_MS`周期拉新候选、追加未见的、淘汰最旧的、刷新启动快照并预热新题；不重排已有候选，失败时不动候选池。
- `UnionTopicProvider`：把人工片单和动态候选合并成单一候选列表，人工题固定在前，保证已持久化的`candidateIndex`在模式切换后仍指向同一道题。候选列表从各提供器实时读取，不做事先快照。

当前使用官方接口：`GET /api/v1/content/hot_list`、`GET /api/v1/content/zhihu_search`、`GET /api/v1/content/question_answers`与`GET /api/v1/user/question_recommendations`，均使用Bearer Access Secret和秒级`X-Request-Timestamp`。禁止抓取网页冒充官方接口。

`createTopicProvider`负责环境门禁：开发默认static；生产默认verified并要求`ZHIHU_ACCESS_SECRET`。成功结果默认缓存7天，可用`ZHIHU_TOPIC_CACHE_MS`调整；设置`ZHIHU_TOPIC_CACHE_PATH`时使用持久化缓存，未设置则退回进程内缓存并在进程重启后消失；同候选并发请求会合并。static只有同时设置`ALLOW_STATIC_TOPICS_IN_PRODUCTION=true`才可用于基础设施冒烟，不能用于公开游戏。`recommended`在`verified`之上叠加动态候选；回滚只需把它改回`verified`并重建容器，不需要重新构建镜像。`openTopicSystem`是供服务器使用的入口，在`openTopicProvider`之上额外返回`close()`以停止刷新循环；`scripts/`下的预热与核验脚本仍用只返回提供器的`openTopicProvider`。

## 排序与覆盖限制

搜索接口单次最多返回10条、`HasMore=false`，没有按赞同数排序参数。因此本局选择的是“本次搜索结果中，同问题回答的最高赞项”，不能宣称是全站绝对最高赞。人工题目包的共识、默认答案和内容适宜性仍需人工审核；**动态题目的共识与默认答案是模型生成、未经人工审核的**，只有问题标题和回答摘要来自平台真实数据。这一缺口尚未闭合，见[内容安全](content-safety.md)。

2026-09-11已用真实Access Secret完成热榜、搜索和生产提供器核验；凭据未写入仓库。普通CI使用脱敏最小响应夹具，不发起在线请求。

2026-09-14复核额度：官方额度表与`GET /api/v1/quota`（该查询本身不消耗业务额度）显示知乎搜索5000/日、热榜100/日，问题推荐（记`creator`额度）与问题回答摘要（`question_answers`）各100/日，未实名等低额度账号为10/日。**仓库此前记录的「搜索额度10次/日」与此不符，已按实测订正。**频率、并发限制和日额度耗尽统一返回`30001`。

开局随机抽取候选后，核验成本按「候选数」而不是「局数」计：9个生产候选全部被抽到时是9次核验，与打多少局无关。持久化缓存把这份成本摊到整个TTL周期内，否则随机化会按局放大搜索调用并可能撞上每日额度。首次部署或清空缓存后，可在低峰期用`npm run verify:zhihu -- --all`一次性预热；预热进程必须与运行环境设置同一个`ZHIHU_TOPIC_CACHE_PATH`，且该路径对两者都可写。动态候选另需`npm run warm:topics`预热（同样要求缓存路径一致）；该脚本在没有可用模型时会直接拒绝运行，避免把兜底文案当成正式内容写进缓存。

目录当前有11个正式候选，其中9个已成功在线核验并进入`productionTopicPacks`，其余2个只在开发静态题库中可见，不能进入生产轮换。另有2个旧开发题，不属于正式候选。`TOPIC_MODE=recommended`时，候选池在此基础上再并入动态推荐题目。

## 动态推荐题目

`TOPIC_MODE=recommended`在人工片单之外并入平台推荐的问题，候选池不再受人工片单数量限制。

- **候选来源**：`GET /api/v1/user/question_recommendations`，按`ZHIHU_TOPIC_CANDIDATE_QUERY`（默认「生活方式」）取`ZHIHU_TOPIC_CANDIDATE_COUNT`条（上限20）。
- **候选快照**：启动时先读`ZHIHU_TOPIC_CANDIDATE_PATH`；快照在`ZHIHU_TOPIC_CANDIDATE_TTL_MS`内就直接使用，完全不联网。否则在`ZHIHU_TOPIC_CANDIDATE_TIMEOUT_MS`内拉取并写回快照。拉取失败则退回过期快照；连快照都没有时动态候选为空，候选池退化为与`verified`完全相同——**启动路径不会因为网络或额度失败而不可用**。
- **单题解析**：用`question_answers`取一页回答（每页消耗一次`question_answers`额度），标题和回答摘要都必须通过内容策略检查；任一不通过就让该候选失败，不做事后替换。接口不返回赞同数，因此不写`selectedVoteUpCount`，也不宣称选中的是最高赞回答。
- **生成字段**：`topConsensusSummary`与`defaults`由模型按`roundtable-topic-v1`提示词生成，并强制经过本地规范化与长度校验（与核心`validateTopic`同一套规则）；不通过则回落到确定性文案。`ZHIHU_TOPIC_FALLBACK=fail`可改为直接让该候选失败。
- **来源标识**：动态题的`provenance.packId`形如`zhihu-q<问题ID>`，与人工片单的`zhihu-2026-09-…`可直接区分。
- **额度**：一份候选快照消耗一次`creator`额度，一道冷启动动态题消耗一次`question_answers`额度，之后由持久化缓存摊到整个TTL周期内。

### 题库滚动

`ZHIHU_TOPIC_REFRESH_MS`不为0时（生产默认一天），应用每隔该时长执行一轮刷新，让候选池持续变化，而不是只在启动那一刻固定下来。每轮按**先拉取、再追加、后淘汰、最后落盘与预热**的顺序做四件事：

1. **拉取**：调`question_recommendations`取一批（数量同`ZHIHU_TOPIC_CANDIDATE_COUNT`），沿用启动时的同一套内容策略过滤。主题按`ZHIHU_TOPIC_CANDIDATE_QUERIES`（逗号分隔）**每轮轮换一个**——平台对同一主题的推荐列表是稳定的，固定用「生活方式」问下去很可能每天返回同一批候选，追加恒为0，滚动就名存实亡。留空则退化为只用`ZHIHU_TOPIC_CANDIDATE_QUERY`。
2. **追加**：只追加池子里还没有的`zhihu-q<问题ID>`。已有候选保持原有下标，因此在跑的房间即便已经持久化了`candidateIndex`，仍然指向同一道题。
3. **淘汰**：池子超过`ZHIHU_TOPIC_CANDIDATE_MAX`（默认60）时，从**最旧的动态题**开始丢弃，直到回到上限。人工片单不在被淘汰之列。淘汰是唯一会移动下标的操作，移动的是所有存活于被丢弃项之后的候选；若某个房间恰好在「建房→出题」这个几秒的窗口内跨越了淘汰，它会改判到另一道**同样合法**的题目，而不是卡死。这是一天一次、窗口几秒的取舍，未额外加锁。
4. **落盘与预热**：把当前池子写回`ZHIHU_TOPIC_CANDIDATE_PATH`并刷新`fetchedAt`，再串行预热本轮新增的候选（每道消耗一次`question_answers`额度与一次模型调用），使第一个抽到它的房间不必付冷启动延迟。预热必须走完整提供器栈，否则生成的题目不会进入房间实际读取的持久化缓存。`ZHIHU_TOPIC_REFRESH_WARM=false`可关闭预热，只保留换题。

刷新失败（网络、额度、模型）只记录`topic.refresh.failed`并保留原候选池，**不影响正在进行的对局**；连续失败会让下一轮的间隔按倍数退避，上限8倍，成功一次即恢复，因此不需要重启。运维事件：`topic.refresh.ok`、`topic.refresh.empty`、`topic.refresh.failed`、`topic.refresh.warm_failed`。

`ZHIHU_TOPIC_REFRESH_MS=0`完全不启动刷新循环，是这条特性的免重建回滚开关；关闭后候选池行为与滚动引入前完全一致。

滚动的效果是**候选池**在换，不是「每局换一批」：单局抽到的题仍由`candidateIndex`和持久化缓存固定，重启或重连不会换题。因此有了滚动之后，`npm run warm:topics`只需在首次上线或清空缓存后跑一次，日常由刷新器接管。

手动在线核验使用：

```sh
ZHIHU_ACCESS_SECRET="通过安全环境注入" npm run verify:zhihu
ZHIHU_ACCESS_SECRET="通过安全环境注入" npm run verify:zhihu -- --all
ZHIHU_ACCESS_SECRET="通过安全环境注入" npm run verify:zhihu -- --candidates
ZHIHU_ACCESS_SECRET="通过安全环境注入" npm run verify:zhihu -- --pending
ZHIHU_ACCESS_SECRET="通过安全环境注入" npm run verify:zhihu -- --candidate <pack-id>
ZHIHU_ACCESS_SECRET="通过安全环境注入" npm run zhihu:hot
```

`--all`验证已进入生产的题；`--candidates`验证全部候选；`--pending`仅验证尚未进入生产的候选；`--candidate`按ID验证单个候选。脚本只输出状态、packId、问题ID、选中回答URL、赞同数、片段长度和核验时间，不输出凭据或完整回答。热榜工具只输出问题元数据和截断摘要。

HTTP客户端将请求串行化，默认最短间隔1秒，可用`ZHIHU_MIN_REQUEST_INTERVAL_MS`调大；业务码`30001`记录为额度耗尽并由运维退避。设置`ZHIHU_TOPIC_CACHE_PATH`可启用带TTL、版本、来源和失败分类的持久化缓存；当前仍是单实例文件缓存，不提供跨进程锁或集中告警。
