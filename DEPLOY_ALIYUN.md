# GuessWord 阿里云 ECS 部署

当前部署目标是单台 Linux ECS，使用 Docker 运行 Next.js standalone 服务，题局数据保存在具名 Docker volume 的 SQLite 数据库中。这个方案适合朋友小范围试玩，不用于多实例横向扩容。

## ECS 前置条件

- 推荐至少 2 vCPU、2 GiB 内存、20 GiB 系统盘；
- Alibaba Cloud Linux 3、Ubuntu 22.04/24.04 或 Debian 12；
- 已分配公网 IPv4；
- 安全组只向管理 IP 开放 SSH 22，向玩家开放 TCP 80；当前应用直接占用公网 80，不部署其他应用；
- 已安装 Docker Engine、Docker Compose plugin、curl。

阿里云 ECS 的构建部署功能也可以自动检查或安装 Docker。官方说明见：[部署应用代码到 ECS](https://help.aliyun.com/en/ecs/user-guide/deploy-applications)。

## 部署

把 `webapp` 目录上传或拉取到 ECS 后，在目录内执行：

```bash
cp .env.production.example .env.production
chmod 600 .env.production
```

编辑 `.env.production`，把 `DEEPSEEK_API_KEY` 替换为新生成、未在聊天或仓库出现过的服务端 Key。保持以下生产值不变：

```dotenv
RUNTIME_PLATFORM=aliyun
APP_ENV=production
SEMANTIC_PROVIDER=deepseek-judge
DATABASE_PATH=/data/guess-word.sqlite
APP_BIND_ADDRESS=0.0.0.0
APP_HOST_PORT=80
```

然后执行：

```bash
sudo sh scripts/deploy-aliyun.sh
```

脚本会校验配置、构建镜像、启动容器，并等待 `/api/health` 返回成功。当前服务直接通过 `http://<ECS公网IP>/` 访问。

## 运维

```bash
sudo docker compose --env-file .env.production -f docker-compose.aliyun.yml ps
sudo docker compose --env-file .env.production -f docker-compose.aliyun.yml logs -f --tail=100 guess-word
curl --fail http://127.0.0.1/api/health
```

题局数据位于 `guess-word-data` volume。更新应用时再次执行 `sudo sh scripts/deploy-aliyun.sh`，volume 不会被替换。不要执行 `docker compose down -v`，它会删除题局数据库。

可用管理员 Token 查看累计 AI 请求、Token、估算费用、持久缓存和反馈数量：

```bash
curl -H "Authorization: Bearer $ADMIN_API_TOKEN" http://127.0.0.1/api/admin/ai-stats
```

## ACR 自动构建与部署

仓库包含 `.github/workflows/deploy-aliyun.yml`。它在 `master` 更新时由 GitHub 托管 Runner 构建 `linux/amd64` 镜像，推送两个标签到阿里云 ACR：不可变的 Git commit SHA 和便于查看的 `latest`；实际部署始终使用 SHA 标签。随后工作流只把发布 Compose 和部署脚本传到 ECS，服务器不再依赖 GitHub 或 Docker Hub。

先在深圳地域的 ACR 个人版创建命名空间和名为 `guess-word` 的镜像仓库，并在 ECS 上使用 ACR 控制台“访问凭证”提供的命令完成一次 `docker login`。服务器上的 `/opt/guess-word/webapp/.env.production` 继续保存 DeepSeek Key，工作流不会上传、覆盖或读取该文件。

在 GitHub 仓库 `Settings → Environments → production` 中创建环境，并添加以下 Secrets：

| Secret | 内容 |
|---|---|
| `ACR_REGISTRY` | ACR 公网 Registry 域名，不含 `https://` |
| `ACR_NAMESPACE` | ACR 命名空间 |
| `ACR_USERNAME` | ACR 登录名 |
| `ACR_PASSWORD` | ACR 固定登录密码或最小权限凭据 |
| `ECS_HOST` | ECS 公网 IP 或主机名 |
| `ECS_USER` | 部署用户，当前单机方案可填 `root` |
| `ECS_SSH_PRIVATE_KEY` | 专用于 Actions 部署的 SSH 私钥 |
| `ECS_KNOWN_HOSTS` | 经可信渠道取得的 ECS SSH host key 行 |

部署 SSH 密钥应独立创建，只允许登录这台 ECS；把公钥追加到服务器部署用户的 `~/.ssh/authorized_keys`，私钥只保存为 GitHub environment secret。`ECS_KNOWN_HOSTS` 应从首次已验证的 SSH 连接或可信管理通道获取，不要在工作流中临时关闭 host key 校验。

Secrets 配置完成后，可以在 GitHub `Actions → Build and deploy to Aliyun → Run workflow` 首次手动执行。后续推送 `master` 会自动发布。手动回滚时，把目标 SHA 镜像传给服务器脚本：

```bash
cd /opt/guess-word/webapp
ACR_IMAGE='<registry>/<namespace>/guess-word:<commit-sha>' sh scripts/deploy-aliyun-release.sh
```
