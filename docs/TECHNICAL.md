# CardCalendar 技术方案

文档版本：v0.1
适用范围：信用卡年费管理 Web MVP
对应产品文档：[PRD.md](./PRD.md)

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
| UI | React + Tailwind CSS + 现有组件库（如 shadcn/ui） | 快速实现响应式和可访问表单 |
| 数据库 | PostgreSQL 16（托管） | 事务、日期类型、约束和备份成熟 |
| ORM/迁移 | Drizzle ORM + SQL migration | 类型安全，SQL 可控，迁移可审查 |
| 后台任务 | 独立 Node.js worker + pg-boss | 复用 PostgreSQL，不为 MVP 额外维护 Redis |
| 日期计算 | `Temporal` polyfill 或 `date-fns-tz`，统一封装 | 明确区分 Instant、PlainDate 和用户时区 |
| 测试 | Vitest + Playwright | 覆盖领域计算和真实浏览器流程 |
| 部署 | Web、worker、PostgreSQL 分别托管 | 可独立发布；优先选择 Render/Fly.io/Railway 等简单平台 |

Node.js 使用当前 LTS 版本；锁定包管理器（推荐 pnpm）和依赖版本。若部署平台已有可靠 Cron，可由 Cron 触发 worker；否则 worker 常驻消费队列。

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

浏览器提交表单 -> API 校验（Zod）和会话 -> `cards` 事务写入当前年费规则 -> 创建或更新当前 `fee_cycle` -> 为未来 12 个月执行幂等的 `fee_event` upsert -> 写 `audit_log` -> 返回卡片详情。

### 4.2 更新进度

提交增量或累计值 -> application service 锁定开放周期 -> 校验不超过业务允许范围并写 `progress_entry` -> 重新汇总周期（可用 SQL `SUM`）-> 更新 `fee_cycle.status` -> 达标时取消该周期未发送的进度提醒 -> 返回最新进度。

### 4.3 年费事件与提醒

每日任务按 UTC 扫描未来窗口和逾期窗口 -> 根据用户时区将事件日期转换为提醒 Instant -> `fee_events` 和 `reminders` 使用唯一约束 upsert -> worker 将到期提醒保持为 `pending` 并展示在提醒中心 -> 用户完成/忽略/稍后处理 -> 状态变更写审计日志。任务失败可重试，成功条件以唯一约束判断。

### 4.4 账户导出/删除

用户二次确认 -> 创建一次性导出任务或删除任务 -> 服务端再次校验所有权 -> 以流式 JSON/CSV 导出（不包含密码哈希和会话 token）或事务标记 `deleted_at`、撤销会话并异步清理业务数据 -> 记录审计结果。

## 5. 认证与安全

- 注册与登录使用邮箱 + 密码；密码使用 Argon2id（合理的内存/时间参数，参数写入配置并可升级），绝不记录明文或可逆密文。
- 登录成功后生成高熵随机 session token，浏览器仅保存 `HttpOnly`、`Secure`、`SameSite=Lax` cookie；数据库保存 SHA-256(token) 及过期时间。退出立即撤销当前会话，支持“退出所有设备”。
- 所有写请求检查 Origin/CSRF token；CORS 默认关闭，仅允许同源。设置 CSP、HSTS、`X-Content-Type-Options`、`Referrer-Policy` 等安全响应头。
- API 和页面都执行服务端用户所有权校验，不能信任客户端传来的 `user_id`。ID 使用 UUID，错误响应不泄露资源是否存在。
- 登录、注册、导出和删除接口按 IP + email 限流；连续失败使用指数退避。生产环境可接入平台 WAF/Turnstile，限流存储升级到 Redis 时保持接口不变。
- 只接受 `last4` 四位数字；日志、埋点、错误上报统一脱敏。禁止把表单原文和数据库连接串写入日志。
- 数据库连接使用 TLS 和最小权限账号；密钥仅通过部署平台 Secret 注入。每日自动备份，至少保留 7/30 天两档，并定期演练恢复。
- 依赖启用 lockfile、Dependabot/Renovate 和 CI 漏洞扫描；生产错误页不展示堆栈。

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
| `GET` | `/fee-events?from=&to=&status=` | 日历/列表查询 |
| `GET` | `/reminders` | 提醒中心 |
| `GET/PUT` | `/reminders/rules` | 查看/保存全局提醒规则 |
| `POST` | `/reminders/{id}/actions` | 完成、忽略、稍后处理 |
| `GET` | `/me/export` | 导出全部 JSON 数据 |
| `POST` | `/me/delete-request` | 申请删除账户 |

### 6.2 请求与响应约定

- 成功返回资源或 `{ "data": ..., "meta": ... }`；列表支持 `page`、`page_size`（默认 20，最大 100）和稳定排序。
- 错误统一为 `{ "error": { "code": "VALIDATION_ERROR", "message": "...", "details": [...], "request_id": "..." } }`。`message` 可展示，`code` 稳定供前端判断。
- `400` 参数错误，`401` 未登录，`403` 无权限，`404` 资源不存在，`409` 版本/状态冲突，`422` 业务校验失败，`429` 限流，`5xx` 服务错误。
- 支持 `Idempotency-Key` 的写接口（进度记录、状态更新、导出、删除）；服务端在事务中保存键与响应摘要，重复请求返回同一结果。
- 使用 `ETag` 或 `updated_at` 做乐观并发控制，编辑过期数据返回 `409`，不静默覆盖。

## 7. 任务与提醒机制

### 7.1 队列与任务

使用 pg-boss 建立以下队列：`calendar.reconcile`、`reminder.dispatch`、`account.cleanup`、`export.generate`。任务 payload 只包含资源 ID 和版本，不放敏感数据。

- `calendar.reconcile`：每天运行一次，并允许手动触发指定用户；生成未来 12 个月事件、补齐新周期。按 `(card_id, event_date)` 幂等。
- `reminder.dispatch`：每 5 分钟取 `scheduled_for <= now()` 且状态为 `pending` 的提醒，站内展示后由用户完成、忽略或稍后处理。站内提醒不需要外部发送，因此失败主要是数据库错误。
- `account.cleanup`：账户删除确认后执行，分批删除关联数据，失败可重试；保留最小化合规审计记录。
- `export.generate`：大数据量时异步生成并上传短期有效对象存储地址；MVP 小数据量可同步流式返回。

任务要求：最大重试 3 次、指数退避、死信/失败表、每次运行有 `run_id` 和耗时。worker 使用数据库 advisory lock 或 pg-boss singleton，确保同一用户同一任务不并发执行。

### 7.2 日期和时区规则

- 数据库存储 Instant 使用 UTC；用户设置保存 IANA 时区（如 `Asia/Shanghai`），不保存固定偏移。
- 年费事件的业务日期是用户时区的 `PlainDate`。提醒时间默认为该日期当地 09:00，再转换成 UTC Instant；若用户设置免打扰，顺延到下一个允许时段。
- 所有周期边界采用左闭右开 `[start, end)`，避免跨年重复计数。日期库集中在 `shared/time`，禁止业务模块直接调用 `new Date()`。
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

必需环境变量：`DATABASE_URL`、`SESSION_SECRET`、`APP_URL`、`CRON_SECRET`、`OBJECT_STORAGE_*`（启用异步导出时）。启动时校验配置并拒绝缺失或弱密钥。

## 9. 可观测性与运维

- 使用结构化 JSON 日志，字段包含 `timestamp`、`level`、`request_id`、`user_id`（哈希/内部 ID）、`route`、`status`、`duration_ms`；默认不记录请求体。
- 接入 Sentry（前端和服务端）或同等错误追踪，设置 PII 脱敏和 source map 权限。
- 指标至少包括：API 请求数/错误率/p95、登录失败率、任务成功/重试/积压数、待处理提醒数、数据库连接池占用、导出/删除耗时。
- `/api/healthz` 只检查进程；`/api/readyz` 检查数据库和 worker 心跳，禁止返回敏感配置。
- 告警阈值：5 分钟 API 5xx > 2%、p95 > 1 秒、任务积压 > 15 分钟、数据库连接耗尽、备份失败。告警链接到 request_id/run_id。
- 记录年费规则修改、进度撤销、事件状态变更、归档、导出和账户删除等审计事件；普通列表读取不写审计。

## 10. 测试策略

- **领域单元测试（高覆盖）**：年费日期（闰年、月末）、周期边界、同时满足/满足其一、金额精度、进度百分比上限、提醒时区和免打扰顺延。固定时钟，不依赖系统时区。
- **应用/集成测试**：使用测试 PostgreSQL 验证事务、所有权过滤、唯一约束、幂等键、归档停止未来事件、账户删除级联和迁移。
- **API 合约测试**：校验状态码、错误码、分页、字段脱敏和未登录/越权响应；OpenAPI 文档与实现可在 CI 对比。
- **E2E（Playwright）**：注册 -> 设置时区 -> 新增卡 -> 更新进度 -> 处理年费事件 -> 完成提醒；另测移动端无横向滚动和越权 URL。
- **任务测试**：重复运行 reconcile 不增加记录；worker 重试后最终一致；跨时区用户在正确本地日期 09:00 看到提醒。
- **安全与质量门禁**：依赖扫描、Secret 扫描、lint、类型检查、迁移向前兼容检查；生产前手工验证备份恢复和删除流程。

## 11. 推荐目录结构

```text
.
├── app/
│   ├── (auth)/login/page.tsx
│   ├── (app)/dashboard/page.tsx
│   ├── (app)/cards/...
│   └── api/v1/...
├── src/
│   ├── modules/
│   │   ├── auth/{domain,application,infrastructure,presentation}/
│   │   ├── cards/...
│   │   ├── fee-rules/...
│   │   ├── cycles/...
│   │   ├── progress/...
│   │   ├── fee-events/...
│   │   └── reminders/...
│   ├── shared/{db,time,validation,errors,logging}/
│   └── workers/{index.ts,jobs/}
├── db/
│   ├── schema/
│   └── migrations/
├── tests/{unit,integration,e2e,fixtures}/
├── scripts/{seed.ts,backup-check.ts}
├── docs/{PRD.md,TECHNICAL.md}
├── Dockerfile
├── docker-compose.yml
└── package.json
```

页面组件不直接访问数据库；API Route Handler 调用模块的 command/query service。查询和写入可分别优化，但不要在 MVP 阶段复制业务模型。

## 12. 分阶段实施

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
