# 前后端接口总览

本目录是合作入口。下列TypeScript文件为接口事实来源；文档说明调用职责，不另复制一套实现。

| 边界 | 入口 | 调用者 |
|---|---|---|
| 浏览器公开类型 | `src/contracts/public.ts`（仅type导出） | 前端与测试 |
| UI会话控制器 | `src/client/game-session.ts` → `GameSession` | 页面、阶段组件、假数据预览 |
| 视觉主题 | `src/ui/theme/types.tsx` → `GameTheme` | ThemeBoundary、组件 |
| 阶段组件替换 | `src/ui/room-slots.ts` → `RoomSlots` | GameScreen |
| Socket事件与回执 | `src/server/socket-contracts.ts` | 浏览器hook、网关 |
| 权威状态与动作 | `src/game/model.ts` | 后端，禁止广播原对象 |
| AI/题目/存储/时钟 | `src/application/ports.ts` | 应用运行时、供应商适配器 |

详细说明：[前端协作](frontend.md)、[后端协作](backend.md)、[Socket事件表](../architecture/socket-protocol.md)。

## 协议兼容约定

目前浏览器与服务端同仓同版本发布，不支持独立版本协商。添加可选展示字段通常可兼容；删除/改名字段、改变阶段或错误语义必须同时修改消费者和测试。`RoomView`当前由投影函数返回类型推导，因此修改投影也属于公开接口变更。

`revision`表示状态版本，`phaseToken`表示阶段/辩论子阶段；二者不等价。提交动作使用收到的matchId和phaseToken。相同commandId重试必须保留原载荷；不能换阶段令牌后继续复用该ID。

## 公开状态

- `self`：本人的匿名seatId与身份；观战者为空。
- `seats`：全桌匿名编号，无账号、连接状态或模型类型。
- `actions`：本人此刻可执行的动作；前端据此呈现按钮，服务端仍会校验。
- `topic`：标题、来源URL；最高赞回答第三轮起公开，高赞共识不公开。
- `answers[1|2|3]`：所有已确认回答；确认后不可修改。
- `debate`：当前指认者、目标、子阶段与总截止时间。
- `votes`：实时公开票路；`null`表示截止未投票。
- `result`：揭示后才出现，含胜方、出局集合、有效票、全身份。
- `log`：公开游戏行为；不包含提示词、凭据或供应商内部错误。

前端任何展示接口都不能扩大这些字段的可见范围。
