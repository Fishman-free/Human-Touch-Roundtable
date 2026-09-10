# SQLite持久化

> 2026-09-10：SQLite房间与会话适配器已实现并通过关闭重开测试。当前schema版本为2。

## 存储模型

使用Node 22内置`node:sqlite`，数据库schema版本为1。

```text
rooms
  room_id       TEXT PRIMARY KEY
  version       INTEGER
  record_json   TEXT
  updated_at    INTEGER

sessions
  id            TEXT PRIMARY KEY
  room_id       TEXT REFERENCES rooms(room_id)
  viewer_json   TEXT
  token_hash    TEXT
  created_at    INTEGER
  expires_at    INTEGER
  last_seen_at  INTEGER
  revoked_at    INTEGER NULL
```

一个房间的私有状态、公开日志、命令回执和题目退避位置位于同一个`record_json`。更新使用单条带版本条件的SQL，因此整体原子提交；不会出现状态已更新但回执或日志尚未保存的中间状态。

会话表只保存token的SHA-256摘要和身份映射，不保存原始token。房间删除时由外键级联删除会话。

## 数据库配置

- `foreign_keys = ON`
- `busy_timeout = 5000`
- `synchronous = FULL`
- 文件数据库启用WAL
- 表使用SQLite STRICT模式和JSON有效性约束

数据库父目录必须在启动前存在。数据库文件、`-wal`和`-shm`文件均不能提交仓库；应放在持久卷并纳入同一备份策略。

## 乐观并发

新房间只允许插入version 0。后续更新必须满足：

```sql
WHERE room_id = ? AND version = expectedVersion
```

影响行数为0表示另一写者已经提交。房间运行时收到冲突后关闭，不会覆盖新状态。P0仍按单Node实例部署；CAS是防止错误多开造成数据分叉，不是多实例房间调度方案。

## 服务端组装

`createServerContext`把同一个`SqlitePersistence`同时作为RoomStore和SessionStore，并组装真实时钟、安全随机源、房间注册表和Socket网关：

```ts
const context = createServerContext({
  databasePath: process.env.DATABASE_PATH!,
  sessionHmacKey: process.env.SESSION_HMAC_KEY!,
}, { topics, ai, diagnose });

context.register(io);
// 关闭HTTP/Socket接入后：
await context.close();
```

`SESSION_HMAC_KEY`至少32字节，部署后应稳定保留；更换会改变入场派生结果，但不会自动撤销已存储摘要对应的Token。撤销需显式删除或禁用会话记录。生产环境通过密钥管理或环境变量注入，不写进配置文件或日志。

## 恢复与迁移

- 新库直接创建schema 2；schema 1会显式迁移会话生命周期字段；遇到未知版本直接拒绝启动。
- 重新打开房间先加载完整私有记录，再由核心按绝对截止时间补推进。
- JSON读取会检查数据库版本与记录版本一致，并做基础结构检查；损坏记录会显式报错，不尝试猜测修复。
- 后续修改schema必须继续增加显式版本迁移，不能原地覆盖`user_version`。

Node 22将`node:sqlite`标记为实验性API，测试时会显示警告。当前项目以Node 22.18+为运行基线；升级Node大版本前需要重新运行全部数据库测试。

## 验证

测试覆盖数据库关闭后重新打开、私有身份与会话恢复、恢复时补做90秒截止、两个独立连接的CAS竞争、重复session主键，以及外键拒绝孤立会话。
