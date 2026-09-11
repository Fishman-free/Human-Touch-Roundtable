# 前端合作者接入指南

## 两种扩展方式

仅修改配色、字体、纹理、密度：新增`GameTheme`，注册到`src/ui/theme/registry.ts`，设置构建变量`NEXT_PUBLIC_GAME_THEME`。主题字段是普通string，不是固定字面量，允许创建完全不同的视觉风格。

需要重做圆桌、答题或结算的结构：编写符合`RoomSlots`的React组件，通过`GameScreen.slots`替换相应默认组件。

```tsx
import type { RoomSlots } from '../../ui/room-slots.ts';

const MyRoundtable: RoomSlots['Roundtable'] = ({ view, theme }) => (
  <section aria-label="圆桌">
    {view.seats.map(seat => <article key={seat.seatId}>{seat.displayNumber}号席</article>)}
  </section>
);

// 在page.tsx组合点注入，未指定的阶段仍用默认实现。
<GameScreen session={session} theme={theme} slots={{ Roundtable: MyRoundtable }} />
```

`slots`支持Lobby、Preparing、StageRail、Roundtable、Answer、Debate、Voting、Reveal。具体props以`src/ui/room-slots.ts`为准。自定义组件建议用CSS Modules，避免影响默认组件的全局类名。

## 主题字段

| 字段 | 意义 |
|---|---|
| `tokens.color` | 背景、表面、文字、边界、强调与角色色 |
| `tokens.font` | 正文、标题、数字字体 |
| `tokens.radius/motion/layout` | 圆角、动画时长、内容宽度与座位宽度 |
| `density` | compact / comfortable / theatrical；通过data-density消费 |
| `assets.brandMark` | 入口和顶部品牌图，省略时用默认图标 |
| `assets.paperTexture` | 根主题背景纹理 |
| `assets.revealArtwork` | 结算插画，省略时不显示 |
| `seatColumns(count)` | 默认圆桌列数策略；完整布局可用Roundtable slot替换 |

资源放`public/`，路径例如`/themes/court/logo.svg`。主题只接受项目受信任配置，不接收用户提供的URL或CSS。

## GameSession：无需启动后端的开发入口

组件只要求`GameSession`显式接口，不依赖hook实现。可在合作者的预览工具里注入包含`RoomView`的假session及操作回调；不用mock数据库、Socket或AI。

主要回调：`ready(boolean)`、`answer(text, stance?)`、`accuse(targetSeatId,text)`、`respond(text)`、`followup(text)`、`skipFollowup()`、`castVote(targetSeatId)`。这些方法不返回胜负或新状态，下一次状态由服务端推送；等待时读取`busy`。

默认`useGameSession`内部使用持久化单命令Outbox。组件不得自行生成第二个重试commandId，也不应在`busy`或状态未知时重复提交。完整语义见[命令确认与重试](../architecture/command-retry.md)。注入假`GameSession`时可以直接同步更新预览状态，无需模拟重试器。

只从`src/contracts/public.ts`导入公开协议类型（使用`import type`）。不要在客户端引入GameState、RoomRuntime、SessionService或SQLite。不得通过隐藏DOM来“隐藏”角色：不该看到的数据本就不应下发。

## 验收与当前边界

以3/5/6/8座位、玩家/观战、全部阶段为检查矩阵。改字数提示必须与后端规则同步；不把90秒等规则放进主题。倒计时显示不能触发阶段推进。

当前页面连接异常与命令重试体验尚需浏览器专项验收；本次不新增海报、排行榜或其他产品功能。sessionStorage在某些“复制标签页”操作中会被复制，测试多玩家请手动新开页面或使用独立浏览器上下文。
