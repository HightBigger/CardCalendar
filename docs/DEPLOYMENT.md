# CardCalendar 部署与运行

## 架构与强制配置

生产环境由三个独立运行单元组成：Next.js Web、pg-boss worker 和 PostgreSQL。`migrate` 是发布时的一次性任务，不与 Web 或 worker 并发执行。

`Dockerfile` 提供 `web` 和 `worker` 两个 target。Web 镜像只包含生产依赖；现有 worker 入口是 TypeScript 且通过 `tsx` 启动，因此 worker target 在生产依赖之上仅补入 lockfile 锁定的 `tsx` 和 `esbuild` 运行文件，不包含 Vitest/Vite 等测试工具。待应用构建产出可直接执行的 worker JavaScript 后，应移除这项运行时工具。

生产镜像和 Compose 均固定以下值，不接受部署环境覆盖：

```dotenv
USE_DATABASE=true
AUTH_DEV_HEADER=false
```

## 首次部署

需要 Docker Engine 24+ 和 Docker Compose v2。先在部署主机准备未跟踪的环境文件：

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

样例中的 PostgreSQL tag 用于快速启动。正式发布应将 `POSTGRES_IMAGE`、`WEB_IMAGE` 和 `WORKER_IMAGE` 全部设为经 CI 验证的不可变 digest，避免同一 tag 在不同时间解析为不同镜像。

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

`.github/workflows/ci.yml` 在 pull request 和 `main` push 上执行 lockfile 安装、TypeScript 检查、Vitest、临时 PostgreSQL 迁移/持久化验证、生产构建、Web/worker 镜像构建，以及生产依赖的 high/critical 漏洞审计。发布平台应只接受通过 CI 的提交。
