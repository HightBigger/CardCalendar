# Cardfolio 工作台扩展数据模型（第四轮 DBA 复核稿 + 第十轮增量）

> 本文只定义数据库设计，不创建迁移、不修改 `db/schema/**` 或业务代码。复核基线为 `main@e756538`；实际 DDL 必须拆分、在影子库演练后才可进入 `db/migrations/`。

> 第十轮增量研究稿：[CARD-FEATURE-ROUND10-DATA.md](research/CARD-FEATURE-ROUND10-DATA.md)。其 canonical/legacy 写围栏、复合 scope、projection watermark、精度/区间冻结和 D-01--D-16 验收优先于本文早期同名草案；在真实 PostgreSQL、RLS、并发和 PITR 证据完成前仍不可部署。

## 1. 复核结论

首轮“定义/版本、实例/流水”方向成立，但以下差异会破坏历史解释或重算，必须在实施前修正：

| 领域 | 首轮问题 | 第二轮结论 |
| --- | --- | --- |
| 活动 | `card_campaigns` 绑定单卡，`activities` 混合报名、消费和奖励事实 | `campaigns` 只表示活动身份；每张卡建立唯一 `activity_participation`，资格、报名和结果是三条正交状态轴 |
| 规则/来源 | `source_snapshots` 同时承担链接目录和快照；规则只允许一个可空来源 | 可变 `source_references` 与不可变 `source_snapshots` 分离；`rule_versions` 通过 citation 至少引用一个 primary snapshot |
| 刷卡任务 | 只有进度缓存，没有任务内规则快照和可重放事实流水 | 激活任务时冻结规则与刷卡方式；`spend_task_entries` 只追加，缓存由 sequence 重放得到，退款/冲正可使达标回退 |
| 权益 | 用 `value_records` 兼任权益使用流水 | 权益定义、周期发放实例、预约/使用实例、额度流水分开；只有确认使用的流水减少额度 |
| 积分 | 缺少 lot、分配关系、账户内序号和对账调整事实 | 积分账本是唯一事实源；余额、lot remaining 和未分配差额均是带水位的缓存，可从流水及 lot allocation 重建 |
| 兑换 | 首轮预留模型超出手工 MVP，失败/退款语义不完整 | P1-b 不预留；外部兑换确认成功后幂等记 debit，退款幂等记 refund；失败不扣点，余额不足保留真实负数并进入待核对 |

核心不变量：

1. 规则版本、来源快照、任务/权益/积分流水一经引用不得原地修改或物理删除。
2. 业务事实与缓存分离；每个缓存都保存最后应用的账户内或聚合内 sequence，并提供从零重建过程。
3. 所有子表重复保存 `user_id`，用复合外键把“同一用户”下沉到 PostgreSQL；需要同卡的关系同时重复 `card_id`。
4. 手工输入、导入和未来同步均提供稳定 `business_key`/`client_request_key`；相同键不同请求摘要返回冲突，不静默复用。
5. P0 不自动判断银行资格、不自动分配受限积分 lot、不自动发起报名或兑换。

## 2. 通用 PostgreSQL 约定

### 2.1 所有权与复合外键

所有父表除主键外增加 `unique (id, user_id)`；需要固定卡归属的表增加 `unique (id, user_id, card_id)`。子表使用复合外键，而不是只靠 API 查询：

```sql
-- 对现有表的实施前置；上线前先清理孤儿数据，再以 NOT VALID 加入并 VALIDATE。
create unique index cards_id_user_unique on cards (id, user_id);

-- 子表范式示例。
foreign key (card_id, user_id) references cards (id, user_id) on delete restrict
```

服务端仍必须使用会话中的 `user_id` 查询；复合外键是末道一致性保护，不替代授权。RLS 启用后，Web 事务执行 `set local app.user_id`，worker 使用最小权限的独立角色。后台角色不得绕过业务键、审计或 append-only 触发器。

### 2.2 精度、币种与单位

- 法币金额使用 `numeric(14,2)`，禁止 `real/double precision/money`。币种使用 `char(3)` 并引用受控 `iso_4217_currencies(code)`；仅用正则不能阻止 `ZZZ`。若以后支持三位小数币种，先把金额统一扩到 `numeric(18,3)`，不得逐表改变精度。
- 积分/里程使用 `numeric(20,4)`；账户保存 `points_scale smallint check (points_scale between 0 and 4)`，写入触发器校验 `round(points_delta, points_scale) = points_delta`。同一账户的所有流水继承账户 `unit_code`，客户端不能另传不同单位。
- `count_delta` 使用 `integer`；次数不允许小数。金额和点数的正负表达方向，禁止额外用 direction 与符号组成两套真相。
- 所有汇率换算保存原金额/币种、目标金额/币种、`numeric(20,10)` 汇率、估值时点和 source snapshot；不覆盖原金额。

### 2.3 日期、时区与窗口

- 真实瞬时点用 `timestamptz`；银行口径的发生日、入账日、到期日用 `date`。
- 活动/任务窗口保存 inclusive 的 `window_start/window_end date` 与 IANA `timezone`。写入触发器通过 `pg_timezone_names` 校验时区；不接受固定偏移量或浏览器缩写。
- 从 `timestamptz` 派生的 `local_date` 在写入时按对象冻结的时区计算并固化。用户以后改变默认时区不会改写历史。
- 截止日 worker 用对象时区计算下一次执行时间；夏令时不存在或重复的本地时间必须有固定策略并纳入测试。

### 2.4 软删除、不可变事实与审计

- 定义/模板可使用 `archived_at`；归档不释放业务唯一键，避免同一 `campaign_key`、`benefit_key` 被重新解释。
- 参与实例、任务、权益实例、兑换以状态终结，不靠软删除隐藏结果。
- 来源快照、已激活规则版本及所有 ledger/entry 表禁止 `update/delete`。错误通过新版本、correction 或 reversal 表达。
- 仅账户删除清理流程可物理删除，顺序由叶子事实到父表；清理操作写不可包含敏感值的合规审计，并等待备份保留期自然过期。
- 所有状态转换、调整、冲正、来源核对、导出和清理必须在业务事务内写现有 `audit_logs`，至少记录 actor、request/correlation id、对象、动作、前后状态摘要和时间。不得记录完整请求体、原始账单、凭据或完整卡号。

## 3. 来源与规则版本

### 3.1 SourceReference 与不可变 SourceSnapshot

```sql
create table source_references (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references users(id) on delete cascade,
  normalized_uri    text,
  uri_hash          char(64),
  publisher         text,
  title             text not null,
  source_level      text not null check (source_level in
                    ('official_rule','official_product','official_mall','regulator','third_party','user_manual')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  archived_at       timestamptz,
  unique (id, user_id),
  check ((normalized_uri is null) = (uri_hash is null)),
  check (uri_hash is null or uri_hash ~ '^[0-9a-f]{64}$')
);

create unique index source_references_uri_unique
  on source_references (user_id, uri_hash) where uri_hash is not null;

create table source_snapshots (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references users(id) on delete cascade,
  reference_id        uuid,
  capture_key         text not null,
  capture_method      text not null check (capture_method in ('manual','url','document','import')),
  captured_at         timestamptz not null default now(),
  accessed_on         date not null,
  published_on        date,
  content_hash        char(64) not null check (content_hash ~ '^[0-9a-f]{64}$'),
  excerpt             text,
  object_key          text,
  parser_version      text,
  confidence          text not null check (confidence in
                      ('official_verified','official_incomplete','third_party','user_unverified')),
  actor_type          text not null default 'user' check (actor_type in ('user','system','admin')),
  actor_user_id       uuid references users(id) on delete set null,
  normalization_json  jsonb not null default '{"schema_version":1}'::jsonb,
  created_at          timestamptz not null default now(),
  unique (id, user_id),
  unique (user_id, capture_key),
  foreign key (reference_id, user_id) references source_references (id, user_id) on delete restrict,
  check (length(coalesce(excerpt, '')) <= 20000),
  check (actor_user_id is null or actor_user_id = user_id),
  check (reference_id is not null or capture_method in ('manual','document','import'))
);
```

`capture_key` 只去重同一次命令；用户在不同日期重新核对同一内容仍创建新 snapshot。原文对象先脱敏再加密保存，数据库只存受控对象键和 hash。应用角色对 `source_snapshots` 只有 `select/insert`；数据库触发器拒绝 `update/delete`。URL 内容变化、重新访问或人工修订都不能覆盖旧快照。

### 3.2 Rule、RuleVersion 与引用证据

```sql
create extension if not exists btree_gist; -- 需先确认托管 PostgreSQL 权限

create table rules (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references users(id) on delete cascade,
  rule_kind       text not null check (rule_kind in
                  ('annual_fee','campaign','benefit','spend','points','redemption')),
  rule_key        text not null,
  created_at      timestamptz not null default now(),
  archived_at     timestamptz,
  unique (id, user_id),
  unique (user_id, rule_kind, rule_key)
);

create table rule_versions (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references users(id) on delete cascade,
  rule_id             uuid not null,
  version_no          integer not null check (version_no > 0),
  status              text not null default 'draft' check (status in
                      ('draft','active','superseded','expired','needs_review')),
  effective_from      date not null,
  effective_to        date,
  timezone            text not null,
  eligibility_text    text,
  conditions_json     jsonb not null default '{"schema_version":1}'::jsonb,
  change_summary      text not null,
  verified_by_user_at timestamptz,
  activated_at        timestamptz,
  superseded_at       timestamptz,
  created_at          timestamptz not null default now(),
  unique (id, user_id),
  unique (id, user_id, rule_id),
  unique (rule_id, version_no),
  foreign key (rule_id, user_id) references rules (id, user_id) on delete restrict,
  check (effective_to is null or effective_to >= effective_from),
  check (status <> 'active' or activated_at is not null),
  check (status not in ('superseded','expired') or activated_at is not null)
);

alter table rule_versions add constraint rule_versions_active_period_excl
  exclude using gist (
    rule_id with =,
    daterange(effective_from, effective_to, '[]') with &&
  ) where (status = 'active');

create table rule_source_citations (
  rule_version_id    uuid not null,
  user_id            uuid not null,
  source_snapshot_id uuid not null,
  citation_role      text not null check (citation_role in ('primary','supporting')),
  quoted_path        text,
  created_at         timestamptz not null default now(),
  primary key (rule_version_id, source_snapshot_id),
  foreign key (rule_version_id, user_id) references rule_versions (id, user_id) on delete restrict,
  foreign key (source_snapshot_id, user_id) references source_snapshots (id, user_id) on delete restrict
);

create unique index rule_source_one_primary
  on rule_source_citations (rule_version_id) where citation_role = 'primary';
```

激活规则必须走一个数据库函数/事务：锁 `rules`，分配下一 `version_no`，验证恰有一个 primary citation，再切换状态。普通 check 无法表达“至少一个子行”，因此用 deferred constraint trigger 在事务结束时验证；不得只在应用层检查。已离开 `draft` 的版本由不可变触发器保护，`needs_review` 经核对后创建新版本，不能原地恢复 active。排斥约束仅限制 active 生效区间；若环境不能安装 `btree_gist`，迁移必须改用锁 `rules` 的 constraint trigger，不能删除非重叠保证。

## 4. 活动报名与参与实例

```sql
create table campaigns (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references users(id) on delete cascade,
  rule_id         uuid not null,
  campaign_key    text not null,
  name            text not null,
  provider_name   text not null,
  status          text not null default 'draft' check (status in
                  ('draft','published','ended','cancelled','needs_review','archived')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  archived_at     timestamptz,
  unique (id, user_id),
  unique (id, user_id, rule_id),
  unique (user_id, campaign_key),
  foreign key (rule_id, user_id) references rules (id, user_id) on delete restrict
);

create table activity_participations (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references users(id) on delete cascade,
  campaign_id            uuid not null,
  card_id                uuid not null,
  rule_id                uuid not null,
  rule_version_id        uuid not null,
  activity_instance_key  text not null,
  eligibility_status     text not null default 'unknown' check (eligibility_status in
                         ('unknown','potentially_eligible','user_confirmed_eligible',
                          'user_confirmed_ineligible','needs_review')),
  enrollment_status      text not null default 'not_started' check (enrollment_status in
                         ('not_required','not_started','submitted','confirmed','rejected','expired','cancelled','unknown','needs_review')),
  quota_status           text not null default 'unknown' check (quota_status in
                         ('not_applicable','unknown','available','full','waitlisted','allocated','not_allocated','needs_review')),
  outcome_status         text not null default 'not_started' check (outcome_status in
                         ('not_started','in_progress','target_reached',
                          'failed','expired','needs_review')),
  qualification_status   text not null default 'unconfirmed' check (qualification_status in
                         ('unconfirmed','user_confirmed','rejected','needs_review')),
  enrollment_verified_at timestamptz,
  quota_verified_at      timestamptz,
  reward_verified_at     timestamptz,
  row_version            bigint not null default 0,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (id, user_id),
  unique (id, user_id, card_id),
  unique (user_id, campaign_id, card_id, activity_instance_key),
  unique (id, user_id, card_id, activity_instance_key),
  foreign key (campaign_id, user_id, rule_id)
    references campaigns (id, user_id, rule_id) on delete restrict,
  foreign key (rule_version_id, user_id, rule_id)
    references rule_versions (id, user_id, rule_id) on delete restrict,
  foreign key (card_id, user_id) references cards (id, user_id) on delete restrict,
  check (enrollment_status <> 'confirmed' or enrollment_verified_at is not null),
  check (quota_status not in ('available','full','waitlisted','allocated','not_allocated') or quota_verified_at is not null)
);
```

```sql
create table activity_rewards (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references users(id) on delete cascade,
  participation_id   uuid not null,
  reward_key         text not null,
  request_hash       char(64) not null check (request_hash ~ '^[0-9a-f]{64}$'),
  business_key       text not null,
  status             text not null default 'not_expected' check (status in
                     ('not_expected','expected_pending','delayed','received','reversed','disputed','unknown','needs_review')),
  reward_type        text,
  reward_amount_text text,
  reward_cap_text    text,
  expected_on        date,
  received_on        date,
  reversed_on        date,
  reversal_reason    text,
  source_snapshot_id uuid,
  evidence_note      text,
  row_version        bigint not null default 0,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (id, user_id),
  unique (participation_id, reward_key, user_id),
  unique (participation_id, business_key),
  foreign key (participation_id, user_id)
    references activity_participations (id, user_id) on delete restrict,
  foreign key (source_snapshot_id, user_id)
    references source_snapshots (id, user_id) on delete restrict
);
```

```sql
create table activity_reward_events (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references users(id) on delete cascade,
  reward_id           uuid not null,
  sequence            bigint not null check (sequence > 0),
  business_key        text not null,
  request_hash        char(64) not null check (request_hash ~ '^[0-9a-f]{64}$'),
  event_type          text not null,
  from_status         text,
  to_status           text not null,
  source_snapshot_id  uuid,
  evidence_note       text,
  occurred_at         timestamptz not null,
  created_at          timestamptz not null default now(),
  unique (id, user_id),
  unique (reward_id, sequence),
  unique (reward_id, business_key),
  unique (reward_id, request_hash),
  foreign key (reward_id, user_id) references activity_rewards (id, user_id) on delete restrict,
  foreign key (source_snapshot_id, user_id)
    references source_snapshots (id, user_id) on delete restrict
);
```

活动规则中的适用卡种、地区、渠道和资格文本属于被冻结的 `rule_version`，不能保存为 `campaigns.applicable_card_ids`。quota_status 是 participation 的独立事实轴，available 不等于 allocated，unknown/full/not_allocated 阻止最终达标。`potentially_eligible` 只表示结构化条件未发现冲突，不能显示为用户已符合资格。并发状态更新使用 `row_version` 乐观锁并写审计；规则变化、卡归档或任务冲正只能将实例标为 `needs_review`，不能静默改为失败。

`outcome_status` 只表示参与结果投影，不是 SpendTask 的 `progress_status`；奖励到账、撤回和争议应由独立 reward 事实或事件投影承载。旧草案中的 `reward_received` 枚举已移除，不能用一个参与状态代替奖励轴。

`activity_rewards` 是独立事实，允许同一 participation 通过 reward_key 表示多个奖励段；状态变更应追加 activity_reward_events 或等价 append-only 历史，并以 request_hash/business_key 幂等。target_reached 不得自动创建奖励到账、积分流水或权益下发。

P0 必须落地 `activity_reward_events`（或等价不可变表），不能只依赖 `activity_rewards.row_version`：事件至少保存 `reward_id`、`sequence`、`business_key`、`request_hash`、`from_status`、`to_status`、来源/证据、时间和 actor；`(reward_id, sequence)`、`(reward_id, business_key)`、`(reward_id, request_hash)` 唯一，应用角色不得更新/删除。奖励状态读模型只能从事件重放，重复确认命中原响应，同 key 异参数返回 409。

报名动作如需独立历史，追加 `activity_participation_events(participation_id, sequence, event_type, business_key, occurred_at, payload)`；状态列只是其投影。实施时建议从第一版就建事件表，以便回答“何时由谁确认报名/资格”，唯一键为 `(participation_id, sequence)` 和 `(participation_id, business_key)`，同样禁止更新/删除。

## 5. 刷卡规则快照、事实流水与进度缓存

### 5.1 模板和任务内快照

`spend_methods` 是用户可编辑模板，不是银行事实。任务激活时把渠道、地区、币种、商户范围、MCC/排除项和证据说明复制到任务内快照：

```sql
create table spend_tasks (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references users(id) on delete cascade,
  card_id               uuid not null,
  participation_id      uuid,
  rule_id               uuid not null,
  rule_version_id       uuid not null,
  activity_instance_key text not null,
  window_start          date not null,
  window_end            date not null,
  timezone              text not null,
  cutoff_basis          text not null default 'unknown' check (cutoff_basis in
                        ('occurred','posted','settled','unknown')),
  input_mode            text not null default 'entries' check (input_mode in ('snapshot','entries')),
  metric_type           text not null check (metric_type in
                        ('count','amount','count_and_amount','count_or_amount','custom')),
  condition_relation    text not null default 'all' check (condition_relation in ('all','any','custom')),
  target_count          integer,
  target_amount         numeric(14,2),
  currency              char(3),
  lifecycle_status      text not null default 'draft' check (lifecycle_status in
                        ('draft','active','ended','cancelled')),
  progress_status       text not null default 'not_started' check (progress_status in
                        ('not_started','in_progress','provisionally_qualified','target_reached',
                         'shortfall','failed','expired','disputed','needs_review')),
  qualification_status  text not null default 'unconfirmed' check (qualification_status in
                        ('unconfirmed','user_confirmed','rejected','needs_review')),
  progress_count_cache  integer not null default 0,
  progress_amount_cache numeric(14,2) not null default 0,
  pending_count_cache   integer not null default 0,
  pending_amount_cache  numeric(14,2) not null default 0,
  evidence_level        text not null default 'unknown' check (evidence_level in
                        ('user_total','user_entries','user_official_evidence','unknown')),
  reconciliation_status text not null default 'not_due' check (reconciliation_status in
                        ('not_due','pending','reconciled','disputed')),
  last_entry_sequence   bigint not null default 0,
  last_rebuilt_at       timestamptz,
  row_version           bigint not null default 0,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (id, user_id),
  unique (id, user_id, card_id),
  unique (user_id, card_id, activity_instance_key),
  foreign key (card_id, user_id) references cards (id, user_id) on delete restrict,
  foreign key (participation_id, user_id, card_id, activity_instance_key)
    references activity_participations (id, user_id, card_id, activity_instance_key) on delete restrict,
  foreign key (rule_version_id, user_id, rule_id)
    references rule_versions (id, user_id, rule_id) on delete restrict,
  foreign key (currency) references iso_4217_currencies (code),
  check (window_end >= window_start),
  check (target_count is null or target_count >= 0),
  check (target_amount is null or target_amount >= 0),
  check ((metric_type in ('count','count_and_amount','count_or_amount')) = (target_count is not null)),
  check ((metric_type in ('amount','count_and_amount','count_or_amount')) = (target_amount is not null)),
  check ((target_amount is null) = (currency is null))
);

create table spend_method_snapshots (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references users(id) on delete cascade,
  task_id             uuid not null,
  snapshot_key        text not null,
  source_method_id    uuid,
  channel_type        text not null,
  merchant_scope      text,
  region_scope        text,
  currency_scope      char(3)[],
  exclusions_text     text,
  source_snapshot_id  uuid,
  created_at          timestamptz not null default now(),
  unique (id, task_id, user_id),
  unique (task_id, snapshot_key),
  foreign key (task_id, user_id) references spend_tasks (id, user_id) on delete restrict,
  foreign key (source_snapshot_id, user_id)
    references source_snapshots (id, user_id) on delete restrict
);
```

```sql
create table spend_task_snapshots (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references users(id) on delete cascade,
  task_id            uuid not null,
  sequence           bigint not null check (sequence > 0),
  confirmed_count    integer,
  confirmed_amount  numeric(14,2),
  evidence_note      text,
  source_snapshot_id uuid,
  business_key       text not null,
  created_at         timestamptz not null default now(),
  unique (id, task_id, user_id),
  unique (task_id, sequence),
  unique (task_id, business_key),
  foreign key (task_id, user_id) references spend_tasks (id, user_id) on delete restrict,
  foreign key (source_snapshot_id, user_id)
    references source_snapshots (id, user_id) on delete restrict,
  check (confirmed_count is not null or confirmed_amount is not null),
  check (confirmed_count is null or confirmed_count >= 0),
  check (confirmed_amount is null or confirmed_amount >= 0)
);
```

`input_mode=snapshot` 时最多允许一个当前 snapshot 事实，`input_mode=entries` 时禁止写入 `spend_task_snapshots`；反向操作也拒绝。该互斥必须由事务内 trigger/存储过程或模式专属写入口强制，不能只靠服务层约定；缓存进度不得作为可写事实。

`custom` 规则只保存说明且强制 `needs_review/user_confirmed`，P0 不执行表达式。模板编辑只影响未来任务；进行中任务迁移必须创建新 task/rule snapshot 或明确终结旧任务，不能覆盖 snapshot。

### 5.2 不可变 SpendTaskEntry

```sql
create table spend_task_entries (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references users(id) on delete cascade,
  task_id             uuid not null,
  sequence            bigint not null check (sequence > 0),
  business_key        text not null,
  entry_type          text not null check (entry_type in
                      ('contribution','refund','correction','reversal')),
  related_entry_id    uuid,
  occurred_on         date not null,
  posted_on           date,
  settled_on          date,
  processing_status   text not null default 'occurred_only' check (processing_status in
                      ('occurred_only','posted','settled','rejected','reversed','unknown')),
  qualification_status text not null default 'unknown' check (qualification_status in
                      ('included','excluded','pending','disputed','unknown')),
  count_delta         integer not null default 0,
  amount_delta        numeric(14,2) not null default 0,
  currency            char(3),
  method_snapshot_id  uuid,
  evidence_status     text not null check (evidence_status in
                      ('user_asserted','source_supported','needs_review','disputed')),
  observed_count      integer,
  observed_amount     numeric(14,2),
  source_snapshot_id  uuid,
  reason_code         text,
  note                text,
  created_at          timestamptz not null default now(),
  unique (id, task_id, user_id),
  unique (task_id, sequence),
  unique (task_id, business_key),
  foreign key (task_id, user_id) references spend_tasks (id, user_id) on delete restrict,
  foreign key (related_entry_id, task_id, user_id)
    references spend_task_entries (id, task_id, user_id) on delete restrict,
  foreign key (method_snapshot_id, task_id, user_id)
    references spend_method_snapshots (id, task_id, user_id) on delete restrict,
  foreign key (source_snapshot_id, user_id)
    references source_snapshots (id, user_id) on delete restrict,
  foreign key (currency) references iso_4217_currencies (code),
  check (count_delta <> 0 or amount_delta <> 0),
  check ((amount_delta = 0) = (currency is null)),
  check (entry_type <> 'contribution' or (count_delta >= 0 and amount_delta >= 0)),
  check (entry_type <> 'refund' or (count_delta <= 0 and amount_delta <= 0)),
  check (entry_type <> 'reversal' or related_entry_id is not null),
  check (entry_type <> 'correction' or observed_count is not null or observed_amount is not null),
  check (processing_status <> 'occurred_only' or posted_on is null),
  check (processing_status not in ('posted','settled') or posted_on is not null),
  check (qualification_status <> 'included' or processing_status in ('posted','settled','occurred_only')),
  check (entry_type <> 'refund' or related_entry_id is not null
         or (source_snapshot_id is not null and length(trim(coalesce(note,''))) > 0))
);

create unique index spend_task_one_reversal_per_entry
  on spend_task_entries (task_id, related_entry_id)
  where entry_type = 'reversal';
```

数据库触发器还需验证：entry 币种与 task 一致；method snapshot 属于 task；`reversal` 与目标 entry 的 count/amount/currency 完全相反；不允许形成引用环。退款可部分发生，使用稳定 `business_key` 防止同一退款重复导入。要恢复一个 reversal，只能新增 reversal-of-reversal。

写入事务先 `select ... for update` 锁 task，分配 `sequence = last_entry_sequence + 1`，插入事实，再按全部 entry 或从水位增量重算缓存。进度允许小于零；负值不截断而将 `progress_status/qualification_status` 置为 `needs_review`。退款使 `target_reached` 回退时，事务必须同时写审计和 `SpendTaskTargetNoLongerReached` outbox 事件。缓存校验公式为：

```text
progress_count_cache  = sum(count_delta order by sequence)
progress_amount_cache = sum(amount_delta order by sequence)
last_entry_sequence   = max(sequence)
```

## 6. 权益发放、预约与使用流水

权益定义通过 `rule_id` 关联版本；发放实例固定卡、版本和周期。业务唯一键在归档后也不复用：

```sql
create table benefits (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users(id) on delete cascade,
  card_id       uuid not null,
  rule_id       uuid not null,
  benefit_key   text not null,
  name          text not null,
  benefit_type  text not null check (benefit_type in
                ('count','credit','insurance','lounge','service','fee_waiver','other')),
  usage_model   text not null default 'unknown' check (usage_model in
                ('consumable_quota','coverage_claim','fee_credit','service_record','unknown')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  archived_at   timestamptz,
  unique (id, user_id),
  unique (id, user_id, card_id),
  unique (id, user_id, card_id, rule_id),
  unique (user_id, card_id, benefit_key),
  foreign key (card_id, user_id) references cards (id, user_id) on delete restrict,
  foreign key (rule_id, user_id) references rules (id, user_id) on delete restrict
);

create table benefit_entitlements (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references users(id) on delete cascade,
  card_id                uuid not null,
  benefit_id             uuid not null,
  rule_id                uuid not null,
  rule_version_id        uuid not null,
  grant_key              text not null,
  valid_from             date not null,
  valid_to               date not null,
  timezone               text not null,
  status                 text not null default 'pending_delivery' check (status in
                         ('pending_delivery','available','delivery_failed','suspended','expired','revoked','disputed','unknown')),
  quota_status           text not null default 'not_applicable' check (quota_status in
                         ('not_applicable','available','partially_used','exhausted','needs_review')),
  granted_count_cache    integer not null default 0,
  remaining_count_cache integer not null default 0,
  granted_amount_cache   numeric(14,2) not null default 0,
  remaining_amount_cache numeric(14,2) not null default 0,
  currency               char(3),
  last_entry_sequence    bigint not null default 0,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (id, user_id),
  unique (id, user_id, card_id),
  unique (user_id, benefit_id, grant_key),
  foreign key (benefit_id, user_id, card_id, rule_id)
    references benefits (id, user_id, card_id, rule_id) on delete restrict,
  foreign key (rule_version_id, user_id, rule_id)
    references rule_versions (id, user_id, rule_id) on delete restrict,
  foreign key (currency) references iso_4217_currencies (code),
  check (valid_to >= valid_from)
);

create table benefit_usages (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references users(id) on delete cascade,
  card_id             uuid not null,
  entitlement_id      uuid not null,
  client_request_key  text not null,
  request_hash        char(64) not null,
  status              text not null check (status in
                      ('planned','booked','used','rejected','cancelled','disputed')),
  reservation_status  text not null default 'not_required' check (reservation_status in
                      ('not_required','not_booked','requested','confirmed','rejected','cancelled','unknown')),
  redemption_status   text not null default 'not_presented' check (redemption_status in
                      ('not_presented','presented','redeemed','rejected','disputed','unknown')),
  dispute_status      text not null default 'not_disputed' check (dispute_status in
                      ('not_disputed','open','resolved_user','resolved_provider','unresolved')),
  planned_on          date,
  booked_at           timestamptz,
  presented_at        timestamptz,
  used_at             timestamptz,
  redeemed_at         timestamptz,
  dispute_opened_at   timestamptz,
  reservation_reference_masked text,
  requested_count     integer,
  requested_amount    numeric(14,2),
  actual_charge_amount numeric(14,2),
  currency            char(3),
  provider_or_location text,
  rejection_reason    text,
  row_version         bigint not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (id, user_id),
  unique (id, entitlement_id, user_id),
  unique (user_id, client_request_key),
  foreign key (entitlement_id, user_id, card_id)
    references benefit_entitlements (id, user_id, card_id) on delete restrict,
  foreign key (currency) references iso_4217_currencies (code),
  check (requested_count is null or requested_count >= 0),
  check (requested_amount is null or requested_amount >= 0),
  check (actual_charge_amount is null or actual_charge_amount >= 0),
  check ((requested_amount is null and actual_charge_amount is null) = (currency is null)),
  check (status <> 'booked' or booked_at is not null),
  check (reservation_status <> 'confirmed' or booked_at is not null),
  check (redemption_status <> 'presented' or presented_at is not null),
  check (redemption_status <> 'redeemed' or redeemed_at is not null),
  check (redemption_status <> 'redeemed' or status = 'used'),
  check (status <> 'used' or redemption_status = 'redeemed'),
  check (dispute_status = 'not_disputed' or dispute_opened_at is not null),
  check (status <> 'disputed' or dispute_status <> 'not_disputed'),
  check (reservation_reference_masked is null or length(reservation_reference_masked) between 1 and 128)
);
```

```sql
create table benefit_entitlement_ledger (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references users(id) on delete cascade,
  entitlement_id      uuid not null,
  sequence            bigint not null check (sequence > 0),
  business_key        text not null,
  entry_type          text not null check (entry_type in
                      ('grant','consume','restore','expire','reversal')),
  related_entry_id    uuid,
  usage_id            uuid,
  count_delta         integer not null default 0,
  amount_delta        numeric(14,2) not null default 0,
  currency            char(3),
  source_snapshot_id  uuid,
  occurred_at         timestamptz not null,
  note                text,
  created_at          timestamptz not null default now(),
  unique (id, entitlement_id, user_id),
  unique (entitlement_id, sequence),
  unique (entitlement_id, business_key),
  foreign key (entitlement_id, user_id)
    references benefit_entitlements (id, user_id) on delete restrict,
  foreign key (related_entry_id, entitlement_id, user_id)
    references benefit_entitlement_ledger (id, entitlement_id, user_id) on delete restrict,
  foreign key (usage_id, entitlement_id, user_id)
    references benefit_usages (id, entitlement_id, user_id) on delete restrict,
  foreign key (source_snapshot_id, user_id)
    references source_snapshots (id, user_id) on delete restrict,
  foreign key (currency) references iso_4217_currencies (code),
  check (count_delta <> 0 or amount_delta <> 0),
  check ((amount_delta = 0) = (currency is null)),
  check (entry_type <> 'grant' or (count_delta >= 0 and amount_delta >= 0)),
  check (entry_type in ('grant','restore') or (count_delta <= 0 and amount_delta <= 0)),
  check (entry_type <> 'consume' or (usage_id is not null and count_delta <= 0 and amount_delta <= 0)),
  check (entry_type not in ('restore','reversal') or related_entry_id is not null)
);

create unique index benefit_ledger_one_restore_or_reversal_per_entry
  on benefit_entitlement_ledger (entitlement_id, related_entry_id)
  where entry_type in ('restore','reversal');
```

`benefit_entitlements.status` 是下发事实，`quota_status` 是额度派生投影；`exhausted` 不得作为下发状态写入。`benefit_usages.status` 仅保留兼容投影，API 不得直接写入，规范事实是 `reservation_status` 与 `redemption_status` 两条轴。booked 只表示预约事实，presented 只表示已出示，只有 redeemed 才表示实际核销。`usage_model=consumable_quota` 的 grant 增加额度，确认 redeemed 后以 `benefit_usage:{id}:consume` 扣减；planned/booked/rejected/cancelled/disputed 不扣额度。`coverage_claim`、`fee_credit` 和 `service_record` 不进入次数 consume 流程。新写入只允许 `grant/consume/restore/expire`，`reversal` 仅作为受控技术性精确反向事实；旧 `use/adjustment` 仅为兼容读映射。restore 必须精确反向既有 consume，usage 与 entitlement 必须属于同一实例。价值另写 value_records，绝不能反向充当额度事实源。

数量和金额字段只接受非负值；金额字段存在时必须带 ISO 4217 币种，只有次数型使用才允许币种为空。预约取消、现场拒绝和未解决争议不得产生额度扣减。失败或取消不会自动生成恢复流水，只有用户确认实际核销后再以 reversal 修正既有扣减。

余额缓存从 entitlement ledger 重建；remaining 小于零时保留原值并进入 `needs_review`。发放、使用、状态投影、审计和 outbox 在同一事务提交。

## 7. 积分账户、到期 lot 与对账差额

### 7.1 账户与唯一事实流水

```sql
create table points_accounts (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null references users(id) on delete cascade,
  card_id                  uuid,
  account_key              text not null,
  program_code             text not null,
  program_name             text not null,
  unit_code                text not null check (unit_code ~ '^[A-Z0-9_]{2,32}$'),
  points_scale             smallint not null default 0 check (points_scale between 0 and 4),
  expiry_model             text not null default 'unknown' check (expiry_model in
                           ('none','fixed_date','rolling','lot_based','unknown')),
  consumption_order        text not null default 'unknown' check (consumption_order in
                           ('earliest_expiry_first','issuer_defined','user_selected','unknown')),
  balance_cache            numeric(20,4) not null default 0,
  confirmed_balance_cache  numeric(20,4),
  allocated_balance_cache  numeric(20,4) not null default 0,
  unallocated_balance_cache numeric(20,4) not null default 0,
  reconciliation_difference_cache numeric(20,4),
  last_ledger_sequence     bigint not null default 0,
  last_allocation_sequence bigint not null default 0,
  balance_as_of            timestamptz,
  reconciliation_status    text not null default 'pending' check (reconciliation_status in
                           ('balanced','mismatch','pending','unknown')),
  status                   text not null default 'active' check (status in
                           ('active','frozen','closed','needs_review','archived')),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  archived_at              timestamptz,
  unique (id, user_id),
  unique (id, user_id, card_id),
  unique (user_id, account_key),
  foreign key (card_id, user_id) references cards (id, user_id) on delete restrict,
  check (unallocated_balance_cache = balance_cache - allocated_balance_cache),
  check (reconciliation_difference_cache is null or confirmed_balance_cache is not null),
  check (reconciliation_difference_cache is null or reconciliation_difference_cache = confirmed_balance_cache - balance_cache)
);

create table points_ledger (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references users(id) on delete cascade,
  account_id          uuid not null,
  sequence            bigint not null check (sequence > 0),
  business_key        text not null,
  request_hash        char(64) not null check (request_hash ~ '^[0-9a-f]{64}$'),
  entry_type          text not null check (entry_type in
                      ('earn','adjustment','expire','redeem_debit','reversal')),
  points_delta        numeric(20,4) not null check (points_delta <> 0),
  related_entry_id    uuid,
  occurred_at         timestamptz not null,
  posted_on           date,
  source_kind         text not null check (source_kind in
                      ('manual','activity','redemption','import','system')),
  adjustment_reason   text,
  source_snapshot_id  uuid,
  note                text,
  created_at          timestamptz not null default now(),
  unique (id, account_id, user_id),
  unique (account_id, sequence),
  unique (account_id, business_key),
  foreign key (account_id, user_id) references points_accounts (id, user_id) on delete restrict,
  foreign key (related_entry_id, account_id, user_id)
    references points_ledger (id, account_id, user_id) on delete restrict,
  foreign key (source_snapshot_id, user_id)
    references source_snapshots (id, user_id) on delete restrict,
  check (entry_type <> 'reversal' or related_entry_id is not null),
  check (entry_type not in ('redeem_debit','expire') or points_delta < 0),
  check (entry_type not in ('earn','adjustment') or points_delta <> 0),
  check (entry_type <> 'adjustment' or adjustment_reason is not null)
);

create unique index points_ledger_one_reversal_per_entry
  on points_ledger (account_id, related_entry_id) where entry_type = 'reversal';
```

`balance_cache` 允许为负：用户可能已经在银行完成兑换，而本地历史不完整。禁止用 `greatest(balance, 0)` 隐藏差异；负余额将账户置为 `needs_review`。写入在锁定账户后分配 sequence，触发器校验精度、reversal 精确反向、账户单位和不可变性。相同 business key 若 `request_hash` 不同必须返回 `409 IDEMPOTENCY_CONFLICT`。

`account_key` 是用户范围内的稳定账户命名空间：同一积分计划按卡分账与合并池必须使用不同 key；不能依赖可空 `card_id` 和 `(user_id, program_code, unit_code)` 的唯一性来表达两种语义。

### 7.2 PointsLot、分配与未分配差额

```sql
create table points_lots (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references users(id) on delete cascade,
  account_id          uuid not null,
  lot_key             text not null,
  earned_on           date,
  expires_on          date,
  expiry_basis        text not null check (expiry_basis in ('fixed','rolling','activity_specific','unknown')),
  expiry_confidence   text not null check (expiry_confidence in ('official','user_input','inferred','unknown')),
  usage_restriction_text text,
  remaining_cache     numeric(20,4) not null default 0,
  status              text not null check (status in
                      ('open','partially_used','used','expired','void','disputed')),
  created_at          timestamptz not null default now(),
  unique (id, account_id, user_id),
  unique (account_id, lot_key),
  foreign key (account_id, user_id) references points_accounts (id, user_id) on delete restrict,
  check (expires_on is null or earned_on is null or expires_on >= earned_on)
);

create table points_lot_allocations (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references users(id) on delete cascade,
  account_id        uuid not null,
  allocation_sequence bigint not null check (allocation_sequence > 0),
  ledger_entry_id   uuid not null,
  lot_id            uuid not null,
  allocated_delta   numeric(20,4) not null check (allocated_delta <> 0),
  created_at        timestamptz not null default now(),
  unique (ledger_entry_id, lot_id),
  unique (account_id, allocation_sequence),
  foreign key (ledger_entry_id, account_id, user_id)
    references points_ledger (id, account_id, user_id) on delete restrict,
  foreign key (lot_id, account_id, user_id)
    references points_lots (id, account_id, user_id) on delete restrict
);
```

lot allocation 是事实的一部分，禁止更新/删除；更正通过新 ledger entry 和对应 allocation。`allocation_sequence` 与 points ledger 的账户 sequence 分离，因此一条 earn/redeem/expire 流水可以拆分到多个 lot。deferred constraint trigger 在事务结束时验证每条 ledger 的 allocation 合计与流水同号且绝对值不超过流水绝对值，并验证 lot remaining 等于 allocation 合计。未分配差额不是额外可写余额，而是：

```text
account.balance       = sum(points_ledger.points_delta)
lot.remaining(lot)    = sum(points_lot_allocations.allocated_delta for lot)
allocated_balance     = sum(all lots' remaining)
unallocated_balance   = account.balance - allocated_balance
```

P1-b 只接受用户指定 lot 或保留未分配差额；即使 `consumption_order` 有值，也只给建议，不自动跨用途限制分摊。到期 worker 对明确 `expires_on` 的剩余额度只生成去重 Reminder；用户基于明确来源确认后，才新增 `expire` ledger 及负 allocation。自动写入 expire 属于 P2，不直接改 `remaining_cache`。

### 7.3 余额核对与调整流水

```sql
create table points_reconciliations (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references users(id) on delete cascade,
  account_id          uuid not null,
  client_request_key  text not null,
  request_hash        char(64) not null check (request_hash ~ '^[0-9a-f]{64}$'),
  observed_balance    numeric(20,4) not null,
  ledger_balance_before numeric(20,4) not null,
  adjustment_delta    numeric(20,4) not null,
  balance_as_of       timestamptz not null,
  source_snapshot_id  uuid,
  adjustment_entry_id uuid,
  note                text,
  created_at          timestamptz not null default now(),
  unique (user_id, client_request_key),
  unique (adjustment_entry_id),
  foreign key (account_id, user_id) references points_accounts (id, user_id) on delete restrict,
  foreign key (adjustment_entry_id, account_id, user_id)
    references points_ledger (id, account_id, user_id) on delete restrict,
  foreign key (source_snapshot_id, user_id)
    references source_snapshots (id, user_id) on delete restrict,
  check (adjustment_delta = observed_balance - ledger_balance_before),
  check ((adjustment_delta = 0) = (adjustment_entry_id is null))
);
```

用户录入余额必须转换成 `adjustment` 且 `adjustment_reason=reconciliation`；不存在 `PATCH balance`。若差额为零，只写 reconciliation/audit，不制造零流水。调整默认不分配 lot，因此 `unallocated_difference` 体现在未分配投影，直至用户补充批次。`reconciliation_difference = confirmed_balance - ledger_balance` 与 `unallocated_difference = ledger_balance - lots_remaining_total` 必须分别展示。

## 8. 兑换幂等、并发扣减与失败退款

```sql
create table redemptions (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references users(id) on delete cascade,
  account_id            uuid not null,
  card_id               uuid,
  rule_id               uuid,
  rule_version_id       uuid,
  client_request_key    text not null,
  request_hash          char(64) not null check (request_hash ~ '^[0-9a-f]{64}$'),
  catalog_name          text,
  item_name             text not null,
  channel               text,
  external_ref_masked   text,
  external_ref_hash     char(64),
  required_points       numeric(20,4) not null check (required_points >= 0),
  cash_component_amount numeric(14,2),
  currency              char(3),
  order_status          text not null default 'planned' check (order_status in
                        ('planned','submitted','accepted','rejected','cancelled','unknown')),
  fulfillment_status    text not null default 'not_started' check (fulfillment_status in
                        ('not_started','processing','fulfilled','failed','cancelled','unknown')),
  points_debit_status   text not null default 'not_debited' check (points_debit_status in
                        ('not_debited','pending_debit','posted','needs_review')),
  refund_status         text not null default 'not_applicable' check (refund_status in
                        ('not_applicable','not_requested','pending_external_confirmation','confirmed_external','posted','needs_review')),
  review_status         text not null default 'clear' check (review_status in
                        ('clear','needs_review','disputed')),
  requested_on          date,
  accepted_at           timestamptz,
  succeeded_at          timestamptz,
  fulfilled_at          timestamptz,
  refund_expected_on    date,
  failure_reason        text,
  row_version           bigint not null default 0,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (id, user_id),
  unique (id, account_id, user_id),
  unique (user_id, client_request_key),
  foreign key (account_id, user_id) references points_accounts (id, user_id) on delete restrict,
  foreign key (account_id, user_id, card_id)
    references points_accounts (id, user_id, card_id) on delete restrict,
  foreign key (card_id, user_id) references cards (id, user_id) on delete restrict,
  foreign key (rule_version_id, user_id, rule_id)
    references rule_versions (id, user_id, rule_id) on delete restrict,
  foreign key (currency) references iso_4217_currencies (code),
  check ((cash_component_amount is null) = (currency is null)),
  check ((external_ref_masked is null) = (external_ref_hash is null)),
  check (external_ref_masked is null or length(external_ref_masked) between 1 and 128),
  check (external_ref_hash is null or external_ref_hash ~ '^[0-9a-f]{64}$'),
  check ((rule_id is null) = (rule_version_id is null)),
  check (cash_component_amount is null or cash_component_amount >= 0),
  check (order_status <> 'accepted' or accepted_at is not null),
  check (fulfillment_status <> 'fulfilled' or fulfilled_at is not null)
);

create unique index redemptions_external_ref_unique
  on redemptions (user_id, account_id, channel, external_ref_hash)
  where external_ref_hash is not null;

create table redemption_ledger_links (
  redemption_id  uuid not null,
  account_id     uuid not null,
  user_id        uuid not null,
  ledger_entry_id uuid not null,
  link_role      text not null check (link_role in ('debit','refund')),
  created_at     timestamptz not null default now(),
  primary key (redemption_id, link_role),
  unique (ledger_entry_id),
  foreign key (redemption_id, account_id, user_id)
    references redemptions (id, account_id, user_id) on delete restrict,
  foreign key (ledger_entry_id, account_id, user_id)
    references points_ledger (id, account_id, user_id) on delete restrict
);
```

`redemptions.card_id` 的可空性不能由 PostgreSQL 复合 FK 的 NULL 语义放行。受控 transition function/deferred trigger 必须强制：`points_accounts.card_id is not null` 时 redemption.card_id 必须非空且相等；只有 `points_accounts.card_id is null` 的合并池允许 redemption.card_id 为空，且不允许任意卡挂接。账户产生首条 ledger 后禁止改变 card scope；固定卡缺卡、错卡、合并池带卡和跨用户引用均返回 404/409 并写审计。

P1-b 是“记录用户已在外部渠道执行的兑换”，不做 reservation；订单受理、外部履约、本地扣分和退分是四个底层事实轴：

1. `record_order_result` 以 `row_version` 更新 `order_status=accepted|rejected|cancelled|unknown`，同事务写审计和结果事件；`record_fulfillment` 单独更新履约轴。重复命令按 `client_request_key + request_hash` 返回原结果。
2. ledger consumer 锁 `points_accounts`，以固定业务键 `redemption:{id}:debit` 插入 `-required_points`，写 debit link，刷新账户/lot 缓存，再把 `points_debit_status` 设为 `posted`。并发 worker 只能命中同一唯一键。
3. 若本地余额不足但用户确认银行已成功，仍记真实 debit，允许余额为负并将 account/redemption 标为 `needs_review`；不得伪造为零或把成功改成失败。
4. `failed/cancelled` 在 debit 前不写积分流水。若技术失败，outbox 重试；若请求字段与既有业务键不一致，进入死信并报警，不创建第二条流水。
5. `record_refund` 先把 `refund_status` 置为 `pending_external_confirmation`；只有已存在且状态为 `posted` 的 debit link，并且用户提供官方退分证据时，consumer 才能锁账户，以 `redemption:{id}:refund` 插入与 debit 完全相反的流水及 lot allocation，再设 `refund_status=posted`。退款先于扣分、重复退款和金额不符均拒绝并留审计。

允许的状态边由数据库 transition trigger 或唯一存储过程校验，禁止任意 PATCH。订单、履约、积分扣分和退分各自只沿本轴合法转换；状态变更、outbox 与本聚合写入同一事务；账本消费是最终一致，页面必须显示 `points_debit_status`、`refund_status` 和 `as_of`，在 debit posted 或 refund posted 前不能宣称余额已对账。

## 9. 事实源、缓存与重建

| 展示值 | 唯一事实源 | 可写缓存 | 重建/异常策略 |
| --- | --- | --- | --- |
| 活动报名/资格 | participation events + 用户确认审计 | participation 五轴状态 | 按 sequence 重放；规则变化只标 needs_review |
| 任务进度 | `spend_task_entries` | count/amount/status/last sequence | 全量或水位增量重放；负数不截断 |
| 权益剩余额度 | entitlement ledger | granted/remaining/status/last sequence | grant/use/reversal 重放；超用标 needs_review |
| 积分账面余额 | `points_ledger` | balance/last sequence | `sum(points_delta)`；允许负数并告警 |
| lot 剩余/未分配 | ledger + lot allocations | lot remaining/allocated/unallocated | 重算后必须满足账户恒等式 |
| 兑换扣点/退款 | redemption 四轴 + ledger link | points_debit_status/refund_status | 固定业务键对账，缺 link 或金额不符即 needs_review |
| 收益/价值 | 独立 `value_records` | 报表投影 | 不参与权益额度或积分余额计算 |

缓存刷新与事实写入属于同一数据库事务时，失败应整体回滚。异步消费者更新的跨聚合缓存携带 source sequence；旧事件不得覆盖新水位。每日校验任务只报告/重建缓存并写审计，不能改事实流水。

## 10. 审计、索引与运行权限

- 高频索引至少包括 participation `(user_id, outcome_status)`、task `(user_id, lifecycle_status, window_end)`、entitlement `(user_id, status, valid_to)`、points ledger `(account_id, sequence)`、lot `(account_id, expires_on) where status in ('open','partially_used')`、redemption `(user_id, order_status, created_at desc)` 和 outbox pending partial index。
- append-only 表撤销应用角色的 `update/delete`；通过 `security definer` 函数写入时固定 `search_path` 并核对调用角色。管理员修复也必须追加 correction/reversal，不开放临时直改。
- 所有 JSONB 带顶层 `schema_version`，限制文档大小；参与授权、金额、状态、去重和日期范围的字段不得藏入 JSON。
- outbox 使用 `(aggregate_type, aggregate_id, event_type, business_key)` 唯一键，worker 以 `for update skip locked` 领取；consumer 另建 inbox `(consumer_name, event_id)` 唯一键。审计表不能替代 outbox。
- RLS 策略、复合外键和 API ownership 测试三者都保留；任何一层通过都不能证明另外两层正确。

## 11. 迁移顺序与回滚边界

本轮不创建迁移。未来实施按以下顺序拆分，不能把整份草案作为一条生产迁移：

1. **预检与备份基线**：确认 PostgreSQL 15、`btree_gist` 权限、`set_updated_at()`、RLS/worker 角色；记录全库逻辑备份、PITR 时间点、表计数、现有孤儿和重复键。
2. **所有权前置**：清理现有跨用户/孤儿引用；增加父表 `(id,user_id)`/`(id,user_id,card_id)` 唯一索引，再以 `not valid` 添加复合外键并离峰 `validate constraint`。
3. **来源与规则**：先建 reference/snapshot/rule/version/citation、不可变触发器和生效期约束；没有 primary snapshot 的规则不得激活。
4. **活动与任务**：建 campaign/participation/event、task/method snapshot/entry；双写后对旧 progress 做 contribution/correction 映射，先比对重放结果再切读。
5. **权益**：建 benefit/entitlement/usage/ledger；从现有使用记录回填稳定 business key，校验发放与剩余恒等式。
6. **积分与 lot**：先建 account/ledger 和 sequence，再回填 reconciliation adjustment；随后建 lot/allocation 和未分配差额。禁止直接把旧 balance 当成 earn lot。
7. **兑换**：最后切换新状态和 ledger link；先冻结旧 worker，逐单对账成功/失败/退款，再启用幂等 consumer。
8. **约束收紧**：数据核验通过后设 not null、启用 RLS/append-only 权限、并发创建大表索引。观察期结束后才 contract；事实表和业务键不做降级删除。

应用回滚以关闭 feature flag、停止 consumer、恢复旧读路径为主，不回写或删除已产生的新事实。若账本异常，先冻结相关命令，保留数据库现场，从 ledger 重建缓存并补 correction/reversal。只有无法逻辑修复的全库灾难才使用 PITR；PITR 后必须重放外部已确认但恢复点之后发生的兑换/退款，避免数据库恢复成功却重复扣点。

## 12. 备份、恢复与数据删除

- 生产要求加密全量备份 + WAL/PITR，跨故障域保存；RPO/RTO 由产品/运维签字后写入运行手册，未确定前不得声称满足灾备目标。
- 至少每季度恢复到隔离环境，验证 schema/migration 版本、用户/卡/参与实例计数、`sum(points_ledger)`、lot 恒等式、兑换 ledger link、附件对象 hash 和 RLS。只验证“备份任务成功”不算恢复演练。
- 恢复演练使用脱敏或受控数据，密钥恢复流程必须一并演练；备份、对象存储和数据库的保留期一致。
- 用户删除采用可重试清理清单，先撤销投递/worker，再删对象存储和业务行，最后匿名化或删除允许处理的审计标识。备份中的数据在保留期内不可选择性擦除，必须在隐私说明中披露并阻止其回灌为在线数据。
- 每次迁移前记录可恢复时间点；恢复后运行第 13 节全部账本/一致性检查，再开放写流量。

## 13. 数据库验收检查

至少以下检查全部自动化；标注“并发”的用 PostgreSQL 集成测试而非 mock：

1. **跨用户/跨卡拒绝**：用户 A 不能把用户 B 的 card、snapshot、rule version、account、lot 或 entitlement 关联到自己的行；同用户不同卡的 participation/task/benefit 交叉引用也被复合外键拒绝。
2. **活动实例唯一与正交状态**：同一 `(user,campaign,card)` 并发创建只成功一条；`potentially_eligible` 不自动改变 enrollment/outcome，奖励确认必须有确认时间。
3. **规则证据与区间**：无 primary citation 不能激活；同一 rule 的 active 生效期重叠失败；修改/删除已激活 version 或 snapshot 失败，旧任务仍读取旧 hash。
4. **刷卡重算与冲正**：contribution 达标后追加 refund 可退回 `in_progress` 并把已确认资格设为 `needs_review`；重复 business key、第二条 reversal、非精确 reversal、跨 task method snapshot 均失败。
5. **累计 correction 幂等**：相同累计录入重试不新增 entry；不同 request hash 使用同 key 返回冲突；从零重放的 count/amount/sequence 与缓存完全一致。
6. **权益发放/使用**：重复 grant/use 业务键不重复增减；booked/rejected/cancelled 不扣额度；used 后 reversal 恢复额度；并发使用导致超额时只允许一个成功，或明确落 `needs_review` 而不丢事实。
7. **积分精度与账户序号（并发）**：超出 `points_scale` 的流水失败；并发追加得到连续且唯一 sequence；相同业务键相同摘要返回原记录，不同摘要冲突。
8. **lot 与未分配恒等式**：earn、部分 redeem、expire、reversal 和 reconciliation adjustment 后，逐 lot remaining、allocated balance、unallocated balance 与全账本公式一致；跨账户 allocation 失败。
9. **兑换重复事件（并发）**：重复 HTTP、两个 debit worker 和事件重放最终只有一个 debit link/ledger entry；订单金额或账户不同但复用 key 时进入冲突，不能多扣。
10. **失败与退款**：failed/cancelled 无 debit；success 后 refund 只产生一个等额反向 entry；退款先于 debit、重复退款或金额不等均失败并留审计。余额不足的外部成功兑换保留负余额且标 `needs_review`。
11. **币种/时区边界**：非法 ISO 币种和 IANA 时区失败；UTC 跨日、夏令时切换、闰日及 inclusive 截止日得到固定 local date，规则/任务时区后续变化不改历史。
12. **软删除与权限**：归档定义后业务键不能复用；普通角色不能 update/delete snapshot 或任一 ledger；归档卡不生成新实例，但历史、审计和重建仍可读。
13. **缓存损坏恢复**：人工在隔离库篡改所有 cache 后执行重建，任务、权益、积分和 lot 缓存恢复一致；旧 sequence 事件不能覆盖新缓存。
14. **备份恢复**：从全量备份 + WAL 恢复到指定时间点后，上述计数、hash、账本合计、lot 恒等式、兑换 link、RLS 和对象引用全部通过。

## 14. P0/P1 数据库边界

| 能力 | P0 必须落库的硬约束 | P1 扩展边界 |
| --- | --- | --- |
| 来源/规则 | snapshot 不可变、primary citation、生效区间不重叠、历史实例固定 version | 版本对比、受控导入；仍只新增 snapshot/version |
| 活动/任务 | participation 五轴状态、任务内 method snapshot、append-only entry、退款/冲正重放 | 导入 preview/confirm、更多模板；不得让 connector 直写缓存 |
| 权益 | grant/use/reversal ledger，预约不扣额度，使用幂等 | 附件和筛选；附件不是发放/使用事实源 |
| 积分 | sequence ledger、reconciliation adjustment、用户指定 lot、未分配差额 | 根据明确 `consumption_order` 给分配建议；用户确认后才写 allocation |
| 兑换 | 外部手工结果、成功 debit、失败不扣、整单退款、幂等 consumer | 若增加系统内 reservation，使用独立 hold/release 流水和到期状态机；不得复用 P1-b `pending` 假装预留 |
| 导入/自动化 | 只有用户确认后的结构化事实可写业务表 | parser/inbox 可重试且版本化；原始敏感内容不进入 JSON/审计 |

P1 只能增加新的事实类型、建议或导入来源，不能把 P0 的缓存提升为事实，也不能放宽复合外键、不可变、幂等和审计约束。部分退款、跨账户积分转移和系统内兑换需要单独设计双边守恒与状态机，不因标记为 P1 就默认已有模型支持。

## 15. 未决项与上线门槛

- `iso_4217_currencies` 是项目自管参考表还是依赖应用常量，需在首个迁移前决定；无论选择哪种，都必须有数据库可执行的有效币种校验。
- PostgreSQL 托管环境是否允许 `btree_gist` 尚未确认；不允许时采用锁父 rule 的 constraint trigger，并补等价并发测试。
- PRD 尚未给出 RPO、RTO、备份保留期、对象存储区域和用户删除等待期；这些是上线阻断项，不在数据库稿中猜数值。
- 多卡联合活动的贡献归属、积分转移的双边账户原子性、自动 lot 分摊、系统内 reservation 和部分兑换退款均超出 P0；加入前需扩展事实模型和验收，不得塞进 JSON 绕过约束。
- `custom` 条件只存文本并要求用户确认；在规则 DSL、版本兼容和安全评审完成前不在数据库执行任意表达式。

上线最低门槛：复合外键/RLS/IDOR 测试通过；规则快照不可变与生效期测试通过；任务、权益、积分全量重放等于缓存；并发兑换与退款幂等通过；敏感数据扫描通过；实际备份恢复演练通过。

## 16. 第三轮 DBA 角色复核整合

本轮数据研究确认当前真实数据库仍只有年费 MVP 表，活动、权益、积分、兑换、来源快照、outbox/inbox 均尚未进入迁移。因此本文件的新增约束是实施前置，不代表代码已经支持这些领域。

必须在第一条工作台迁移前落实：

1. 复合所有权与 RLS/IDOR 测试；不能只依赖应用层过滤。
2. 活动参与状态与奖励轴分离；`reward_received` 不再混入 `outcome_status`。
3. 权益 usage 到 entitlement 的三列复合外键；预约/拒绝/争议不写 use ledger。
4. `PointsAccount.account_key` 区分按卡账户与合并池；`allocation_sequence` 允许一笔流水拆分多个 lot；正/负未分配差额必须可重放。
5. 兑换退款必须已有 `posted` debit link；订单成功、扣分处理和退分结果分别记录，失败不猜测退分。
6. 旧 `progress_entries` 通过 adapter 进入新任务事实，缺失 occurred/posted/settled 或 business key 的历史记录标记 `needs_review`，不得伪造银行入账事实。

详见 [CARD-DOMAIN-DATA-REVIEW.md](research/CARD-DOMAIN-DATA-REVIEW.md)，其中包含 15 类数据库验收案例、expand/contract 顺序和回滚边界。本轮不创建真实迁移。

## 17. 第四轮提醒与状态契约收敛

P0 提醒必须在现有 `reminders` 上做 expand/contract，不能只由首页查询临时计算。若采用新表，最低结构如下；若复用现有表，必须等价增加字段、约束和索引：

```sql
create table workbench_reminders (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references users(id) on delete cascade,
  object_type    text not null check (object_type in
                 ('fee_event','campaign','participation','activity_reward','spend_task','source_rule','benefit','points_lot','redemption')),
  object_id      uuid not null,
  reminder_type  text not null check (reminder_type in
                 ('annual_fee','activity_end','task_due','reward_verification','verification_due','benefit_expiry','points_expiry','redemption_followup')),
  trigger_at     timestamptz not null,
  timezone       text not null,
  status         text not null default 'pending' check (status in
                 ('pending','snoozed','completed','ignored','overdue','cancelled')),
  delivery_status text not null default 'ready' check (delivery_status in
                  ('ready','leased','delivered','retrying','dead_lettered')),
  dedupe_key     text not null,
  source_sequence bigint,
  attempt_count  integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz,
  lease_owner    text,
  lease_expires_at timestamptz,
  last_attempt_at timestamptz,
  last_error_code text,
  dead_lettered_at timestamptz,
  snoozed_until  timestamptz,
  completed_at   timestamptz,
  ignored_at     timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (id, user_id),
  unique (user_id, dedupe_key),
  check (status <> 'snoozed' or snoozed_until is not null),
  check (status <> 'completed' or completed_at is not null),
  check (status <> 'ignored' or ignored_at is not null)
  ,check (delivery_status <> 'leased' or lease_expires_at is not null)
  ,check (delivery_status <> 'dead_lettered' or dead_lettered_at is not null)
);

create index workbench_reminders_due_idx
  on workbench_reminders (user_id, status, trigger_at);
create index workbench_reminders_object_idx
  on workbench_reminders (user_id, object_type, object_id);
create index workbench_reminders_delivery_idx
  on workbench_reminders (user_id, delivery_status, next_attempt_at, trigger_at);
```

`timezone` 必须是 PostgreSQL/IANA 可识别值，`trigger_at` 存 UTC；worker 使用 `FOR UPDATE SKIP LOCKED` 和 `lease_owner/lease_expires_at` 领取，失败递增 `attempt_count` 并保留稳定的脱敏 `last_error_code`，达到上限转 `dead_lettered`。重复生成命中同一 `dedupe_key`。归档卡、取消任务和已确认奖励停止未来提醒但保留历史。`reward_verification` 只有奖励有明确 `expected_on` 或用户设置核对节点时才创建，不能因抓取或 `target_reached` 自动宣称到账。

本轮同步的 canonical 约束为：ActivityParticipation 五轴（资格/报名/名额/结果/奖励）；Benefit 下发状态与 quota 投影分离，Usage 的 `status` 只作兼容投影；SpendTask 使用 `progress_status`，Participation 的 `outcome_status` 只作参与结果投影；PointsEntry 使用 `earn/adjustment/expire/redeem_debit/reversal`，`transfer` 延后 P2；Redemption 使用 `order_status`、`fulfillment_status`、`points_debit_status`、`refund_status` 四个底层事实轴，旧 `status/ledger_status/fulfilled/debited/returned/pending_refund/refunded` 只读映射。

以上仍是迁移前契约。真实 PostgreSQL、RLS/复合 FK、提醒 worker、并发重放、账本重建、删除和恢复演练通过前，不能宣称工作台模块可部署。

## 第五轮账本与迁移收敛（2026-08-14）

第五轮 DBA/架构复核将以下约束视为实现前必须冻结的数据库契约：

- `SpendMilestone` 独立于 `spend_task_entries`，以 `(entry_id, milestone_kind, business_key)` 去重；`settled` 必须先有 `posted`，退款/冲正只能追加反向事实。
- `PointsEntry`、`PointsLotAllocation`、权益额度流水和兑换关联均 append-only；普通应用角色无 `UPDATE/DELETE`。账户余额、批次剩余、额度剩余和提醒状态都是可重放投影。
- 积分账户同时保存 observation、ledger、lot allocation 和两个差额；正的未分配差额不自动造 lot，负差额进入 `mismatch/needs_review` 并阻止新的自动建议。P1 到期只建 Reminder，不自动写 `expire`。
- `Redemption` 必须保留订单、履约、扣分和退分四个底层事实轴；`redemption:{id}:debit` 与 `redemption:{id}:refund` 是独立幂等业务键，退款必须引用已 posted debit。
- 所有父子引用使用复合 ownership/FK 或等价事务校验；提醒以冻结 IANA 时区 + UTC `trigger_at` + 稳定 `dedupe_key` 落库，worker 用 lease/`SKIP LOCKED`，重跑不重复生成。

迁移按 `expand -> backfill/adapter -> shadow replay -> verify -> switch -> contract` 执行：先保留年费 `progress_entries` 兼容读，确认旧事实可无损映射后再切换新聚合；每阶段必须有回滚、PITR 恢复和账本从零重建证据。未完成前不创建正式迁移文件。

详细字段、索引和恢复门槛见 [第五轮数据复核](research/CARD-DOMAIN-FOLLOWUP-DATA.md)。

## 第六轮扩展账本与迁移收敛（2026-08-14）

第六轮 DBA、产品和架构复核将以下内容冻结为后续实现的数据库契约；本节不代表已创建 migration 或已通过真实 PostgreSQL 演练。

1. **活动与刷卡事实**：`activity_participations` 以用户、活动、卡片和周期实例建立复合唯一范围；奖励按 `reward_key` 分组件。`spend_tasks` 的 `snapshot/entries` 互斥，`spend_entries` 保存发生事实，`spend_milestones` 保存 posted/settled/rejected，退款/冲正必须以关联反向行守恒。
2. **权益账本**：`usage_model=consumable_quota` 才允许 `grant/consume/restore/expire`；预约、出示、拒绝、争议和 `coverage_claim/fee_credit` 不写次数 consume。consume/restore 使用稳定业务键并保留真实负余额，不能截断为零。
3. **积分对账**：`points_entries` append-only，`ledger_balance=sum(points_delta)`；批次分配独立存储，`unallocated_difference=ledger_balance-lots_remaining_total`，外部观察差额为 `reconciliation_difference=confirmed_balance-ledger_balance`。未知批次不生成到期提醒或自动 expire/lot。
4. **兑换与所有权**：订单、履约、扣分和退分关联事实分开；只有已 posted debit 且具备外部退回证据才可写等额 reversal。所有父子引用使用复合 owner/card/account FK 或等价事务校验，跨用户/不兼容跨卡统一拒绝。
5. **横切约束**：所有写命令持久化 request hash 和幂等结果；outbox/inbox、ledger、lot allocation、reminder 均按业务键去重，提醒冻结 IANA 时区并以 UTC `trigger_at` 落库。expand/contract 期间保留旧年费 adapter、shadow replay、PITR 恢复点和可重建投影。

字段、CHECK/UNIQUE/FK、索引、账本恒等式、Stage 0--6 迁移与 14 条数据库验收见 [第六轮 DBA 复核](research/CARD-DOMAIN-ROUND6-DATA.md)。在影子库迁移、并发/重放、RLS/IDOR、备份恢复和删除演练完成前，工作台数据模型不得被解释为可部署实现。

## 第七轮 Gate 0 DDL 硬化（2026-08-14）

Round7 DBA/架构复核将第六轮的文字约束进一步落到以下实现前硬门槛：

- `activity_rewards` 只做当前投影；奖励状态必须通过 `activity_reward_events` 的 sequence、business_key、request_hash 和复合 owner FK 追加，普通角色不得 PATCH 主表状态。
- `spend_tasks.input_mode` 激活后不可变；`snapshot` 只能有一个 `spend_task_snapshots`，`entries` 模式禁止 snapshot，互斥由 deferred trigger/受控存储过程和并发测试保证。`SpendMilestone` 的 canonical 路径是 `/api/v1/spend-entries/{entryId}/milestones`，旧 task-entry 路径只读兼容并标 deprecated。
- Reminder 持久化 `delivery_status`、`attempt_count`、`next_attempt_at`、lease、`last_error_code` 和 dead-letter 时间；worker 租约过期可回收，死信重放复用原 reminder/event id，不生成新业务事实。
- Benefit 新写枚举为 `grant/consume/restore/expire`，`reversal` 只作为受控技术性精确反向事实；旧 `use/adjustment` 仅兼容读映射。非 `consumable_quota` 禁止 consume。
- Redemption 固定卡与 merged pool 通过 scope trigger 强制：固定卡账户必须提供同卡 redemption，合并池才允许 NULL card；四轴状态和 debit/refund link 必须幂等可重放。

Round7 12 条数据库验收、复合约束、Reminder lease/dead-letter、RLS、PITR 和删除恢复门槛见 [第七轮 DBA 复核](research/CARD-DOMAIN-ROUND7-DATA.md)；架构 API/事件与 Gate 0--3 见 [第七轮架构复核](research/CARD-DOMAIN-ROUND7-ARCHITECTURE.md)。这些是实施前契约，不代表已有 migration 或可部署能力。

## 18. 第九轮卡领域数据整合（2026-08-15）

本轮把卡活动、卡权益、刷卡方式、积分账户和积分兑换的新增需求落到以下数据库门槛；不创建迁移，不代表当前数据库已具备这些表。

### 18.1 事实与投影边界

- 活动拆为 `campaigns`、`activity_participations` 和 `activity_reward_components`；`(user_id, campaign_id, card_id, activity_instance_key)` 唯一，奖励组件不得直接插入积分/权益流水。
- `spend_method_snapshots` 在任务激活时冻结渠道、商户/MCC、地区、币种、附属卡和排除项；`spend_entries` 只追加发生事实，`spend_milestones` 追加 posted/settled/rejected；任务级 `input_mode` 对 `snapshot` 与 `entries` 加互斥约束。
- `benefit_usages` 通过 `(benefit_id, user_id)` 复合外键绑定权益；预约、出示、拒绝和争议不能写 consume ledger，只有首次次数型 redeemed 可写入唯一业务键的 consume。
- `points_observations`、`points_entries`、`points_lots` 和 `lot_allocations` 分表；`reconciliation_difference` 与 `unallocated_difference` 分开计算，真实负值保留并标记 `needs_review`，不得补零或造 lot。
- `redemptions` 的订单、履约、扣分和退分状态分列；refund reversal 必须引用已 `posted` 的 debit 和官方证据，订单失败/取消不能自动写流水。

### 18.2 约束与迁移门槛

1. 所有新表带 `user_id`，父子外键使用 `(id, user_id)`；跨卡/跨账户引用在数据库约束和服务层同时校验。
2. append-only 事实表拒绝普通 `UPDATE/DELETE`；修正、退款、恢复和对账只允许关联 reversal/adjustment，保留原记录。
3. 规则、方法快照、来源快照和兑换请求保存 `content_hash/request_hash`；业务自然键和幂等键唯一，重放不产生第二事实。
4. 到期提醒索引只覆盖明确 `expires_on/trigger_at` 且对象不是 `unknown/needs_review` 的行；未知日期不得进入 worker 队列。
5. 刷卡金额、积分和现金部分使用精确 numeric + currency/unit；禁止浮点、隐式汇率或把不同积分单位相加。

迁移顺序固定为：`Stage 0` 清理年费表跨用户引用并建立约束测试；`Stage 1` 来源/规则/活动参与与奖励；`Stage 2` SpendMethodSnapshot、SpendEntry、milestone 和任务重算；`Stage 3` 权益下发/使用账本；`Stage 4` 积分观察、lot、allocation 和兑换四轴；`Stage 5` 旧 adapter 只读切换、全量重建、备份恢复和删除清理演练。任一阶段失败只回退读路由，禁止 canonical 与旧表双向写入。

详细字段、索引和验证见 [Round9 数据复核](research/CARD-DOMAIN-ROUND9-DATA.md)。在真实 PostgreSQL、RLS、并发重放、PITR 和回滚证据完成前，不得把本数据模型当作部署完成。

## 19. 第十轮数据与恢复增量（2026-08-15）

第十轮 DBA 研究见 [CARD-FEATURE-ROUND10-DATA.md](research/CARD-FEATURE-ROUND10-DATA.md)。本节将产品新增的报名尝试、规则新鲜度、跨任务消费防双算和分项履约落到数据库发布门；不创建正式 migration。

### 19.1 Canonical 写入围栏

| 领域 | Canonical 写模型 | 兼容读取 | 新写入禁止 |
| --- | --- | --- | --- |
| 活动报名 | `activity_enrollment_attempts` + event sequence | 旧 `ActivityEnrollment`/`CardActivity` view | 旧报名表、单一 `status` 或覆盖式重试 |
| 刷卡 | `SpendEntry` + `SpendMilestone`；未来 `SpendFact` + `SpendTaskEvaluation` | 旧 task-entry、entry 上的 posted/settled 投影 | 同一消费复制金额到多个 task；在关联模型未通过 Gate 0 前拒绝第二次复制录入 |
| 权益 | `BenefitUsage` events + quota ledger | 旧 `redeemed/use` 投影 | 非次数权益写 consume，预约/拒绝/争议扣额度 |
| 积分/兑换 | observation、append-only PointsEntry/Lot/Allocation、订单/履约/debit/refund 四轴 | 旧 balance/success/fulfilled 字段 | 客户端 PATCH balance、单一兑换状态、失败自动退分 |

兼容映射必须保存 `legacy_source`、`legacy_id`、`backfill_run_id`、原始 row hash、`mapping_status` 和冲突原因。canonical 写权限开启后，旧路由只能读取投影；同 hash 重放原映射，异 hash 进入 conflict queue，不覆盖事实。

### 19.2 增量表和约束

1. **报名尝试**：`activity_enrollment_attempts` 使用 `(user_id, participation_id, attempt_no)` 唯一；保存 `idempotency_key/request_hash`、外部渠道、提交/结果时间、掩码回执 hash、失败原因和 retryable 标记。截止后禁止新提交，重试必须新增 attempt，不能 UPDATE 旧结果。
2. **规则新鲜度**：RuleVersion/SourceSnapshot 保存 `last_verified_at`、有效区间、摘要 hash 和用户 freshness policy 的评估结果；报名、任务激活、兑换预检命令必须在同一事务检查阈值。未知或过期只写计划/线索，不写确定资格、进度或扣分。
3. **跨任务防双算**：P0 单任务 `SpendEntry` 保持现状；若开放同一消费服务多个任务，新增不可变 `spend_facts` 和 `spend_task_evaluations`，以 `(user_id, spend_fact_id, task_id, task_instance_key)` 唯一，并通过复合 FK 校验卡/币种/规则快照。evaluation 可各自为 included/excluded/pending/disputed，但金额原事实只存一次。
4. **部分履约**：`redemption_fulfillment_lines` 以 `(user_id, redemption_id, line_key)` 唯一；`fulfilled + rejected + cancelled <= requested`，每次状态追加 evidence snapshot 和 request hash。debit/refund link 必须同 account/card scope，refund 累计不得超过已 posted debit。
5. **投影水位**：统一 `projection_checkpoints` 或等价域表，至少保存 `projection_name`、aggregate、`source_sequence`、`source_watermark`、`rebuild_run_id`、status、错误和尝试次数；水位单调，重建在隔离表完成校验后原子切换，不能以空投影覆盖线上值。
6. **精度/区间冻结**：Gate 0 统一金额精度、积分 `points_scale`、ISO 4217 币种和 IANA timezone；RuleVersion 使用半开生效区间，业务活动/任务窗口使用约定的 inclusive date。禁止同一字段在不同表混用 `[]` 与 `[)` 或隐式浮点/汇率。

### 19.3 迁移与恢复顺序

`Stage 0` 扫描现有年费跨 owner/card/cycle 引用、重复周期、可变 progress 和旧 reminder key，建立计数/hash/orphan 报告与 PITR 恢复点；`Stage 1` 建来源/规则、幂等、outbox/inbox、projection checkpoint 和 append-only 权限；`Stage 2` 建 P0 活动/报名尝试/SpendTask/Milestone/Reminder 与单向年费 adapter；`Stage 3` 建 P1-a 权益周期/usage/quota；`Stage 4` 建 P1-b Points observation/lot/allocation；`Stage 5` 建兑换四轴/履约分项；`Stage 6` 关闭旧写、完成 shadow replay、备份恢复、删除清理和 contract。

每一阶段失败只能停用 feature flag、切回旧读路由或重放 canonical，不能恢复双向写入或级联删除事实。投影重建必须固定 source watermark；PITR 后外部 debit/refund/cancel 事件按原业务键重放，不能生成第二条事实。用户删除按清理注册表从 lease/提醒、对象存储、业务叶子到主体标识执行，事实/审计保留并支持恢复校验。

### 19.4 数据库发布门

- **Gate 0（当前阻断）**：签收 canonical/legacy 写围栏、报名 attempt、跨任务消费策略、投影 watermark/backfill fence、金额/积分精度和 RuleVersion 区间；D-01--D-08、D-15--D-16 必须在真实 PostgreSQL 通过。
- **Gate 1/P0（当前阻断）**：活动、单卡任务、里程碑、退款、奖励组件和 Reminder 通过复合 FK/RLS、append-only、并发、shadow replay 和年费回归；P0 未通过前不开放新写入口。
- **Gate 2/P1-a（当前阻断）**：D-09--D-10 的权益周期、凭证轮换、重复核销、restore、删除和恢复通过后才开启权益 flag。
- **Gate 3/P1-b（当前阻断）**：D-11--D-14 的积分双差额、负余额、批次、分项履约、debit/refund 幂等与 PITR 通过后才开启积分/兑换 flag。

完整 D-01--D-16 验收、观测指标和年费回归影响见第十轮 DBA 研究稿。当前代码和数据库没有新领域 schema、migration、worker 或真实测试，因此当前可部署范围仍只有年费 MVP。
