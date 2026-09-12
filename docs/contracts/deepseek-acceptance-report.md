# DeepSeek 供应商验收报告

本报告只记录一次临时真实凭据验收，不属于 CI，也不代表长期 SLA、成本、容量或生产可用性。

| 字段 | 结果 |
|---|---|
| 模型名 | `deepseek-v4-flash` |
| API 端点类型 | `https://api.openai-next.com/v1/chat/completions`，OpenAI 兼容 HTTPS 临时代理 |
| 验证日期（UTC） | 2026-09-12 |
| 凭据 | 不记录；仅通过进程环境变量注入 |
| 三轮回答、指认、回应、追问、跳过追问、投票 | 7/7 通过 |
| 错误码/超时/取消/限流 | 未用真实供应商故障注入验证；此前错误端点返回 `LLM_HTTP_404` |
| failover 顺序和重复请求 | 真实供应商场景未验证；代码级自动测试覆盖 |

## 动作结果

| 动作 | 结果 | 延迟 | 输入/输出 Token |
|---|---|---:|---:|
| answer round 1 | valid | 1990 ms | 465 / 17 |
| answer round 2 | valid | 3105 ms | 477 / 26 |
| answer round 3 | valid | 2049 ms | 465 / 18 |
| accuse | valid | 2703 ms | 510 / 30 |
| respond | valid | 2251 ms | 498 / 13 |
| followup | valid | 2738 ms | 507 / 22 |
| vote | valid | 1735 ms | 464 / 10 |

本次结果证明一次请求中七个动作均返回可解析且符合当前动作契约的命令。不能由此推导长期稳定性、SLA、成本、并发容量、内容安全完备性、真实整局成功率或故障切换可用性。

执行命令：

```sh
DEEPSEEK_ENDPOINT=https://api.openai-next.com/v1 \
DEEPSEEK_MODEL=<model> \
DEEPSEEK_API_KEY=<temporary-key> \
npm run verify:llm -- --all
```

输出只保留动作、命令类型和安全元数据；不得保存完整响应、请求头或 Key。失败样例只记录收敛后的 `LLM_HTTP_<status>`、`timeout`、`aborted` 或 `rate-limited` 类别。单次验证不能推出 DeepSeek 长期稳定性、SLA、成本、并发容量、内容安全完备性或整局游戏成功率。
