# 协作指南

先读 [README](README.md)、[接口总览](docs/contracts/README.md) 和 [冻结规则](docs/product/game-rules.md)。本项目为单仓库，前后端通过共享类型协作。

## 分工

| 区域 | 主要负责人 | 变更范围 |
|---|---|---|
| `src/components/`、`src/ui/`、`src/app/globals.css`、`public/` | 前端合作者 | 主题、组件、布局、素材、交互展示 |
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

推荐Node 22.23.2、npm 10，在WSL/Linux下执行命令。CI使用同一Node版本。不要上传`node_modules`；依赖变更同时提交package.json与锁文件。

typecheck会先运行`next typegen`，首次克隆不需要先启动网页或复制他人的.next缓存。

## 当前限制

开发启动使用本地题目及模拟AI，尚未验证真实知乎/LLM接口。SQLite使用同步API，P0按单进程运行。HTTP握手和单元/集成测试通过并不等于浏览器全部场景或公网部署已经验收。

来源域名校验、限流、线上备份及外部素材许可需在公网发布前完成。仓库暂未选定开源许可证：公开仓库前由项目所有者决定许可证，第三方`zhihu/`工具包默认不上传。
