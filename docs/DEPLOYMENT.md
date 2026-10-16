# Cardfolio 部署与运行

## Linux + Docker 一键部署

先将域名解析到服务器 IP，放行 TCP 80/443。脚本默认启动 Caddy 自动配置 HTTPS；如果已有 Nginx、宝塔或其他 HTTPS 入口，使用 `--no-proxy`，将已有入口转发到 `127.0.0.1:3000`。

在已安装 Docker Engine 24+、Compose v2.20+、curl、tar 和 OpenSSL，且当前用户可以运行 Docker 的 Linux 服务器上，粘贴这一条命令：

```bash
curl -fsSL https://raw.githubusercontent.com/HightBigger/CardCalendar/v0.1.4/scripts/install.sh | bash -s -- cards.example.com
```

将 `cards.example.com` 替换为实际域名。不需要 Git、Node.js 或手动克隆仓库。安装脚本会下载固定 tag 的源码，在服务器构建 Web/worker 镜像；首次构建需要几分钟，服务器需要能访问 GitHub、Docker Hub 和 npm。

默认安装目录为 `~/cardfolio`：

```text
~/cardfolio/
  .env.production       # 配置与随机数据库密码，权限 600
  .deploy-backups/      # 每次迁移前的数据库备份
  releases/v0.1.4/      # 固定版本源码
  current -> releases/v0.1.4
```

脚本自动构建镜像、启动数据库、停止应用写入、备份数据库、执行迁移，再等待 Web、数据库和 worker 心跳就绪。镜像使用发布版本作为标签。Caddy 启动后自动申请证书，可用 `curl --fail https://cards.example.com/api/readyz` 验证公开入口。数据库和证书保存在 Docker 的持久卷中。

默认启用待办、私人活动和银行活动浏览；周期执行、目录管理和目录加入仍分别由 `FEATURE_ACTIVITY_PERIODS`、`FEATURE_CATALOG_MANAGE`、`FEATURE_CATALOG_JOIN` 控制，默认关闭。全部开关会传入 Web、worker 和迁移容器。启用目录管理后还需通过 `scripts/catalog-role.ts` 为具体用户授予管理角色。

已有 HTTPS 入口时，在同一命令末尾追加 `--no-proxy`；自定义目录可追加 `--dir /opt/cardfolio`（需对该目录有写入权限）：

```bash
curl -fsSL https://raw.githubusercontent.com/HightBigger/CardCalendar/v0.1.4/scripts/install.sh | bash -s -- cards.example.com --no-proxy --dir /opt/cardfolio
```

重复执行同一命令会保留配置、备份和数据库卷，也可用于失败后重试。安装目录设有锁，同一时间只允许一次安装。下载或解压失败不会执行部署；构建失败不会停止现有应用；备份或迁移失败会停止发布，应用保持停止以便排查。`current` 只在部署通过后更新；源码目录切换不等于数据库回滚。脚本管理 Compose 内置的 PostgreSQL；使用外部托管数据库时按下方手动流程部署。

后续更新时，使用新版本发布说明提供的命令，沿用同一个域名、安装目录和 `--no-proxy` 选项。各版本共享根目录的配置和备份，旧版本源码和镜像保留。

也支持从 Git 仓库手动部署：

```bash
git clone --branch v0.1.4 --depth 1 https://github.com/HightBigger/CardCalendar.git
cd CardCalendar
bash scripts/deploy.sh cards.example.com
```

Git 克隆方式将配置和备份放在仓库根目录，镜像使用提交 SHA 标签。不要把一键安装命令的 `--dir` 指向已有 Git 仓库；继续使用仓库中的 `scripts/deploy.sh` 更新。

一键安装后排查日志（使用 `--no-proxy` 时去掉第二个 `-f` 和 `caddy`，自定义目录需对应修改）：

```bash
cd ~/cardfolio/current
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

样例中的 PostgreSQL tag 用于快速启动。一键脚本按发布版本（Git 克隆方式为提交 SHA）标记本地构建的应用镜像，保留上一版以便回滚；使用镜像仓库发布时，将 `POSTGRES_IMAGE`、`WEB_IMAGE` 和 `WORKER_IMAGE` 固定为已验证的 digest，避免可变 tag 指向其他镜像。

一键脚本在服务器从代码构建。当前 CI 只验证和构建镜像，不上传镜像仓库，也不连接服务器自动部署；推送 tag 后仍需在服务器运行安装命令。

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

发布新版本时先将 `scripts/install.sh` 中的 `install_version` 和本文安装链接更新为新版本，再提交代码、创建并推送同名 tag；不要移动已发布的 tag。待 tag 的 CI 全部通过后再使用安装命令。

修改安装或部署脚本时，运行 `bash scripts/verify-install.sh` 检查安装目录、配置保留、并发锁和失败后的重试行为。该检查使用本地源码包并模拟 Docker 操作，不启动服务；实际镜像构建由 CI 验证。
