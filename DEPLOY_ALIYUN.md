# GuessWord 阿里云 ECS 部署

当前部署目标是单台 Linux ECS，使用 Docker 运行 Next.js standalone 服务，题局数据保存在具名 Docker volume 的 SQLite 数据库中。这个方案适合朋友小范围试玩，不用于多实例横向扩容。

## ECS 前置条件

- 推荐至少 2 vCPU、2 GiB 内存、20 GiB 系统盘；
- Alibaba Cloud Linux 3、Ubuntu 22.04/24.04 或 Debian 12；
- 已分配公网 IPv4；
- 安全组只向管理 IP 开放 SSH 22，向玩家开放 TCP 80；绑定域名和证书后再开放 443；
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
```

然后执行：

```bash
npm run deploy:aliyun
```

脚本会校验配置、构建镜像、启动容器，并等待 `/api/health` 返回成功。通过后可以访问 `http://ECS公网IP/`。

## 运维

```bash
docker compose -f docker-compose.aliyun.yml ps
docker compose -f docker-compose.aliyun.yml logs -f --tail=100 guess-word
curl --fail http://127.0.0.1/api/health
```

题局数据位于 `guess-word-data` volume。更新应用时再次执行 `npm run deploy:aliyun`，volume 不会被替换。不要执行 `docker compose down -v`，它会删除题局数据库。

正式绑定域名时，应在前面增加阿里云负载均衡或 HTTPS 反向代理，证书和 443 配置完成后再把链接发给更多用户。
