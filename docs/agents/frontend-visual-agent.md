# 前端视觉 Agent 工作提示词

将以下内容完整交给负责前端视觉工作的 Agent。Agent 必须以 GitHub 最新 `origin/main` 为代码依据，不得以旧分支、本地缓存或聊天记录代替仓库版本。

```text
你是 Human-Touch-Roundtable 项目的前端贡献者。

仓库：https://github.com/Fishman-free/Human-Touch-Roundtable

开始工作前：

1. git fetch origin main --prune
2. 确认最新 origin/main commit
3. 检查 git status --short，不覆盖已有未提交修改
4. 从最新 origin/main 创建独立功能分支
5. 阅读 README.md、CONTRIBUTING.md、docs/contracts/README.md、docs/contracts/frontend.md、docs/contracts/validation-status.md、docs/architecture/frontend-extension.md、docs/architecture/web-app.md、src/contracts/public.ts、src/client/game-session.ts、src/ui/room-slots.ts、src/ui/theme/和src/components/

目标：

为“人味圆桌局”建立一套适合知乎气质的浅蓝色圆桌视觉系统。整体采用低饱和、接近白色的雾蓝背景，气氛轻松、友善、有讨论感，同时保留匿名圆桌、怀疑和投票带来的轻微张力。

设计参考Apple的留白、排版、层级和克制动效。可以借鉴shadcn/ui、Origin UI、Magic UI或Aceternity UI的组件组织和交互细节，但不得复制其页面、品牌、文案或未经许可的素材。

视觉基调：

- warm editorial
- quiet tension
- roundtable
- human conversation
- restrained Apple-like layout
- soft paper-like light blue background
- subtle stage lighting
- mobile-first
- accessible

初始颜色Token建议：

- 页面背景：#F2F7FC
- 圆桌区域：#E6EFF8
- 卡片背景：#FFFFFF
- 边框：#D7E4F0
- 主按钮和选中状态：#356FA8
- 正文：#24364B
- 辅助文字：#61758A

颜色必须集中定义在GameTheme或主题Token中，不要把颜色值散落到组件。实际实现时检查文字、按钮、状态和禁用状态的对比度。颜色只是建议，若现有主题契约有更合适的语义命名，优先遵循现有结构。

小看山头像：

- 用户形象使用戴不同颜色围巾的小看山知乎吉祥物。
- 本次先预留可替换的头像资源接口和固定尺寸容器；用户稍后会提供参考图。
- 没有图片时使用稳定占位，不得因图片加载造成布局跳动。
- 所有头像保持一致的画布比例、主体位置和视觉尺寸。
- 可先使用柔和底色、简洁轮廓和座位编号作为占位。
- 头像资源只能来自项目受信任配置和public/中的已授权素材。
- 围巾颜色只用于区分本局公开座位，与普通人、影子、AI身份无关。
- 真人和AI使用同一套头像与颜色分配方式。
- 刷新和重连后同一座位的颜色保持稳定。
- 始终保留座位编号，不得让颜色成为唯一识别方式。

围巾可使用低饱和灰蓝、豆沙粉、鼠尾草绿、浅杏、薰衣草紫、柔和赭黄、青灰和莓果色。不要用颜色暗示隐藏身份、阵营或AI。

必须清楚表达的公开状态：

- 当前行动者：外圈、文字或明确的静态标记
- 已完成：低对比完成标记
- 离线：明确但不刺眼的状态
- 被指认：使用独立关系标记，不改变头像身份
- 等待AI：清晰的等待说明
- 断线重连：清晰的恢复状态
- 命令状态未知：提示用户当前命令仍待确认，不允许视觉上鼓励重复提交
- 观战：保持观战者与玩家信息边界

优先完成这些页面状态：

1. Landing：创建或加入房间
2. Lobby：候场
3. Preparing：题目和身份准备
4. Answer：三轮回答
5. Debate：辩论和追问
6. Voting：投票
7. Reveal：结果揭示
8. Reconnecting：断线重连
9. Unknown command state：命令状态未知
10. Spectator：观战

建议组件：

- RoundtableShell
- StageHeader
- SeatRing
- SeatCard
- PlayerStatusDot
- PhaseProgress
- PromptCard
- AnswerComposer
- DebateThread
- VotePanel
- ConnectionStatus
- WaitingState
- RevealPanel

组件必须通过props接收RoomView和现有公开类型，不从组件内部读取私有状态。

必须遵守现有前端契约：

- 前端只能使用GameSession和RoomView。
- 只能从src/contracts/public.ts导入公开类型。
- 不得导入GameState、RoomRuntime、SessionService或SQLite。
- 不得在前端重新实现游戏规则、胜负判断或Socket连接。
- 不得自行生成第二个commandId。
- 不得在busy或状态未知时重复提交命令。
- 创建和加入房间使用requestId；进入房间后的游戏动作使用commandId、matchId和phaseToken。
- 不得通过隐藏DOM伪装隐藏角色信息。
- 保持GameTheme、RoomSlots和GameSession可替换。

动画规则：

- 进入房间时座位轻微淡入。
- 阶段切换时标题和进度条平滑过渡。
- 当前行动者使用静态强调环或轻微呼吸动画。
- 投票提交后只显示短暂确认。
- Reveal阶段可以使用一次性过渡。
- 不使用持续闪烁、自动播放音效、高频粒子或强烈霓虹效果。
- 支持prefers-reduced-motion；减少动画时退化为即时状态切换。

响应式和可访问性：

- 先保证390px左右移动宽度，再处理桌面宽屏。
- 圆桌关系在手机上仍然可理解。
- 键盘焦点必须清楚可见。
- 输入框、按钮和座位操作适合触控。
- 不只依靠颜色传达状态。
- 处理图片加载失败、空状态、等待状态、错误状态和长文本。

第一阶段只改视觉和展示层，优先使用：

- src/ui/theme/
- src/ui/room-slots.ts
- src/ui/presentation/
- src/components/
- src/app/globals.css
- 必要时新增独立组件文件

避免直接修改src/client/、src/server/、src/game/、src/application/、src/repository/和公开协议。若发现接口不足，先在PR中记录，不要擅自扩大协议范围。

不要新增海报、排行榜、OAuth、产品营销页或其他无关功能。不要把视觉改造描述为完成生产验收。

交付要求：

- 完成浅蓝主题Token、圆桌和卡片层次。
- 完成可替换的头像容器和小看山占位头像。
- 完成座位编号和独立状态标记。
- 完成至少一个可独立预览或测试的新增组件。
- 更新必要的前端协作文档。
- 在PR中附桌面和移动端截图；若没有真实设备，明确写明模拟环境。
- 说明是否修改公开协议、是否新增依赖、哪些视觉状态仍需人工验收。

验证命令：

npm run audit:repo
npm run check
npm run build

如果可以运行浏览器检查，还要验证：

- 桌面宽屏和390px左右移动宽度；
- 两个独立浏览器加入同一房间；
- 断线、重连和刷新；
- 状态未知时不能重复提交；
- 观战视图不显示玩家私有身份；
- reduced-motion模式；
- 图片缺失和长文本布局。

PR标题建议：

feat: introduce roundtable visual system

PR正文必须说明：

- 使用了哪些GameTheme、RoomSlots和可替换组件；
- 哪些页面状态发生变化；
- 是否修改公开协议；
- 桌面和移动端如何验证；
- 是否加入外部依赖或素材；
- 当前哪些内容仍需人工验收。
```
