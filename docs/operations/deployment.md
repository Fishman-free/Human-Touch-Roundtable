# 单实例生产部署

## 架构

```text
Internet → Caddy :443 → app :3000 → SQLite persistent volume
```

当前房间内存计时和限流均为单进程模型，只部署一个app副本。SQLite CAS能防止误开的第二写者覆盖状态，但不能提供分布式房间调度。

## 必要配置

1. DNS将`DOMAIN`指向服务器。
2. 生成至少32字节随机`SESSION_HMAC_KEY`和至少24字节`METRICS_TOKEN`。
3. 配置DeepSeek或GLM至少一个API Key；生产禁止Mock AI。
4. 确保持久卷和备份目标受到访问控制。

不要把生产环境变量写入仓库。复制字段名自行建立服务器`.env`，然后运行：

```sh
docker compose build
docker compose up -d
docker compose ps
curl -fsS "https://${DOMAIN}/api/health/ready"
```

Caddy自动申请TLS证书并转发WebSocket。`TRUST_PROXY_HOPS=1`只适用于仓库提供的单层Caddy结构；增加CDN或代理后需按真实链路重新验证，不能盲目加大。

## 发布

```sh
npm ci
npm run audit:repo
npm run check
npm run build
npm run smoke:prod
```

生产冒烟会启动真正的`NODE_ENV=production`服务器，检查首页、健康、指标认证、允许Origin的Socket入场及拒绝恶意Origin；使用占位模型凭据但不触发模型调用。

发布前先执行`docker compose exec app npm run backup -- /app/data/backups/pre-release.db`。更新应用后观察ready、错误率和AI失败率；失败时停止新版本、恢复应用镜像，数据库只在确认schema不兼容且经过演练时回滚备份。

## 数据与恢复

- `roundtable_data`包含全部游戏和会话数据，不随容器删除。
- Caddy证书保存在独立卷。
- 每日备份SQLite，并至少保留一次异地加密副本。
- 定期在隔离目录打开备份并运行应用恢复测试，不能只检查文件存在。
- 终局默认24小时后清理，因此长期分析需要单独、合规的匿名化事件管道；当前没有。

## 尚需人工验收

- 真实域名、证书、云防火墙和反向代理IP解析。
- 真实DeepSeek/GLM调用、配额和内容安全。
- 真实知乎题目核验能力。
- 手机与桌面多人完整时长对局。
- 负载、断网、重启、磁盘不足和备份恢复演练。

完成这些人工项前，容器可部署不等于公网生产验收完成。

当前开发机没有Docker命令，因此本地未实际构建镜像。GitHub Actions已配置`docker build`和`docker compose config`作为远程验证；合并前必须确认对应检查通过。
