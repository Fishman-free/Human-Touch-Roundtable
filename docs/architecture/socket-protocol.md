# Socket与会话协议

> 2026-09-10：Socket.IO协议和真实双客户端集成测试已完成；SQLite适配器已可持久化生产会话与房间。

## 建立会话

客户端生成UUID `requestId`。它是加入请求的幂等标识，应像临时凭据一样避免写入公开日志。

```ts
socket.emit("room:create", { requestId, roomId, mode: "player" }, callback);
socket.emit("room:join", { requestId, roomId, mode: "player" | "spectator" }, callback);
```

成功响应包含：

```ts
{ ok: true, roomId, sessionToken, view }
```

- 房间号只允许1至24位小写字母、数字和连字符。
- `room:create`要求房间不存在。创建响应丢失时，客户端可改用`room:join`和同一个requestId恢复同一入场请求。
- 同一房间、同一requestId会确定性生成同一participantId和sessionToken；两分钟幂等窗口内重复加入不会多占座位。窗口结束后只能使用sessionToken恢复。
- 派生使用服务端HMAC密钥，存储只保留token的SHA-256摘要。部署环境必须提供稳定的至少32字节密钥，多实例必须共享。
- requestId不能代替长期sessionToken；成功后客户端保存sessionToken，后续只用它恢复。

## 恢复与接管

```ts
socket.emit("room:resume", { roomId, sessionToken }, callback);
```

凭据有效时恢复玩家或观战身份，并返回最新视图。同一会话只允许最新连接写入：新连接会让旧连接收到`session:replaced`，随后服务端断开旧连接。

会话默认48小时到期，服务端保存`expiresAt`、`lastSeenAt`和可选`revokedAt`。命令、同步和状态广播都会重新确认会话；到期或撤销后现有连接也会停止读写并断开。最近活动时间最多每分钟持久化一次，过期/撤销记录默认每小时清理。

断线不会调用退出游戏或释放座位。测试可使用`MemorySessionStore`；生产组装使用`SqlitePersistence`恢复跨进程会话。

## 状态同步

- `room:state(view)`：成功保存新游戏revision后推送；每个连接单独做身份裁剪。
- `room:sync(callback)`：补做已过期阶段并返回当前视图，未建立会话返回`NOT_JOINED`。
- 客户端以revision识别新旧快照，以phaseToken构造当前阶段命令。
- 观战者可以创建/加入/恢复/同步，但所有游戏写事件返回`FORBIDDEN`。

## 游戏事件

所有写事件都携带：

```ts
{ commandId, matchId, phaseToken, ...eventFields }
```

| 事件 | 额外字段 |
|---|---|
| `room:ready` | `ready` |
| `game:answer` | `round`, `text`, 可选`stance` |
| `game:accuse` | `targetSeatId`, `text` |
| `game:respond` | `text` |
| `game:followup` | `text` |
| `game:skip-followup` | 无 |
| `game:vote` | `targetSeatId` |

网络层执行字段白名单和运行时类型校验，额外字段也会拒绝。通过认证会话确定participantId；客户端不能上传actor、role或自己的seatId。进一步的阶段、字数、重复动作和目标校验由游戏核心执行。

回执包含commandId、revision以及成功或错误码。连接中断后，可用同一commandId和完全相同载荷重试；同ID不同载荷返回`COMMAND_ID_REUSED`。

## 信任与部署边界

- `SESSION_HMAC_KEY`不得提交到仓库、发送到客户端或记录到日志。
- Socket网关不直接接触私有GameState，只调用RoomRuntime的玩家视图与命令接口。
- sessionToken是Bearer凭据；浏览器端后续应放在受控本地存储，并避免出现在URL、分析事件和截图中。
- HTTP/Next/Socket共用`server.ts`入口；Origin精确匹配、消息大小、连接/建房/入场/命令限流和未认证超时已经实现，参数见[公网安全边界](security.md)。
- 现有防护是单进程基础能力，真实反向代理地址解析、压力和外围DDoS防护仍需部署环境验收。

## 验证

真实本地端口测试覆盖：两名玩家加观战者、准备后取题、私有身份视图、观战只读、额外/错误字段拒绝、开局后禁止玩家加入、重复加入幂等、新连接接管、有效与篡改凭据、未入房同步。
