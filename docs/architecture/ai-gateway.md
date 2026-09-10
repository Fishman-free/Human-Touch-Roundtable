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
- `AI_ATTEMPT_TIMEOUT_MS`默认8000；每次实际时限不会超过当前游戏阶段剩余时间。

仓库和日志不得包含API Key。普通CI只使用假供应商和录制结构，不发起计费请求。

## 输出约束

模型只允许返回纯JSON对象：

- 回答：`{text}`；第二轮为`{stance,text}`。
- 指认：`{targetSeatId,text}`。
- 回应/追问：`{text}`；跳过追问为`{skip:true}`。
- 投票：`{targetSeatId}`。

解析器拒绝Markdown围栏、额外字段、超长文本、自投/未知座位、系统提示/身份表泄露及明确宣告普通人/影子身份。解析成功后仍通过核心状态机校验阶段和动作权限。

## 故障切换

每个供应商独立超时；网关使用自身Promise竞速，因此供应商即使忽略AbortSignal也不会阻止切换。失败类型只记录provider、model、action、promptVersion、状态、延迟和可选Token数，不记录Prompt、响应、用户文本或异常详情。

所有供应商失败后网关抛出统一错误。RoomRuntime不向客户端显示模型异常，等待阶段截止后使用题目默认答案或未投票规则。

## 尚未验证

DeepSeek/GLM真实响应格式、模型对JSON模式的实际支持、配额错误、网络代理、内容安全效果和成本均需使用项目方密钥单独验收。当前代码具备接入通道，不等于真实供应商已经接通。
