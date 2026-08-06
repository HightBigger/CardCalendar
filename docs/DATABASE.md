# CardCalendar 数据库设计（MVP）

本文记录数据模型设计意图；实际可执行 DDL 以 `db/migrations/` 为准，Drizzle 类型以 `db/schema/index.ts` 为准。当前 MVP 迁移包含 9 张业务表；`benefits` 为 P1 预留，尚未创建。

## 1. 设计目标与约定

- 默认数据库：PostgreSQL 15+；应用连接使用事务和参数化 SQL。
- 所有时间按 `timestamptz` 存储，展示和“提前 N 天”计算使用用户的 IANA 时区；纯日期使用 `date`。
- 金额使用 `numeric(14,2)`，不使用浮点数；币种使用 ISO 4217 三位大写代码（MVP 默认 `CNY`）。
- 主键统一使用 `uuid`（应用生成或 `gen_random_uuid()`）；所有业务表都带 `user_id` 做租户隔离。
- 卡号只保存后四位 `last4`，禁止保存完整卡号、CVV、网银密码和银行凭据。
- “删除”采用软删除/账户匿名化。卡片默认归档，历史事件、进度和审计记录保留。
- 建议启用扩展：

```sql
create extension if not exists pgcrypto; -- gen_random_uuid()
create extension if not exists citext;    -- email 大小写不敏感唯一约束
```

## 2. 实体关系

```text
users 1──N sessions
users 1──N cards 1──N fee_cycles 1──N progress_entries
                  │       └──N fee_events 1──N reminders
                  └──N benefits

users 1──N audit_logs
users 1──N reminders
```

- `users` 是数据所有权根；服务端每次查询都必须带 `user_id`，不能仅凭客户端传入的资源 ID 授权。
- `cards` 是用户的信用卡档案；`fee_cycles` 是每个年费周期的快照，避免规则修改后影响历史。
- `progress_entries` 记录手动累计/增量变更；周期汇总值由流水聚合得到。
- `fee_events` 是具体年费处理记录；`reminders` 关联事件（进度提醒可不关联事件）。
- `benefits` 为 P1 预留，记录权益使用和估算价值，不承载金融建议。

## 3. 表结构

以下为核心 DDL 草案，实际迁移时可拆成多个版本。命名使用小写蛇形。

### 3.1 用户与审计

```sql
create table users (
  id                uuid primary key default gen_random_uuid(),
  email             citext not null unique,
  password_hash     text not null,
  timezone          text not null default 'Asia/Shanghai',
  status             text not null default 'active'
                    check (status in ('active', 'deletion_requested', 'anonymized')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz
);

create table sessions (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references users(id) on delete cascade,
  token_hash        char(64) not null unique,
  expires_at        timestamptz not null,
  last_seen_at      timestamptz,
  revoked_at        timestamptz,
  created_at        timestamptz not null default now(),
  created_ip_hash   text,
  check (expires_at > created_at)
);

create index sessions_user_active_idx
  on sessions (user_id, expires_at)
  where revoked_at is null;

create table audit_logs (
  id                bigint generated always as identity primary key,
  user_id           uuid references users(id) on delete set null,
  actor_type        text not null check (actor_type in ('user', 'system', 'admin')),
  actor_id          uuid,
  action            text not null, -- create/update/archive/delete/export/login 等
  entity_type       text not null,
  entity_id         uuid,
  request_id        text,
  occurred_at       timestamptz not null default now(),
  ip_hash           text,           -- 仅保存不可逆哈希，不保存原始 IP
  metadata          jsonb not null default '{}'::jsonb
);

create index audit_logs_user_time_idx on audit_logs (user_id, occurred_at desc);
create index audit_logs_entity_idx on audit_logs (entity_type, entity_id, occurred_at desc);
```

> `citext` 需要 `create extension if not exists citext;`；若不启用扩展，则保存规范化小写邮箱并建立普通唯一索引。`updated_at` 由应用或统一触发器更新。

### 3.2 卡片

```sql
create table cards (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references users(id) on delete cascade,
  issuer_name           text not null check (length(trim(issuer_name)) between 1 and 100),
  name                  text not null check (length(trim(name)) between 1 and 120),
  last4                 char(4) not null check (last4 ~ '^[0-9]{4}$'),
  status                text not null default 'active'
                        check (status in ('active', 'suspended', 'archived')),
  annual_fee_amount     numeric(14,2) not null default 0 check (annual_fee_amount >= 0),
  currency              char(3) not null default 'CNY' check (currency ~ '^[A-Z]{3}$'),
  fee_cycle_type        text not null check (fee_cycle_type in ('anniversary', 'fixed_date', 'custom')),
  opened_on             date,
  fee_month             smallint check (fee_month between 1 and 12),
  fee_day               smallint check (fee_day between 1 and 31),
  next_fee_date         date not null,
  waive_rule_type       text not null default 'none'
                        check (waive_rule_type in ('none', 'count', 'amount', 'count_and_amount', 'custom')),
  target_count          integer check (target_count is null or target_count >= 0),
  target_amount         numeric(14,2) check (target_amount is null or target_amount >= 0),
  progress_period_start date,
  progress_period_end   date,
  custom_rule_text      text,
  notes                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  archived_at           timestamptz,
  check (fee_cycle_type <> 'anniversary' or opened_on is not null),
  check (fee_cycle_type <> 'fixed_date' or (fee_month is not null and fee_day is not null)),
  check (progress_period_start is null or progress_period_end is null
         or progress_period_end >= progress_period_start),
  check (waive_rule_type not in ('count', 'count_and_amount') or target_count is not null),
  check (waive_rule_type not in ('amount', 'count_and_amount') or target_amount is not null),
  check (waive_rule_type <> 'custom' or nullif(trim(custom_rule_text), '') is not null)
);

create index cards_user_status_idx on cards (user_id, status, created_at desc);
create index cards_user_fee_date_idx on cards (user_id, next_fee_date)
  where status <> 'archived';
create index cards_user_search_idx on cards (user_id, issuer_name, name, last4);
```

`custom` 周期由应用计算并写入 `next_fee_date`；`fee_month/fee_day` 仅用于固定日期规则。闰年和月末日期的归一化必须在应用日期库中测试。

### 3.3 年费周期与事件

```sql
create table fee_cycles (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references users(id) on delete cascade,
  card_id               uuid not null references cards(id) on delete restrict,
  period_start          date not null,
  period_end            date not null,
  fee_due_date          date not null,
  waive_rule_type       text not null,
  target_count          integer check (target_count is null or target_count >= 0),
  target_amount         numeric(14,2) check (target_amount is null or target_amount >= 0),
  status                text not null default 'open'
                        check (status in ('open', 'qualified', 'closed')),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  check (period_end >= period_start),
  unique (card_id, period_start, period_end)
);

create table fee_events (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references users(id) on delete cascade,
  card_id               uuid not null references cards(id) on delete restrict,
  fee_cycle_id          uuid not null references fee_cycles(id) on delete restrict,
  due_date              date not null,
  expected_amount       numeric(14,2) not null default 0,
  status                text not null default 'pending'
                        check (status in ('pending', 'waived', 'charged', 'refunded', 'not_applicable')),
  actual_amount         numeric(14,2) check (actual_amount is null or actual_amount >= 0),
  occurred_on           date,
  notes                 text,
  resolved_at           timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (fee_cycle_id),
  check (status not in ('charged', 'refunded') or (actual_amount is not null and occurred_on is not null)),
  check (status in ('pending', 'waived') or resolved_at is not null)
);

create index fee_cycles_user_period_idx on fee_cycles (user_id, period_start desc);
create index fee_events_user_due_idx on fee_events (user_id, due_date, status);
create index fee_events_card_due_idx on fee_events (card_id, due_date desc);
```

`user_id` 在子表中重复保存，便于隔离和索引；应用写入时校验 `card.user_id = fee_cycle.user_id = fee_event.user_id`。若使用数据库强约束，可为关联列增加复合外键；MVP 至少在服务层事务内校验。

### 3.4 进度流水

```sql
create table progress_entries (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references users(id) on delete cascade,
  card_id               uuid not null references cards(id) on delete restrict,
  fee_cycle_id          uuid not null references fee_cycles(id) on delete restrict,
  entry_date            date not null,
  count_delta           integer not null default 0,
  amount_delta          numeric(14,2) not null default 0,
  entry_type            text not null default 'manual'
                        check (entry_type in ('manual', 'correction', 'reversal')),
  note                  text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  created_by            uuid references users(id) on delete set null,
  check (count_delta <> 0 or amount_delta <> 0),
  unique (id, fee_cycle_id)
);

create index progress_entries_cycle_date_idx
  on progress_entries (fee_cycle_id, entry_date desc, created_at desc);
create index progress_entries_user_card_idx
  on progress_entries (user_id, card_id, entry_date desc);
```

周期当前次数/金额 = `sum(count_delta)` / `sum(amount_delta)`；禁止直接覆盖累计值。撤销使用反向流水并保留原记录，便于审计。应用层需阻止汇总结果低于 0，并将目标完成状态写回 `fee_cycles.status`。

### 3.5 提醒与提醒规则

```sql
create table reminder_rules (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references users(id) on delete cascade,
  card_id               uuid references cards(id) on delete cascade,
  kind                  text not null check (kind in ('fee_event', 'progress')),
  days_before           integer not null check (days_before between 0 and 3650),
  enabled               boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (user_id, card_id, kind, days_before)
);

create table reminders (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references users(id) on delete cascade,
  card_id               uuid references cards(id) on delete cascade,
  fee_event_id          uuid references fee_events(id) on delete cascade,
  fee_cycle_id          uuid references fee_cycles(id) on delete cascade,
  kind                  text not null check (kind in ('fee_event', 'progress')),
  scheduled_for         timestamptz not null,
  status                text not null default 'pending'
                        check (status in ('pending', 'completed', 'snoozed', 'ignored', 'cancelled')),
  snoozed_until         timestamptz,
  completed_at          timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  check ((kind = 'fee_event' and fee_event_id is not null)
      or (kind = 'progress' and fee_cycle_id is not null)),
  check (status <> 'completed' or completed_at is not null)
);

create unique index reminders_event_schedule_uniq
  on reminders (fee_event_id, scheduled_for, kind)
  where fee_event_id is not null;
create unique index reminders_cycle_schedule_uniq
  on reminders (fee_cycle_id, scheduled_for, kind)
  where fee_cycle_id is not null;
create index reminders_user_inbox_idx
  on reminders (user_id, status, scheduled_for);
```

默认规则在用户首次创建卡片时插入 `30/7/1` 天的 `fee_event` 规则；归档卡片时将未来未处理提醒标为 `cancelled`。提醒生成任务必须使用幂等键（关联对象 + `scheduled_for` + `kind`），并在事务中 `insert ... on conflict do nothing`，避免重复提醒。

### 3.6 权益记录（P1 预留）

```sql
create table benefits (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references users(id) on delete cascade,
  card_id               uuid not null references cards(id) on delete restrict,
  name                  text not null check (length(trim(name)) between 1 and 160),
  valid_from            date,
  valid_to              date,
  usage_limit_count     integer check (usage_limit_count is null or usage_limit_count >= 0),
  usage_limit_amount    numeric(14,2) check (usage_limit_amount is null or usage_limit_amount >= 0),
  estimated_value       numeric(14,2) not null default 0 check (estimated_value >= 0),
  used_value            numeric(14,2) not null default 0 check (used_value >= 0),
  notes                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  archived_at           timestamptz,
  check (valid_to is null or valid_from is null or valid_to >= valid_from),
  check (used_value <= estimated_value or estimated_value = 0)
);

create index benefits_user_card_validity_idx
  on benefits (user_id, card_id, valid_to, archived_at);
```

MVP 可直接更新 `used_value`；若需要完整使用历史，再增加 `benefit_usages` 流水表。年度权益汇总按 `card_id` 和有效期与年费周期的交集聚合，结果仅作记录展示。

## 4. 约束、事务与派生数据

1. **所有权**：API 先从认证会话取得 `user_id`，查询使用 `(id, user_id)`；禁止仅按 `id` 更新/删除。可在后续启用 PostgreSQL Row-Level Security（见第 7 节）。
2. **跨表一致性**：创建周期、年费事件和提醒在一个事务中完成；卡片归档与取消未来提醒在同一事务中完成。
3. **金额与日期**：金额不可为负；`charged/refunded` 必须有实际金额和发生日期；周期结束日不得早于开始日。
4. **规则快照**：`fee_cycles` 保存创建时的目标和规则，卡片规则编辑只影响未来周期；历史周期和事件不回写。
5. **唯一性**：同一卡片同一周期只有一条 `fee_event`；同一事件同一计划时间只能有一条提醒。
6. **派生值**：进度完成度、剩余量、未来 90 天数量通过查询或缓存视图计算，不作为可被客户端任意写入的事实字段。
7. **审计**：用户可见的状态修改、归档、导出、账户删除请求和系统生成/取消提醒均写入 `audit_logs`；日志中不得出现密码、完整卡号或敏感请求体。

## 5. 典型查询与任务

### 5.1 进度汇总

```sql
select
  coalesce(sum(p.count_delta), 0)  as current_count,
  coalesce(sum(p.amount_delta), 0) as current_amount
from progress_entries p
where p.user_id = $1 and p.fee_cycle_id = $2;
```

完成规则：`none` 直接视为无需达标；`count` 比较次数；`amount` 比较金额；`count_and_amount` 两者都满足；`custom` 仅展示说明，由用户确认状态。

### 5.2 年费事件生成任务

- 每日按用户时区运行，扫描未来 12 个月及已过期未处理的活动卡片。
- 为缺失的 `fee_cycles` 生成周期快照，再为每个周期 `upsert` 一条 `fee_event`。
- 卡片为 `archived` 时不生成未来周期；历史事件保持可读。
- 任务使用短事务、批量处理和幂等唯一约束；失败可重试。

### 5.3 提醒生成/状态任务

- 根据 `fee_event.due_date - days_before` 计算本地日期，再转换为用户时区的发送时间。
- 默认节点为提前 30、7、1 天；到期日仍为 `pending` 时，查询层标记为逾期（无需另写一条事件）。
- 每 5--15 分钟扫描 `scheduled_for <= now()` 且 `status in ('pending','snoozed')` 的提醒，站内展示后由用户完成、忽略或稍后处理。
- 周期达标后，将对应进度提醒标为 `cancelled`；年费事件已解决后，同一事件的未处理提醒也取消。

## 6. 迁移策略

仓库当前使用轻量迁移脚本 scripts/migrate.ts，迁移文件放在 db/migrations/，以 _cardcalendar_migrations 表记录已应用文件，重复执行会自动跳过。

当前迁移：

- 0000_initial.sql：初始表、约束、索引、触发器。
- 0001_mvp_auth_runtime.sql：为真实账号会话补充 users.name 可选字段。

数据库可用后依次执行：

1. 启动 PostgreSQL（可参考仓库内 docker-compose.yml）。
2. 设置 DATABASE_URL。
3. 执行 npm run db:migrate。
4. 执行 npm run db:smoke 做只读表连通性检查。
5. 设置 USE_DATABASE=true 后启动应用。

1. 使用版本化迁移工具（如 Flyway、Sqitch、Prisma Migrate 或 Alembic），迁移文件只做一次性、可审查的 schema 变更。
2. 初始迁移顺序：扩展与枚举/约束 -> `users` -> `sessions` -> `cards` -> `fee_cycles` -> `fee_events` -> `progress_entries` -> `reminder_rules` -> `reminders` -> `benefits` -> 索引与 RLS。
3. 采用 expand/contract：先新增可空字段和兼容代码，回填并验证，再在后续迁移中加 `not null`/删除旧字段；避免长时间锁表。
4. 大表索引使用 `create index concurrently`，并在单独迁移中执行；生产迁移前检查锁等待和执行计划。
5. 每次迁移记录版本、执行时间和校验结果；部署流水线先在临时数据库执行迁移和回滚演练。
6. 数据删除按两阶段执行：先将账户标记为 `deletion_requested` 并记录审计，冷静期后事务删除业务数据并将用户记录匿名化；备份中的数据按保留策略自然过期。

## 7. 备份、恢复与隐私安全

- **备份**：生产启用 PITR/WAL 归档，每日加密全量备份、至少保留 30 天；每周做一次跨可用区/跨区域副本（按合规要求调整）。备份密钥与数据库凭据分离存放在 Secret Manager/KMS。
- **演练**：每月至少一次在隔离环境恢复备份，验证用户、卡片、周期、提醒关联完整；记录 RPO（目标不超过 24 小时，建议 1 小时）和 RTO（MVP 目标不超过 4 小时）。
- **传输与访问**：应用到数据库强制 TLS；数据库仅允许私网访问；应用使用最小权限账号，迁移账号与运行账号分离；禁止生产数据直连开发环境。
- **行级隔离**：成熟后启用 RLS，例如在事务开始设置 `set local app.user_id = '...'`，并对所有带 `user_id` 的表增加 `using (user_id = current_setting('app.user_id')::uuid)` 策略；后台任务使用专用受控角色。
- **敏感字段**：`password_hash` 仅存 Argon2id/bcrypt 哈希；邮箱和备注属于个人数据，按最小化原则收集。日志、错误追踪、导出文件均脱敏，不记录认证头和原始 IP。
- **账户删除与导出**：导出任务在服务端生成短时效、一次性下载链接并记录 `export` 审计；删除前二次确认，删除后撤销会话和令牌。导出/删除接口执行所有权过滤和速率限制。
- **监控**：监控备份失败、WAL 延迟、磁盘水位、慢查询、异常登录和跨用户访问拒绝；告警信息不包含业务敏感值。

## 8. MVP 实施检查清单

- [ ] 创建 `users`、`cards`、`fee_cycles`、`fee_events`、`progress_entries`、`reminder_rules`、`reminders` 表及索引。
- [ ] 所有写接口均在事务内校验 `user_id`，并写入 `audit_logs`。
- [ ] 年费/提醒定时任务具备幂等、可重试和归档卡片跳过逻辑。
- [ ] 进度汇总、周期切换、时区和闰年日期有单元测试。
- [ ] 完成一次备份恢复演练；验证导出和账户删除不会泄露完整卡号或密码。
