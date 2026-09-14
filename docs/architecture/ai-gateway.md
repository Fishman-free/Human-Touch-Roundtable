# AI网关与供应商契约

> 网关、结构化解析与组装已实现；GLM和DeepSeek均有七动作单次真实验证。完整边界见[验证状态矩阵](../contracts/validation-status.md)。

## 分层

```text
RoomRuntime → AiProvider
  LlmGateway
    → buildPrompt（版本、人格、动作指令）
    → LlmProvider[]（DeepSeek → GLM）
    → parseAiCommand（JSON、长度、目标、安全）
    → AiCommand → 游戏核心再次校验
```

`LlmProvider`只负责把messages发送给一个模型并返回文本/可选用量，不参与游戏规则。`OpenAiCompatibleProvider`支持DeepSeek和GLM当前兼容接口，固定HTTPS endpoint由后端配置，发送JSON object响应模式，限制原始响应64 KiB。

## 环境配置

- 开发默认`AI_MODE=mock`。
- 生产默认`AI_MODE=live`，明确禁止Mock伪装为生产AI。
- `DEEPSEEK_API_KEY`和`GLM_API_KEY`存在时按该顺序加入故障切换链。
- 模型名可分别通过`DEEPSEEK_MODEL`、`GLM_MODEL`覆盖。
- 官方端点为默认值；受信任部署可用`DEEPSEEK_ENDPOINT`、`GLM_ENDPOINT`配置HTTPS兼容代理。端点属于服务端高信任配置，不能来自玩家输入。
- `AI_ATTEMPT_TIMEOUT_MS`默认14000；每次实际时限不会超过当前游戏阶段剩余时间。`AI_MAX_TOKENS`默认1024，为带内部推理的模型预留最终JSON空间。
- 请求发出前，AI 座位先等一段自己的随机节拍（`AI_BEAT_MS`，题面 30 字时基准 40～70 秒）：一桌人同时秒回是最明显的机器特征，而模型本身只要几百毫秒。`aiBeatWindow(remaining, aiTimeoutMs, question)` 把窗口裁到这个阶段付得起的大小——上限取“阶段剩余时间减去模型预算”，题面长度再按 `BEAT_BASELINE_CHARS=30` 字把整个窗口左右平移（0.6～1.4 倍）。先缩放再抽取，而不是抽完再截断，短阶段才保留随机性，不会把每个节拍压成同一个数。辩论中 20 秒的指认阶段只等 5 秒，60 秒的投票阶段落在 40～45 秒。等待期间上下文在请求发出时才读取，晚发言的座位能看到这期间其他人的话。
- `GLM_THINKING=disabled`用于低延迟游戏动作；供应商不支持时应移除该配置，而不是伪造兼容。

仓库和日志不得包含API Key。普通CI只使用假供应商和录制结构，不发起计费请求。

真实验收先用`npm run verify:llm -- --action answer`做单动作探测，成功后再用`--all`覆盖三轮回答、指认、回应、追问和投票。脚本只输出命令类型及安全尝试元数据；上游HTTP错误收敛为`LLM_HTTP_<状态码>`，不输出响应正文。

2026-09-11使用清华计算机系AI平台的OpenAI兼容端点和`glm-5.3-flash`完成真实验收；显式关闭thinking后，三轮回答、指认、回应、追问和投票7个场景全部通过结构、长度和目标校验。实测延迟约1.4至7.2秒，单次输入约517至562 Token，输出约19至89 Token。该结果不是延迟或成本SLA，仍需整局、多次采样和内容安全对抗测试。

`npm run verify:llm-models`只输出模型ID；`npm run inspect:llm-shape`只输出字段类型和字符串长度，二者均会发起真实请求，不进入CI。代理Key不能用于官方智谱端点，端点和密钥必须成对配置。

## 输出约束

模型只允许返回纯JSON对象：

- 回答：`{text}`；第二轮为`{stance,text}`。
- 指认：`{targetSeatId,text}`。
- 回应/追问：`{text}`；跳过追问为`{skip:true}`。
- 投票：`{targetSeatId}`。

解析器可靠拒绝Markdown围栏、额外字段、超长文本和自投/未知座位；另以少量关键词和正则启发式拦截系统提示、身份表及部分普通人/影子身份泄露。启发式过滤不能构成内容安全保证，解析成功后仍需核心状态机校验，并需用真实模型做对抗测试。

真人、题目和AI共用的确定性基础策略见[内容安全边界](content-safety.md)。

## 故障切换

每个供应商独立超时；网关使用自身Promise竞速，因此供应商即使忽略AbortSignal也不会阻止切换。失败类型只记录provider、model、action、promptVersion、状态、延迟和可选Token数，不记录Prompt、响应、用户文本或异常详情。

所有供应商失败后网关抛出统一错误。RoomRuntime不向客户端显示模型异常，等待阶段截止后使用题目默认答案或未投票规则。

## 题目内容生成

`TOPIC_MODE=recommended`时，动态题目的`topConsensusSummary`与`defaults`也由模型生成，但不走本页的`AiProvider`：`LlmGateway.act()`会把输出交给`parseAiCommand`，那套契约绑定在游戏动作上。题目生成使用独立的`LlmTopicContentGenerator`，依赖更窄的`LlmProvider`接口（只有`complete`），并按同样的顺序做供应商故障切换。

- 供应商由`createLlmProviders`从环境统一构造，与游戏动作共用同一份映射，不重复一套端点与模型默认值。
- 提示词版本为`roundtable-topic-v1`。输出必须经`normalizeTopicContent`规范化与长度校验，规则与核心`validateTopic`一致；不合规的输出在这里被拦下，而不是等到开局失败。
- `TOPIC_AI_TIMEOUT_MS`约束的是**全部供应商合计**的预算，不是每个供应商各一份，避免故障切换把运行时的题目超时撑爆。输出上限用`TOPIC_AI_MAX_TOKENS`：`AI_MAX_TOKENS`装不下完整的中文JSON。
- 生成失败**不向客户端failover**，而是回落到确定性文案（`ZHIHU_TOPIC_FALLBACK=fail`可改为让该候选失败）。一道题必须始终能被解开，缺题会让房间停在preparing。

## 尚未验证
