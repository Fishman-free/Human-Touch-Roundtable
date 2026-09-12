# SQLite崩溃与恢复演练

## 自动演练

```sh
npm run drill:recovery
```

演练在临时目录执行：

1. 子进程创建回答阶段房间并确认一条真人回答。
2. SQLite处于WAL模式且未显式关闭时，对子进程发送SIGKILL。
3. 父进程重新打开数据库并运行`PRAGMA integrity_check`。
4. 主动恢复活动房间，将时钟推进到三轮回答、辩论和投票全部过期之后。
5. 验证已确认回答未丢失、默认动作只补一次、终局唯一。
6. 使用SQLite在线备份生成新数据库，再次检查完整性和终局。

该测试随`npm test`和GitHub Actions运行，在Linux/WSL验证真实进程边界，不只是同进程关闭连接。

## 备份文件校验与恢复命令

备份使用 `roundtable-YYYY-MM-DDTHH-mm-ss.sssZ.db` 命名，并旁置同名 `.json` 清单。清单记录创建时间、数据库版本、字节数和 SHA-256 摘要；备份目录应至少保留最近 7 天每日备份和最近 4 个周备份，过期文件连同清单一起删除。

```sh
npm run backup -- ./backups/roundtable-$(date -u +%Y-%m-%dT%H-%M-%S.000Z).db
npm run verify:backup -- ./backups/roundtable-2026-09-12T00-00-00.000Z.db
npm run restore:backup -- ./backups/roundtable-2026-09-12T00-00-00.000Z.db ./data/recovered.db
DATABASE_PATH=./data/recovered.db npm run start
```

校验会执行 `PRAGMA integrity_check`、读取 `user_version` 并输出 SHA-256；校验失败不得启动恢复实例。恢复目标必须是新文件，工具拒绝覆盖已有数据库。容器中应先停止 app，再把恢复文件放入数据卷，以 `DATABASE_PATH` 启动唯一实例，并检查 `/api/health/ready`、活动房间和会话。

故障处理顺序：停止入口流量 → 保留原数据库及 WAL/SHM → 复制到隔离目录 → 校验最近备份 → 用验证通过的备份启动临时实例 → 检查 ready、活动房间恢复和日志 → 再恢复流量。应用版本升级必须先备份、校验，再滚动到新镜像；若新版本无法 ready，停止流量并用原版本加验证通过的备份启动。终局清理只删除在线数据库中的终局记录，不会删除已生成的备份；备份中的终局数据仍按备份保留策略保存。

## 生产恢复顺序

1. 阻止新流量并停止应用；保留原数据库、WAL和SHM文件，不单独复制其中一个。
2. 复制完整数据卷到隔离位置。
3. 优先用最新经验证的在线备份启动单实例。
4. 请求`/api/health/ready`，检查结构化日志中的恢复失败事件。
5. 用测试会话检查活动房间是否按绝对截止时间推进。
6. 验证后再恢复流量；原始损坏文件保持只读供分析。

不要在未知损坏上直接运行人工UPDATE或删除WAL文件。Schema回滚必须使用经过演练的应用版本和备份组合。

## 仍需环境演练

自动测试没有模拟真实磁盘写满、文件系统只读、宿主断电、网络存储语义或异地备份下载失败。这些场景需要在与生产相同的持久卷和容器环境中演练，并配置告警。
