# 前端扩展边界

> 2026-09-10：展示层已从单页实现重构为会话、组件、展示配置和主题四个边界。

## 目录职责

```text
src/app/page.tsx                         # 选择主题，组合入口或房间
src/client/use-game-session.ts           # Socket、会话和命令动作
src/components/entry/                    # 入场界面
src/components/room/                     # 游戏阶段和圆桌界面
src/ui/presentation/game-presentation.ts # 品牌、角色、阶段、轮次文案
src/ui/theme/types.tsx                   # GameTheme契约和CSS变量注入
src/ui/theme/registry.ts                 # 主题注册与选择
src/ui/theme/themes/                     # 具体主题
src/app/globals.css                      # 只消费主题变量的结构样式
```

页面组件不直接创建Socket、不读取sessionStorage，也不自行判断角色权限。它们接收`src/client/game-session.ts`中的显式`GameSession`动作接口和服务端裁剪后的`RoomView`。公开类型从`src/contracts/public.ts`导入，共享规则从`src/contracts/rules.ts`导入。

## 新增主题

实现`GameTheme`并注册到`registry.ts`。主题可提供颜色、字体、圆角、动效时长、内容宽度、座位最小宽度、资产路径和座位列策略。设置`NEXT_PUBLIC_GAME_THEME`即可在构建时选择，不修改页面组件。

CSS颜色、字体、主要尺寸和动效均通过变量读取。响应式断点和语义结构属于组件布局约束，不由主题任意改变，避免换皮后破坏可用性。

## 可替换资产

`assets`中的品牌标识、纸张纹理和揭示图均已被默认组件消费。未提供品牌资产时使用Lucide图标，未提供揭示插图时不显示。`density`通过data属性控制默认阶段间距。

## 不允许进入主题的内容

- 游戏阶段和时间推进
- 字数限制和投票规则
- 服务端`actions`权限
- 身份、有效票及胜负计算
- Socket事件和持久化字段

这些属于后端规则。主题只改变表达，不改变对局事实。

## 修改阶段表现

通用文案统一在`game-presentation.ts`，默认组件位于`components/room/game-screen.tsx`。合作者可在独立文件实现`RoomSlots`中的任意组件，再通过`GameScreen.slots`注入；无需修改默认组件或Socket hook。示例与完整props见[前端协作指南](../contracts/frontend.md)。
