# CardCalendar MVP 交付说明

文档版本：v1.0  
交付日期：2026-08-06  
适用版本：当前 main 分支

## 1. 交付结论

CardCalendar 已形成可运行、可演示、可接 PostgreSQL 的 Web MVP。核心闭环为：

注册/登录 -> 新增信用卡 -> 自动生成年费周期和事件 -> 更新免年费进度 -> 处理年费事件 -> 管理提醒 -> 导出或申请删除账户

本版本用于小团队内部验收、用户试用和后续部署准备。面向公网正式运营前，仍需完成本文“生产部署边界”中的平台级安全与运维工作。

## 2. 已交付能力

| 领域 | 已交付内容 |
| --- | --- |
| 账号 | 邮箱注册、登录、退出、Argon2 密码哈希、随机会话、IANA 时区设置 |
| 卡片 | 新增、编辑、详情、归档、恢复、尾号四位校验、年费与免年费规则 |
| 周期 | 创建当前周期，幂等补齐未来 12 个月年费事件，关闭过期周期 |
| 进度 | 次数/金额增量、百分比、剩余量、达标状态、记录编辑、最近记录撤销 |
| 年费事件 | 待确认、已免除、已扣费、已退费、无需处理，支持实际金额、日期和备注 |
| 日历 | 月视图、列表视图、按月份浏览和状态展示 |
| 提醒 | 默认提前 30/7/1 天、自定义节点、完成、忽略、稍后处理、逾期提示 |
| 查询 | 银行/卡名/尾号搜索，状态、年费状态、日期、达标状态筛选和排序 |
| 账户数据 | JSON 全量导出、删除申请、会话撤销、worker 异步清理 |
| 审计 | 注册登录、卡片、进度、事件、提醒、导出、删除和匿名化操作留痕 |
| 后台任务 | calendar.reconcile、reminder.dispatch、account.cleanup |

## 3. MVP 验收对照

| PRD 验收项 | 当前证据 |
| --- | --- |
| 新用户注册、登录和建卡 | Playwright 主流程覆盖注册和首张卡创建 |
| 刷新后数据存在 | 会话 cookie 与服务端仓储生效；PostgreSQL 模式可跨进程持久化 |
| 卡片详情展示规则和进度 | 卡片详情包含周期、年费、规则、进度和记录 |
| 进度计算和非法输入校验 | 领域测试覆盖次数、金额、组合规则；API 拒绝负数和空增量 |
| 未来 12 个月事件和归档行为 | reconcile 与卡片服务单测覆盖幂等生成、归档取消提醒 |
| 30/7/1 天提醒与时区 | 提醒领域测试覆盖 Asia/Shanghai 当地 09:00 转换和幂等 |
| 五种年费状态和历史 | E2E 覆盖待确认到已免除，并验证审计历史展示 |
| 页面导航和移动端 | E2E 使用 390x844 视口并检查无横向溢出和日历双视图 |
| 用户数据隔离 | repository 查询均带 userId；审计测试覆盖跨用户过滤 |
| JSON 导出和账户删除确认 | 设置页提供二次确认；操作写入审计日志 |
| 核心测试和构建 | 30 项单元测试、Playwright 主流程、数据库验证、生产构建均通过 |

## 4. 运行模式

### 4.1 演示模式

默认 USE_DATABASE=false，使用进程内共享仓储。适合快速试用和 E2E，不适合生产：

- 浏览器刷新后数据仍在；
- 开发服务器重启后数据清空；
- 不应把此模式用于真实用户数据。

### 4.2 PostgreSQL 模式

设置 USE_DATABASE=true 和 DATABASE_URL 后，账号、卡片、周期、事件、提醒和审计日志均写入 PostgreSQL。

~~~bash
docker compose up -d postgres
cp .env.example .env
npm run db:migrate
npm run dev
~~~

确认 .env 中：

~~~dotenv
USE_DATABASE=true
DATABASE_URL=postgres://cardcalendar:cardcalendar@localhost:5432/cardcalendar
AUTH_DEV_HEADER=false
~~~

## 5. 开发和验证

要求 Node.js 20.11+，包管理器为 npm。

~~~bash
npm install --legacy-peer-deps --no-audit --no-fund
npm run typecheck
npm test
npm run test:e2e
npm run db:verify
npm run build
~~~

db:verify 会启动临时 PostgreSQL，执行全部迁移、检查 10 张业务表，并验证审计日志真实写入和读取，完成后自动清理。

## 6. 部署组成

生产最小拓扑由三个进程组成：

1. Web：执行迁移后的 npm run start，提供页面和 /api/v1。
2. Worker：运行 npm run worker，负责周期补齐、提醒生成和账户清理。
3. PostgreSQL：使用托管 PostgreSQL 16，配置备份、TLS 和最小权限账号。

推荐发布顺序：

数据库备份 -> npm run db:migrate -> 部署 Web -> 部署 Worker -> /api/healthz -> 主流程 smoke

## 7. 环境变量

| 变量 | 用途 | 生产要求 |
| --- | --- | --- |
| DATABASE_URL | PostgreSQL 连接串 | PostgreSQL 模式和 worker 必填 |
| USE_DATABASE | 是否启用数据库仓储 | 生产必须为 true |
| DATABASE_POOL_MAX | 连接池上限 | 默认 10，按托管数据库容量调整 |
| AUTH_DEV_HEADER | 本地 x-user-id 调试入口 | 生产必须为 false |
| NODE_ENV | Next.js 运行环境 | 生产使用 production |
| APP_URL | 公开 HTTPS 访问 origin | 生产必填；用于写请求 Origin 校验 |

`APP_URL` 是生产写请求 Origin 校验的必填公开 HTTPS origin。当前会话使用高熵随机 token 和数据库 token 哈希；`SESSION_SECRET` 与 `CRON_SECRET` 仍为后续平台接入预留。

## 8. 生产部署边界

以下项目不属于当前代码内 MVP 闭环，但在公网正式运营前应由部署平台补齐：

- TLS 终止、可信代理配置，以及将已实现的 HSTS/CSP/Origin 防护接入公开入口；
- 登录/注册/导出/删除接口的分布式限流（当前代码提供单实例限流）；
- Sentry 或同类错误追踪、结构化日志采集、指标和告警；
- PostgreSQL 自动备份、恢复演练和密钥轮换；
- Secret 扫描与发布环境的 CI 强制策略；
- worker 失败任务告警和 readyz 外部监测（当前代码已提供 worker 心跳与数据库就绪检查）。

## 9. 明确不包含

- 银行 API、账单自动同步、短信、邮件和 Push；
- 完整卡号、CVV、网银密码或银行登录凭据；
- CSV 导入导出、权益收益、多人共享和金融建议；
- 高并发、多地域、微服务和复杂计费。

上述内容按 PRD 归入 P1/P2，不影响本次 MVP 交付。
