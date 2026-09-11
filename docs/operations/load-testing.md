# 预演负载与代理验证

```sh
npm run build
npm run load:smoke
LOAD_CLIENTS=100 npm run load:smoke
```

脚本启动真实`NODE_ENV=production`进程，通过WebSocket并发连接，每个客户端携带不同的`X-Forwarded-For`，服务端配置`TRUST_PROXY_HOPS=1`模拟仓库提供的单层Caddy。每个客户端创建一个观战房间并同步状态，最终输出成功数、P50、P95和最大端到端延迟。

默认40客户端，允许1至200；P95超过10秒判定冒烟失败。脚本显式使用静态题目和占位模型Key，不进入游戏、不调用知乎或模型，不产生外部费用。

2026-09-11本地基线：40/40成功，P50约208ms、P95约222ms、最大约223ms。该数据只用于发现明显回归，不是生产SLA。

覆盖生产Next/Socket/SQLite启动、Origin与WebSocket、单层可信代理IP、并发房间创建、会话保存、状态同步和优雅关闭。

未覆盖真实Caddy/CDN链路、校园网共享IP误伤、完整玩家对局、AI并发、长连接持续时间，以及CPU、内存、文件描述符、磁盘和带宽容量。正式预演应在目标服务器逐级增加负载并监控资源，在错误率或资源达到阈值时停止。
