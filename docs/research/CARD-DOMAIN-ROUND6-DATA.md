# Cardfolio 卡领域第六轮扩展账本与迁移复核

| 项目 | 内容 |
| --- | --- |
| 角色 | DBA |
| 复核日期 | 2026-08-14 |
| 基线 | 当前 working tree；真实数据库仍是年费 MVP |
| 范围 | 活动 participation/名额/奖励、SpendTask、刷卡方式、权益 usage、积分账户/批次/流水、兑换、ownership、幂等、提醒、迁移、备份恢复 |
| 交付边界 | 只读研究稿；仅新增本文，不创建 migration，不修改代码、schema、正式 DB/架构/PRD/安全/QA/UX 文档或 ledger |

本文是第五轮约束的可合并数据库决策补充。它不表示工作台模块已经部署，也不把 SQL 片段当作已批准的 DDL。任何真实迁移都必须在影子 PostgreSQL 15 环境中演练、回滚和验证后，才能进入 `db/migrations/`。

## 1. 输入与来源边界

### 1.1 已复核输入

- `docs/DATABASE-WORKBENCH.md`：第四轮数据库模型和第五轮账本/迁移收敛。
- `docs/research/CARD-DOMAIN-ALIGNMENT-DATA.md`：提醒、活动多卡、权益、积分、兑换和恢复补充。
- `docs/research/CARD-DOMAIN-DATA-REVIEW.md`：状态、约束、重放和验收研究。
- `docs/research/CARD-DOMAIN-FOLLOWUP-DATA.md`：复合 ownership、outbox/inbox、expand/contract 门槛。
- `docs/PRD-WORKBENCH.md`、`docs/ARCHITECTURE-WORKBENCH.md`：产品范围、聚合边界和状态契约。
- 当前 `db/migrations/0000_initial.sql`--`0003_worker_heartbeats.sql`、`db/schema/index.ts`：确认仍只有用户、卡片、年费周期/事件、进度、提醒、审计和 worker 心跳等 MVP 表。

### 1.2 事实与规划的边界

1. 当前运行代码不能声称已经支持活动、权益、积分、兑换、来源快照、统一提醒、outbox/inbox 或 RLS；本文所有“必须”都是实施前门槛。
2. P0 仍是手工录入和用户确认，不接银行账户、不自动报名、不自动判断资格、不自动兑换。`target_reached`、`submitted`、`redeemed`、`success` 只能表达本地记录的事实轴，不能冒充发卡行确认。
3. 数据库是事实守恒和所有权的最后防线；服务层仍必须从会话/受控 worker 上下文取得 `user_id`，不能把复合 FK 当作授权替代品。
4. 业务事实、投影缓存、审计和通知 outbox 在同一事务提交；缓存损坏只能从不可变事实重建，不能用 `PATCH` 余额/剩余量/进度来修复。

### 1.3 本轮需要冻结的冲突

| 主题 | 旧表达风险 | 第六轮 canonical 决策 |
| --- | --- | --- |
| 活动奖励 | participation 的结果状态被误读为奖励到账 | `activity_rewards` + reward event 是独立事实；资格、报名、名额、结果、奖励五轴正交 |
| 刷卡任务 | 快照累计和逐笔 entry 同时写入导致双算 | `input_mode=snapshot` 与 `input_mode=entries` 互斥；只能有一个事实入口 |
| 达标节点 | milestone 藏在 entry 状态中，无法解释已入账/已冲正 | `spend_milestones` 独立去重和事件投影；`settled` 先有 `posted` |
| 权益 | 预约、出示和核销都被当作 consume | `usage_model` 决定是否有额度；只有首次 `redeemed` 写 `use`，恢复只能追加 reversal |
| 积分差额 | lot 缺口和银行核对差额混成一个字段 | 保留两个有符号差额：`unallocated_difference` 与 `reconciliation_difference` |
| 未知批次 | 余额或未知到期日被虚构为可到期 lot | 未知保持未分配或显式 `unknown` lot；不生成到期提醒、不自动过期 |
| 兑换 | 订单成功、履约成功、本地扣分和退分被混写 | 订单、履约、`points_debit_status`、`refund_status` 四个底层事实轴独立；退款必须引用已 posted debit |
| ownership | 只保存单列外键，允许同用户跨卡/跨账户错误引用 | 所有子表保留 `user_id`；固定卡/账户/entitlement 使用复合唯一键和复合 FK |

## 2. Canonical 表、字段与枚举

### 2.1 活动 participation、名额和奖励事实

**Canonical 表：** `campaigns`（活动身份）、`activity_participations`（每卡实例）、`activity_participation_events`（不可变状态事件）、`activity_rewards`（奖励组件）、`activity_reward_events`（奖励历史）。

| 对象 | 必要字段/枚举 | 数据库决策 |
| --- | --- | --- |
| `campaigns` | `user_id`、`rule_id`、`campaign_key`、`status=draft/published/ended/cancelled/needs_review/archived` | 活动只表示提供方规则和生命周期，不保存卡片报名、消费、名额或奖励结果；`(user_id,campaign_key)` 永久唯一，归档不释放键 |
| `activity_participations` | `campaign_id`、`card_id`、冻结 `rule_version_id`；`eligibility_status=unknown/potentially_eligible/user_confirmed_eligible/user_confirmed_ineligible/needs_review`；`enrollment_status=not_required/not_started/submitted/confirmed/rejected/expired/cancelled/unknown/needs_review`；`quota_status=not_applicable/unknown/available/full/waitlisted/allocated/not_allocated/needs_review`；`outcome_status=not_started/in_progress/target_reached/failed/expired/needs_review`；`qualification_status=unconfirmed/user_confirmed/rejected/needs_review` | `unique(user_id,campaign_id,card_id)`；每张卡单独累计、报名、名额和结果。`potentially_eligible` 不是银行确认，`available` 不是 `allocated` |
| participation events | `sequence`、`event_type`、`business_key`、`request_hash`、`occurred_at`、actor、最小 payload | 状态列只是投影；事件 append-only，`(participation_id,sequence)` 和 `(participation_id,business_key)` 唯一。同键同摘要重放原结果，同键不同摘要返回 `409` |
| `activity_rewards` | `reward_key`、`reward_type`、金额/上限原文文本、`status=not_expected/expected_pending/delayed/received/reversed/disputed/unknown/needs_review`、`expected_on/received_on/reversed_on`、`source_snapshot_id` | 一次 participation 可有多个奖励组件；不把奖励金额强行解析为统一货币，未确认字段保持原文/未知；`unique(user_id,participation_id,reward_key)` |
| reward events | `sequence`、`event_type=expected/delayed/received/reversed/disputed/note`、`business_key`、证据 | `target_reached` 不自动产生奖励到账、积分流水或权益；奖励修正通过新事件，不覆盖历史 |

名额是事实轴，不由资格、任务进度或奖励结果推断。最终达标前，如果 `quota_status` 为 `unknown/full/waitlisted/not_allocated/needs_review`，页面必须显示待核对；不能自动宣称有名额。若将来需要全局名额计数，另建受活动所有者约束的 `campaign_quota_ledger`，不得把多个用户参与记录互相写入。

### 2.2 SpendTask、刷卡方式快照、snapshot/entries 互斥与 milestone

**Canonical 表：** `spend_methods`（可编辑模板）、`spend_method_snapshots`（任务激活时冻结）、`spend_tasks`（任务聚合）、`spend_task_snapshots`（snapshot 模式唯一汇总事实）、`spend_task_entries`（entries 模式逐笔事实）、`spend_milestones`/`spend_milestone_events`（达标节点）。

1. `spend_tasks.input_mode` 只能是 `snapshot` 或 `entries`。数据库必须以 deferred constraint trigger/受控 command 保证：
   - `snapshot`：该 task 恰有一个 snapshot 汇总事实，禁止创建 `spend_task_entries`；修改总额只能追加新的 snapshot correction 事件。
   - `entries`：禁止 snapshot 汇总事实；所有进度只能由 entry 重放，不能再写一份手工总额。
   - 任务从一种模式切换必须终结旧 task 并创建新 `instance_key`，不得原地切换造成双算。
2. 任务激活时复制 `rule_version`、`method_snapshot`、窗口 `window_start/window_end`、冻结 IANA `timezone`、`cutoff_basis=occurred/posted/settled/unknown`、币种和计量目标。模板后来修改不影响已激活任务。
3. `spend_task_entries` 采用 append-only：`sequence`、`business_key`、`entry_type=contribution/refund/correction/reversal`、`occurred_on/posted_on/settled_on`、`processing_status=occurred_only/posted/settled/rejected/reversed/unknown`、`qualification_status=included/excluded/pending/disputed/unknown`、方法快照和证据级别。
4. 必须由 CHECK/trigger 保证 `occurred_on <= posted_on <= settled_on`（存在时）、任务币种与 entry 一致、金额非零时带合法币种、`included` 不得早于任务 cutoff 口径。`occurred_only` 不得有 `posted_on`；`posted/settled` 必须有 `posted_on`；`settled` 必须已经 `posted`。
5. 退款与冲正规则：
   - `refund` 可以多笔部分退回，但必须关联同一原始 contribution，所有退款绝对值合计不能超过原 entry；
   - `reversal` 是对一条事实的精确反向，原 entry 的 count/amount/currency 必须完全相反，不能自引用、成环或跨 task；同一原 entry 的完整 reversal 只能有一条；
   - 修复错误不更新原行，追加 correction 或 reversal-of-reversal，并保留 request hash、审计和 outbox；
   - 退款/冲正可能使累计值回退或变负，缓存保留真实值并置 `needs_review`，同时产生 `SpendTaskTargetNoLongerReached` 事件。
6. `spend_milestones` 不等同 entry、不参与金额/次数求和。以 `(task_id,entry_id,milestone_kind,business_key)` 唯一，记录 `qualified_at`、口径（如 `posted`/`settled`）、证据和当前状态。`settled` milestone 不能在没有 posted 事实时写入；entry 被冲正后追加 `reversed` milestone event，不能删除原 milestone。
7. `custom` 计量规则只能保存说明，强制 `needs_review` 或用户确认；P0 不执行任意表达式或把 JSONB 当规则引擎。

### 2.3 Benefit usage model 与 consume/restore 守恒

**Canonical 表：** `benefits`（定义）、`benefit_entitlements`（周期发放实例）、`benefit_usages`（预约/出示/核销）、`benefit_entitlement_ledger`（额度流水）。

| `usage_model` | 是否产生 consume ledger | 说明 |
| --- | --- | --- |
| `consumable_quota` | 是 | 次数或额度型；grant 增加额度，首次 redeemed 写 use，纠错写 reversal |
| `coverage_claim` | 否（P1） | 保险/理赔事实单独记录，不把理赔金额当次数余额 |
| `fee_credit` | 否（P1） | 账单抵扣需独立金额事实和币种，不复用次数 consume |
| `service_record` | 否 | 服务发生记录，不代表可扣减额度 |
| `unknown` | 否 | 未确定模型前只能记录事实并标 `needs_review` |

`benefit_usages` 的 `reservation_status=not_required/not_booked/requested/confirmed/rejected/cancelled/unknown` 与 `redemption_status=not_presented/presented/redeemed/rejected/disputed/unknown` 两轴独立；兼容 `status` 只能是投影，不得由 API 任意 PATCH。`planned/booked/presented/rejected/cancelled/disputed` 均不扣额度；只有首次 `redeemed` 并且 usage 与 entitlement 通过复合 FK 校验时，事务才可追加 `benefit_usage:{id}:use`。

额度 ledger 仅允许 `grant/use/expire/adjustment/reversal`。`use` 需关联 redeemed usage；`reversal` 必须引用同一 entitlement 的原 entry 并精确相反。两个并发 redeemed 命令只能产生一条 use；重复 key 重放原结果。剩余量不能被截断为零，若小于零则保留真实负数并标 `needs_review`。预约取消不会自动生成 restore；只有已存在的 use 被用户确认错误时，才追加 restore/reversal。

### 2.4 PointsAccount、PointsLot、PointsEntry 和未知批次

**Canonical 表：** `points_accounts`、`points_ledger`（或统一命名 `points_entries`）、`points_lots`、`points_lot_allocations`、`points_reconciliations`。`points_debit_status` 使用该名称，旧的 `ledger_status/debit_status` 只做兼容读映射。

1. `points_accounts.account_key` 是用户范围稳定命名空间，必须明确按卡账户与同计划合并池；`card_id IS NULL` 不能单独推断为合并池。固定卡账户要求所有 redemption、lot、entry 使用同一 `(account_id,user_id,card_id)`；合并池在 P1 只允许 `card_id IS NULL`，不接受任意卡挂接。
2. `points_ledger` append-only，`unique(account_id,sequence)`、`unique(account_id,business_key)`；`entry_type=earn/adjustment/expire/redeem_debit/reversal`，`points_delta` 有符号且非零，单位/精度从 account 继承。余额不得由客户端更新，重放以 `sum(points_delta)` 为准。
3. `points_lot_allocations` append-only，`(ledger_entry_id,lot_id)` 唯一，allocation sequence 与 ledger sequence 分离；一笔 entry 可以拆到多个 lot。allocation 的方向和绝对值必须与 entry 类型一致，不能超过该 entry 绝对值或使 lot 负数而不标记异常。
4. 两个差额必须独立且有符号：

   ```text
   ledger_balance          = sum(points_ledger.points_delta)
   allocated_balance       = sum(points_lot_allocations.allocated_delta)
   unallocated_difference  = ledger_balance - allocated_balance
   reconciliation_difference = confirmed_balance - ledger_balance
   ```

   `unallocated_difference` 描述账本和 lot 分配之间的差；`reconciliation_difference` 描述外部确认余额和本地账本之间的差。不得用 `greatest(...,0)`、单一 `lot_gap` 或把两者合并成一个 mismatch。
5. 未知批次/未知到期日：本地没有证据时保持 `unallocated_difference`，不得自动创建带到期日的 lot；若用户明确录入未知批次，可建立 `expiry_basis=unknown`、`expiry_confidence=unknown` 的 lot，但不得生成到期提醒、自动 expire 或 FIFO 建议。正未分配差不改变余额，负未分配差必须进入 `mismatch/needs_review`。
6. 外部余额确认必须以 `points_reconciliations` 记录 observation、as-of、source snapshot、request hash；非零差额只能追加 `adjustment` entry。`confirmed_balance` 缺证据时为 null，不伪造对账通过。

### 2.5 Redemption 订单/履约/扣分/退分四个底层事实轴

`redemptions` canonical 状态如下：

- 订单轴 `order_status=planned/submitted/accepted/rejected/cancelled/unknown`。
- 履约轴 `fulfillment_status=not_started/processing/fulfilled/failed/cancelled/unknown`。
- 积分扣分轴 `points_debit_status=not_debited/pending_debit/posted/needs_review`。
- 退分轴 `refund_status=not_applicable/not_requested/pending_external_confirmation/confirmed_external/posted/needs_review`。

P1-b 只记录用户已在外部渠道执行的兑换，不启用系统内 reservation/hold。`accepted` 或 `fulfilled` 不等于本地已经扣分；成功命令只写订单/履约事实、幂等结果和 outbox，debit consumer 锁定 account 后，以 `redemption:{id}:debit` 追加一条 `-required_points` entry 和唯一 debit link，再置 `posted`。

`failed/cancelled` 在 debit 前不写积分流水。退分必须满足全部条件：已有唯一 `posted` debit link、存在用户确认的官方退分证据、退款金额与原 debit 精确相反；以 `redemption:{id}:refund` 追加 reversal/refund link，再置 `refund_status=posted`。退款先于扣分、重复退款、金额不符或跨账户 link 均拒绝并审计。外部已成功但本地余额不足时保留真实负余额，并把 account/redemption 置 `needs_review`，不能伪造为失败或截断为零。

## 3. CHECK、UNIQUE、FK、索引与横切约束

### 3.1 复合 ownership 规则

所有父表建立 `unique(id,user_id)`；固定卡关系再建立 `unique(id,user_id,card_id)`。子表至少重复 `user_id`，固定卡对象重复 `card_id`，账户/权益/任务按需要重复 `account_id`/`entitlement_id`/`task_id`。典型关系必须使用复合 FK：

```text
(card_id,user_id) -> cards(id,user_id)
(campaign_id,user_id,rule_id) -> campaigns(id,user_id,rule_id)
(participation_id,user_id,card_id,rule_id) -> activity_participations(...)
(entitlement_id,user_id,card_id) -> benefit_entitlements(...)
(account_id,user_id,card_id) -> points_accounts(...)
(ledger_entry_id,account_id,user_id) -> points_ledger(...)
```

可空 `card_id` 只有在明确的合并池语义下允许；PostgreSQL 对可空复合 FK 的“放行”不能代替账户 scope trigger。多态提醒 target 不得只依赖 `object_id` 存在性，应拆 target 表或由按 `object_type` 的受控函数验证完整父链。

### 3.2 约束和索引矩阵

| 领域 | 必须约束 | 最小索引 |
| --- | --- | --- |
| 活动 | 三元 participation 唯一；rule/campaign/card 同用户复合 FK；event sequence/business key 唯一；奖励组件键唯一 | `(user_id,campaign_id,card_id)`、`(user_id,card_id,outcome_status)`、`(participation_id,sequence)`、`(participation_id,status,expected_on)` |
| SpendTask | `window_end>=window_start`；input mode 互斥；日期顺序；task/entry/method 同 owner；entry business key/sequence 唯一；refund/reversal 守恒 | `(user_id,card_id,lifecycle_status,window_end)`、`(task_id,sequence)`、`(task_id,business_key)`、`(task_id,processing_status)`、`(task_id,milestone_kind,status)` |
| 权益 | valid date 顺序；usage 与 entitlement 同卡同用户；usage request hash 幂等；状态时间互相校验；ledger entry sequence/business key/reversal 唯一 | `(user_id,card_id,valid_to,status)`、`(entitlement_id,sequence)`、`(entitlement_id,redemption_status)`、`(user_id,client_request_key)` |
| 积分 | account key 稳定；entry 单调 sequence/business key；lot key 唯一；allocation 同 entry/lot 唯一；同账户单位/精度继承；两个差额分别缓存 | `(user_id,account_key)`、`(account_id,sequence)`、`(account_id,posted_on)`、`(account_id,expires_on,status)`、`(ledger_entry_id,lot_id)`、`(account_id,reconciliation_status)` |
| 兑换 | account/card scope 相容；订单/履约/积分/退分状态只能合法迁移；debit/refund link 各一条；request hash 幂等；外部引用 hash 唯一 | `(user_id,account_id,created_at desc)`、`(account_id,points_debit_status)`、`(order_status,fulfillment_status)`、`(redemption_id,link_role)` |
| 幂等/事件 | `(user_id,client_request_key)` + request hash；outbox event id 唯一；inbox `(consumer_name,event_id)` 唯一；append-only 权限 | outbox pending/lease partial index、inbox consumer/event、dead-letter retry index |
| 提醒 | 服务端生成 `dedupe_key`；冻结 IANA `timezone` + UTC `trigger_at`；终态不重新生成 | `unique(user_id,dedupe_key)`、`(user_id,status,trigger_at)`、`(user_id,object_type,object_id)`、pending/snoozed/overdue partial index |

### 3.3 幂等、inbox/outbox 和 append-only

每个写 command 必须持久化 `client_request_key`/`Idempotency-Key`、规范化 `request_hash`、首次结果和 `correlation_id`。同键同 hash 返回原结果，同键异 hash 返回 `409 IDEMPOTENCY_KEY_REUSED`。事实、投影、audit 和 outbox 在一个事务内写入；publisher 用 `FOR UPDATE SKIP LOCKED` 加租约，consumer 事务第一步插入 `(consumer_name,event_id)` inbox，冲突即视为已处理。达到重试上限进入 dead-letter，人工重放只能重用原 event，不产生第二条事实。

应用角色不得直接 `UPDATE/DELETE` source snapshot、参与/奖励 event、SpendEntry、milestone、benefit ledger、points ledger、lot allocation 或 redemption link。更正、冲正、退分和恢复都只能调用受控 transition function；`SECURITY DEFINER` 函数必须固定 `search_path`、校验 actor/owner，并在同一事务写审计。

## 4. 账本恒等式和可重放要求

所有缓存必须带聚合水位（如 `last_entry_sequence`/`last_allocation_sequence`/`row_version`），提供从零重建命令。以下公式是验收时的 canonical，不是应用层“尽量保持”的建议：

```text
SpendTask(entries mode):
  progress_count  = sum(entry.count_delta by sequence)
  progress_amount = sum(entry.amount_delta by sequence)
  snapshot mode:  progress = the single snapshot fact, never + entries

BenefitEntitlement:
  remaining_count  = grants + adjustments - uses - expires + reversals
  remaining_amount = same formula for amount unit/currency
  only redeemed usage may create use; restore is an exact reversal

PointsAccount:
  ledger_balance           = sum(points_entry.points_delta)
  allocated_balance        = sum(points_lot_allocation.allocated_delta)
  unallocated_difference   = ledger_balance - allocated_balance
  reconciliation_difference = confirmed_balance - ledger_balance

Redemption:
  posted_debit = exactly one debit link or zero
  posted_refund = zero until posted_debit exists; at most one refund link
  net_points_effect = -required_points + exact_refund_if_posted
```

重放必须验证：sequence 无重复、业务键稳定、同一事件不会覆盖更高水位、坏缓存可从事实恢复、负余额/负额度不会被归零、未知 lot 不会凭空出现到期日。`audit_logs` 记录 command、actor、前后状态摘要、source snapshot、entry/link id 和 request/correlation id，但不记录原始请求体或敏感凭据。

## 5. Expand/contract 迁移顺序与回滚边界

以下是迁移顺序，不是已经执行的 migration：

### Stage 0：预检、备份和 schema 盘点

- 确认 PostgreSQL 15、`pgcrypto`/`citext`；核实 `btree_gist`、RLS、worker 受控角色和 `is_valid_iana_timezone()` 的可用方案。
- 加密全量备份并打 WAL/PITR 标记，记录表计数、孤儿、单列 FK 交叉 owner/card、重复自然键、提醒数量、现有 progress 的可推导字段；失败只输出隔离报告，不直接清理。
- 定义 RPO/RTO、备份保留、对象存储保留和删除账户恢复语义；没有批准值不得进入 contract。

### Stage 1：ownership 和横切基础

- 先为现有父表增加复合唯一索引，再以 `NOT VALID` 加复合 FK，离峰 `VALIDATE`；孤儿/跨 owner 行进入可重试清单并审计。
- 创建受控币种参考表、source reference/snapshot、rule/version/citation、idempotency command/result、outbox/inbox 和 append-only 权限/触发器。
- 建立通用 request hash、事件 sequence、审计白名单、RLS policy 与最小 worker 角色；RLS 旁路必须有 worker job 中的 user/aggregate owner 校验。

### Stage 2：P0 活动、SpendTask、奖励和提醒

- 建 campaigns/participations/events/rewards/reward-events；先双写 shadow 投影，比较 event 重放与状态列，不立即切旧读路径。
- 建 spend methods/snapshots/tasks；通过 adapter 将现有 `progress_entries` 映射为 `legacy_progress`。缺少 occurred/posted/settled、稳定 business key 或可证明币种的行标 `needs_review`，不得伪造银行事实。
- 先以 entries 模式验证完整窗口，再启用 snapshot 模式；为两种模式分别建立互斥数据库测试，不能在同一个 task 双写。
- 扩展/新建提醒表，先影子生成 `dedupe_key`、冻结时区和 trigger_at，观察一个完整周期后才切 worker。旧年费提醒保持兼容读，重复生成只保留一条。
- 回滚：停新写 command/consumer、恢复旧 facade 读路径、保留新事实和 outbox；不能删除或把新事实倒灌到旧累计字段。

### Stage 3：P1-a 权益

- 创建 benefit/entitlement/usage/ledger；历史资料只有稳定业务键且有证据时才 backfill grant/use。预约不得回填为 use。
- 启用只读投影和守恒报告，完成两并发 redeemed、reversal、超用与归档卡测试后，再打开 redeemed command。
- 回滚只关闭 feature flag/consumer，保持 ledger append-only；缓存从 ledger 重建。

### Stage 4：P1-b 积分账户、lot、对账

- 先建 account/points ledger/sequence/reconciliation，再建 lots/allocations；旧余额只能成为 confirmed observation 或 reconciliation adjustment，不得伪造 earn lot。
- 对未知 expiry 保持 unallocated/unknown；到期 worker 只写去重提醒，不自动 `expire`。
- 完成 ledger/lot 双差额全量重放、负余额和跨账户 allocation 拒绝后，才开放用户录入调整。

### Stage 5：P1-b 兑换

- 冻结任何旧兑换写入口，逐单核对订单、履约、外部成功/失败、既有扣分和退款证据。
- 建 redemption/link、状态 transition 和 debit/refund consumer；先 shadow 比较订单状态与 points ledger，再以 `redemption:{id}:debit/refund` 业务键切换。
- 回滚可停止 consumer 并显示 pending/needs_review，不得撤销已经 posted 的事实；必要修正使用新 reversal。

### Stage 6：contract 和长期观察

- 至少两个核对周期、一次并发/死信重放、一次全量+WAL 恢复、一次导出/删除演练全部通过后，才关闭旧写入口。
- 旧表/兼容 adapter 保留只读观察期；contract 不物理删除事实，不删除业务唯一键，不让归档重新解释历史。

## 6. 备份、恢复、删除与审计要求

1. 生产备份必须加密、跨故障域保存并具备可验证的 PITR；每次扩展 migration 前打恢复点，记录 schema 版本、feature flag、outbox 水位和运行中 worker。
2. 至少季度一次在隔离环境用全量备份 + WAL 恢复，校验所有复合 FK/RLS、sequence、activity rewards、SpendTask input mode、milestone、权益/积分/lot/兑换 link 和 reminder dedupe。恢复后从零重建缓存，结果必须与备份水位一致。
3. 恢复后的 outbox/inbox 要按 event id 重放；已经处理的 inbox 不产生第二条事实，dead-letter 重放只能重新运行原 command。外部兑换/退分在恢复点之后的确认事件必须按 business key 补齐，而不能依赖内存状态。
4. 账户删除注册表必须覆盖新表、source object、附件/导入、提醒 lease、worker job、outbox/inbox、缓存、导出链接和审计匿名化。删除 job 可重试、幂等且返回稳定错误码；恢复副本不得回灌已删除账户到在线库。
5. 不可变事实和来源 snapshot 只允许通过 correction/reversal 表达错误；归档卡停止新提醒和新任务，但历史事实仍可读。日志、审计、备份 manifest 和恢复报告不得包含完整卡号、CVV、token、密码、Authorization 或敏感 URL query。

## 7. 数据库验收（最少 8 条）

1. **活动多卡并发**：同一 `(user,campaign,card)` 并发创建只有一条 participation；同活动第二张卡独立建立实例，跨用户/跨卡复合 FK 失败并对 API 返回统一 `404`。
2. **资格/名额/奖励正交**：`potentially_eligible`、`quota=available`、`target_reached` 不能自动生成 enrollment confirmed 或 reward received；多个 `reward_key` 独立去重和重放。
3. **snapshot/entries 互斥**：snapshot task 写第二个 snapshot 或任意 entry 均失败；entries task 写 snapshot 或直接 patch progress 均失败；重建值与唯一事实入口一致。
4. **日期和 milestone**：`occurred_on > posted_on`、`posted_on > settled_on`、跨币种 entry、无 posted 的 settled milestone 均失败；乱序重复 event 不覆盖更高 sequence。
5. **退款/冲正守恒**：多个部分 refund 的绝对值不能超过原贡献；第二个完整 reversal、跨 task、环引用和非精确 reversal 均拒绝；负进度保留并触发 needs_review/outbox。
6. **权益消费/恢复**：预约 confirmed、presented、rejected、cancelled、disputed 都不写 use；两个并发 redeemed 至多一条 use；只有已有 use 的精确 reversal 才能 restore，超用不被截断。
7. **积分双差额**：重放后 `ledger_balance = sum(entry)`、`allocated_balance = sum(allocation)`、`unallocated_difference` 与 `reconciliation_difference` 分别相等；正未分配差不创建 lot，负差进入 mismatch/needs_review。
8. **未知批次**：`expiry_basis=unknown` 或无 lot 分配的余额不会生成 expiry reminder 或自动 expire；用户显式补证据后才允许后续命令改变 lot 事实。
9. **兑换四轴**：订单 failed/cancelled 不扣分；success/fulfilled 但 debit pending 显示扣分待处理；debit 未 posted 的 refund 被拒；两个 debit worker 和重复 refund 只产生一条对应 link。
10. **账户/卡 ownership**：固定卡 points account 不能被另一张同用户卡 redemption 引用；合并池不能隐式挂卡；entitlement、usage、task、entry、lot、redemption 的父链 owner 不一致时数据库和 API 都拒绝。
11. **幂等和消息**：同 key 同 hash replay 原结果，同 key 异 hash 返回 `409`；重复 HTTP/outbox/inbox、乱序事件、死信重放不复制事实、余额或提醒。
12. **提醒去重**：同一 `(user,dedupe_key)` 只有一条；归档/终态不重新生成；冻结 IANA 时区在 UTC 跨日、DST、闰日和截止日边界上的 trigger_at 可重建。
13. **迁移 parity**：旧 `progress_entries` adapter 的可推导行与新 task 重放相等；缺证据行清楚标记 needs_review，不伪造 posted/settled；expand/contract 可停写并恢复旧读 facade。
14. **备份恢复**：全量+WAL 恢复后复合 FK/RLS、所有账本恒等式、outbox/inbox 水位、兑换 link、提醒去重和删除注册表均通过，恢复副本不会将已删除账户带回在线库。

## 8. 未决事项与发布风险

1. 托管 PostgreSQL 是否允许 `btree_gist`、RLS 受控 worker 旁路、`SECURITY DEFINER` 函数和 `pg_timezone_names` 校验函数尚未签字；不可用时必须提供等价锁/trigger 方案。
2. 多卡联合活动是否允许跨卡合并贡献、全局名额如何计数，目前 P0 明确不支持；若开放，必须另建跨聚合分配和守恒模型。
3. Benefit 的 `coverage_claim`、`fee_credit` 单位和后续价值记录尚未由产品定义；在定义前不得复用次数 ledger 或把估值写入额度事实。
4. 积分 program 的最小单位、未知 lot 是否允许用户显式创建、不同用途限制和部分兑换退款未冻结；P1 只支持手工确认、用户指定 lot 或未分配差额。
5. 旧 `progress_entries` 是否含 posted/settled 来源、稳定业务键和完整币种仍未盘点；在盘点完成前只能有损 adapter，不能承诺无损迁移。
6. 账户删除冷静期、备份/对象保留期、RPO/RTO、恢复后已删除数据的匿名化策略没有运维/安全签收。
7. 统一提醒仍有多态目标选择；如果不拆 target 表，按 object type 的 owner/终态检查必须由数据库受控函数覆盖所有类型。
8. 正式 PRD/架构/QA/安全文档仍可能存在状态命名和 P0/P1 边界漂移；主会话合并前要冻结 canonical glossary，避免实现时出现 `ledger_status/debit_status/points_debit_status` 三套写法。

## 9. 交接

### 给产品经理

- 确认活动名额是用户手工核对还是未来全局库存；确认 reward 原文、奖励组件、expected date 和争议处理的展示语义。
- 确认 snapshot 与 entries 的产品输入是否永远二选一；确认发生/入账/结算口径、部分退款和 reversal-of-reversal 的用户文案。
- 确认 Benefit 各 `usage_model` 的单位、有效期和“预约/出示/核销”状态；确认积分账户按卡/合并池、未知批次和部分退分策略。

### 给架构师

- 将 participation/reward/milestone/benefit/points/redemption transition 固化为 command + event + projection；禁止任意 PATCH 状态和缓存。
- 设计复合 ownership、RLS/worker 角色、idempotency result、outbox/inbox、lease/dead-letter 与从零重建命令；为 snapshot/entries 互斥提供事务边界。
- 明确 `points_debit_status`、`request_hash`、`business_key` 和 sequence 的唯一命名，避免兼容字段成为第二事实源。

### 给 QA

- 将第 7 节 14 条验收拆为 PostgreSQL constraint/trigger、API IDOR、并发、时区、重放、迁移 parity 和恢复套件；不能只靠 mock/静态文档签收。
- 对负余额、负额度、未知 lot、settled 前置 posted、奖励延迟、退款先后和死信重放保留固定 fixture，并验证 cache 从事实重建。

### 给安全工程师

- 在 RLS/复合 FK 之外审查敏感字段、审计 metadata、source snapshot/附件、导出、删除注册表和恢复副本；完整 PAN/CVV/token/密码永不落库或进入日志。
- 对来源、导入、worker 旁路、外部兑换证据和短时下载链接做威胁模型；确认删除、备份保留和恢复后的“不可回灌”控制。

## 10. 交付摘要

- **Changed files**：仅新增 `docs/research/CARD-DOMAIN-ROUND6-DATA.md`；未修改正式数据库/架构/PRD/安全/QA/UX 文档、代码、迁移、锁文件或 coordination ledger。
- **Decisions**：活动奖励独立事实；SpendTask snapshot/entries 互斥且 milestone 独立；权益按 usage model 守恒并只在首次 redeemed consume；积分保留 ledger/lot/reconciliation 两个有符号差额和未知批次不提醒；兑换订单/履约/扣分/退分四个底层事实轴与 posted-debit refund 前置；所有权使用复合 FK；写入使用幂等 + append-only + outbox/inbox；迁移采用 expand/adapter/shadow replay/verify/switch/contract；恢复以全量+WAL 和从零重建为门槛。
- **Validation**：已完成指定文档、当前 schema/migration 和跨角色稿件的静态交叉复核；本文完成后运行 `git diff --check -- docs/research/CARD-DOMAIN-ROUND6-DATA.md`。未执行数据库迁移、真实 PostgreSQL、业务/API、E2E 或备份恢复测试。
- **Risks/open questions**：见第 8 节，重点是扩展/RLS/worker 能力、旧进度可回放性、活动名额/多卡合并、Benefit 单位、积分未知批次/部分退款、删除保留与 RPO/RTO、正式契约状态词漂移。
- **Ready for integration**：yes，本文可交给主会话整合；工作台功能 release readiness 仍为 no，直至第 7 节验收和第 8 节阻断项在真实 PostgreSQL/恢复演练中关闭。
