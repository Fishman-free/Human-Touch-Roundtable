# AI网关与供应商契约

> 网关、OpenAI兼容客户端、结构化解析与开发/生产组装已实现；真实密钥在线调用尚未验证。

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
- `AI_ATTEMPT_TIMEOUT_MS`默认8000；每次实际时限不会超过当前游戏阶段剩余时间。

仓库和日志不得包含API Key。普通CI只使用假供应商和录制结构，不发起计费请求。

真实验收先用`npm run verify:llm -- --action answer`做单动作探测，成功后再用`--all`覆盖三轮回答、指认、回应、追问和投票。脚本只输出命令类型及安全尝试元数据；上游HTTP错误收敛为`LLM_HTTP_<状态码>`，不输出响应正文。

## 输出约束

模型只允许返回纯JSON对象：

- 回答：`{text}`；第二轮为`{stance,text}`。
- 指认：`{targetSeatId,text}`。
- 回应/追问：`{text}`；跳过追问为`{skip:true}`。
- 投票：`{targetSeatId}`。

解析器可靠拒绝Markdown围栏、额外字段、超长文本和自投/未知座位；另以少量关键词和正则启发式拦截系统提示、身份表及部分普通人/影子身份泄露。启发式过滤不能构成内容安全保证，解析成功后仍需核心状态机校验，并需用真实模型做对抗测试。

## 故障切换

每个供应商独立超时；网关使用自身Promise竞速，因此供应商即使忽略AbortSignal也不会阻止切换。失败类型只记录provider、model、action、promptVersion、状态、延迟和可选Token数，不记录Prompt、响应、用户文本或异常详情。

所有供应商失败后网关抛出统一错误。RoomRuntime不向客户端显示模型异常，等待阶段截止后使用题目默认答案或未投票规则。

## 尚未验证

2026-09-11使用一组`pk-proxy`形态的GLM凭据访问官方智谱端点，返回HTTP 401。该凭据需要对应代理端点，或改用官方智谱API Key；在取得正确端点/密钥前，真实响应格式、JSON模式、配额、内容安全效果和成本仍未验收。
