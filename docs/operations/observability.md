# 可观测性与备份

## 结构化日志

服务器使用`JsonLogger`输出单行JSON到stderr。字段包括时间、级别、事件名和受控元数据；名称含secret、token、authorization、cookie、apiKey、requestId的字段递归替换为`[REDACTED]`，字符串和集合有长度限制。

当前事件：服务启动/关闭、运行时诊断、AI尝试和Socket安全拒绝。运行时诊断不记录roomId，AI尝试只记录供应商、模型、动作、Prompt版本、状态、延迟和Token数量；不记录用户回答、Prompt、模型响应、异常正文或凭据。

## 指标

`MetricsRegistry`在单进程内聚合：

- `roundtable_runtime_events_total{kind}`
- `roundtable_security_events_total{kind}`
- `roundtable_ai_attempts_total{provider,model,action,status}`
- `roundtable_ai_latency_ms_count/sum{...}`
- `roundtable_ai_input_tokens_total{provider,model}`
- `roundtable_ai_output_tokens_total{provider,model}`

标签只使用有限枚举，不放roomId、sessionId、IP或用户文本。设置`METRICS_TOKEN`后启用`GET /api/metrics`，请求必须提供`Authorization: Bearer ...`；未配置时该路径不暴露。当前指标不跨进程持久化，重启归零。

## 健康检查

`/api/health/live`仅表示进程可响应HTTP。`/api/health/ready`要求服务初始化完成且SQLite可执行查询，关闭期间返回503。两者不返回路径、schema、房间数或内部错误。

## SQLite备份

```sh
npm run backup
npm run backup -- /secure/path/roundtable.db
```

脚本使用SQLite在线备份API生成一致数据库，默认写入被Git忽略的`backups/`。备份应写到独立持久卷并加密、限制访问、定期做恢复演练；备份包含身份、答案、票路和会话摘要，按敏感数据处理。

当前脚本只创建备份，不自动轮换、上传或验证异地副本。部署层负责保留周期与失败告警。

跨进程WAL与备份恢复演练见[恢复手册](recovery.md)。
