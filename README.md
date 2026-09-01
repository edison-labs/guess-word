# GuessWord

GuessWord 是一个手机优先的中文 AI 联想猜词 Web 游戏。玩家只看到目标词的宽泛范围，通过连续猜测获得 0%～100% 的关联度，并在按关联度或时间排列的本局猜词榜中逐步接近答案。

当前交付是**工程 MVP**：六分类开局、102 道服务端开发题、刷新恢复、三档提示、精简结算区、本地战绩、确定性开发/测试评分器，以及真实 AI 评分适配器均已实现。没有真实模型凭据时，可以明确选择测试模式完成全流程；生产环境绝不会静默回退到测试评分。

## 本地启动

要求 Node.js 22.13 或更高版本。

```bash
cd webapp
npm ci
cp .dev.vars.example .dev.vars
npm run dev
```

打开终端显示的本地地址（通常是 `http://localhost:3000`）。默认示例配置明确启用 `deterministic` 开发评分器；它只用于开发和自动化测试，不代表真实语义效果。

页面会显示“测试评分”标记。登记的测试词、类别关键词和题目线索具有预设层次；其他中文词使用稳定的低分散列扰动，避免全部显示同一个百分比。该扰动只保证同词结果稳定且数值有区分度，**不能解释为词义远近**。需要真实关联度时请按下文配置 `cloudflare-ai`。

若要让开发环境固定使用企鹅题进行调试，可在被 Git 忽略的 `.dev.vars` 中设置：

```dotenv
TEST_QUESTION_ID=animal_penguin
```

留空时会在玩家所选分类中随机抽题。该选项在 `APP_ENV=production` 时不会生效。

## 测试与构建

在 `webapp` 目录执行：

```bash
npm run typecheck
npm run lint
npm test
npm run test:coverage
npm run test:e2e
npm run build
npm run check:leaks
npm run check:secrets
npm audit --omit=dev
```

- `npm test`：Vitest 单元和 API/服务集成测试。
- `npm run test:e2e`：用系统 Chrome 在 `375×812` 和 `1440×900` 两个视口运行完整主流程及无障碍检查。
- 若开发服务已在运行，可用 `E2E_BASE_URL=http://localhost:3000 npm run test:e2e` 直接复用它，测试不会另启或停止服务。
- `npm run check:leaks`：生产构建后扫描公开客户端资源，确认完整题库的答案、内部 ID、子类别和高关联提示没有进入客户端包。
- `npm run check:secrets`：用假 Token 执行生产构建并扫描部署产物，防止服务端密钥被序列化。
- `npm run db:generate`：题局数据库结构变更后生成并检查 D1/SQLite 迁移。

## 启用真实 AI 关联度

项目支持两种显式真实评分方式，不会在配置失败时静默回退到测试分数。

### DeepSeek 评分

DeepSeek 官方目前提供聊天/Responses 模型而没有单独的 embeddings 模型。本项目使用 `deepseek-v4-flash` 非思考模式和 JSON 输出，让模型以三位小数分别判断词义接近、场景关联和目标指向性，再由服务端固定加权并以整数千分位百分比保存、排序和缓存；界面显示真实的三位小数，而不是补零或随机尾数。它适合直接复用已有 DeepSeek Token，但跨冷启动的一致性通常不如向量模型，正式验收必须使用真实中文词组做排序标定。

在被 Git 忽略的 `.dev.vars` 中配置：

```dotenv
APP_ENV=development
SEMANTIC_PROVIDER=deepseek-judge
DEEPSEEK_API_KEY=your-rotated-server-side-token
DEEPSEEK_MODEL=deepseek-v4-flash
TEST_QUESTION_ID=
```

- [DeepSeek API 接入](https://api-docs.deepseek.com/)
- [DeepSeek 模型列表](https://api-docs.deepseek.com/api/list-models/)
- [DeepSeek JSON 输出](https://api-docs.deepseek.com/guides/json_mode/)

### Cloudflare embeddings 评分

Cloudflare 路径使用 Workers AI 的 `@cf/baai/bge-m3` 多语言向量模型。服务端把本次猜词和隐藏答案批量转换为 embeddings，再用余弦相似度计算关联度；首次请求批量处理两个词，之后会复用答案向量缓存。

截至 2026-08-30，Cloudflare 官方标价为每百万输入 token 0.012 美元，文本嵌入默认速率限制为每分钟 3000 次。模型能力、价格和限制以后可能变化，使用前应再次核对官方页面：

- [BGE-M3 模型说明](https://developers.cloudflare.com/workers-ai/models/bge-m3/)
- [Workers AI 价格](https://developers.cloudflare.com/workers-ai/platform/pricing/)
- [Workers AI 限制](https://developers.cloudflare.com/workers-ai/platform/limits/)

选择 Cloudflare 时，在 `.dev.vars` 中配置：

```dotenv
APP_ENV=development
SEMANTIC_PROVIDER=cloudflare-ai
CLOUDFLARE_ACCOUNT_ID=your-account-id
CLOUDFLARE_AI_API_TOKEN=your-server-side-token
CLOUDFLARE_AI_MODEL=@cf/baai/bge-m3
TEST_QUESTION_ID=
```

保存后执行 `chmod 600 .dev.vars` 并重启开发服务。页面显示“AI 语义评分”才代表真实模式已启用；若仍显示“测试评分”，则没有调用真实模型。

不要把真实凭据写入仓库、聊天、浏览器代码或命令行。真实模式会把猜词和隐藏答案发送给所选供应商并可能产生费用；应使用单独、最小权限且可轮换的服务端 Token。生产运行必须显式设置 `APP_ENV=production`、真实 `SEMANTIC_PROVIDER` 和对应有效凭据，缺少或错误配置时会明确失败。本项目不会在没有凭据和明确操作时自动调用真实模型。

## 架构与安全边界

- 前端：React 19 + TypeScript + Vinext，响应式单页游戏界面。
- 服务端：同源 Route Handlers；创建、恢复、猜测、提示和放弃均由服务端推进状态。Cloudflare/Sites 与阿里云 ECS 分别使用独立构建入口。
- 持久化：Cloudflare 使用 D1；阿里云单 ECS 使用 Docker volume 中的 SQLite WAL。题局用不可枚举 UUID 标识，并使用独立 256-bit 恢复令牌认证。
- 评分：精确答案由领域层独立判定为 100%，不会调用外部供应商；任何非答案分数统一封顶 99.9%。Cloudflare 使用 embeddings 与余弦相似度，DeepSeek 使用冻结量表的 JSON judge，测试适配器只验证流程。
- 题库：仅存在于服务端模块；活动局响应、客户端状态和本地存储都不包含答案、题目 ID、未来提示或向量。
- 本地存储：只保存当前 `gameId + resumeToken` 和不含答案的最近 20 局摘要。
- 防护：服务端输入校验、评分前 D1 原子占位去重、同源检查、小请求体限制、统一错误结构、安全响应头和本地短窗限流。

详见 [ARCHITECTURE.md](ARCHITECTURE.md) 和 [REQUIREMENTS_REVIEW.md](REQUIREMENTS_REVIEW.md)。

## 阿里云 ECS 部署

项目已提供 Next.js standalone、SQLite 持久化、Docker 数据卷和健康检查。部署前必须轮换此前在聊天中出现过的 DeepSeek Key，并通过服务器端 `.env.production` 注入新 Key。完整步骤见 [DEPLOY_ALIYUN.md](DEPLOY_ALIYUN.md)。

## 当前限制

- DeepSeek 与 Cloudflare 的真实语义评分均尚未用有效凭据完成中文标定；自动化通过结果来自 mock 供应商和明确标记的确定性测试适配器。
- 当前有 102 道结构完整的开发题（六类各 17 道），已达到数量门槛，但尚未逐题完成人工试玩和真实模型标定，因此只可准出“工程 MVP”。
- 没有公开部署；项目按需求保持本地交付。
- 当前短窗限流是单进程保护；适合朋友小范围试玩，公开推广前必须接入按设备与 IP 协调的网关或分布式限流。
- P0 只接受 NFKC 标准化、去首尾空白后的 1～10 个连续汉字；不做简繁自动转换。
- 每个浏览器只保留本地战绩，未实现登录、跨设备同步、每日一词、排行榜或分享。

最终验证证据和外部阻塞见 [ACCEPTANCE_REPORT.md](ACCEPTANCE_REPORT.md)。
