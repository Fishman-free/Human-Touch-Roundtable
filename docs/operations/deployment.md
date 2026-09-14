# 单实例生产基础设施部署

> Docker构建、Compose解析和本地production mode冒烟已通过CI；知乎和GLM有单次外部验证。没有经过真实Caddy/CDN/公网容量验收。

## 架构

```text
Internet → Caddy :443 → app :3000 → SQLite persistent volume
```

当前房间内存计时和限流均为单进程模型，只部署一个app副本。SQLite CAS能防止误开的第二写者覆盖状态，但不能提供分布式房间调度。

## 必要配置

1. DNS将`DOMAIN`指向服务器。
2. 生成至少32字节随机`SESSION_HMAC_KEY`和`ADMIN_TOKEN`。需要暴露指标时再配置至少24字节`METRICS_TOKEN`；省略后`/api/metrics`不启用。
3. 配置DeepSeek或GLM至少一个API Key；生产禁止Mock AI。
4. 配置知乎开放平台`ZHIHU_ACCESS_SECRET`；默认`TOPIC_MODE=verified`会在凭据缺失时拒绝启动。设为`recommended`可在人工片单之外并入动态推荐题目。
5. 确保持久卷和备份目标受到访问控制。

不要把生产环境变量写入仓库。按`.env.example`字段在服务器安全配置后运行：

```sh
docker compose build
docker compose up -d
docker compose ps
curl -fsS "https://${DOMAIN}/api/health/ready"
```

Caddy自动申请TLS证书并转发WebSocket。`TRUST_PROXY_HOPS=1`只适用于仓库提供的单层Caddy结构；增加CDN或代理后需按真实链路重新验证，不能盲目加大。

## 题目模式切换

`TOPIC_MODE`在`verified`与`recommended`之间切换只需改环境变量并重建容器，不需要重新构建镜像：

```sh
# 切换到动态推荐题目
TOPIC_MODE=recommended docker compose up -d --force-recreate app
# 回滚
TOPIC_MODE=verified docker compose up -d --force-recreate app
```

`recommended`在启动时读取`ZHIHU_TOPIC_CANDIDATE_PATH`快照；快照缺失或过期时会在`ZHIHU_TOPIC_CANDIDATE_TIMEOUT_MS`内尝试拉取，失败则退回过期快照，再失败则仅使用人工片单。**启动路径不会因为网络或额度失败而不可用。**

首次切换前建议先预热，让第一局不必承担冷启动的拉取与生成耗时：

```sh
docker compose exec -T app node scripts/warm-topics.ts
```

预热必须与运行环境使用同一个`ZHIHU_TOPIC_CACHE_PATH`。该脚本在没有可用模型时会直接拒绝运行，避免把兜底文案当成正式内容写进缓存。

### 题库滚动

`TOPIC_MODE=recommended`时应用会在运行期间持续换题，不再只在启动那一刻固定候选池：

| 变量 | 默认 | 作用 |
|---|---|---|
| `ZHIHU_TOPIC_REFRESH_MS` | `86400000` | 每轮刷新的间隔；`0`表示不启动刷新循环 |
| `ZHIHU_TOPIC_CANDIDATE_QUERIES` | `生活方式,职场,人际关系,情感,健康` | 每轮轮换一个主题，逗号分隔 |
| `ZHIHU_TOPIC_CANDIDATE_MAX` | `60` | 候选池上限，超出后从最旧的动态题开始淘汰 |
| `ZHIHU_TOPIC_REFRESH_WARM` | `true` | 是否预热本轮新增的候选 |

主题轮换不是可选项而是滚动能生效的前提：平台对同一主题的推荐列表是稳定的，固定用一个主题每天问，很可能返回的全是池子里已有的候选，追加数长期为0，池子就冻住了。留空`ZHIHU_TOPIC_CANDIDATE_QUERIES`会退化为只用`ZHIHU_TOPIC_CANDIDATE_QUERY`。

每轮消耗约一次`creator`额度（拉候选）加每个新候选一次`question_answers`额度与一次模型调用（预热），相对100/日的额度是宽裕的。想关闭滚动而不重建镜像：

```sh
ZHIHU_TOPIC_REFRESH_MS=0 docker compose up -d --force-recreate app
```

刷新失败只写`topic.refresh.failed`事件并保留原候选池，不影响正在进行的对局。排查时看这一组事件：`topic.refresh.ok`、`topic.refresh.empty`、`topic.refresh.failed`、`topic.refresh.warm_failed`。判断某局是否真的走了缓存，仍以对局后`topic-cache.json`的mtime是否变化为准。

**已知取舍**：淘汰最旧的动态题会移动存活候选的下标。若某个房间恰好在淘汰前后跨越「建房→出题」这个几秒的窗口，它会改判到另一道同样合法的题目。窗口极短且一天只发生一次，未额外加锁。

## 发布

```sh
npm ci
npm run audit:repo
npm run check
npm run build
npm run smoke:prod
npm run load:smoke
```

生产冒烟会启动真正的`NODE_ENV=production`服务器，检查首页、健康、指标认证、允许Origin的Socket入场及拒绝恶意Origin；它显式启用“仅测试可用”的静态题目开关，并使用占位模型凭据但不触发开局或模型调用。该结果只验证基础设施。

发布前先执行`docker compose exec app npm run backup -- /app/data/backups/pre-release.db`。更新应用后观察ready、错误率和AI失败率；失败时停止新版本、恢复应用镜像，数据库只在确认schema不兼容且经过演练时回滚备份。

## 数据与恢复

- `roundtable_data`包含全部游戏和会话数据，不随容器删除。
- Caddy证书保存在独立卷。
- 每日备份SQLite，并至少保留一次异地加密副本。
- 定期在隔离目录打开备份并运行应用恢复测试，不能只检查文件存在。
- 终局默认24小时后清理，因此长期分析需要单独、合规的匿名化事件管道；当前没有。

## 尚需人工验收

- 真实域名、证书、云防火墙和反向代理IP解析。
- DeepSeek真实调用，以及GLM长期配额、稳定性和内容安全。
- 知乎额度、缓存、片单轮换和长期稳定性。
- 动态题目的模型生成共识与默认答案的质量、事实准确性和内容安全。
- 手机与桌面多人完整时长对局。
- 负载、断网、重启、磁盘不足和备份恢复演练。

完成这些人工项前，容器可部署不等于公网生产验收完成。

GitHub `main`的Verify工作流执行生产构建、生产进程冒烟、`docker build`和`docker compose config`；具体结果以仓库Actions页面为准。真实域名环境仍需单独验收。

应用层并发和可信代理冒烟见[负载测试](load-testing.md)。
没有正式服务器时，使用[临时部署与验收](temporary-acceptance.md)；该流程不能替代本页的正式环境验收。
管理员操作见[内部管理员API](admin-api.md)，数据处理见[隐私工程基线](../product/privacy.md)。
