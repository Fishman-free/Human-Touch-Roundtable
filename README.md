# 人味圆桌局

**协作入口：** [贡献指南](CONTRIBUTING.md) · [接口总览](docs/contracts/README.md) · [前端扩展](docs/contracts/frontend.md) · [后端契约](docs/contracts/backend.md)

当前已实现TypeScript游戏核心、房间运行时、Socket.IO会话协议和SQLite持久化，包含候场准备、题目与角色配置校验、三轮回答、辩论、投票、结算、身份视图裁剪、串行命令、计时、题目轮换、AI任务编排及断线/进程恢复。

## 当前验证状态

| 能力 | 状态 |
|---|---|
| 核心、Socket、SQLite恢复 | 已有自动测试；不等于公网验收 |
| 知乎题目 | 11个正式候选，9个已在线核验并进入运行时生产集合，2个待核验 |
| GLM | 清华代理`glm-5.3-flash`七动作单次真实验证通过 |
| DeepSeek | `deepseek-v4-flash`七动作单次真实验证通过；未证明长期稳定性和容量 |
| 内容安全 | 基础确定性过滤，不是完整审核系统 |
| 负载 | 本地production mode的40并发观战房间冒烟，未经过真实Caddy/CDN |
| 管理员API | 内部运维接口，不得仅凭Bearer Token直接暴露公网 |

完整证据边界见[验证状态矩阵](docs/contracts/validation-status.md)。当前项目**不能表述为已经完成公网生产验收**。

## 运行检查

要求 Node.js 22.18+，使用 Node 原生 TypeScript 类型剥离运行测试。

```sh
npm ci
npm run audit:repo
npm run check
```

`npm run typecheck` 执行类型检查；`npm test` 执行全部自动测试。

## 启动浏览器版本

```sh
npm run dev
```

访问 `http://localhost:3000`。使用两个独立浏览器上下文进入同一房间即可开局。会话保存在`sessionStorage`，刷新回到原座位；部分浏览器复制标签页会复制该存储，因此多玩家测试应手动打开新页面或使用独立浏览器上下文。

开发服务器使用：

- `./data/roundtable.db`：SQLite房间和会话数据。
- `StaticTopicProvider`：本地预置的知乎题目材料。
- `MockAiProvider`：带短延迟的可控AI行为。
- 开发专用会话密钥。生产启动还必须显式设置会话密钥、Origin、真实模型和经核验题目提供器。

生产基础设施检查：

```sh
npm run build
npm run smoke:prod
```

生产默认使用已实现的知乎搜索核验网关，并要求通过环境注入`ZHIHU_ACCESS_SECRET`；没有凭据时拒绝启动。完整环境变量和部署步骤见[生产部署](docs/operations/deployment.md)。

## 文件入口

- [知乎登录与公共匹配](docs/operations/zhihu-login-matchmaking.md)：airoundtable.stream回调配置、匿名匹配和真实授权待验收项。

- [规则书](docs/product/game-rules.md)：已经冻结的产品规则。
- [验证状态矩阵](docs/contracts/validation-status.md)：代码、CI、真实外部验证和目标环境验收的区别。
- [核心设计](docs/architecture/game-core-design.md)：状态机、协议和模块边界。
- [核心调用约定](docs/architecture/core-usage.md)：应用层如何调用与保存核心结果。
- [房间运行时](docs/architecture/runtime-usage.md)：运行时生命周期、依赖接口和一致性边界。
- [Socket与会话协议](docs/architecture/socket-protocol.md)：入场、重连、接管和网络事件。
- [SQLite持久化](docs/architecture/sqlite-persistence.md)：schema、CAS、恢复和部署边界。
- [前端扩展边界](docs/architecture/frontend-extension.md)：主题、展示配置、组件和客户端会话职责。
- [公网安全边界](docs/architecture/security.md)：Origin、可信代理、限流和健康检查。
- [题目包与知乎接入](docs/architecture/topic-provider.md)：TopicPack v1、核验网关和缓存边界。
- [AI网关](docs/architecture/ai-gateway.md)：结构化Prompt、供应商切换、过滤和生产配置。
- [内容安全](docs/architecture/content-safety.md)：文本规范化、隐私/注入过滤及未覆盖范围。
- [命令确认与重试](docs/architecture/command-retry.md)：浏览器Outbox、幂等重发与状态未知处理。
- [可观测性与备份](docs/operations/observability.md)：脱敏日志、指标、健康检查和SQLite备份。
- [崩溃与恢复](docs/operations/recovery.md)：跨进程WAL、连续截止和备份恢复演练。
- [生产部署](docs/operations/deployment.md)：Docker、Caddy、持久卷、发布与人工验收。
- [预演负载](docs/operations/load-testing.md)：并发WebSocket、可信代理IP和延迟冒烟。
- [分阶段压测](docs/operations/load-testing.md)：10/40客户端阶段、长连接演练和正式报告采集清单。
- [管理员API](docs/operations/admin-api.md)：仅限受控运维网络的房间摘要、删除、会话撤销和清理。
- [隐私工程基线](docs/product/privacy.md)：数据保存、模型传输、保留和删除。
- `src/game/model.ts`：服务端权威类型、动作与结果。
- `src/game/transition.ts`：不可变状态转换和超时补全。
- `src/game/settlement.ts`：普通人有效票与三方胜负。
- `src/game/projection.ts`：玩家、观战和服务端AI的可见内容。
- `src/game/rules.ts`：人数、时限、字数限制。
- `tests/game.test.ts`：四档人数的整局及异常验收。
- `src/application/room-runtime.ts`：房间队列、超时、保存、取题和AI任务编排。
- `src/application/ports.ts`：时钟、随机源、存储、题目和AI端口。
- `src/application/seat-assignment.ts`：随机身份和匿名座位分配。
- `src/repository/memory-room-store.ts`：开发与测试用内存存储。
- `tests/runtime.test.ts`：并发、恢复、退避、AI迟到和存储失败测试。
- `src/server/session.ts`：HMAC派生凭据、摘要验证和内存会话存储。
- `src/server/room-registry.ts`：房间运行时注册与恢复。
- `src/server/socket-gateway.ts`：Socket输入校验、会话绑定和权限广播。
- `src/server/socket-contracts.ts`：前后端共享事件类型。
- `tests/socket.test.ts`：真实Socket.IO连接集成测试。
- `src/repository/sqlite-persistence.ts`：房间和会话的SQLite生产适配器。
- `src/server/server-context.ts`：SQLite、运行时、会话和Socket依赖组装。
- `tests/sqlite.test.ts`：重开恢复、CAS和外键测试。
- `server.ts`：Next.js、Socket.IO、SQLite及开发适配器启动入口。
- `src/app/page.tsx`：入场、候场、回答、辩论、投票和揭示界面。
- `src/contracts/public.ts`：公开协议类型入口；`src/contracts/rules.ts`：共享人数、字数及计数规则。
- `src/client/game-session.ts`：前端显式会话控制接口，可以注入假实现供UI开发。
- `src/ui/room-slots.ts`：阶段与圆桌组件替换接口。
- `src/client/use-game-session.ts`：Socket连接、会话恢复和游戏动作。
- `src/ui/theme/`：主题契约、注册表和视觉Token。
- `src/ui/presentation/game-presentation.ts`：品牌、阶段和轮次展示配置。
- `src/components/`：入口与房间阶段组件。
- `src/topics/static-topic-provider.ts`：开发题目包。
- `src/ai/mock-ai-provider.ts`：开发AI行为。

## 实现范围

Socket层签发和验证会话凭据，再把认证身份交给运行时；SQLite可以主动恢复完整私有房间和会话摘要。浏览器版本可用本地题目和模拟AI走完整流程；知乎热榜/搜索及GLM全动作已用真实凭据在线验证，DeepSeek仍仅具备接入和主备切换代码。

正式题库目前有11个候选，其中9个进入运行时生产集合，其余2个待验证。剩余重点是完整内容审核、真实浏览器弱网E2E、目标环境代理/容量/磁盘演练和管理网络隔离。状态以[验证矩阵](docs/contracts/validation-status.md)为准。

GitHub Actions会执行仓库内容扫描、类型检查、测试和构建。默认排除本地数据库、凭据、构建缓存、第三方工具包、根目录历史策划原稿及本地上传清单。

负载验证使用 `npm run load:staged` 按阶段记录环境、连接、回执、广播、AI、SQLite、恢复和主机资源指标。现有本地脚本使用静态题目和占位模型，只能发现明显回归，不能表述为完整玩家压测或公网生产容量验收。
