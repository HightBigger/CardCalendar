# Cardfolio 工作台扩展数据模型（草案）

> 本文只规划数据模型，不创建迁移、不修改 `db/schema/**` 或业务代码。基线为 `main@c10bd5c`。实际可执行 DDL 仍以 `db/migrations/` 和 Drizzle schema 为准。

## 1. 基线与设计原则

当前项目是 PostgreSQL 15+、Drizzle ORM，业务表统一使用 `uuid` 主键，并在子表重复保存 `user_id`。时间约定是 `timestamptz` 存储瞬时点、`date` 存储用户时区内的业务日期；金额约定是 `numeric(14,2)` 和 ISO 4217 三位大写币种。本文沿用这些约定，不引入 PostgreSQL enum，以便和现有 `text + check` 写法以及 Drizzle 生成方式兼容。

工作台采用“定义/版本、实例/流水”分离：

- `card_campaigns` 是活动身份；`rule_versions` 是不可变的活动规则版本，历史版本不可回写。
- `activities` 是用户录入或导入的事实事件；任务进度由事实聚合。
- `campaign_requirements` 是活动版本下的结构化条件；`spend_tasks` 是用户对条件的执行实例。
- `benefits` 是权益定义；`entitlements` 是某个周期实际发放给用户的额度。
- `points_accounts` 是积分账户；`points_ledger` 是不可变积分流水，余额以聚合为事实。
- `redemptions` 是兑换订单和状态机；积分扣减必须与订单状态变更在同一事务内完成。
- `source_snapshots` 保存规则/导入来源的脱敏快照；`value_records` 保存估算或实际价值流水。

所有用户拥有的数据都带 `user_id not null references users(id) on delete cascade`。写入或更新必须同时按 `(id, user_id)` 查询，且在事务内核对所有关联对象属于同一用户；后续可用复合外键和 RLS 把该约束下沉到数据库。

禁止保存完整卡号、有效期、CVV、网银密码、银行登录 cookie、银行卡凭据或可直接登录银行的 token。卡片只能复用现有 `cards.last4`；外部会员号只能保存不可逆哈希或用户自定义的非敏感别名。

### 1.1 精度、时间和软删除

- 金额、估算价值、兑换成本：`numeric(14,2)`，不可用浮点；每条金额都带 `currency char(3)`。不做隐式汇率换算，换算必须显式记录来源、汇率和目标币种。
- 积分、里程和可分割单位：`numeric(20,4)`；单位写在 `unit_code`（如 `POINT`、`MILE`），同一账户不可混用单位。即使银行展示整数，也以四位小数精度入库。
- 事件发生时间、抓取时间、审计时间：`timestamptz`。活动有效期和任务统计窗口使用 `date` 加明确的 IANA `timezone`，窗口两端均为包含日期（inclusive）。
- `created_at`、`updated_at` 使用现有 `set_updated_at()` 触发器；定义表使用 `archived_at`，一般事实可用 `voided_at`，积分流水只能插入反向流水，不允许修改或作废原记录。账户删除沿用现有两阶段清理和审计策略。
- 除 `metadata`/`rule_json`/`normalization_json` 等扩展列外，参与查询、授权、金额/点数核算、去重和状态迁移的字段必须结构化并有约束。

## 2. 关系和版本语义

```text
users 1──N cards
  cards 1──N card_campaigns 1──N rule_versions 1──N campaign_requirements 1──N spend_tasks
                                      └──N activities ───────────────────────┘
  cards 1──N benefits 1──N entitlements
  cards 1──N points_accounts 1──N points_ledger
  cards 1──N redemptions ────────────────┘
  cards 1──N value_records
users 1──N source_snapshots
```

`rule_versions.version_no` 是同一活动的单调递增版本号。规则发生任何影响资格、金额、有效期或渠道的变化时创建新行，并将旧版本 `superseded_at` 写入；不得更新已被活动事实、任务或权益引用的规则字段。`activities`、`spend_tasks`、`entitlements` 和 `redemptions` 都保存其创建时引用的 `rule_version_id`，因此历史结果不随规则编辑变化。

## 3. SQL 草案

以下语句按依赖顺序执行即可作为未来迁移的起点；仅为草案，不应直接在生产数据库执行。

### 3.1 来源快照

```sql
create table source_snapshots (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references users(id) on delete cascade,
  source_type         text not null check (source_type in ('manual', 'public_url', 'document', 'import', 'system')),
  source_name         text,
  source_uri          text,
  captured_at         timestamptz not null default now(),
  source_timezone     text not null default 'Asia/Shanghai',
  content_hash        char(64) not null check (content_hash ~ '^[0-9a-f]{64}$'),
  snapshot_json       jsonb not null default '{}'::jsonb,
  normalization_json  jsonb not null default '{}'::jsonb,
  parser_version      text,
  status              text not null default 'active'
                      check (status in ('active', 'superseded', 'invalid', 'redacted')),
  superseded_at       timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  archived_at         timestamptz
);

create unique index source_snapshots_hash_unique
  on source_snapshots (user_id, source_type, content_hash);
create index source_snapshots_user_time_idx
  on source_snapshots (user_id, captured_at desc)
  where archived_at is null;
```

`snapshot_json` 必须先做 PAN/凭据脱敏；`source_uri` 只允许公开 URL 或内部对象键，不得存银行登录地址中的 token。原文文件宜放加密对象存储，表中仅保存内容哈希、脱敏结构化结果和对象键。

### 3.2 活动规则和事实活动

```sql
create table card_campaigns (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references users(id) on delete cascade,
  card_id               uuid not null references cards(id) on delete restrict,
  campaign_key          text not null check (length(trim(campaign_key)) between 1 and 120),
  name                  text not null check (length(trim(name)) between 1 and 160),
  provider_name         text not null check (length(trim(provider_name)) between 1 and 120),
  status                text not null default 'draft'
                        check (status in ('draft', 'active', 'paused', 'expired', 'archived')),
  notes                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  archived_at           timestamptz,
  unique (user_id, card_id, campaign_key)
);

create index card_campaigns_user_status_date_idx
  on card_campaigns (user_id, status, created_at desc)
  where archived_at is null;
create index card_campaigns_card_idx on card_campaigns (card_id, created_at desc);

create table rule_versions (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references users(id) on delete cascade,
  campaign_id           uuid not null references card_campaigns(id) on delete restrict,
  version_no            integer not null check (version_no > 0),
  status                text not null default 'draft'
                        check (status in ('draft', 'active', 'paused', 'expired', 'superseded', 'archived')),
  valid_from            date not null,
  valid_to              date,
  enrollment_deadline   date,
  timezone              text not null default 'Asia/Shanghai',
  region_code           text,
  channel               text,
  currency              char(3),
  source_snapshot_id    uuid references source_snapshots(id) on delete restrict,
  terms_uri             text,
  last_confirmed_at     timestamptz,
  rule_json             jsonb not null default '{}'::jsonb,
  superseded_at         timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  archived_at           timestamptz,
  unique (campaign_id, version_no),
  check (valid_to is null or valid_to >= valid_from),
  check (enrollment_deadline is null or enrollment_deadline <= valid_to or valid_to is null),
  check (currency is null or currency ~ '^[A-Z]{3}$')
);

create unique index rule_versions_current_unique
  on rule_versions (user_id, campaign_id)
  where status in ('active', 'paused') and archived_at is null;
create index rule_versions_user_date_idx
  on rule_versions (user_id, valid_from desc, valid_to)
  where archived_at is null;
create index rule_versions_campaign_idx on rule_versions (campaign_id, version_no desc);

create table activities (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references users(id) on delete cascade,
  card_id               uuid not null references cards(id) on delete restrict,
  campaign_id           uuid references card_campaigns(id) on delete restrict,
  rule_version_id       uuid references rule_versions(id) on delete restrict,
  activity_type         text not null
                        check (activity_type in ('enrollment', 'spend', 'purchase_count', 'bonus', 'benefit_use', 'adjustment', 'reversal')),
  occurred_at           timestamptz not null,
  occurred_local_date   date not null,
  timezone              text not null default 'Asia/Shanghai',
  amount                numeric(14,2),
  currency              char(3),
  quantity              numeric(20,4),
  merchant_name         text,
  merchant_category     text,
  external_key          text,
  source_snapshot_id    uuid references source_snapshots(id) on delete restrict,
  note                  text,
  metadata              jsonb not null default '{}'::jsonb,
  voided_at             timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  check (amount is null or amount >= 0),
  check (quantity is null or quantity >= 0),
  check (currency is null or currency ~ '^[A-Z]{3}$')
);

create unique index activities_campaign_external_unique
  on activities (user_id, campaign_id, external_key)
  where campaign_id is not null and external_key is not null and voided_at is null;
create index activities_user_time_idx on activities (user_id, occurred_at desc);
create index activities_campaign_type_date_idx
  on activities (campaign_id, activity_type, occurred_local_date desc)
  where voided_at is null;
create index activities_card_date_idx on activities (user_id, card_id, occurred_local_date desc);
create index activities_rule_version_idx on activities (rule_version_id, occurred_local_date desc)
  where rule_version_id is not null and voided_at is null;
```

`external_key` 只接受来源系统的幂等键，不接受完整账单文本。手工活动可为空；导入或重试必须提供。`occurred_local_date` 由写入事务按 `timezone` 计算并固定，以免用户后来改时区导致历史活动跨日漂移。跨表的 `user_id/card_id/campaign_id` 一致性先由服务层事务校验，强约束阶段再加复合外键。

### 3.3 活动条件和刷卡任务

```sql
create table campaign_requirements (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references users(id) on delete cascade,
  campaign_id           uuid not null references card_campaigns(id) on delete restrict,
  rule_version_id       uuid not null references rule_versions(id) on delete restrict,
  requirement_key       text not null check (length(trim(requirement_key)) between 1 and 100),
  requirement_type      text not null
                        check (requirement_type in ('spend_amount', 'spend_count', 'merchant', 'category', 'enrollment', 'custom')),
  operator              text not null default 'gte'
                        check (operator in ('gte', 'gt', 'eq', 'lte', 'lt', 'contains')),
  target_amount         numeric(14,2),
  target_count          integer,
  currency              char(3),
  window_start          date,
  window_end            date,
  timezone              text not null default 'Asia/Shanghai',
  stack_mode            text not null default 'and' check (stack_mode in ('and', 'or')),
  custom_rule_json      jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  archived_at           timestamptz,
  unique (rule_version_id, requirement_key),
  check (target_amount is null or target_amount >= 0),
  check (target_count is null or target_count >= 0),
  check (currency is null or currency ~ '^[A-Z]{3}$'),
  check (window_end is null or window_start is null or window_end >= window_start),
  check (requirement_type <> 'spend_amount' or target_amount is not null),
  check (requirement_type <> 'spend_count' or target_count is not null),
  check (requirement_type <> 'custom' or custom_rule_json <> '{}'::jsonb)
);

create index campaign_requirements_user_campaign_idx
  on campaign_requirements (user_id, campaign_id, requirement_key)
  where archived_at is null;
create index campaign_requirements_rule_version_idx
  on campaign_requirements (rule_version_id, requirement_key)
  where archived_at is null;

create table spend_tasks (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references users(id) on delete cascade,
  card_id               uuid not null references cards(id) on delete restrict,
  campaign_id           uuid not null references card_campaigns(id) on delete restrict,
  requirement_id        uuid not null references campaign_requirements(id) on delete restrict,
  instance_key          text not null default 'default',
  rule_version_id       uuid not null references rule_versions(id) on delete restrict,
  window_start           date not null,
  window_end             date not null,
  status                text not null default 'pending'
                        check (status in ('pending', 'in_progress', 'qualified', 'expired', 'cancelled')),
  target_amount         numeric(14,2),
  target_count          integer,
  progress_amount       numeric(14,2) not null default 0,
  progress_count        integer not null default 0,
  qualified_at          timestamptz,
  last_evaluated_at     timestamptz,
  evaluation_version    integer not null default 1,
  metadata              jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  archived_at           timestamptz,
  unique (user_id, requirement_id, instance_key),
  check (window_end >= window_start),
  check (target_amount is null or target_amount >= 0),
  check (target_count is null or target_count >= 0),
  check (progress_amount >= 0 and progress_count >= 0),
  check (status <> 'qualified' or qualified_at is not null)
);

create index spend_tasks_user_status_window_idx
  on spend_tasks (user_id, status, window_end, window_start)
  where archived_at is null;
create index spend_tasks_campaign_idx on spend_tasks (campaign_id, status, window_end);
```

`progress_amount` 和 `progress_count` 是可重建的缓存，不是事实来源；计算必须聚合未撤销的 `activities`，在同一事务更新任务状态并写 outbox。重复型活动用不同 `instance_key`（例如 `2026-Q3`），避免用删除重建破坏审计。

### 3.4 权益定义、发放额度和价值记录

```sql
create table benefits (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references users(id) on delete cascade,
  card_id               uuid not null references cards(id) on delete restrict,
  campaign_id           uuid references card_campaigns(id) on delete restrict,
  benefit_key           text not null check (length(trim(benefit_key)) between 1 and 120),
  benefit_version       integer not null check (benefit_version > 0),
  rule_version_id       uuid references rule_versions(id) on delete restrict,
  name                  text not null check (length(trim(name)) between 1 and 160),
  benefit_type           text not null check (benefit_type in ('credit', 'discount', 'access', 'insurance', 'points_bonus', 'other')),
  status                text not null default 'active' check (status in ('draft', 'active', 'expired', 'archived')),
  valid_from            date,
  valid_to              date,
  timezone              text not null default 'Asia/Shanghai',
  usage_limit_count     integer,
  usage_limit_amount    numeric(14,2),
  estimated_value       numeric(14,2) not null default 0,
  currency              char(3) not null default 'CNY',
  valuation_method      text not null default 'manual' check (valuation_method in ('manual', 'source', 'formula')),
  source_snapshot_id    uuid references source_snapshots(id) on delete restrict,
  last_confirmed_at     timestamptz,
  rule_json              jsonb not null default '{}'::jsonb,
  notes                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  archived_at           timestamptz,
  unique (user_id, card_id, benefit_key, benefit_version),
  check (valid_to is null or valid_from is null or valid_to >= valid_from),
  check (usage_limit_count is null or usage_limit_count >= 0),
  check (usage_limit_amount is null or usage_limit_amount >= 0),
  check (estimated_value >= 0),
  check (currency ~ '^[A-Z]{3}$')
);

create index benefits_user_card_validity_idx
  on benefits (user_id, card_id, valid_to, status)
  where archived_at is null;

create table entitlements (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references users(id) on delete cascade,
  card_id               uuid not null references cards(id) on delete restrict,
  benefit_id            uuid not null references benefits(id) on delete restrict,
  grant_key             text not null,
  rule_version_id       uuid references rule_versions(id) on delete restrict,
  valid_from            date not null,
  valid_to              date not null,
  granted_count         integer,
  granted_amount        numeric(14,2),
  currency              char(3),
  status                text not null default 'available'
                        check (status in ('available', 'partially_used', 'exhausted', 'expired', 'cancelled')),
  issued_at             timestamptz not null default now(),
  exhausted_at          timestamptz,
  metadata              jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  archived_at           timestamptz,
  unique (user_id, benefit_id, grant_key),
  check (valid_to >= valid_from),
  check (granted_count is null or granted_count >= 0),
  check (granted_amount is null or granted_amount >= 0),
  check (currency is null or currency ~ '^[A-Z]{3}$'),
  check (status <> 'exhausted' or exhausted_at is not null)
);

create index entitlements_user_status_validity_idx
  on entitlements (user_id, status, valid_to)
  where archived_at is null;
create index entitlements_benefit_idx on entitlements (benefit_id, valid_from desc);
```

额度消耗不直接覆盖 `entitlements`。用 `value_records`（`value_type = 'benefit_use'`）或后续专用使用流水聚合，任务在事务中刷新 `status`。`estimated_value` 是用户记录/来源估算，不是收益承诺。

### 3.5 积分账户、流水和兑换

```sql
create table points_accounts (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references users(id) on delete cascade,
  card_id               uuid references cards(id) on delete restrict,
  program_code          text not null check (length(trim(program_code)) between 1 and 80),
  program_name          text not null check (length(trim(program_name)) between 1 and 120),
  unit_code             text not null check (unit_code ~ '^[A-Z0-9_]{2,32}$'),
  points_scale          smallint not null default 4 check (points_scale between 0 and 4),
  account_label         text,
  member_ref_hash       char(64) check (member_ref_hash is null or member_ref_hash ~ '^[0-9a-f]{64}$'),
  balance_cache         numeric(20,4) not null default 0,
  balance_as_of         timestamptz,
  status                text not null default 'active' check (status in ('active', 'suspended', 'archived')),
  metadata              jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  archived_at           timestamptz,
  unique (user_id, program_code, unit_code),
  check (balance_cache >= 0)
);

create index points_accounts_user_status_idx
  on points_accounts (user_id, status, program_name)
  where archived_at is null;

create table points_ledger (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references users(id) on delete cascade,
  account_id            uuid not null references points_accounts(id) on delete restrict,
  entry_type            text not null
                        check (entry_type in ('earn', 'bonus', 'expire', 'redeem', 'adjustment', 'reversal')),
  points_delta          numeric(20,4) not null check (points_delta <> 0),
  unit_code             text not null check (unit_code ~ '^[A-Z0-9_]{2,32}$'),
  occurred_at           timestamptz not null,
  source_type           text not null check (source_type in ('manual', 'activity', 'redemption', 'import', 'system')),
  source_id             uuid,
  idempotency_key       text not null,
  source_snapshot_id    uuid references source_snapshots(id) on delete restrict,
  note                  text,
  metadata              jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now(),
  unique (user_id, account_id, idempotency_key)
);

create index points_ledger_account_time_idx
  on points_ledger (account_id, occurred_at desc, id desc);
create index points_ledger_user_type_time_idx
  on points_ledger (user_id, entry_type, occurred_at desc);

create table redemptions (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references users(id) on delete cascade,
  card_id               uuid references cards(id) on delete restrict,
  account_id            uuid not null references points_accounts(id) on delete restrict,
  benefit_id            uuid references benefits(id) on delete restrict,
  entitlement_id        uuid references entitlements(id) on delete restrict,
  rule_version_id       uuid references rule_versions(id) on delete restrict,
  client_request_key    text not null,
  reward_code           text not null check (length(trim(reward_code)) between 1 and 120),
  status                text not null default 'requested'
                        check (status in ('requested', 'reserved', 'processing', 'confirmed', 'failed', 'cancelled', 'reversed')),
  points_requested      numeric(20,4) not null check (points_requested > 0),
  points_spent          numeric(20,4),
  reward_value          numeric(14,2),
  reward_currency       char(3),
  requested_at          timestamptz not null default now(),
  processed_at          timestamptz,
  external_ref          text,
  failure_code          text,
  metadata              jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  check (points_spent is null or points_spent > 0),
  check (reward_value is null or reward_value >= 0),
  check (reward_currency is null or reward_currency ~ '^[A-Z]{3}$'),
  check (status not in ('confirmed', 'reversed') or (points_spent is not null and processed_at is not null)),
  unique (user_id, client_request_key)
);

create index redemptions_user_status_time_idx
  on redemptions (user_id, status, requested_at desc);
create index redemptions_account_time_idx on redemptions (account_id, requested_at desc);
```

`points_ledger` 是不可变事实，数据库运行角色不授予该表 `update/delete` 权限；冲正插入相反方向的 `reversal`，不更新或删除原流水。`balance_cache` 只作读优化，定期以 `sum(points_delta)` 校正。兑换预留不提前写积分流水：事务 `select ... for update` 锁住 `points_accounts`，计算已记账余额减去 `reserved/processing` 兑换，再创建一条 `reserved` 订单；确认时在同一事务更新订单并插入负的 `redeem` 流水。失败/取消释放预留；超时由幂等 worker 处理。这样不会因并发兑换产生负可用余额。

### 3.6 价值流水

```sql
create table value_records (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references users(id) on delete cascade,
  card_id               uuid not null references cards(id) on delete restrict,
  benefit_id            uuid references benefits(id) on delete restrict,
  entitlement_id        uuid references entitlements(id) on delete restrict,
  redemption_id         uuid references redemptions(id) on delete restrict,
  value_type            text not null
                        check (value_type in ('estimated', 'realized', 'fee', 'cost', 'benefit_use', 'refund', 'adjustment')),
  direction             text not null check (direction in ('credit', 'debit')),
  amount                numeric(14,2) not null check (amount >= 0),
  currency              char(3) not null check (currency ~ '^[A-Z]{3}$'),
  occurred_on           date not null,
  valuation_method      text not null default 'manual'
                        check (valuation_method in ('manual', 'source', 'formula')),
  source_snapshot_id    uuid references source_snapshots(id) on delete restrict,
  record_key            text,
  note                  text,
  metadata              jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  voided_at             timestamptz,
  check (benefit_id is not null or entitlement_id is not null or redemption_id is not null or card_id is not null)
);

create unique index value_records_key_unique
  on value_records (user_id, record_key)
  where record_key is not null and voided_at is null;
create index value_records_user_card_date_idx
  on value_records (user_id, card_id, occurred_on desc)
  where voided_at is null;
create index value_records_benefit_idx
  on value_records (benefit_id, occurred_on desc)
  where benefit_id is not null and voided_at is null;
```

报表将 `credit` 聚合为正、`debit` 聚合为负；同一记录不能隐式换算币种。若需要统一报表币种，应在记录中另存经确认的 `base_amount`、`base_currency` 和 `fx_rate`（均结构化），并保留原始金额，不把汇率塞进不透明 JSON。

### 3.7 事务事件（建议）

现有 `audit_logs` 负责审计，不适合作为可靠消息队列。若 worker 或未来通知需要跨进程消费，增加事务 outbox：

```sql
create table workbench_outbox_events (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid references users(id) on delete set null,
  aggregate_type        text not null,
  aggregate_id          uuid not null,
  event_type            text not null,
  event_version         integer not null default 1 check (event_version > 0),
  idempotency_key       text not null,
  payload               jsonb not null,
  occurred_at           timestamptz not null default now(),
  published_at          timestamptz,
  attempt_count         integer not null default 0 check (attempt_count >= 0),
  last_error             text,
  unique (aggregate_type, aggregate_id, event_type, event_version, idempotency_key)
);

create index workbench_outbox_pending_idx
  on workbench_outbox_events (occurred_at, id)
  where published_at is null;
create index workbench_outbox_user_idx
  on workbench_outbox_events (user_id, occurred_at desc);
```

活动写入、任务重算、兑换状态变更、积分流水、`audit_logs` 和 outbox 必须在同一个数据库事务中提交。发布 worker 采用 `for update skip locked`、成功后设置 `published_at`，失败递增 `attempt_count` 并指数退避；业务方按 `idempotency_key` 幂等消费。

## 4. 结构化字段与 JSON 边界

必须结构化并约束的字段：`user_id`、所有主外键、版本号、状态、有效期/发生日期、时区、金额与币种、积分单位与增量、兑换请求幂等键、来源哈希、审计时间、软删除时间。它们承担授权、唯一性、范围检查、排序和聚合，禁止放入 JSON。

适合 JSONB 的字段：银行条款中尚未稳定的渠道/商户分类、活动展示文案、多语言文案、解析器原始字段、公式参数、外部响应中非敏感的扩展属性和版本迁移信息。JSONB 必须有顶层 schema/version（例如 `rule_json.schema_version`），限制大小并在应用层验证；不可把完整卡号、凭据、认证头、原始账单或未经脱敏的 PDF 文本写入其中。需要查询的 JSON 键应在确认稳定后提升为列，再删除旧 JSON 键（expand/contract）。

Drizzle 对应写法沿用现有 schema，例如：

```ts
numeric("points_delta", { precision: 20, scale: 4 }).notNull(),
numeric("amount", { precision: 14, scale: 2 }).notNull(),
timestamp("occurred_at", { withTimezone: true, mode: "date" }).notNull(),
jsonb("metadata").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
```

状态枚举继续用 `text(...).notNull()` 配合 `check(sql\`... in (...)\`)`，不要在应用类型中允许任意字符串；可另导出 TypeScript union 供服务层校验。

## 5. 所有权、审计和一致性约束

1. **用户隔离**：所有读写 API 从认证会话取得 `user_id`；SQL 必须带 `where id = $id and user_id = $user_id`。创建子对象时先锁定父对象并核对父对象 `user_id`。生产启用 RLS 时，事务开始 `set local app.user_id = '...'`，后台任务使用单独角色。
2. **跨表一致性**：`card_campaigns.card_id`、`activities.card_id`、`spend_tasks.card_id`、`benefits.card_id`、`points_accounts.card_id` 和 `redemptions.card_id` 必须属于同一用户。第一阶段用服务层事务校验；第二阶段为每个父表增加 `unique(id,user_id)`，再加 `(id,user_id)` 复合外键。
3. **规则快照**：活动定义被引用后只能新建 `rule_versions` 行；权益定义被引用后只能递增 `benefit_version` 新建行。任务、权益额度和活动事实记录引用明确版本，不能通过更新父行改变历史结论。
4. **金额与点数**：所有非负金额/目标/数量由 check 约束；积分流水允许正负但不得为零，单位必须匹配账户。余额和任务进度是可重建缓存，定期校验聚合结果并记录 `audit_logs`。
5. **幂等**：导入活动用 `(user_id,campaign_id,external_key)`；积分流水用 `(user_id,account_id,idempotency_key)`；兑换用 `(user_id,client_request_key)`；outbox 使用自身唯一键。重复请求使用 `on conflict do nothing` 或返回原记录。
6. **审计**：创建/修改/归档活动规则、任务状态、权益发放、兑换状态、积分调整、价值记录、来源替换、导出和账户删除均写现有 `audit_logs`。`metadata` 只能包含脱敏差异和 request id，不记录密码、完整卡号或原始请求体。
7. **软删除**：规则定义和快照用 `archived_at`/`status`；一般事实用 `voided_at`，积分流水只用反向流水。任何物理删除仅随账户清理事务进行，并按现有保留期和备份过期策略处理。

## 6. 关键事务流程

### 6.1 活动/任务

```sql
begin;
select id, user_id from card_campaigns
  where id = $campaign_id and user_id = $user_id for update;
insert into activities (...) values (...)
  on conflict (user_id, campaign_id, external_key) do nothing;
-- 聚合未 void 的 activities，更新 spend_tasks 缓存和 status
insert into audit_logs (...) values (...);
insert into workbench_outbox_events (...) values (...);
commit;
```

活动事实已经落库但任务重算失败时，整笔事务回滚；定时校正任务可从事实重建缓存。

### 6.2 权益发放和使用

在活动达标事务内创建 `entitlements`，唯一键冲突即返回已有额度。使用权益时插入 `value_records(value_type='benefit_use')`，锁定额度行并依据流水聚合判断是否变为 `partially_used/exhausted`；过期 worker 只把仍可用的额度标为 `expired`，不删除使用记录。

### 6.3 积分兑换

1. `select ... for update` 锁定 `points_accounts`；计算 `sum(points_ledger.points_delta)` 和未终结兑换的 `points_requested`。
2. 可用点数足够时插入 `redemptions(status='reserved')`，写审计和 outbox，提交。
3. 外部兑换成功时锁账户，在同一事务将订单设为 `confirmed`，插入负 `points_ledger(entry_type='redeem')`，并可创建 `value_records`。
4. 失败/取消只更新订单并释放预留；超时任务按 `requested_at` 和重试上限处理。冲正新建 `reversal` 流水并将订单设为 `reversed`。

任何步骤重试都使用客户端请求键和流水幂等键；绝不先扣积分再创建订单，也不允许客户端直接写 `balance_cache`。

## 7. 迁移阶段、验证和回滚

采用与现有轻量迁移兼容的 expand/contract，新增表和索引不改动 MVP 表：

| 阶段 | 变更 | 验证/回滚 |
| --- | --- | --- |
| 0. 预检 | 在临时 PostgreSQL 15 执行草案 DDL，检查扩展、权限、锁和磁盘 | `db:smoke`、`db:verify`、约束负例测试；失败直接丢弃临时库 |
| 1. Expand | 创建 `source_snapshots`、活动/权益/积分/兑换/价值/outbox 表及非唯一索引；全部新列可空或有安全默认 | 校验表、索引、check、外键；应用未读新表时可逐表 `drop table` 回滚 |
| 2. 双写/回填 | 仅在业务代码上线后双写活动事实、任务缓存和审计；按批回填来源哈希、规则版本、积分流水 | 对每个用户比较原始输入与聚合余额/进度，抽样校验跨用户拒绝；停止双写并删除回填数据可回滚 |
| 3. Contract | 验证通过后将必要列设为 `not null`，启用复合外键/RLS，稳定 JSON 键提升为列；大表索引使用 `create index concurrently` | 先在影子库演练；约束冲突时保留兼容列，撤销 RLS/约束并修复数据，不直接删列 |
| 4. 清理 | 旧读路径切换完成且观察窗口结束后，才删除临时兼容字段或旧缓存 | 删除前备份 schema 与计数；保留反向迁移脚本和 PITR 时间点 |

建议迁移拆分为：`workbench_01_sources`、`workbench_02_campaigns`、`workbench_03_benefits`、`workbench_04_points_redemptions`、`workbench_05_value_outbox`；这些只是命名建议，不代表已创建文件。DDL 应避免在事务中执行 `create index concurrently`，并为每个索引记录执行计划和耗时。

回滚原则：新增表优先通过停止写入、禁用消费者、恢复到上一个应用版本处理；不要在有引用数据时级联删除。若积分或兑换出现不一致，冻结兑换 worker，以 `sum(points_ledger)` 重建 `balance_cache`，以订单状态和审计日志重放 outbox；PITR 只作为最后手段。规则版本和流水不可通过“回滚更新”覆盖，必须用反向版本或冲正流水。

## 8. 验证清单和迁移风险

- DDL 语法在 PostgreSQL 15+ 临时库通过，Drizzle `numeric/timestamp/jsonb` 类型与现有 schema 一致。
- 负金额、零积分、错误状态终态、无目标的 `spend_amount/spend_count`、跨用户父子引用和重复幂等键均有失败测试。
- 活动有效期边界、用户时区跨日、夏令时、闰年和窗口包含端点有单元测试；来源快照替换后历史活动结果不变。
- 并发兑换、worker 重试、outbox 重复消费、任务重算和积分余额校正有事务/集成测试。
- 归档卡片不生成新活动任务或权益，但历史活动、额度、兑换和审计可读；账户删除后业务数据按现有清理流程处理。

主要风险是规则 JSON 未定义 schema、跨表 `user_id` 仅靠服务层校验、积分预留超时、来源快照含敏感原文、以及把缓存余额当作事实。上线门槛应是：敏感数据扫描通过、跨用户访问测试通过、积分流水重建与订单对账通过、备份恢复演练完成，并明确每个规则版本的来源和最后确认时间。

## 9. 第二轮领域边界审查

- **活动与刷卡任务**：活动身份、不可变规则版本、结构化条件、执行任务和事实活动分层成立。活动不直接持有“完成度”，任务缓存也不能反向修改事实；同一笔消费可以由规则引擎匹配多个任务，但 `external_key` 只能在同一活动范围内去重，避免误吞跨活动匹配。
- **权益**：`benefits` 表达规则定义，`entitlements` 表达周期发放额度，`value_records` 表达使用和价值。权益使用不等同于消费活动；若业务需要关联，可由 `activities.source_id`/扩展关联表显式连接，不把两类事实合成一行。
- **积分**：账户只定义积分计划和读缓存，`points_ledger` 才是余额事实。活动获得积分、权益赠分和兑换扣分都必须各自产生有幂等键的流水；对账差异使用 `adjustment`/`reversal`，禁止覆盖余额或历史流水。
- **兑换**：兑换是独立订单状态机，不是积分流水的别名。`reserved/processing` 影响可用余额但不改变账面余额，只有 `confirmed` 才插入扣减流水；失败、取消和冲正的语义因此可审计且可重试。
- **来源与价值**：来源快照是所有规则版本的证据，不是规则本身；价值流水只记录用户输入或有来源的算术结果，不承担权益额度和积分余额。以上边界避免把会变化的规则、用户事实、聚合缓存和估值混在同一表中。
