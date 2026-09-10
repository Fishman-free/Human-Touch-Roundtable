# 后端接口与不变量

## 从网络到保存

```text
SocketGateway（结构校验、会话认证）
  → RoomRuntime.dispatch（按房间排队、幂等）
  → transition（阶段、权限、次数、目标校验）
  → RoomStore.save（状态+日志+回执原子写）
  → project（按接收者裁剪）→ room:state
```

正常玩家调用永远不能选择actor或participantId。网关从已认证会话取得participantId；AI/system只由后端创建。系统resolve-topic事件没有公开Socket入口。

## 核心接口

- `createGame(matchId, now)`：生成候场状态。
- `transition(state, actor, envelope, now)`：返回新状态和成功/错误，不修改输入。即使动作失败也要保存返回状态，因为截止可能已推进。
- `advanceTime(state, now)`：按绝对截止时间补完整个过期流程。
- `settle(seats,votes)`：普通票命中即出局，同时结算。普通人全歼AI优先；否则全部影子存活则影子胜；否则AI胜。
- `project(state,viewer)`：唯一公开投影入口；禁止序列化GameState给浏览器。

## 运行时与存储

`RoomRuntime.open`加载或新建房间；`dispatch`只接受认证身份与PlayerRequest；`sync`补到期状态并返回视图；`subscribe`仅发布已保存状态；`close`取消任务但保留记录。

同一参与者的同commandId和同载荷返回原回执；不同载荷拒绝。回执上限当前4096，不会自动清理后再执行旧命令。正式高频开放前还需限流。

`RoomStore.save(roomId, expectedVersion, record)`必须原子写完整RoomRecord。返回false代表CAS冲突；抛异常必须代表没有成功提交。SQLite适配器将状态、日志、回执放在单行JSON中；SessionStore独立保存会话摘要，两者并非一个跨表入场事务。入场失败后的重试由相同请求身份与命令幂等兜底。

`validateRoomRecord`对读取做结构/部分不变量校验，不应称为数据库所有损坏情形的完整证明。schema迁移与备份恢复需要额外测试。

## 外部能力

| 端口 | 输入 | 返回/约束 |
|---|---|---|
| TopicProvider | 稳定candidateIds、resolve(id,AbortSignal) | 规范化Topic，必须由适配器核实真实来源；当前静态实现仅开发使用 |
| AiProvider | AiRequest（matchId、phaseToken、seatId、动作、截止、私有上下文）+ AbortSignal | AiCommand；类型/目标/阶段仍由核心校验 |
| Clock | now / setTimeout / clearTimeout | 可替换测试时钟；截止以服务端为准 |
| RandomSource | integer(exclusiveMax) | [0,max)整数；生产使用crypto随机 |
| SessionStore | create / find | 存摘要与viewer，禁止存明文secret |

AI失败不提前广播错误或默认来源，最终由阶段截止补默认回答/未投票。题目全部失败停留preparing并退避，不能把模拟题当成已验证的知乎材料。

## 会话语义

requestId须为随机UUID，相当于两分钟内的临时入场恢复凭据；泄露它在窗口内仍有风险，不能记录到公共日志。长期重连使用sessionToken。稳定HMAC密钥负责确定性入场派生；摘要验证本身使用存储值，因此密钥轮换不会自动撤销已有Token，撤销需要显式删/禁用会话记录。

重连接管在sync后同步替换活动连接，防止两个并发恢复保留双写连接。已经被服务器接收并进入房间队列的旧连接命令可能完成；接管后收到的新命令由新连接发起。入场命令固定使用候场phaseToken=0，保证跨阶段重试保持相同指纹。

## 当前尚未完成

真实知乎/LLM适配器、限流与Origin策略、数据库备份/迁移演练、自动恢复所有无人重连的房间、浏览器重试专项测试。本次修复和现有测试保证覆盖过的路径，不能据此宣称公网生产全部就绪。
