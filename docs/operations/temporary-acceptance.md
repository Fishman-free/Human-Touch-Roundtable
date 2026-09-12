# 临时部署与验收（非生产）

本页用于没有正式云服务器时的可重复验收。它验证容器启动、HTTP/Socket 基础链路、SQLite 备份和重启恢复；结果只能记为“自动验证”或“临时隧道验证”，不能写成正式公网生产验收。

## 本地 Compose

```sh
export DOMAIN=roundtable.example.com
export SESSION_HMAC_KEY="$(openssl rand -hex 32)"
export TOPIC_MODE=static
export ALLOW_STATIC_TOPICS_IN_PRODUCTION=true
export DEEPSEEK_API_KEY=ci-placeholder-not-a-real-key
docker compose up -d --build app
curl -fsS http://127.0.0.1:3000/api/health/live
curl -fsS http://127.0.0.1:3000/api/health/ready
```

Compose 的 3000 端口仅绑定本机，临时测试必须通过隧道明确转发该端口；真实部署仍应只公开 Caddy。用两个独立浏览器或手机创建/加入同一房间，验证状态同步、刷新、断线、重连和完整对局。Origin 必须精确设置为临时地址（含协议和端口）。

## 临时公网隧道

可选 Cloudflare Tunnel、Tailscale Funnel 或 ngrok。隧道只指向 `http://127.0.0.1:3000`，并将该精确 origin 写入 `ALLOWED_ORIGINS` 后重启应用。确认浏览器开发者工具中的 Socket.IO 升级成功，再执行多人测试。关闭隧道后立即清理容器、临时数据库、备份和凭据；不要保存真实用户数据，使用过的临时 Token 必须轮换或销毁。

临时隧道不是正式服务器、正式域名、Caddy/CDN、持久卷或长期运维验收。家庭网络、电脑休眠、上行带宽和隧道供应商限制会影响结论。不得把 `/api/admin/*` 转发到公共隧道；Bearer Token 不能替代 VPN、防火墙、IP allowlist 和审计，未配置 Token 返回 404 也不是网络隔离。

仓库 Caddy 配置在公共入口对 `/api/admin/*` 固定返回 404；管理员操作只能通过本机绑定的 app 端口或独立受控运维入口访问。临时隧道指向 Caddy 时应验证公共地址的管理员路径为 404，再从本机受控入口用正确 Token 验证管理员接口。

## 备份与恢复检查

```sh
docker compose exec app npm run backup -- /app/data/backups/temporary.db
docker compose exec app test -s /app/data/backups/temporary.db
docker compose exec app node -e "const d=require('node:fs'); if(!d.existsSync('/app/data/backups/temporary.db')) process.exit(1)"
docker compose restart app
curl -fsS http://127.0.0.1:3000/api/health/ready
docker compose down -v --remove-orphans
```

需要验证备份启动临时实例时，复制备份到新的空数据目录并以 `DATABASE_PATH` 启动第二个临时容器，再检查活动房间/会话；不得在同一 SQLite 文件上启动第二个写入实例。磁盘写满、宿主断电、异地恢复和网络存储仍未验收。

管理员路由只做受控网络的鉴权回归：无 Token 应为 404 或 401，错误 Token 为 401，正确 Token 才可访问。该检查不证明公网安全。
