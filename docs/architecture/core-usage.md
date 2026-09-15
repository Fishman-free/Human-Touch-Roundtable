# 游戏核心调用约定

> 核心、运行时、会话和SQLite已实现；外部及环境验证见[验证状态矩阵](../contracts/validation-status.md)。

## API

```ts
import { createGame, transition, advanceTime } from "../../src/game/transition.ts";
import { project } from "../../src/game/projection.ts";

let state = createGame("unique-match-id", Date.now());
const result = transition(state, { kind: "participant", participantId: "authenticated-id" }, {
  matchId: state.matchId,
  phaseToken: state.phaseToken,
  command: { type: "join" },
}, Date.now());

// 必须保存返回状态，即使动作被拒绝：截止时间可能已经触发推进。
state = result.state;
const view = project(state, { kind: "participant", participantId: "authenticated-id" });
```

- `createGame(matchId, now)`：创建候场状态。
- `transition(state, actor, envelope, now)`：先处理所有到期阶段，再校验动作，成功返回新状态，规则失败返回错误码与超时推进后的状态。
- `advanceTime(state, now)`：纯函数补全所有已到期的阶段；不需要真实等待，也不创建系统定时器。
- `project(state, viewer)`：按明确字段白名单生成独立的公开快照，包含本人身份和可执行动作。
- `aiContext(state, seatId)`：仅服务端调用，为AI生成全身份上下文。

输入状态不被修改。时间必须有限且不早于上次调用时间；调用方应保证时间单调不倒退。每个截止时间单独计一次revision，成功动作再计一次；当前阶段变化会更新phaseToken。

## 信任边界

1. `Actor`由服务端认证会话生成，不能直接使用客户端传来的actor或seatId。系统动作与AI动作不能暴露为客户端接口。
2. 客户端输入尚需网络层做运行时结构校验；核心TypeScript命令并非未经校验的JSON解析器。
3. 全员准备后进入preparing。应用层成功取得知乎题目材料后，才调用系统`resolve-topic`，一起提交题目与身份分配。
4. 核心校验题目材料、默认池、人数、角色数、真人映射和匿名编号。它不能证明HTTP请求已经成功，该责任属于题目适配器。
5. 座位必须依次使用s1、s2等匿名编号。角色及真人映射由应用层随机安排，核心不自行读取随机源；测试使用固定分配方便复现。
6. 同一commandId重试回执由应用层维护；核心只保证一轮一答、一人一票和阶段令牌校验。
7. 存储完整GameState才能恢复私有身份；不能把公开视图当作恢复数据。快照可以JSON序列化，重新调用advanceTime补做超时。

## 超时与默认内容

- 到达截止时刻即超时。旧阶段命令在补全后会返回STALE_PHASE，不能被新阶段接纳。
- 默认答题内容按座位索引在该轮题目默认池中轮换，用完循环；不发布默认来源。
- 第二轮通过stance加理由提交，展示前缀计入50字；按可见字素计数，标点计入。
- 按设计建议实现指认超时：指向下一个座位，并填“我认为你是AI。”；应答超时使用通用回应；追问超时记为跳过。
- 辩论优先执行480秒总上限，可能截断当前发言或尚未行动的座位。
- 辩论未设置产品字数限制，暂用4096字节技术输入上限。
- 投票到期统一记未投票，不强制随机投票。

## 公开视图

整局座位身份只对本人可见，揭示后才公布全部身份。公开数据不包含participantId、模型控制信息、默认答案池、各座位网络状态。投票关系实时公开，有效票、出局集合和胜方仅在揭示后公开。

观战在核心中是只读视图，不占座位或触发准备条件。陌生participantId不能操作已有座位；会话层已经实现凭据签发、48小时有效期、撤销、重连和单活动连接接管，并向核心提供认证participantId。

公开日志包含阶段转换、三轮答案、每次辩论、跳过追问及每张票。AI上下文和内部状态不得通过普通广播发送。

## 验证记录

在WSL Ubuntu、Node.js v22.23.2环境执行`npm run check`，严格类型检查与全量自动测试通过。

已覆盖四档人数的整局、全员准备和题目校验、字数/立场校验、越权与重复提交、迟到动作、全员离线超时恢复、辩论顺序与8分钟截断、投票约束、两方胜负（v1.1）、有效票同时结算、玩家/观战身份隔离，以及快照序列化后的视图一致性。

SQLite关闭重开、主动恢复、本地Socket、SIGKILL/WAL和生产进程冒烟已有自动测试；知乎与GLM有单次外部验证。浏览器完整体验和真实代理/容量仍未验收。
