# 知乎登录与公共匹配

实现依据：知乎官方Skill `0.7.2-beta.20260911131715` 的黑客松OAuth和基础信息文档。当前具备代码及模拟供应商测试；真实授权须填入本项目凭据、登记回调后，由开发者在浏览器完成。

## 配置

目标站点为 `https://airoundtable.stream`，拟登记回调为：

```text
https://airoundtable.stream/api/auth/zhihu/callback
```

此路径是已实现的应用路由，不代表赛事后台已经登记。联调前须核对协议、域名、路径和尾部斜杠一致。本实现不接受带Query或片段的回调配置。

| 服务端变量 | 值 |
|---|---|
| `DOMAIN` | 仓库Compose/Caddy使用 `airoundtable.stream` |
| `ALLOWED_ORIGINS` | `https://airoundtable.stream` |
| `ZHIHU_OAUTH_APP_ID` | 稍后填入赛事项目App ID |
| `ZHIHU_OAUTH_APP_KEY` | 稍后通过服务器环境或Secret注入，不能提交到仓库 |
| `ZHIHU_OAUTH_REDIRECT_URI` | 上述回调地址，代码和Compose已提供默认值 |

App ID或App Key为空时，首页显示登录暂未开放，房间码入口仍可用；构建不需要OAuth凭据。补齐环境后用 `docker compose up -d --force-recreate app` 重建应用容器；仅restart不会更新Compose环境配置。

仅知乎登录和基础信息查询不需要Access Secret；正式游戏取题仍需题目提供器凭据。OAuth不替代模型、题目、HMAC等现有生产配置。

## 登录与数据边界

1. `GET /api/auth/zhihu/start` 生成随机state，绑定短期浏览器Cookie，跳转到 `https://openapi.zhihu.com/authorize`。
2. 回调读取 `authorization_code`（兼容`code`），验证state与浏览器绑定、有效期和是否已使用，在换Token之前原子消费state。
3. 后端表单请求 `https://openapi.zhihu.com/access_token`，再以OAuth Bearer Token请求 `https://openapi.zhihu.com/user`。
4. 用有效字符串 `hash_id` 建立身份，不使用可能超过JavaScript安全整数范围的数字uid。缺失hash_id时拒绝登录，等待真实联调核实字段。
5. 浏览器只持有随机应用会话Cookie：`HttpOnly; Secure; SameSite=Lax; Path=/`，使用`__Host-`前缀。会话最长24小时且不超过供应商Token有效期。

服务端只在内存保存登录会话摘要、哈希化账号标识、昵称及到期时间。取完基础信息立即丢弃供应商Token，不保存手机号、邮箱、头像、创作或关注信息。昵称仅返回当前浏览器；OAuth资料不进入GameState、RoomView或日志。退出/到期/重启使登录会话失效。

Secure Cookie要求HTTPS；普通HTTP开发地址不能完成真实登录。自动测试使用模拟供应商，不调用真实接口。

## HTTP与客户端契约

| 接口 | 行为 |
|---|---|
| `GET /api/auth/session` | 返回功能是否配置及当前用户昵称，不返回知乎ID或Token |
| `POST /api/auth/logout` | 清除当前登录会话并取消未成桌的排队 |
| `POST /api/matchmaking?action=join` | 登录后进入队列，同账号重复请求幂等 |
| `POST /api/matchmaking?action=poll` | 更新已排队用户心跳、查询结果，不自动创建队列项 |
| `POST /api/matchmaking?action=cancel` | 取消未匹配项；成桌已先完成则返回原匹配 |

所有POST要求Origin精确匹配回调所属站点，拒绝游客、跨站请求。接口不缓存，按账号或可信代理解析的访客IP限流。匹配返回的房间凭据只供当前账号恢复自己的座位。

`GameSession.matchmaking`是可选展示接口，旧的假session无需补字段。HTTP轮询在客户端hook内，组件不创建Socket。匹配通过现有`room:resume`入席，继续用sessionStorage保存房间Token。

## 匹配规则与生命周期

- FIFO两名真人成桌，双方仍需准备开局；房间码入口继续支持原有2～5名真人。
- 同账号在本进程最多一个公共队列项或未结束的公共匹配，重复点击、刷新、重登返回原匹配。
- 玩家和AI继续使用匿名座位、小看山形象，登录信息不发给对手。
- 每3秒轮询；未匹配用户30秒无心跳或登录过期即不再参与配对。后台每10秒清理，匹配请求也触发清理。
- 公共候场两分钟未开局会清理，用户可重新匹配；房间队列内原子检查阶段并关闭，已开局房间不受影响。旧客户端下次操作/恢复收到失效或关闭反馈。
- 第二个席位创建失败时回滚本次新房间，保留队列供重试。
- 成桌后退出登录不销毁游戏会话。离开页面后再点匹配，可恢复尚未结束的原公共房间。
- 队列与账号到匹配的关联不持久化，重启需重新登录排队；已入席的房间和Token沿用SQLite恢复。跨重启账号去重、跨实例匹配尚未实现。
- 首版不含校园筛选、人数选择、段位或语音，也不能证明多个知乎账号来自不同真人。

## 验证

自动测试覆盖state绑定/过期/重放、退出、供应商错误、最小身份、HTTP鉴权与Origin、并发排队、取消/过期、失败回滚、候场清理与准备竞态，以及真实Socket恢复匿名座位。

配置到位后还需人工验证：HTTPS授权成功与取消、回调Cookie、实际响应结构、两账号跨设备匹配、断网/刷新、候场过期和完整开局。测试与构建成功不代表真实授权或站点发布已完成。
