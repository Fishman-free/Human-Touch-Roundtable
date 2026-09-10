# 房间运行时调用约定

> 2026-09-10：房间运行时、Socket会话和SQLite适配器已实现。真实知乎网关尚未实现；模型供应商尚未在线验收。

## 职责

`RoomRuntime`把纯游戏核心接到应用层生命周期：

- 每房间一个Promise串行队列，真人命令、截止处理和异步结果依次提交。
- 注册表初始化时主动打开所有非终局房间，无需等待玩家重连。
- 每个已认证真人的`commandId`幂等；同ID不同载荷拒绝。
- 状态、日志和命令回执作为一个`RoomRecord`原子保存，保存成功后才广播和确认。
- 全员准备后轮换知乎题目候选；一轮全部失败使用指数退避。
- 题目和AI调用在房间队列外运行，完成后重新入队并校验`phaseToken`。
- 随机分配真人角色、AI数量和匿名座位；AI能获得服务端全身份上下文。
- 定时器只负责唤醒，核心仍以绝对截止时间判断；重新打开房间会补做错过的截止动作。

## 打开与关闭

```ts
const runtime = await RoomRuntime.open(roomId, matchId, {
  clock,
  random,
  store,
  topics,
  ai,
  diagnose: event => internalLogger.info(event),
});

await runtime.close();
```

- 第一次打开会建立并保存版本0。再次打开同一房间必须使用相同matchId。
- P0同一房间只允许一个活动运行时。存储使用乐观版本检查；发现另一个写者后，冲突实例关闭并返回`ROOM_CONFLICT`。
- `close()`拒绝新命令、排空已入队命令，再取消本地计时器和异步请求，不删除已保存房间。
- 注册表默认保留终局24小时，每分钟枚举并按版本删除过期终局；SQLite会级联删除相关会话。
- `MemoryRoomStore`只能模拟同一进程内的重新打开，不提供进程崩溃后的持久化。

## 网络层接入

```ts
const ack = await runtime.dispatch(authenticatedParticipantId, {
  commandId,
  matchId,
  phaseToken,
  command,
});
```

- 网络层先做运行时schema校验，再构造`PlayerRequest`。不能允许客户端提交participant actor、AI actor、system actor或`resolve-topic`。
- commandId限制为1至128位ASCII字母、数字、下划线或连字符。
- 每局默认最多保留4096条命令回执。超过后拒绝新命令，避免清理旧回执导致旧请求失去幂等语义。
- 规则拒绝也保存回执；保存失败返回`STORAGE_UNAVAILABLE`且不缓存，客户端可以用同一命令重试。
- `sync(viewer)`先补过期阶段再返回视图。`view(viewer)`不写存储，只返回最近已提交状态并刷新`serverNow`。
- `subscribe(viewer, send)`首次发送当前裁剪视图，之后仅在已保存的游戏revision变化时发送。订阅发送失败只记内部诊断，不阻塞房间。

重连凭据和participantId映射由Socket会话层负责；运行时只接受已经认证的participantId。

## 外部端口

### TopicProvider

- `candidateIds`在同一房间准备期保持稳定顺序。
- `resolve`负责真实知乎请求和材料组装；核心会再次校验URL、摘要和默认答案。
- 每个候选失败后立即尝试下一个；一轮全部失败后，从5秒开始指数退避，默认最多60秒。
- 失败原因只通过内部`diagnose`报告，公开视图停留在preparing。

### AiProvider

- 处理回答、指认、应答、追问和投票。AI请求包含全身份上下文，不能写进公开日志。
- 每个座位、每个phaseToken只发起一次AI任务；无自动模型重试，供应商failover应在AiProvider适配器内部完成。
- 超时、错误、命令类型不匹配、核心校验失败都不提交状态，最终由核心默认动作补齐。
- 任务切换阶段后会abort；即使供应商不支持取消，迟到结果也因phaseToken失效被丢弃。

### RoomStore

- `save(roomId, expectedVersion, record)`必须原子保存整个记录；异常表示没有部分提交。
- 返回false表示乐观版本冲突，运行时关闭以避免多写者分叉。
- 生产实现需要SQLite事务；不应分别保存状态、日志和回执。

## 一致性说明

- 运行时保证单实例内串行执行和存储提交顺序，不承诺分布式多实例调度。
- 慢供应商请求不会持有房间队列；真人仍可提交操作。
- 广播发生在成功保存之后；异步订阅者不会反向阻塞持久化。
- 系统时间回退时使用上次状态时间作为下限；生产时钟应保持单调合理。
- 对状态有影响的超时会保存一次。仅`lastNow`变化但未到截止时间时不写库。
- 题目准备的候选位置、轮次和下次重试时间也持久化，重新打开不会重置失败退避。

## 验证记录

在WSL Ubuntu、Node.js v22.23.2执行`npm run check`，严格类型检查与全量自动测试通过。

已验证随机角色数量、并发串行化、幂等回执、题目轮换与指数退避、AI异步提交、AI迟到作废、保存失败不广播、内存恢复补过期阶段，以及双运行时乐观锁冲突。

尚未验证真实网络乱序、进程级SQLite恢复、知乎接口字段、LLM供应商取消行为和浏览器重连；这些属于后续集成阶段。
