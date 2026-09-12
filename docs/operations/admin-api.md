# 内部管理员API

设置至少32字节的`ADMIN_TOKEN`后启用；未配置时所有`/api/admin/*`返回404，错误Token返回401。调用使用`Authorization: Bearer ...`，Token不得进入URL、日志或仓库。

| 方法 | 路径 | 行为 |
|---|---|---|
| GET | `/api/admin/rooms` | 返回roomId、phase、version、updatedAt摘要 |
| DELETE | `/api/admin/rooms/{roomId}` | 关闭活动运行时并CAS删除房间；SQLite级联删除会话 |
| POST | `/api/admin/sessions/{sessionId}/revoke` | 撤销指定会话 |
| POST | `/api/admin/cleanup` | 立即执行终局和过期会话清理 |

房间列表明确不返回matchId、答案、身份、票路、参与者、会话或Token摘要。删除是不可逆操作，生产调用前应先备份并确认roomId；备份中的历史数据不会因在线删除自动消失。

删除房间必须携带 `X-Admin-Reason` 和查询参数 `expectedVersion`（来自房间摘要），撤销会话必须携带 `X-Admin-Reason`；版本不匹配返回409，防止误删。接口按管理员Token指纹限流，每分钟30次。

服务记录结构化 `admin.audit` 事件：操作类型、roomId、Token SHA-256短指纹、时间、成功/失败和耗时；不记录Token、答案、身份、会话内容或完整请求头。该接口只应通过受控运维网络访问；Bearer认证不能替代VPN、防火墙、审计和Token轮换。
