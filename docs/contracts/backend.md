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

`RoomStore.save(roomId, expectedVersion, record)`必须原子写完整RoomRecord；`list()`提供启动恢复/清理摘要；`delete(roomId, expectedVersion)`以CAS删除终局。返回false代表版本冲突；抛异常必须代表没有成功提交。SQLite适配器将状态、日志、回执放在单行JSON中；SessionStore独立保存会话摘要，两者并非一个跨表入场事务。入场失败后的重试由相同请求身份与命令幂等兜底。

服务启动先调用`ServerContext.initialize()`：注册表枚举所有非终局房间，打开运行时并补做已过截止；因此无人重连时计时仍继续。终局默认保留24小时，每分钟执行一次CAS清理，删除房间时SQLite外键级联删除会话。两个时长可通过`ServerContextConfig.lifecycle`配置。

`RoomRuntime.close()`先停止接受新命令，排空已经进入串行队列的命令，再取消本地定时器和AI/题目任务。服务关闭顺序仍为停止网络接入、关闭房间注册表、关闭数据库。

`validateRoomRecord`对读取做结构/部分不变量校验，不应称为数据库所有损坏情形的完整证明。schema v1→v2迁移和在线备份已有自动测试；真实进程升级、异地备份恢复和损坏介质演练仍需额外测试。

## 外部能力

| 端口 | 输入 | 返回/约束 |
|---|---|---|
| TopicProvider | 稳定candidateIds、resolve(id,AbortSignal) | 规范化Topic；TopicPack负责结构，VerifiedTopicProvider负责官方网关核验，静态实现仅开发使用 |
| AiProvider | AiRequest（matchId、phaseToken、seatId、动作、截止、私有上下文）+ AbortSignal | AiCommand；类型/目标/阶段仍由核心校验 |
| Clock | now / setTimeout / clearTimeout | 可替换测试时钟；截止以服务端为准 |
| RandomSource | integer(exclusiveMax) | [0,max)整数；生产使用crypto随机 |
| SessionStore | create / find / touch / revoke / deleteExpired | 存摘要、viewer和生命周期，禁止存明文secret |

AI失败不提前广播错误或默认来源，最终由阶段截止补默认回答/未投票。LLM供应商与结构化动作契约见[AI网关](../architecture/ai-gateway.md)。题目全部失败停留preparing并退避，不能把模拟题当成已验证的知乎材料。题目详细契约见[题目包与知乎接入边界](../architecture/topic-provider.md)。

## 会话语义

requestId须为随机UUID，相当于两分钟内的临时入场恢复凭据；泄露它在窗口内仍有风险，不能记录到公共日志。长期重连使用sessionToken。稳定HMAC密钥负责确定性入场派生；摘要验证本身使用存储值，因此密钥轮换不会自动撤销已有Token，撤销需要显式删/禁用会话记录。

重连接管在sync后同步替换活动连接，防止两个并发恢复保留双写连接。已经被服务器接收并进入房间队列的旧连接命令可能完成；接管后收到的新命令由新连接发起。入场命令固定使用候场phaseToken=0，保证跨阶段重试保持相同指纹。

会话默认48小时有效，可撤销并记录最近活动时间。Socket命令、同步和广播都重新授权；因此撤销/到期不仅阻止重连，也停止现有长连接继续读取状态。`AdmissionService`集中处理创建、加入和恢复，网关不直接编排RoomRegistry与SessionService。永久入场失败会撤销刚创建的会话；存储暂时失败保留相同入场身份供重试。

## 当前尚未完成

知乎热榜/搜索适配器已实现；正式目录含11个候选，9个已在线核验进入生产，2个待验证。当前缓存仅在进程内，尚未持久化。GLM代理已完成全动作真实验收，DeepSeek尚未带密钥验证。确定性隐私/注入过滤已实现，但完整内容审核和对抗测试仍未完成，详见[内容安全边界](../architecture/content-safety.md)。浏览器已用同一commandId和原载荷实现持久化单命令重试。跨进程SIGKILL、WAL、连续截止和在线备份恢复已有自动演练；真实磁盘/宿主故障仍需部署环境验证。其他未完成项主要是真实反向代理与负载压测。基础Origin、连接/事件限流、未认证超时及健康检查已经实现，具体约束见[公网安全边界](../architecture/security.md)。日志、指标和在线备份见[可观测性与备份](../operations/observability.md)。应用内保护不能替代CDN或入口网关。
