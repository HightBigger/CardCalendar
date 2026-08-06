# CardCalendar 技术方案

文档版本：v0.2
适用范围：信用卡年费管理 Web MVP
对应产品文档：[PRD.md](./PRD.md)

本文同时记录当前 MVP 实现和生产演进方案。凡标记为“生产加固”的内容尚未在当前代码中实现，不应作为现状能力对外承诺。实际交付、运行命令和验收证据以 [MVP-DELIVERY.md](./MVP-DELIVERY.md) 为准。

## 0. 当前实施状态

已实现：Next.js 模块化单体、npm lockfile、React 响应式界面、PostgreSQL/内存双仓储、Drizzle schema、SQL 迁移、pg-boss worker、Argon2 密码哈希、cookie 会话、年费/周期/提醒领域逻辑、审计日志、Vitest、Playwright 和临时 PostgreSQL 验证。

生产加固：平台 HTTPS/CSP/HSTS、Origin/CSRF 防护、分布式限流、Sentry、集中日志、readyz、CI 漏洞扫描、备份恢复演练和 worker 失败告警。

## 1. 设计目标与约束

### 1.1 目标

- 支持个人用户安全录入信用卡、年费规则和免年费进度。
- 按用户时区计算年费日、周期和站内提醒，结果可追溯、可重算。
- 以单体应用快速交付，保留清晰的领域边界，便于后续拆分。
- 数据写入有事务和幂等保证；重复执行任务不会重复生成事件或提醒。

### 1.2 明确不做

- 不接入银行 API，不保存完整卡号、CVV、网银密码或账单凭据。
- MVP 不引入微服务、事件总线、复杂实时协作和多租户计费。
- 只保证站内提醒；邮件、短信、Push 作为后续通知适配器。

### 1.3 关键技术决策

| 决策 | 推荐方案 | 原因 |
| --- | --- | --- |
| Web 与服务端 | Next.js App Router + TypeScript | 前后端同仓库，适合小团队，支持 SSR、路由和 API |
| UI | React + 原生 CSS + lucide-react | 依赖少，当前 MVP 已实现响应式和移动端布局 |
| 数据库 | PostgreSQL 16（托管） | 事务、日期类型、约束和备份成熟 |
| ORM/迁移 | Drizzle ORM + SQL migration | 类型安全，SQL 可控，迁移可审查 |
| 后台任务 | 独立 Node.js worker + pg-boss | 复用 PostgreSQL，不为 MVP 额外维护 Redis |
| 日期计算 | date-fns + date-fns-tz，统一封装 | 明确区分业务日期和用户时区 |
| 测试 | Vitest + Playwright | 覆盖领域计算和真实浏览器流程 |
| 部署 | Web、worker、PostgreSQL 分别托管 | 可独立发布；优先选择 Render/Fly.io/Railway 等简单平台 |

Node.js 要求 20.11+；当前使用 npm 11 和 package-lock.json 锁定依赖。若部署平台已有可靠 Cron，可由 Cron 触发任务；否则 worker 常驻消费 pg-boss 队列。

## 2. 系统分层与模块边界

采用模块化单体（modular monolith），每个业务模块内部保持四层边界：

1. **Presentation**：页面、表单、API Route Handler；只做鉴权、解析输入、返回输出。
2. **Application**：用例编排和事务边界，例如创建卡片、追加进度、处理年费事件。
3. **Domain**：纯业务规则和计算，不依赖 HTTP、ORM 或队列，例如周期计算、进度达标判断、提醒节点计算。
4. **Infrastructure**：Drizzle repository、会话存储、pg-boss、时钟、日志和外部服务适配器。

业务模块边界如下：

- `auth`：注册、登录、退出、会话、密码策略、账户删除流程。
- `users`：个人资料和 IANA 时区设置。
- `cards`：卡片基本资料、状态、归档和所有权校验。
- `fee-rules`：年费周期、免年费条件及规则版本。
- `cycles`：免年费周期生成、锁定和切换。
- `progress`：进度累计值、增量记录、撤销与达标状态。
- `fee-events`：年费事件生成、处理状态、实际扣费/退费信息。
- `reminders`：提醒规则、提醒实例、完成/忽略/稍后处理。
- `dashboard`：只读聚合查询，不持有业务写入规则。
- `export`：按用户导出 JSON/CSV；账户删除和审计记录。

模块之间通过 application service 或明确的 domain port 调用，不直接读取其他模块的表。共享代码只允许放在 `shared`（错误、ID、分页、日期、验证）中，禁止把业务逻辑放入通用工具。

## 3. 数据模型

所有表使用 UUID 主键、`created_at`/`updated_at`（UTC `timestamptz`）。用户可见日期另存为 `date` 或带时区的 Instant，展示时转换到用户时区。

核心实体：

- `users`：`id`、`email`（唯一、规范化）、`password_hash`、`timezone`、`status`、`deleted_at`。
- `sessions`：`id`、`user_id`、`token_hash`、`expires_at`、`last_seen_at`、`revoked_at`、创建来源；只存 token 哈希。
- `cards`：`id`、`user_id`、`issuer_name`、`name`、`last4`、`status`（active/suspended/archived）、年费和免年费规则字段、`currency`、`note`。MVP 将当前规则直接放在卡片表，规则变更由周期快照保证历史不变；未来规则版本复杂后再拆分 `fee_rules` 表。
- `fee_cycles`：`card_id`、规则快照、周期起止 `date`、目标快照、累计次数和金额、`status`（open/qualified/closed）；`(card_id, start_date)` 唯一。
- `progress_entries`：`cycle_id`、`occurred_on`、次数/金额增量、备注、`reversed_at`；金额使用 `numeric(14,2)`，禁止负数（撤销通过反向状态处理）。
- `fee_events`：`card_id`、`cycle_id`、事件日期、预期金额、`status`（pending/waived/charged/refunded/not_applicable）、实际金额/日期、备注；`(fee_cycle_id)` 唯一。
- `reminder_rules`：`user_id` 或 `card_id`、提前天数、启用状态、免打扰设置；默认 30/7/1 天。
- `reminders`：`fee_event_id` 或 `fee_cycle_id`、规则 ID、计划时间 `scheduled_for`、`status`（pending/completed/snoozed/ignored/cancelled）；通过关联对象、计划时间和类型的唯一索引保证幂等。
- `audit_logs`：用户、操作、资源类型/ID、结果、请求 ID、时间和必要的脱敏元数据。

重要约束：所有业务表带 `user_id` 或可通过关联得到用户；repository 查询必须同时带当前用户 ID。归档不删除历史。账户删除采用软删除后异步清理，导出在删除前完成。

## 4. 主要数据流

### 4.1 新增卡片

浏览器提交表单 -> API 运行时校验和会话 -> `cards` 事务写入当前年费规则 -> 创建或更新当前 `fee_cycle` -> 为未来 12 个月执行幂等的 `fee_event` reconcile -> 写 `audit_log` -> 返回卡片详情。

### 4.2 更新进度

提交增量或累计值 -> application service 锁定开放周期 -> 校验不超过业务允许范围并写 `progress_entry` -> 重新汇总周期（可用 SQL `SUM`）-> 更新 `fee_cycle.status` -> 达标时取消该周期未发送的进度提醒 -> 返回最新进度。

### 4.3 年费事件与提醒

每日任务按 UTC 扫描未来窗口和逾期窗口 -> 根据用户时区将事件日期转换为提醒 Instant -> `fee_events` 和 `reminders` 使用唯一约束 upsert -> worker 将到期提醒保持为 `pending` 并展示在提醒中心 -> 用户完成/忽略/稍后处理 -> 状态变更写审计日志。任务失败可重试，成功条件以唯一约束判断。

### 4.4 账户导出/删除

用户二次确认 -> 服务端再次校验所有权 -> 同步返回 JSON 导出（不包含密码哈希和会话 token），或标记删除申请、撤销会话并由 worker 异步清理业务数据 -> 记录审计结果。CSV 和异步对象存储导出属于 P1。

## 5. 认证与安全

当前 MVP 已实现：

- 注册与登录使用邮箱和密码；密码使用 Argon2，应用不保存密码明文。
- 登录后生成 32 字节随机 session token；浏览器 cookie 使用 `HttpOnly`、`SameSite=Lax`，生产环境增加 `Secure`；数据库只保存 SHA-256 token 哈希和过期时间。
- API 在服务端解析会话并执行用户所有权过滤，不接受客户端指定 `user_id`；资源 ID 使用 UUID。
- 只接受四位 `last4`；JSON 导出不包含密码哈希或 session token。
- 生产模式禁用 `x-user-id` 调试入口；账户删除申请会撤销该用户全部会话。
- 关键写操作记录脱敏审计日志，状态历史可按用户和资源过滤。

公网部署前必须加固：

- 配置 HTTPS、HSTS、CSP、`X-Content-Type-Options`、`Referrer-Policy` 和可信代理。
- 对写请求增加 Origin/CSRF 校验；对登录、注册、导出和删除增加平台或分布式限流。
- 数据库使用 TLS 和最小权限账号，Secret 由部署平台注入；启用自动备份和恢复演练。
- 在 CI 启用依赖漏洞与 Secret 扫描；错误追踪和日志采集必须配置 PII 脱敏。

## 6. API 规范

API 前缀为 `/api/v1`，JSON UTF-8，使用 cookie 会话。页面内部也统一调用 application service，避免出现两套业务规则。

### 6.1 资源示例

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `POST` | `/auth/register` | 注册并创建会话 |
| `POST` | `/auth/login` | 登录 |
| `POST` | `/auth/logout` | 撤销当前会话 |
| `GET/PATCH` | `/me` | 获取/修改时区和个人设置 |
| `GET/POST` | `/cards` | 查询/创建卡片 |
| `GET/PATCH` | `/cards/{cardId}` | 查看/编辑卡片 |
| `POST` | `/cards/{cardId}` | 归档或恢复（archive/restore） |
| `GET` | `/cards/{cardId}/cycles` | 周期和进度 |
| `GET` | `/cards/summary` | 卡片列表汇总（下一期年费状态与达标进度） |
| `POST` | `/cycles/{cycleId}/progress-entries` | 新增进度记录 |
| `PATCH` | `/cycles/{cycleId}/progress-entries/{entryId}` | 编辑进度记录 |
| `POST` | `/cycles/{cycleId}/progress-entries/{entryId}/reverse` | 撤销进度记录 |
| `POST` | `/fee-events/{eventId}/status` | 更新年费处理状态 |
| `GET` | `/fee-events/{eventId}/history` | 查询年费事件状态审计历史 |
| `GET` | `/fee-events?from=&to=&status=` | 日历/列表查询 |
| `GET` | `/reminders` | 提醒中心 |
| `GET/PUT` | `/reminders/rules` | 查看/保存全局提醒规则 |
| `POST` | `/reminders/{id}/actions` | 完成、忽略、稍后处理 |
| `GET` | `/me/export` | 导出全部 JSON 数据 |
| `POST` | `/me/delete-request` | 申请删除账户 |

### 6.2 请求与响应约定

- 当前成功响应统一为 `{ "data": ... }`；列表量按个人用户 MVP 规模直接返回。
- 错误统一为 `{ "error": { "code": "VALIDATION_ERROR", "message": "...", "details": [...], "request_id": "..." } }`。`message` 可展示，`code` 稳定供前端判断。
- 当前状态码包括 `400` 参数错误、`401` 未登录、`403` 无权限、`404` 资源不存在、`409` 状态冲突、`422` 业务校验失败和 `5xx` 服务错误。
- 事件和提醒生成通过数据库唯一约束及 repository upsert 保证幂等。
- 分页、`Idempotency-Key`、ETag/乐观锁和应用级 `429` 限流属于数据量或并发增加后的演进项。

## 7. 任务与提醒机制

### 7.1 队列与任务

使用 pg-boss 建立 `calendar.reconcile`、`reminder.dispatch`、`account.cleanup` 队列；`export.generate` 仅预留队列名，当前 JSON 导出为同步响应。任务 payload 不放敏感数据。

- `calendar.reconcile`：每天运行一次，并允许手动触发指定用户；生成未来 12 个月事件、补齐新周期。按 `(card_id, event_date)` 幂等。
- `reminder.dispatch`：每 5 分钟扫描活跃用户的待处理事件，按提醒规则幂等补齐提醒实例；前端提醒中心展示待处理和稍后处理记录。
- `account.cleanup`：账户删除确认后执行，分批删除关联数据，失败可重试；保留最小化合规审计记录。
- `export.generate`：P1 大数据量场景再实现异步生成和短期对象存储地址；MVP 同步返回 JSON。

当前依赖 pg-boss 的持久化队列和调度能力。上线前需明确配置最大重试、指数退避、失败告警、run_id、耗时指标和 singleton 并发约束。

### 7.2 日期和时区规则

- 数据库存储 Instant 使用 UTC；用户设置保存 IANA 时区（如 `Asia/Shanghai`），不保存固定偏移。
- 年费事件的业务日期是用户时区的 `PlainDate`。提醒时间默认为该日期当地 09:00，再转换成 UTC Instant；若用户设置免打扰，顺延到下一个允许时段。
- 周期和提醒核心计算集中在 `shared/time` 与领域模块，并通过固定时钟测试覆盖跨时区行为。界面层和应用编排允许使用 `Date` 处理当前时间。
- 用户修改时区后，只重算未来未触发提醒的 `scheduled_for`，历史记录保持原始 Instant 和展示时区无关。

## 8. 部署与环境

### 8.1 环境

- `development`：Docker Compose 启动 PostgreSQL，worker 可本地常驻运行。
- `staging`：独立数据库和密钥，启用真实迁移、备份恢复演练和 E2E。
- `production`：Web、worker、PostgreSQL、对象存储分开配置；禁止生产数据库从开发机直连。

### 8.2 发布流程

1. Pull Request 运行格式检查、TypeScript、lint、单元测试、迁移校验和依赖扫描。
2. 合并主分支后构建不可变镜像/构建产物，先部署 staging 并运行 Playwright smoke test。
3. 生产发布按 `db migrate -> web -> worker` 顺序进行；迁移只做向前兼容，破坏性变更拆成多次发布。
4. 保留上一个 Web/worker 版本，支持快速回滚；回滚不回滚已执行的数据库迁移。

### 8.3 配置

当前运行配置：

- `USE_DATABASE=true`：生产必须启用 PostgreSQL 仓储。
- `DATABASE_URL`：数据库模式、迁移和 worker 必填。
- `DATABASE_POOL_MAX`：可选，默认 10。
- `AUTH_DEV_HEADER=false`：生产必须关闭。
- `NODE_ENV=production`：确保 session cookie 带 `Secure`。

`SESSION_SECRET`、`APP_URL` 和 `CRON_SECRET` 当前为平台接入预留；启用签名 cookie、外部 Cron 或公开回调时再接入并执行启动校验。

## 9. 可观测性与运维

当前已实现：

- `/api/healthz` 进程健康检查。
- API 错误响应包含 request_id。
- 年费规则、进度、事件、归档、提醒、导出和账户删除等关键操作写入 `audit_logs`；普通列表读取不写审计。

生产加固：

- 接入结构化 JSON 日志、Sentry 或同等错误追踪，并配置 PII 脱敏。
- 增加 API 错误率/p95、登录失败率、任务成功/积压、连接池和删除耗时指标。
- 增加 `/api/readyz` 检查数据库与 worker 心跳。
- 设置 5xx、延迟、队列积压、连接耗尽和备份失败告警。

## 10. 测试策略

当前质量门禁：

- Vitest 30 项：认证、日期、免年费规则、进度、卡片同步、事件 reconcile、提醒规则/幂等和审计隔离。
- Playwright 主流程：注册、建卡、进度编辑、达标、事件处理历史、提醒取消、日历双视图和 390px 移动端无横向溢出。
- `db:verify`：临时 PostgreSQL 全量迁移、9 张表冒烟和审计日志写读。
- `next build`：生产构建和 Next.js 类型检查。

上线前补充：独立 API 越权合约套件、备份恢复演练、worker 故障重试、依赖/Secret 扫描和跨浏览器 E2E。

## 11. 当前目录结构

```text
.
├── app/
│   ├── api/v1/...
│   ├── login/page.tsx
│   └── page.tsx
├── components/
│   ├── mvp-app.tsx
│   ├── dashboard-shell.tsx
│   └── api.ts
├── src/
│   ├── modules/
│   │   ├── auth/
│   │   ├── cards/
│   │   ├── cycles/
│   │   ├── progress/
│   │   ├── fee-events/
│   │   ├── reminders/
│   │   ├── export/
│   │   └── account/
│   ├── shared/{audit,db,time,validation,errors,store}/
│   └── workers/
├── db/
│   ├── schema/
│   └── migrations/
├── e2e/
├── scripts/{migrate.ts,db-smoke.ts,db-verify.ts}
├── docs/{PRD.md,TECHNICAL.md,DATABASE.md,MVP-DELIVERY.md}
├── docker-compose.yml
└── package.json
```

页面组件不直接访问数据库；API Route Handler 调用模块 service，service 通过 repository 选择内存或 PostgreSQL 实现。当前为同仓库模块化单体，不在 MVP 阶段拆分微服务。

## 12. 分阶段实施

当前进度：

| 阶段 | 状态 |
| --- | --- |
| Phase 0 工程基线 | 已完成 |
| Phase 1 核心闭环 | 已完成 |
| Phase 2 进度与站内提醒 | 已完成 |
| Phase 3 上线准备 | MVP 功能已完成；平台安全、监控、备份和 CI 待生产部署补齐 |
| Phase 4 P1 | 未开始 |

### Phase 0：工程基线（1--2 天）

- 初始化 Next.js/TypeScript/pnpm、代码规范、环境配置和 Docker Compose PostgreSQL。
- 建立 Drizzle schema/migration、错误格式、日志、CI 和健康检查。

### Phase 1：可用核心闭环（约 1 周）

- 注册/登录/退出、时区设置、卡片 CRUD/归档。
- 年费规则、周期和事件生成；首页、卡片详情和基础 API。
- 领域单元测试覆盖日期、周期、进度计算。

### Phase 2：进度与站内提醒（约 1 周）

- 进度记录、撤销、达标状态和历史。
- pg-boss worker、提醒规则/实例、提醒中心、默认 30/7/1 天节点。
- Playwright 主流程和任务幂等测试。

### Phase 3：上线准备（约 3--5 天）

- 搜索筛选排序、事件状态历史、数据导出和账户删除。
- HTTPS/安全响应头/限流、Sentry、指标告警、备份恢复演练。
- staging 验收、迁移演练、生产发布和回滚手册。

### Phase 4：P1（按反馈排期）

- 权益与收益记录、CSV 导入导出、邮件/Push 通知适配器、银行/卡种模板。
- 当任务量或团队规模确实需要时，再引入 Redis、独立读模型或拆分服务；先以指标证明瓶颈。

## 13. MVP 风险与取舍

- **提醒可靠性**：站内提醒没有外部投递依赖，但 worker 和数据库仍需监控；所有任务必须可重跑。
- **日期歧义**：固定日、开卡周年日和自定义周期统一转成明确的 `PlainDate`，产品界面显示规则来源和周期起止日。
- **金额精度**：数据库和领域层使用 decimal，不用 JavaScript 浮点数直接累计。
- **隐私边界**：尾号仅用于识别，代码审查和自动化扫描阻止完整卡号字段进入模型、日志或分析平台。
- **过早扩展**：MVP 采用单体和 Postgres 队列，保留模块边界；只有出现可观测的吞吐或团队协作瓶颈时再拆分。
