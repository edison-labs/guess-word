# GuessWord 工程架构

## 请求与状态流

```text
React 客户端
  ├─ localStorage：gameId + resumeToken、无答案战绩摘要
  ├─ HttpOnly Cookie：匿名/登录会话（JavaScript 不可读）
  └─ 同源 /api/games/*、/api/auth/*、/api/account、/api/leaderboards/*
          ↓
Vinext / Cloudflare Worker Route Handlers
  ├─ 请求格式、Origin、恢复令牌、限流与统一错误
  ├─ GameService：状态机、精确命中、提示顺序、公开字段映射
  ├─ SemanticScorer
  │    ├─ deterministic（仅 development/test）
  │    ├─ Cloudflare AI BGE-M3 embeddings（显式真实配置）
  │    └─ DeepSeek V4 Flash JSON judge（显式真实配置）
  ├─ AccountService：游客会话、用户名口令、恢复码、短信验证码、账号合并和榜单规则
  ├─ SmsProvider：开发固定验证码 / 阿里云 Dysmsapi 生产短信
  └─ D1GameStore / NodeSqliteGameStore
       ├─ games：私有 questionId、状态、提示次数、令牌摘要
       ├─ guess_claims：评分前原子占位、所有权令牌和超时接管
       ├─ guesses：标准化词、整数千分位百分比分数、序号
       ├─ users / account_sessions / verification_codes
       └─ semantic_scores / ai_usage / score_feedback

服务端私有题库（200 题，八类各 25 题）
  ├─ 答案、范围、子类别、字数、高关联词
  └─ 确定性测试向量（不会进入客户端包）
```

阿里云 ECS 使用同一套 Route Handlers 和领域服务，但通过独立 Next.js standalone 构建把运行时切换为 Node.js。题局存储使用挂载在 Docker volume 的 SQLite WAL；健康检查为 `GET /api/health`。该路径面向单 ECS 小范围试玩，不支持多实例共享同一 SQLite 文件。

## 关键决策

1. **D1 作为服务端事实来源。** 刷新后通过 `gameId + resumeToken` 恢复完整状态；客户端不能提交可信分数、次数、题目或终局状态。
2. **分数保存为整数千分位百分比。** `99900` 表示 99.900%，`100000` 只允许精确命中；旧的 `score_tenths` 列仅用于无损兼容迁移，避免浮点边界和伪造小数。
3. **答案按公开视图白名单输出。** 活动局只返回范围和已经揭示的提示；猜中或放弃后才返回答案。
4. **重复猜测三层保护。** 客户端避免无意义请求；服务端在调用评分器前以 `guess_claims` 复合主键原子占位，并以不可猜测 claim token 保证只有占位所有者能提交；`guesses` 复合主键继续兜底。评分失败会释放占位，崩溃遗留占位可在 15 秒后安全接管。
5. **测试评分必须显式选择。** `deterministic` 适配器基于服务端概念向量、余弦相似度和相同校准逻辑，仅允许 `development/test`；生产配置缺失时直接失败。
6. **真实模型是可替换边界。** Cloudflare 适配器封装 8 秒超时、向量验证、批量 embeddings 和答案向量缓存。DeepSeek 适配器使用 V4 Flash 非思考模式和 JSON 输出，对词义、场景与指向性分别给出三位小数评分，再按固定权重计算并缓存；最终精确到 0.001%，超时为 12 秒。两者都把 401/403 等配置故障标为不可重试，把 429/5xx、超时和网络故障标为可重试；精确答案始终由领域层独立判定为 100%。
7. **游客先玩、登录后合并。** 服务端为首次访问创建随机游客 `playerId` 与 30 天会话；手机验证码验证成功后只迁移该游客名下题局并轮换会话令牌。已登录账号切换手机号时绝不迁移原账号数据。
8. **排行榜只比较同题条件。** 每日榜比较当天统一题目，好友榜比较同一分享根题目；每位用户只取该范围的首次作答，先比猜测数，再比提示数、用时和完成时间。

## 数据库

Drizzle 结构位于 `webapp/db/schema.ts`，生成的迁移位于 `webapp/drizzle/`。运行时也使用幂等、单语句的 `CREATE TABLE/INDEX IF NOT EXISTS` 初始化本地 D1，以便干净环境直接启动。常用查询索引覆盖：

- `(game_id, sequence)`：按提交顺序恢复历史；
- `(game_id, score_milli_percent, sequence)`：最佳猜测和分数排序；
- `(game_id, normalized_guess)` 复合主键：标准化重复去重。

`guess_claims` 使用相同复合主键协调并发请求，避免同一标准化词在多个请求或 Worker isolate 中重复调用付费评分器。运行时初始化 Promise 在失败后会清空，因此瞬时 D1 故障不会永久毒化当前 isolate。

控制器内的 10 秒/15 次短窗限流只用于单进程工程保护。公开推广前必须将其替换或叠加为按匿名设备与来源 IP 协调的网关、负载均衡限流或等效分布式实现；当前版本不据此宣称生产级抗滥用能力。

## API

```text
POST /api/games                     { "category": "动物" }
POST /api/games/daily
POST /api/games/challenge           { "sourceGameId": "..." }
GET  /api/games/:gameId
POST /api/games/:gameId/guesses   { "guess": "海豹" }
POST /api/games/:gameId/hints
POST /api/games/:gameId/abandon
GET  /api/auth/session
POST /api/auth/sms/request          { "phone": "13800138000" }
POST /api/auth/sms/verify           { "phone": "...", "code": "123456" }
POST /api/auth/logout
GET/PATCH /api/account
GET  /api/leaderboards/daily
GET  /api/leaderboards/challenge?gameId=...
```

除创建外，均要求 `Authorization: Bearer <resumeToken>`。API 采用 `Cache-Control: no-store`，错误统一为：

```json
{
  "error": {
    "code": "DUPLICATE_GUESS",
    "message": "这个词已经猜过了。",
    "retryable": false,
    "field": "guess"
  }
}
```
