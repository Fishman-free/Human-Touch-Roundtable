# 协作指南

先读 [README](README.md)、[接口总览](docs/contracts/README.md) 和 [冻结规则](docs/product/game-rules.md)。本项目为单仓库，前后端通过共享类型协作。

## 分工

| 区域 | 主要负责人 | 变更范围 |
|---|---|---|
| `src/components/`、`src/ui/`、`src/app/globals.css`、`public/` | 前端合作者 | 主题、组件、布局、素材、交互展示；可直接使用[前端视觉Agent提示词](docs/agents/frontend-visual-agent.md) |
| `src/client/` | 前后端协商 | 会话、请求重试、Socket生命周期 |
| `src/contracts/`、`src/server/socket-contracts.ts`、`src/game/projection.ts` | 前后端共同审阅 | 公开状态、事件、错误码与可见性 |
| `src/game/`、`src/application/`、`src/server/`、`src/repository/` | 后端 | 规则、认证、并发、保存、恢复 |
| `src/topics/`、`src/ai/` | 后端 | 外部供应商适配 |

不要为了美化直接复制一套Socket连接、私有GameState或胜负逻辑。前端只使用`GameSession`和`RoomView`；前端素材放`public/`并核对授权。

## 工作方式

1. 每人从最新主分支建立功能分支，一次PR聚焦一个目标。
2. 优先在自己的新主题或组件文件中开发，使用`RoomSlots`替换；减少同时编辑默认`game-screen.tsx`和全局CSS。
3. 协议改动在同一PR中同步类型、运行时校验、客户端调用、测试和文档。
4. 执行 `npm run audit:repo`、`npm run check`、`npm run build`。
5. UI改动在PR中附桌面/移动截图；后端改动附触发条件、结果及对应回归测试。
6. 提交前检查 `git status --short` 和 `git diff --cached`，不要提交数据库、密钥或运行日志。
7. 负载相关改动使用 `npm run load:staged` 分阶段验证，并在PR中记录测试环境、阶段结果、资源指标和未覆盖项；本地production mode冒烟不能写成公网容量验收。

真实凭据只能通过本机进程环境、部署密钥系统或GitHub Secrets注入，不得放入Issue、PR、文档、截图或测试夹具。已经通过聊天或其他非部署密钥通道共享的凭据，在正式部署前必须轮换。

推荐Node 22.23.2、npm 10，在WSL/Linux下执行命令。CI使用同一Node版本。不要上传`node_modules`；依赖变更同时提交package.json与锁文件。

typecheck会先运行`next typegen`，再把Next受本地缓存影响的`next-env.d.ts`规范化为稳定生产路径；首次克隆不需要先启动网页或复制他人的.next缓存，检查后也不应产生该文件的差异。

## 当前限制

开发默认使用本地题目和模拟AI。知乎已有9个在线核验生产题，另有可选的动态推荐题目（共识与默认答案由模型生成，带确定性兜底）；GLM和DeepSeek均做过七动作单次真实验证。真实外部验证不进入普通CI，也不等于长期稳定或生产容量验收。详细状态以[验证矩阵](docs/contracts/validation-status.md)为准。

基础内容过滤不是完整审核。应用层并发冒烟未经过真实Caddy/CDN。管理员API只能放在受控运维网络，Bearer认证不能替代VPN、防火墙和审计。SQLite使用同步API，P0按单进程运行。仓库暂未选定开源许可证，第三方`zhihu/`工具包默认不上传。

PR描述必须使用准确证据等级：没有真实凭据只能写“代码支持/自动验证”；单次外部验证不能写“长期稳定”；本地production mode或Docker构建不能写“公网生产已验收”。
