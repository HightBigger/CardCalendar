# Cardfolio 卡领域第七轮 DBA 数据收敛复核

| 项目 | 内容 |
| --- | --- |
| 角色 | DBA |
| 复核日期 | 2026-08-14 |
| 基线 | 当前 working tree；真实数据库仍为年费 MVP |
| 复核输入 | `DATABASE-WORKBENCH.md`、Round6 DBA 稿、Round7 台账、PRD/架构及现有 `0000`--`0003` migration/schema |
| 范围 | participation 实例 ownership、奖励组件历史、SpendMilestone、Reminder 投递、权益 usage model、积分双差额/lot、兑换四轴、RLS、迁移与恢复 |
| 交付边界 | 只新增本文；不修改正式文档、代码、schema、migration、锁文件或 ledger，不提交/推送 |

本文将第六轮的 prose 约束进一步收敛到 DDL、constraint trigger、transition function 和可执行验收层。所有示例均为实施前建议，不代表已经创建 migration 或当前产品已支持工作台领域。

## 1. 输入、现状与边界

### 1.1 现状证据

- 当前真实迁移仍只有用户、会话、卡片、年费周期/事件、`progress_entries`、提醒、审计和 worker 心跳；没有活动、奖励、SpendMilestone、权益 ledger、积分 lot、兑换 link、outbox/inbox 或 RLS 领域表。
- `DATABASE-WORKBENCH.md` 已提出活动五轴、任务规则快照、不可变流水、权益额度流水、积分 lot/差额、兑换四轴和提醒 `dedupe_key`，但部分约束仍是文字约定；本稿补充其 DDL 级落点。
- Round6 已确认 P0/P1 是手工确认纵切：不接银行、不代报名、不自动判断资格、不自动兑换、不自动 FIFO/跨账户转移。任何 `confirmed/received/fulfilled/posted` 只表示本地记录轴，不证明外部机构事实。

### 1.2 统一原则

1. 所有业务事实表携带 `user_id`；固定卡、活动规则、entitlement、task、points account 和 redemption 使用复合唯一键/FK。API/worker 仍从会话或受控 job 上下文取得 owner，复合 FK 不替代授权。
2. 事件/流水/关联表 append-only；主表只做投影或聚合元数据。修正使用新 correction/restore/reversal 事实，不能直接更新余额、剩余量、进度或历史状态。
3. 同一事务提交事实、投影、审计和 outbox；消费者使用 inbox 去重。缓存只带水位并支持从零重放。
4. 旧枚举只允许读兼容映射；新写入口使用 canonical 名称，不能让两个名字同时成为事实源。

## 2. 逐项 DDL 收敛

每节按“当前漂移 -> canonical 建议 -> 验收/回滚风险”记录，便于主会话整合。

### 2.1 `activity_participations` 实例键与 FK

**当前漂移**

- 现有草案虽有 `unique(user_id,campaign_id,card_id)` 和 `rule_id` 字段，但没有把重复/周期活动的实例键纳入 ownership 边界；仅有单列/较短复合 FK 时，可能出现同用户不同卡或不同周期实例被错误合并。
- `campaigns.rule_id`、`activity_participations.rule_id` 和 `rule_version_id` 的一致关系如果只在应用层检查，并发建实例或规则换版时会留下无法解释的历史。

**Canonical DDL 建议**

父表必须提供以下唯一键：

```text
campaigns:             unique(id, user_id, rule_id)
cards:                 unique(id, user_id)
rule_versions:         unique(id, user_id, rule_id)
activity_participations:
  unique(id, user_id, card_id, activity_instance_key)
  unique(user_id, campaign_id, card_id, activity_instance_key)
```

`activity_participations` 至少保留 `user_id,campaign_id,card_id,activity_instance_key,rule_id,rule_version_id`，并建立：

```text
(campaign_id,user_id,rule_id)
  -> campaigns(id,user_id,rule_id)
(card_id,user_id)
  -> cards(id,user_id)
(rule_version_id,user_id,rule_id)
  -> rule_versions(id,user_id,rule_id)
```

`activity_instance_key` 是周期/批次/重复活动的业务实例键，创建后冻结；同一活动的下一周期必须创建新 key。`rule_id` 和 `rule_version_id` 仅表达活动及其规则版本引用，不属于参与实例的业务唯一键，但必须通过复合 FK 与 `campaigns`/`rule_versions` 保持一致。`campaigns.rule_id` 一旦有 participation 就不可原地改变；规则变化创建新 campaign/rule version 或将既有实例标为 `needs_review`。所有下游 task/reward/entry 沿参与实例键引用，不能按标题、商户或规则 ID 自动合并。参与状态仍是资格、报名、名额、结果和奖励五轴，不能由一列 `status` 代替。

**验收/回滚风险**

- 并发插入相同 `(user,campaign,card,activity_instance_key)` 只能成功一条；使用另一用户、另一卡或另一活动/规则引用的 payload 必须在 FK/transition 层失败，API 对无权资源统一 `404`。
- expand 阶段先盘点孤儿和跨 owner 行，再 `NOT VALID` 加约束并离峰 `VALIDATE`；发现旧数据冲突时只能隔离并审计，不能用级联删除掩盖。回滚只停新命令和恢复旧 facade，不撤销已经提交的 participation 事件。

### 2.2 活动奖励组件主表与 append-only history/event

**当前漂移**

- 现有 `activity_rewards` 草案包含 `status`、`request_hash` 等字段，但没有明确主表是否为事实源，也缺少完整的 reward event sequence、`business_key` 和命令幂等边界。
- 若直接 PATCH `activity_rewards.status`，会丢失延迟、到账、撤回、争议是谁在何时确认的历史；`target_reached` 也可能被误写成奖励到账。

**Canonical DDL 建议**

`activity_rewards` 是按 `(user_id,participation_id,reward_key)` 唯一的**投影/组件目录**，不可由普通应用角色直接更新状态。建议保留金额/上限原文、`source_snapshot_id`、`row_version` 和当前投影，但将事实写入：

```text
activity_reward_events(
  id, user_id, participation_id, reward_id,
  sequence > 0,
  event_type = expected|delayed|received|reversed|disputed|note,
  business_key,
  client_request_key,
  request_hash char(64),
  occurred_at, actor_type, actor_id,
  source_snapshot_id, payload_json schema_version,
  unique(reward_id, sequence),
  unique(reward_id, business_key),
  unique(user_id, client_request_key)
)
```

事件表使用复合 FK：`(reward_id,user_id,participation_id) -> activity_rewards(id,user_id,participation_id)`；奖励投影只由受控 transition function 在同一事务根据 event sequence 更新，并同时写 audit/outbox。`request_hash` 必须是规范化请求摘要并通过 64 位十六进制 CHECK；它不是跨用户全局唯一值，而是同一 `client_request_key` 的冲突判别值：同键同 hash 重放原结果，同键异 hash 返回 `409 IDEMPOTENCY_KEY_REUSED`。事件 `business_key` 在 reward 范围唯一，归档后也不复用。

**验收/回滚风险**

- 重复到账、重复撤回和两个 worker 重放只能产生一条对应 event；事件乱序不能让较低 sequence 覆盖较高投影。
- 旧主表状态需要一次只读 shadow 比对；contract 前保留旧字段作为 projection read facade。若投影重建失败，回滚为停止 consumer、从 event 全量重建，不允许直接改回旧状态或删除事件。

### 2.3 SpendTask 与 `SpendMilestone` 表、事件、FK、幂等

**当前漂移**

- `spend_task_entries` 已有 entry sequence 和处理状态，但 milestone 仍主要是 prose；若把 `posted/settled/target_reached` 塞进 entry 或 task 状态，无法表示一个 entry 的多个达标节点、撤回和重试。
- `snapshot` 与 `entries` 双输入的互斥只能由应用约定，普通 CHECK 无法跨表防止同一 task 同时拥有总额和明细。

**Canonical DDL 建议**

`spend_tasks.input_mode` 一旦从 `draft` 进入 `active` 即不可变，只能是 `snapshot` 或 `entries`。建议以 deferred constraint trigger（或受控存储过程锁 task）保证：

```text
input_mode=snapshot -> 恰有一个 spend_task_snapshots(task_id)，不得有 entries
input_mode=entries  -> 不得有 snapshot，progress 只能由 entries 重放
```

模式切换必须终结旧 task 并创建新的 `activity_instance_key`；不能原地切换。测试必须覆盖：先 snapshot 后 entry、先 entry 后 snapshot、同事务并发写两种来源、重试写同一来源和删除/归档时的来源水位。

`spend_milestones` 建议字段和约束：

```text
id, user_id, task_id, entry_id,
milestone_kind = posted|settled|target_reached|reversed|needs_review,
status = pending|qualified|reversed|disputed|needs_review,
business_key, request_hash, qualified_at, source_sequence,
unique(task_id, entry_id, milestone_kind, business_key),
unique(task_id, business_key),
FK (task_id,user_id,card_id) -> spend_tasks(...),
FK (entry_id,task_id,user_id) -> spend_task_entries(...)
```

`settled` milestone 的 constraint trigger 必须检查 entry 的 `processing_status` 已经 `posted/settled`，并满足 `occurred_on <= posted_on <= settled_on`；`posted`/`settled` 只是节点事实，不直接加入金额/次数。`spend_milestone_events` 记录 `sequence,event_type,client_request_key,request_hash,business_key`，主 milestone 行只作投影。entry refund/reversal 只能追加 `reversed` event，不能删除已发 milestone；同一原 entry 的部分 refund 总绝对值不得超过原贡献。

**验收/回滚风险**

- snapshot/entries 五类互斥测试必须全部拒绝混写；从零 replay 的 task cache 与唯一输入源相等。回滚阶段停新写入口、保留事实和 source mode，不把新 cache 倒灌旧 `progress_entries`。
- 无 posted 的 settled milestone、跨 task/跨卡 entry、重复 milestone business key、过量 refund、环形 reversal 均必须失败；旧进度缺发生/入账/结算证据的 adapter 行只能 `needs_review`。

### 2.4 Reminder 表、索引、dedupe、时区和 worker 状态

**当前漂移**

- 现有 `reminders` 主要描述业务提醒状态，`workbench_reminders` 建议字段尚未成为真实表；没有持久化 lease、attempt、last error 和 dead-letter，worker 重启可能重复投递或丢失失败原因。
- 多态 `object_id` 不是天然 FK；只校验 UUID 存在会放行跨用户对象。`timezone` 也不能只靠字符串格式判断 IANA 有效性。

**Canonical DDL 建议**

提醒业务状态和投递状态分离。统一表至少包含：

```text
id, user_id, object_type, object_id, reminder_type,
trigger_at timestamptz, timezone, dedupe_key, source_sequence,
status = pending|snoozed|completed|ignored|overdue|cancelled,
delivery_status = ready|leased|delivered|retrying|dead_lettered,
attempt_count integer >= 0, next_attempt_at timestamptz,
lease_owner, lease_expires_at, last_attempt_at,
last_error_code, dead_lettered_at, created_at, updated_at
unique(user_id, dedupe_key)
```

`last_error_code` 只能存稳定脱敏错误码/长度受限摘要，不存异常 message、请求体或凭据。可另建 `reminder_delivery_attempts` append-only 表，`unique(reminder_id,attempt_no)`，记录开始/结束时间、worker、结果码和 event/request id。业务 object 使用按 `object_type` 拆 target 表，或通过受控函数在同一事务验证完整父链和 `user_id`；不能接受客户端 `owner_user_id`。

索引至少包括：

```text
unique(user_id,dedupe_key)
(user_id,status,trigger_at)
(user_id,delivery_status,next_attempt_at,trigger_at)
(user_id,object_type,object_id)
partial(delivery_status in ready|retrying, next_attempt_at)
partial(delivery_status = dead_lettered, dead_lettered_at)
```

`timezone` 写入时由稳定函数/trigger 校验 `pg_timezone_names`，`trigger_at` 始终是 UTC。worker 在一个事务中 `FOR UPDATE SKIP LOCKED` 领取 ready/retrying 行，写 `lease_owner`/`lease_expires_at` 并递增 attempt；租约过期可回收，超过上限持久化为 `dead_lettered`，业务事实不回滚。重复生成命中 `dedupe_key`，归档/终态只停止未来投递而保留历史。

**验收/回滚风险**

- 两个 worker 不能同时取得同一 lease；进程崩溃后租约可回收，attempt/last_error/dead-letter 在重启和数据库恢复后仍可见。dead-letter 重放必须沿原 reminder/event id，不能生成新业务提醒。
- expand 先将旧提醒投递影子写入新状态字段，旧 API 继续读；观察完整周期和时区/DST 后才切 worker。回滚只停止新 worker、继续兼容旧投递，不删除 dedupe 或失败历史。

### 2.5 Benefit `usage_model` 与 consume/restore 守恒

**当前漂移**

- 现有数据库草案使用 `benefit_entitlement_ledger.entry_type=grant/use/adjustment/expire/reversal`，而产品/架构已需要“consume/restore”语义；`use` 与通用 adjustment 容易让预约或纠错误扣次数。
- `benefit_usages.status` 仍可能被误当作事实写入口，未完全禁止直接把 booked/presented/rejected 变成额度流水。

**Canonical DDL 建议**

新写模型的 ledger 枚举只允许：

```text
grant     正向发放
consume   首次 redeemed 的负向消耗
restore   对 consume 的正向恢复
expire    用户确认的负向过期
reversal  对任意既有 entry 的精确反向
```

旧 `use` 只读映射为 `consume`；旧 `adjustment` 仅在已有 `adjustment_reason=restore` 且关联原 consume 时映射为 `restore`，其他 adjustment 映射为 `legacy_adjustment/needs_review`，不能静默改成 restore。`benefit_entitlement_ledger` 的新写入口拒绝旧枚举，要求 `(entitlement_id,user_id,card_id)` 复合 FK、`sequence/business_key` 唯一、entry 不可更新/删除。

`usage_model=consumable_quota` 才允许 grant/consume/restore/expire；`coverage_claim`、`fee_credit`、`service_record` 和 `unknown` 禁止写次数 consume。`benefit_usages` 以 `reservation_status` 与 `redemption_status` 为事实轴，只有首次 `redeemed` 命令在锁定 entitlement 后写 `benefit_usage:{id}:consume`；restore 必须引用同一 entitlement 的 consume 并精确相反。剩余量为负时保留真实值并设置 `needs_review`，不得截断为零。

**验收/回滚风险**

- 同一 usage 两个并发 redeemed 最多一条 consume；booked/presented/rejected/cancelled/disputed 不产生 consume。重复 consume、跨 entitlement restore、非精确 reversal 和 unknown usage model 均拒绝。
- 迁移先建立 canonical read view 和旧枚举映射，再在 shadow replay 中核对剩余量；发现旧 adjustment 无法判断 restore 时保留 `needs_review`，不能批量重分类。回滚只能停新写入口，从 append-only ledger 重建投影。

### 2.6 Points dual differences、lot allocation 与未知批次

**当前漂移**

- 旧草案的 allocation sequence、entry sequence 和一笔 entry 拆多个 lot 的唯一性描述存在混淆；若以 `(account_id,allocation_sequence)` 代替 `(ledger_entry_id,lot_id)`，合法拆分会失败。
- lot 缺口和外部确认余额差可能被合并为单个正数 gap；未知 expiry 可能被 worker 当作可提醒/自动过期。

**Canonical DDL 建议**

`points_ledger` 是唯一余额事实，`points_lot_allocations` 是独立不可变事实。必须满足：

```text
points_ledger: unique(account_id,sequence), unique(account_id,business_key)
lot allocation: unique(ledger_entry_id,lot_id)
allocation sequence: 独立账户水位，可 unique(account_id,allocation_sequence)，但不能代替上面的 pair
FK (ledger_entry_id,account_id,user_id) -> points_ledger(...)
FK (lot_id,account_id,user_id) -> points_lots(...)
```

deferred trigger 检查同账户、单位/scale 继承、allocation 方向与 entry 类型一致、单 entry 分配绝对值不超 entry、lot remaining 等于该 lot allocations 合计。两种有符号差额不可合并：

```text
ledger_balance            = sum(points_delta)
allocated_balance         = sum(allocated_delta)
unallocated_difference    = ledger_balance - allocated_balance
reconciliation_difference = confirmed_balance - ledger_balance
```

没有来源证据的余额保持 `unallocated_difference`；显式未知 lot 允许 `expiry_basis=unknown`，但不产生 points expiry reminder、不自动 `expire`、不自动 FIFO。正差不造 lot，负差进入 `mismatch/needs_review` 并阻止自动建议；对账非零差只能追加 `adjustment` entry。

**验收/回滚风险**

- 一笔 earn/redeem 可拆到多个 lot；跨账户、单位不一致、超过 entry 绝对值、重复 pair 和负 lot 未标异常均失败。重放必须同时恢复账户余额、lot remaining、两种差额和水位。
- backfill 只把有稳定业务键/来源的历史余额转成 observation 或 reconciliation adjustment；无法确定 lot 的行留在 unallocated。回滚停 allocation consumer、保留 ledger facts，缓存可从零重建。

### 2.7 Redemption 四轴与 account-card ownership

**当前漂移**

- 兑换草案已出现 order/fulfillment/debit/refund 四轴，但 `points_accounts.card_id` 与 `redemptions.card_id` 可空时，PostgreSQL 复合 FK 对 NULL 的放行会允许“固定卡账户 + 未填卡”或同用户跨卡挂接。
- 只用 `account_id,user_id` 的 FK 无法表达固定卡账户和 merged pool 的两种 scope；订单成功也可能被错误地当成本地已扣分/已退分。

**Canonical DDL 建议**

四轴固定为：

```text
order_status          = planned|submitted|accepted|rejected|cancelled|unknown
fulfillment_status    = not_started|processing|fulfilled|failed|cancelled|unknown
points_debit_status   = not_debited|pending_debit|posted|needs_review
refund_status         = not_applicable|not_requested|pending_external_confirmation|
                         confirmed_external|posted|needs_review
```

账户 scope trigger/transition function 必须明确：

```text
points_accounts.card_id IS NOT NULL
  -> redemptions.card_id IS NOT NULL
  -> redemptions.card_id = points_accounts.card_id
points_accounts.card_id IS NULL (merged pool, P1)
  -> redemptions.card_id IS NULL
```

复合 FK 仍用于 user/account/card，另以 deferred trigger 防止 NULL 规避 scope；account 的 `card_id` 在产生首条 ledger 后不可改变。`redemption_ledger_links` 使用 `primary key(redemption_id,link_role)`、`unique(ledger_entry_id)`，link_role 只有 debit/refund。debit consumer 锁 account，以 `redemption:{id}:debit` 追加负 entry；refund 只有在 debit link 已 posted 且有外部证据时，以 `redemption:{id}:refund` 追加等额 reversal。P1 不实现 hold/reservation；failed/cancelled 不写 debit。

**验收/回滚风险**

- 固定卡账户挂另一张卡、固定卡账户缺 card、merged pool 带任意 card、跨用户 account/ledger link 均失败；外部 success 但本地余额不足保留真实负余额并标 `needs_review`。
- 两个 debit worker、重复 HTTP、重复 outbox 和退款重试只能各产生一条 link。迁移期间先冻结旧兑换写入口，shadow 比对订单/履约/ledger；回滚停 consumer、保留 posted facts，用新 reversal 修正，不把成功订单改回失败。

## 3. 横切约束：幂等、RLS、append-only 和审计

### 3.1 幂等和事件

所有 command 存 `(user_id,client_request_key,request_hash,result,status,correlation_id)`；同键同摘要 replay 原结果，同键异摘要 `409`。事件 outbox 与事实同事务提交；consumer 先插入 `inbox(consumer_name,event_id)`，重复即 no-op。attempt、dead-letter、transition error 使用稳定错误码和最小脱敏 metadata，不把原始 payload 复制进日志。

### 3.2 RLS 与复合 ownership

Web 事务使用 `set local app.user_id`；worker 使用受控角色和 job owner，RLS policy 与业务复合 FK/API ownership 三层都保留。每个资源命令都验证完整父链：user -> card -> campaign/participation -> task/entitlement -> account/ledger/redemption。不存在和无权资源统一 `404`；管理员不能绕过 transition function 直改流水。

### 3.3 Append-only 权限边界

普通应用角色撤销 source snapshot、participation/reward event、SpendEntry/Milestone、benefit ledger、points ledger/lot allocation、redemption link、reminder attempt 的 `UPDATE/DELETE`。`SECURITY DEFINER` 写函数固定 `search_path`、校验 actor/owner、分配 sequence、写审计/outbox；账户删除清理是唯一受控物理删除路径。

## 4. 账本恒等式与可重放检查

```text
SpendTask(entries): progress = sum(entries by sequence)
SpendTask(snapshot): progress = the single snapshot fact; no entries allowed
Benefit: remaining = grant - consume + restore - expire + reversal
Points: ledger_balance = sum(points_delta)
        allocated_balance = sum(allocated_delta)
        unallocated_difference = ledger_balance - allocated_balance
        reconciliation_difference = confirmed_balance - ledger_balance
Redemption: net_points_effect = -required_points + exact posted refund (if any)
```

所有投影缓存带 `last_sequence`/`row_version`；重建后检查 sequence 无重复、事件业务键稳定、旧事件不覆盖新水位、负值不归零、未知 lot 不生提醒。任何不变量失败写 `needs_review` 和审计，不能静默修 cache。

## 5. Expand/contract 迁移与回滚

以下是迁移建议，不是已经执行的 migration：

### Stage 0：预检和恢复基线

- PostgreSQL 15、`pgcrypto/citext`、`btree_gist`、RLS worker 角色、IANA 校验函数和受控 `SECURITY DEFINER` 能力先签字。
- 加密全量备份 + WAL/PITR 标记；盘点孤儿、跨 owner/card/account 引用、重复 business key、旧 reminder 投递、旧 progress 可推导字段；失败只报告，不清理。

### Stage 1：横切基础

- 父表先建复合唯一索引，再以 `NOT VALID` 添加复合 FK 并离峰验证；建立 idempotency command/result、outbox/inbox、审计白名单、append-only trigger 和最小角色。
- `activity_participations` 实例键唯一/复合 FK、奖励 event、SpendMilestone 和 Reminder 表先 expand；旧 API/提醒继续读兼容 facade。

### Stage 2：P0 活动、任务与提醒

- Reward/Participation/Milestone event 与 projection 双写 shadow；对 `snapshot`、`entries` 各自重放并执行互斥测试。
- 提醒先双写 dedupe/timezone/lease/attempt 字段，worker 只影子领取；完成一个周期、重启租约和 dead-letter 演练后再切投递。
- 旧 `progress_entries` 通过只读 adapter 进入 entries 模式；缺日期口径、来源或 business key 的行标 `needs_review`。

### Stage 3：P1 权益

- 建 canonical `grant/consume/restore/expire/reversal` ledger 和旧枚举 read view；只回填有稳定键/证据的 grant/use，旧 adjustment 无法判定 restore 时留待核对。
- 先只读守恒和并发报告，再打开 consume/restore command；失败停 feature flag/consumer，事实不删除。

### Stage 4：P1 积分与兑换

- 先建 account/ledger/reconciliation，再建 lot/allocation；旧余额作为 observation/adjustment，不伪造 lot。通过双差额、未知 expiry 和负余额测试后，再切兑换四轴 consumer。
- 兑换切换前冻结旧写入口，shadow 比对 order/fulfillment/debit/refund；回滚只停 consumer 和恢复旧 facade，posted debit/refund 由新 reversal 修正。

### Stage 5：Contract

- 至少两个核对周期、并发/乱序/死信重放、RLS/IDOR、导出/删除和全量+WAL 恢复通过后，才关闭旧写入口。旧表和 adapter 保留只读观察期，不物理删除事实或释放业务键。

## 6. 备份、恢复、删除和审计

1. 每次扩展 migration 前保存 schema 版本、feature flag、outbox/inbox 水位、worker lease 和可恢复时间点；备份加密、跨故障域，RPO/RTO/保留期由产品/运维/安全签收。
2. 隔离环境用全量+WAL 恢复，验证实例键复合 FK、reward/milestone event、Reminder lease/attempt/dead-letter、Benefit/Points/Redemption 守恒、RLS 和缓存从零重建。恢复后 inbox 去重和 outbox 重放不得产生第二条事实。
3. 删除注册表覆盖新表、reminder attempts、worker job/lease、outbox/inbox、source object、导出链接、缓存/索引和审计匿名化；恢复副本不得把已删除账户回灌在线库。
4. 审计只保存 actor、owner、transition、source/version、entry/link id、request/correlation id、结果码和前后摘要；禁止 PAN/CVV/token/密码、完整来源正文和原始异常 message。

## 7. 数据库验收与回滚门槛

1. participation 实例键并发唯一、campaign/rule/card/user 任一不一致的 FK/transition 拒绝；规则换版不会改写历史实例。
2. Reward 主表直接 UPDATE 被拒；同一 reward 的 event sequence/business key/request key 重放幂等，乱序不能回退 projection。
3. 同一 task 的 snapshot/entries 五种混写路径均失败；task mode 只能在 draft 设定，旧 progress adapter 可重放且不伪造入账口径。
4. SpendMilestone 的 settled 必须有 posted；重复/跨 task/过量 refund、环引用和非精确 reversal 失败；milestone event 追加而非删除。
5. 两个 Reminder worker 不能同时持有 lease；过期租约可回收，attempt/last_error/dead-letter 在重启/恢复后持久存在；同 dedupe key 不重复生成。
6. `usage_model` 非 consumable_quota 时 consume 被拒；booked/presented/rejected/cancelled/disputed 无额度流水；并发 redeemed 至多一条 consume，restore 精确反向。
7. 旧 `use/adjustment` 只读映射，canonical ledger 只接受 grant/consume/restore/expire/reversal；未知 adjustment 不被静默重分类。
8. 一笔 points entry 可拆多个 lot；重复 `(ledger_entry_id,lot_id)`、跨账户、单位/scale 不一致、超量分配失败；双差额公式和未知 lot 不提醒。
9. 固定卡账户缺 card/错 card、merged pool 带 card、跨用户 redemption link 均失败；order/fulfillment/debit/refund 四轴可独立重放。
10. 重复 HTTP/outbox/inbox、两个 debit worker、死信和 refund retry 不复制事实；退款无 posted debit 或金额不等被拒。
11. 跨用户/跨卡 API、RLS、复合 FK 三层均阻断 IDOR；append-only 表普通角色 update/delete 失败。
12. 全量+WAL 恢复后重建所有 projection，sequence、差额、dedupe、lease、link、删除注册表与恢复前一致；已删除账户不回灌在线库。

## 8. 未决事项与风险

- `btree_gist`、IANA 校验函数、RLS worker 旁路和 `SECURITY DEFINER` 的托管 PostgreSQL 能力仍待签字；不可用时必须提供锁父行/constraint trigger 等价方案。
- 活动换版是新 campaign 还是原 campaign 终结、历史 participation 是否标记 `needs_review`，需产品/架构冻结；本稿默认规则绑定不可变，`rule_id` 不是 participation 的业务实例键。
- Reminder 多态 target 的拆表方案、投递渠道和最大 attempt/退避参数尚未确定；数值不得在数据库稿中猜定，需运维签收。
- Benefit 旧 adjustment 的历史含义、未知 usage model 的处理、积分最小单位、未知 lot 是否可手工创建、部分退款和跨账户 transfer 均未最终冻结。
- 旧 progress 是否有可证明 posted/settled/business key 尚未完成盘点；在此之前只能有损 adapter。
- RPO/RTO、备份/对象保留、删除冷静期、恢复副本隔离和审计匿名化仍是发布阻断项。

## 9. 交接与交付摘要

### 产品

确认活动规则换版和 participation 实例生命周期、名额/奖励组件显示、Benefit usage model/consume 文案、积分未知批次、merged pool 和兑换退款语义。

### 架构

将实例 owner 复合 FK、reward/milestone event projection、Reminder lease/dead-letter、canonical Benefit ledger、Points allocation 和 Redemption scope trigger 固化到 command/event/port 契约；不得以兼容字段做第二事实源。

### QA

将第 7 节 12 条拆成 PostgreSQL constraint/trigger、并发、IDOR/RLS、时区、乱序重放、迁移 parity、dead-letter 和恢复套件；静态文档不能替代真实数据库证据。

### 安全

审查 RLS worker 旁路、审计/last_error 脱敏、来源和导出对象、删除注册表、备份恢复不回灌及 lease/job 权限；禁止敏感值进入事件 payload/日志。

### 交付摘要

- **Changed artifacts**：仅新增 `docs/research/CARD-DOMAIN-ROUND7-DATA.md`；未修改 Round6、正式 DATABASE/架构/PRD/安全/QA/UX、代码、migration、锁文件或 ledger。
- **Decisions**：参与实例使用 `(user,campaign,card,activity_instance_key)` 业务唯一键，`rule_id/rule_version_id` 仅作规则引用并通过复合 FK 校验；`activity_rewards` 主表只作投影，reward events append-only 且业务键/幂等键受约束；SpendMilestone 独立表/事件并与 snapshot/entries 互斥；Reminder 持久化 dedupe、冻结 IANA、lease/attempt/last_error/dead-letter；权益 ledger 统一 `grant/consume/restore/expire/reversal`；积分 allocation/双差额/未知 lot 守恒；兑换四轴和固定卡/merged pool scope trigger；expand/contract、RLS、备份恢复按阶段推进。
- **Evidence/validation**：已静态复核 Round7 台账、`DATABASE-WORKBENCH.md`、Round6 DBA 稿、PRD/架构和现有 migration/schema；`git diff --check -- docs/research/CARD-DOMAIN-ROUND7-DATA.md` 通过。未运行真实 PostgreSQL、迁移、API、E2E 或恢复测试。
- **Risks/open questions**：见第 8 节，主要是托管 PostgreSQL 能力、历史 progress 可回放性、规则换版键、提醒退避参数、旧 adjustment 语义、积分未知 lot/部分退款及 RPO/RTO/删除保留。
- **Ready for integration**：yes；本文可供主会话串行整合；当前工作台仍是年费 MVP，未通过真实数据库和恢复门槛前不得宣称可部署。
