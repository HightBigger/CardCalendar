# Cardfolio 部署与运行

## Linux + Docker 一键部署

先将域名解析到服务器 IP，放行 TCP 80/443。脚本默认启动 Caddy 自动配置 HTTPS；如果已有 Nginx、宝塔或其他 HTTPS 入口，使用 `--no-proxy`，将已有入口转发到 `127.0.0.1:3000`。

开发机先提交并推送发布代码，再推送版本标签（下面以 `v0.1.0` 为例）：

```bash
git push origin main
git tag -a v0.1.0 -m "Cardfolio v0.1.0"
git push origin v0.1.0
```

GitHub Actions 全部通过后，在已安装 Docker Engine 24+、Compose v2.20+、Git 和 OpenSSL 的 Linux 服务器执行：

```bash
git clone --branch v0.1.0 --depth 1 https://github.com/HightBigger/CardCalendar.git
cd CardCalendar
bash scripts/deploy.sh cards.example.com
```

将 `cards.example.com` 替换为实际域名。脚本会自动生成权限为 `600` 的 `.env.production` 和随机数据库密码，按当前提交生成 Web/worker 镜像标签，构建镜像、启动数据库、停止应用写入、备份数据库、执行迁移，再等待 Web、数据库和 worker 心跳就绪。Caddy 启动后自动申请证书，可用 `curl --fail https://cards.example.com/api/readyz` 验证公开入口。

默认启用待办、私人活动和银行活动浏览；周期执行、目录管理和目录加入仍分别由 `FEATURE_ACTIVITY_PERIODS`、`FEATURE_CATALOG_MANAGE`、`FEATURE_CATALOG_JOIN` 控制，默认关闭。全部开关会传入 Web、worker 和迁移容器。启用目录管理后还需通过 `scripts/catalog-role.ts` 为具体用户授予管理角色。

已有 HTTPS 入口时运行：

```bash
bash scripts/deploy.sh cards.example.com --no-proxy
```

重复执行会保留 `.env.production` 和数据库卷，迁移前将数据库备份到 `.deploy-backups/`，已有镜像按提交保留。构建失败不会停止现有应用；备份或迁移失败会停止发布，应用保持停止以便排查。脚本管理 Compose 内置的 PostgreSQL；使用外部托管数据库时按下方手动流程部署。

后续更新到新的、已通过 CI 的 tag 后再次运行脚本：

```bash
git fetch --tags
git checkout --detach v0.1.1
bash scripts/deploy.sh cards.example.com
```

排查日志（使用 `--no-proxy` 时去掉第二个 `-f` 和 `caddy`）：

```bash
APP_DOMAIN=cards.example.com docker compose --env-file .env.production -f docker-compose.production.yml -f docker-compose.https.yml logs --tail=100 web worker caddy
```

## 架构与强制配置

生产环境由三个独立运行单元组成：Next.js Web、pg-boss worker 和 PostgreSQL。`migrate` 是发布时的一次性任务，不与 Web 或 worker 并发执行。

`Dockerfile` 提供 `web` 和 `worker` 两个 target。Web 镜像只包含生产依赖；现有 worker 入口是 TypeScript 且通过 `tsx` 启动，因此 worker target 在生产依赖之上仅补入 lockfile 锁定的 `tsx` 和 `esbuild` 运行文件，不包含 Vitest/Vite 等测试工具。待应用构建产出可直接执行的 worker JavaScript 后，应移除这项运行时工具。

生产镜像和 Compose 均固定以下值，不接受部署环境覆盖：

```dotenv
USE_DATABASE=true
AUTH_DEV_HEADER=false
```

## 首次部署

需要 Docker Engine 24+ 和 Docker Compose v2.20+。先在部署主机准备未跟踪的环境文件：

```bash
cp .env.production.example .env.production
openssl rand -base64 32
```

将生成的高熵值写入 `POSTGRES_PASSWORD`，并将同一密码做 URL 编码后写入 `DATABASE_URL`。示例形式为 `postgresql://cardcalendar:<encoded-password>@postgres:5432/cardcalendar`。更好的做法是由部署平台的 Secret Manager 直接注入这两个值。不要提交 `.env.production`、真实连接串或镜像仓库凭据。

`APP_URL` 必须是用户访问的公开 HTTPS origin（例如 `https://cards.example.com`），否则生产写请求会被 CSRF 校验拒绝。只在确定流量必经会覆盖客户端转发头的受信入口网关时，才将 `RATE_LIMIT_TRUST_PROXY` 设为 `true`；直接暴露容器端口时必须保持 `false`。

验证解析结果并部署：

```bash
docker compose --env-file .env.production -f docker-compose.production.yml config --quiet
docker compose --env-file .env.production -f docker-compose.production.yml build
docker compose --env-file .env.production -f docker-compose.production.yml up -d postgres
docker compose --env-file .env.production -f docker-compose.production.yml run --rm migrate
docker compose --env-file .env.production -f docker-compose.production.yml up -d --no-deps web worker
```

对于外部托管的 PostgreSQL，不启动 Compose 中的 `postgres`，将 `DATABASE_URL` 改为托管库的 TLS 连接串，并使用 `docker compose ... run --rm --no-deps migrate` 防止 Compose 自动启动本地数据库，再在同一受控网络内运行 Web 和 worker。

样例中的 PostgreSQL tag 用于快速启动。一键脚本按提交 SHA 标记本地构建的应用镜像，保留上一版以便回滚；使用镜像仓库发布时，将 `POSTGRES_IMAGE`、`WEB_IMAGE` 和 `WORKER_IMAGE` 固定为已验证的 digest，避免可变 tag 指向其他镜像。

一键脚本在服务器从代码构建，以提交 SHA 标记应用镜像。当前 CI 只验证和构建镜像，不上传镜像仓库，也不连接服务器自动部署；推送 tag 后仍需在服务器运行脚本。

## 发布、验证与回滚

发布顺序固定为：数据库备份 -> `migrate` -> Web -> worker。迁移脚本可重复执行，但数据库迁移不随应用回滚。发布前应保留上一版 Web/worker 镜像的不可变 tag 或 digest。

```bash
curl --fail --show-error http://127.0.0.1:${WEB_PORT:-3000}/api/healthz
curl --fail --show-error http://127.0.0.1:${WEB_PORT:-3000}/api/readyz
docker compose --env-file .env.production -f docker-compose.production.yml ps
docker compose --env-file .env.production -f docker-compose.production.yml logs --tail=200 web worker
```

`/api/healthz` 只确认 Web 进程存活。`/api/readyz` 检查数据库与指定 worker 心跳，并在不就绪时返回 503；Compose 使用它作为 Web 就绪检查。`WORKER_HEARTBEAT_INTERVAL_SECONDS` 必须小于 `WORKER_HEARTBEAT_MAX_AGE_SECONDS`，时钟偏差也必须纳入最大时效设计。默认配置只运行一个名为 `primary` 的 worker；扩容 worker 前需先定义心跳命名和 readyz 聚合策略。

回滚时将 `WEB_IMAGE` 和 `WORKER_IMAGE` 指向上一个已验证的不可变镜像，重新启动 Web 和 worker；不要倒序执行已应用的 SQL 迁移。

## 平台运维

- PostgreSQL 不暴露公网端口；只允许 Web、worker 和受控迁移任务访问。
- 至少每日备份，设置保留周期，并定期在隔离环境执行恢复演练。
- 监控 Web 5xx/延迟、连接池耗尽、PostgreSQL 容量/复制/备份、worker 进程退出与 pg-boss 队列失败。
- 在入口网关终止 TLS，启用 HSTS/CSP、请求大小限制和分布式限流。
- 通过平台 Secret Manager 轮换数据库凭据；新旧凭据交叠验证后再撤销旧值。

## CI 门禁

`.github/workflows/ci.yml` 仅在推送 tag 时执行（包括带 `/` 的 tag 名称）；普通分支推送和 pull request 不触发。流程执行 lockfile 安装、TypeScript 检查、Vitest、临时 PostgreSQL 迁移/持久化验证、生产构建、Web/worker 镜像构建，以及生产依赖的 high/critical 漏洞审计。发布平台应只接受通过 CI 的 tag 对应提交。
