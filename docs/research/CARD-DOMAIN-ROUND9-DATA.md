# Cardfolio 卡领域第九轮 DBA 数据深化复核

| 项目 | 内容 |
| --- | --- |
| 文档版本 | v0.1 |
| 复核日期 | 2026-08-15 |
| 角色 | DBA｜Cardfolio｜工作台账本与迁移深化复核 |
| 输入 | `docs/PRD-WORKBENCH.md` v0.9、`docs/DATABASE-WORKBENCH.md`、`docs/ARCHITECTURE-WORKBENCH.md` v0.6、`docs/research/CARD-DOMAIN-ROUND8-DATA.md`、当前 `db/schema`/migrations |
| 产品现状 | 真实数据库和代码仍是年费 MVP；活动、权益、刷卡任务、积分和兑换没有正式表、migration、worker 或新领域 E2E |
| 允许修改范围 | 仅本文；不修改正式 PRD/架构/数据库文档、schema、migration、代码、锁文件或其他角色文件 |

> 本文是 report-only 研究稿，补充 Round8 的实现级数据契约，不表示任何新模块已经实现或可部署。所有表名、字段和迁移步骤必须在真实 PostgreSQL 15、影子库、并发、RLS 和 PITR 恢复演练中验证后才能进入正式 migration。

## 1. 结论先行

Round8 已冻结“活动五轴、单卡单周期 participation、SpendEntry/Milestone、权益 usage model、积分双差额、兑换四轴和 Reminder lease”。第九轮静态复核发现，当前正式文档仍有三类会导致数据错误的间隙：

1. **兼容投影和 canonical 写模型仍未在所有章节分层。** PRD 的 `CardActivity`、架构早期的 `ActivityEnrollment`、旧 `/spend-task-entries`、旧 `pending/success/fulfilled` 字段仍与新模型同时出现。数据库不能给两套名称各建一张表；必须规定单一事实源和只读映射，并把旧写路径停用作为 contract 门。
2. **跨对象所有权需要显式 scope，而不只是复合 FK。** 同一用户不代表同一张卡、同一积分账户或同一 activity instance。固定卡账户、合并积分池、多卡活动引用、奖励到积分/权益的关联、兑换部分履约都需要 owner/card/account/instance 的复合键和事务触发器，否则可发生“同户跨卡串账”或把一项奖励记到另一账户。
3. **可重放性必须延伸到投影和迁移水位。** 现有文档要求事实 append-only，但没有统一 projection checkpoint、backfill run、schema version 和 replay fence。没有这些字段，旧年费 adapter、outbox/inbox 重试、乱序事件和 PITR 后重放都无法证明不会双算。

Round9 DBA 建议的阻断项：

- P0 活动/刷卡任务上线前，完成 canonical 名称表、复合 ownership、规则版本生效区间、entry/milestone sequence、报名/奖励事件和投影 watermark 的 DDL 评审。
- P1-a 权益上线前，完成周期 entitlement、usage event、quota ledger 的 restore 守恒、超用/重复核销和删除恢复测试。
- P1-b 积分/兑换上线前，完成 account scope、pending/confirmed、lot allocation、负余额、四轴 debit/refund、现金和部分履约的跨表约束及并发测试。
- 任一阶段没有真实迁移、RLS/IDOR、回放、备份恢复和旧年费兼容证据，发布状态只能是“规划/阻断”。

## 2. 静态基线与文档漂移

### 2.1 当前真实实现

当前 `db/schema/index.ts` 和 `db/migrations/0000`--`0003` 仍只有 users、sessions、cards、fee_cycles、fee_events、progress_entries、reminder_rules、reminders、audit_logs 和 worker_heartbeats。没有 `campaigns`、`activity_participations`、`spend_tasks`、`benefit_entitlements`、`points_accounts`、`points_lots`、`redemptions`、source snapshots、outbox/inbox 或 RLS policy。Round8/9 研究稿和正式文档不应被误读为已经存在的表。

现有年费表仍有下列迁移前风险：

| 基线问题 | 影响 | Round9 处理 |
| --- | --- | --- |
| `fee_cycles.user_id` 与 `card_id` 是两个独立 FK | 数据库允许用户 A 的周期引用用户 B 的卡；相同风险存在于 fee event、progress、reminder | Stage 0 清理跨 owner 行，增加 `(id,user_id)`/`(id,user_id,card_id)` 唯一键，以 `NOT VALID` 复合 FK 过渡再 validate |
| `progress_entries` 可更新且没有业务键/sequence | backfill 不能还原编辑前事实，重试可能双算 | adapter 只映射当前可证明快照，未知中间版本标 `needs_review`；新 canonical entry 只能 append-only |
| `reminders` 没有 canonical dedupe/lease/attempt | worker 崩溃会重复投递，取消/换版可能遗留提醒 | 兼容读 adapter；canonical reminder/delivery attempt 独立建事实，历史不级联删除 |
| 币种为 regex、用户 timezone 为自由 text | 无法保证受控币种或 DST 边界 | 建 ISO 代码表和 IANA 校验函数；任务/规则/提醒冻结时区 |
| 现有 audit 未约束敏感字段/aggregate version | 无法审计幂等冲突、跨账户拒绝和 projection lag | 扩展脱敏 metadata、actor、request/correlation、source version、before/after 摘要 |

### 2.2 兼容投影与写模型唯一原则

正式文档应将以下名称明确为兼容读，而非新写入：

| 旧/展示名称 | Canonical 事实 | 数据库要求 |
| --- | --- | --- |
| `CardActivity`、`ActivityEnrollment` | `Campaign` + `ActivityParticipation` + `ActivityRewardComponent` | 只建 canonical 表；兼容查询由 view/read model 提供，不允许向单行 CardActivity 写状态 |
| `reward_status=pending` | `expected_pending` reward event | 旧 `pending` 只做映射，奖励组件事件按 sequence 重放 |
| `qualified/blocked/expired` | `target_reached/provisionally_qualified/needs_review` + `ended`/原因码 | 不新增同义主状态；原因和生命周期分列 |
| `SpendEntry.posted_on/settled_on` | `SpendEntry` occurred + `SpendMilestone` posted/settled/rejected | 旧列只读投影；canonical milestone 使用 `/spend-entries/{id}/milestones` |
| `redeemed/use` | 用户可见“已核销” -> `BenefitUsed`，quota ledger `consume` | 只有首次 consumable usage event 触发 consume |
| `success/fulfilled/debited/refunded` | redemption 四轴 order/fulfillment/debit/refund | 四轴各自有事件、版本和幂等键 |

CI/文档检查应禁止新 migration、API 或事件继续生成旧写入名称。兼容 adapter 必须记录 `legacy_source`、`legacy_id`、`backfill_run_id` 和原始 hash，避免同一历史行在多次回填时产生第二事实。

## 3. 跨对象 ownership 与 scope 契约

### 3.1 复合键层级

每个聚合至少携带 `user_id`，固定卡对象携带 `card_id`，固定账户对象携带 `account_id`，重复活动携带 `activity_instance_key`。父表必须提供目标唯一键，子表使用同序复合 FK：

```text
(user_id, card_id) -> cards(user_id, id)
(user_id, parent_id) -> parent(user_id, id)
(user_id, parent_id, card_id)
  -> parent(user_id, id, card_id)
(user_id, account_id, card_id)
  -> points_accounts(user_id, id, card_id)
```

所有权检查必须同时存在于：

1. API/application port：从会话/job context 派生 `user_id`，不信任请求体 owner。
2. RLS：缺少 `set local app.user_id` 默认拒绝，worker 使用最小角色。
3. PostgreSQL FK/trigger：阻止跨用户、跨卡、错误 activity instance、错误 account scope。

三层中任一层失败都算 P0 阻断；只做 application `where user_id = ?` 不能发布。

### 3.2 各领域边界

| 对象 | 固定 ownership | 需要阻止的非法关系 | 必需约束 |
| --- | --- | --- | --- |
| Campaign/RuleVersion | user + rule | activity 引用其他用户规则/来源或非 active 版本 | `(id,user_id,rule_id)` 复合 FK；source citation 同 owner；激活版本不可变 |
| Participation | user + campaign + card + instance | 同卡不同周期合并；不同卡共用 outcome/reward | unique `(user_id,campaign_id,card_id,activity_instance_key)`；子 task/reward 带 participation 复合 FK |
| SpendTask/Entry/Milestone | user + card + task + instance | entry 引到另一 task/card；reversal 跨卡或跨 task | `(task_id,user_id,card_id,instance_key)` 复合 FK；entry/milestone sequence 和 reverse guard |
| BenefitEntitlement/Usage | user + card + entitlement + period | 预约一项权益后核销另一周期；restore 另一 usage | `(entitlement_id,user_id,card_id)` FK；`period_instance_key` unique；usage event scope |
| PointsAccount/Lot/Entry | user + account scope + optional card | fixed-card account 被另一卡 debit；NULL card 被当作任意卡 | scope enum + trigger；account 首条事实后禁止改变 card scope |
| Redemption/Fulfillment/Debit | user + account + card scope | order 属于 A 账户但 debit 到 B 账户；部分履约重复 | redemption/account/card 复合 FK；ledger link 一对一/一对多规则；line quantity trigger |
| Reminder/Outbox/Inbox | user + target aggregate + target version | 规则换版或重试生成重复提醒；跨 user event 被 consumer 应用 | target owner 快照、dedupe key、aggregate version/sequence、inbox consumer unique |

### 3.3 固定卡和合并池

`card_id IS NULL` 不足以证明 PointsAccount 是合并池。账户必须有不可变 `scope_type=fixed_card|merged_pool` 和 `scope_key`：

- `fixed_card`：`card_id` 必填；所有 PointsEntry、Lot、Allocation、Redemption debit/refund 必须同一 `(user_id,account_id,card_id)`。
- `merged_pool`：`card_id` 为空，账户保存允许参与的卡集合/版本；P1 只允许用户手动确认来源，不允许任意卡自动挂接。
- 账户有首条 ledger 后禁止 scope/card 变更；变更只能关闭旧账户、创建新账户并追加迁移 adjustment，不能改写历史。

跨卡联合活动同理：P0 participation 和 SpendTask 按卡隔离；若以后有跨卡总目标，必须独立 `ContributionAllocation` 双边守恒模型，不把 task 的 card_id 置 NULL 绕过约束。

## 4. RuleVersion、来源和影响范围

### 4.1 生效区间和唯一性

RuleVersion 的业务唯一性应是 `(user_id, rule_id, version_no)`；`version_no` 由锁定 `rules` 的事务分配，客户端不可提交。有效区间使用对象时区下的 date 半开区间 `[effective_from,effective_to)`，或者明确 inclusive end 的统一策略，不能在不同表混用。数据库应保证同一 `(user_id,rule_id)` 的 active 区间不重叠，推荐 `EXCLUDE USING gist`；无法装 `btree_gist` 时用锁 `rules` 的 deferred trigger。

激活事务必须：

1. 锁定 rule 根行，验证版本仍为 draft、恰有一个 primary source citation、source snapshot owner 一致。
2. 验证 `effective_from`/`effective_to`、IANA timezone、币种/单位和条件 DSL schema version。
3. 将旧 active 版本标 `superseded`、写版本事件和 outbox；不更新已被 participation/task/entitlement/redemption 引用的版本。
4. 在提交前验证所有 mandatory child citation/condition（普通 CHECK 无法表达“至少一行”）。

规则状态变更不应直接重算已有事实。活动取消、来源撤回、规则换版和解释变更写 `RuleImpact`/`ActivityRuleImpact` 事件：记录 old/new version、affected aggregate id、impact type、review status 和 actor。受影响的未结束任务标 `needs_review`，历史 entry/reward/ledger 仍引用旧版本。

### 4.2 来源快照不可回写

`SourceReference` 是可更新目录；`SourceSnapshot` 是不可变访问/捕获内容。URL 同 hash 在不同访问日可有多个 snapshot，`capture_key` 只去重同一次操作。规则引用 snapshot 时，子表保存 `(source_snapshot_id,user_id)` 复合 FK，不能只保存 URL。源快照 actor 删除策略必须允许用户删除：主体可匿名化，不能用自引用 `ON DELETE RESTRICT` 阻断整个账户清理。

## 5. 事实、事件、投影与重放

### 5.1 统一事件信封和水位

所有 append-only 事实和跨模块事件使用同一 envelope：

```text
event_id, event_type, schema_version, aggregate_type, aggregate_id,
aggregate_version, source_sequence, occurred_at, actor, correlation_id,
causation_id, request_hash, business_key, owner_user_id, payload_hash
```

约束：`event_id` 全局唯一；`(aggregate_id,aggregate_version)` 和 `(aggregate_id,business_key)` 唯一；payload 受大小/顶层 `schema_version` 限制且不放可授权金额、owner 或敏感原文。Event `owner_user_id` 是审计快照，不替代复合 FK。

每个投影记录 `(projection_name, aggregate_id, source_sequence, rebuilt_at, status)`，单调水位不能后退；旧事件到达时只记录 late event，不覆盖新投影。重建时先获得 `rebuild_run_id` 和 snapshot watermark，在隔离表计算，校验 hash/恒等式后原子切换；不能边读边覆盖线上缓存。

Outbox 事实与业务写入同事务；publisher `FOR UPDATE SKIP LOCKED` 领取，inbox `(consumer_name,event_id)` 唯一。consumer 失败仅重试/死信，不回滚已经提交的业务事实。每个 outbox/inbox/backfill 行保存 `attempt_count`、`last_error_code`、`next_attempt_at` 和 `dead_lettered_at`，否则恢复后无法区分重复和失败。

### 5.2 各领域事实/投影恒等式

| 投影 | 唯一事实源 | 必须重建的恒等式/边界 |
| --- | --- | --- |
| Participation/reward | participation/reward events | 状态轴只沿合法 transition；每个 reward_key 仅一次 active sequence，已撤回仍保留 |
| Spend progress | SpendEntry + SpendMilestone | `progress = sum(qualified entries)`；posted/settled 先决条件；reversal 累计不超过原 entry |
| Benefit quota | entitlement ledger | `remaining = grants - consumes + restores - expires`；restore 必须精确引用既有 consume，不能过度恢复 |
| Points ledger | PointsEntry | `ledger_balance = sum(points_delta)`；账户 sequence 连续且 immutable；负数保留 |
| Lots | LotAllocation + lot origin | 每个 allocation 与 entry/lot/account 同 scope；allocation 和 remaining 不超过 origin，未分配差额单独投影 |
| Redemption | 四轴 events + ledger links + fulfillment lines | debit/refund links 只绑定对应 account/card；fulfilled/rejected quantities 不超过 request；refund 累计不超过 posted debit |
| Reminder | Reminder + DeliveryAttempt | `(target,version,type,trigger)` dedupe；lease token 过期不能覆盖新 worker；失败不改业务 aggregate |

### 5.3 读模型 stale 语义

Dashboard/read model 只读，不拥有业务状态。每个响应必须带 `as_of`、source sequence、`stale`/`rebuilding` 和差异状态；投影落后时显示处理中，不用默认 0、旧值伪装新鲜或写回来源。高影响命令（核销、积分 debit/refund、账户删除）返回所属聚合 committed 状态，跨模块更新允许最终一致但必须可追踪。

## 6. 活动与刷卡任务深化约束（P0）

### 6.1 Participation 和 reward

`activity_participations` 唯一键为 `(user_id,campaign_id,card_id,activity_instance_key)`；`activity_instance_key` 创建后冻结，周期/批次/重复活动必须新建实例。报名 deadline 以冻结 IANA timezone 计算，保存 UTC 执行时点、本地解释、submit/confirm/cancel 时间和 actor。回执使用 `receipt_masked` + provider-scoped `receipt_hash`，相同 hash 不能在同一 participation 生成两个 confirmed 结果；hash 不允许代替外部资格证明。

报名/资格/名额/结果和奖励各自 append-only event。活动取消或规则影响停止未来 SpendTask/Reminder，但不修改历史 participation、entry 或 reward。`target_reached` 只更新任务投影或发布“待核对”事件，不自动创建 PointsEntry、BenefitEntitlement 或 received reward。

建议索引：

- `activity_participations(user_id, enrollment_status, enrollment_deadline_at)`；
- `activity_participations(user_id, card_id, outcome_status, updated_at desc)`；
- `activity_rewards(user_id, status, expected_on)`；
- partial index：未结束 participation/reward 和需要核对的对象。

### 6.2 SpendMethodSnapshot、Entry 和 Milestone

任务激活时冻结 rule/method snapshot、`cutoff_basis`、window、timezone、currency、channel/merchant/MCC/region、附属卡/退款口径。`route_confirmation_status=unknown`、币种未知、商户范围未知时可保存计划但不能进入确定进度；每笔 `excluded/pending/disputed/unknown` 必须有 `reason_code`、`evidence_note`、`next_action`。

`input_mode=snapshot|entries` 激活后不可变；延迟约束或受控函数保证二者互斥。Entry 只保存 occurred 事实；posted/settled/rejected 是 Milestone。每个 entry 的 milestone sequence 在 task/entry 锁下分配，`settled` 无 `posted` 先决条件返回 409。occurred/posted/settled 的日期排序由数据库触发器验证，但未知日期不补默认值。

退款/冲正创建反向 entry，related entry 使用 `(user_id,task_id,card_id,id)` 复合 FK；部分退款需锁原 entry 并验证累计绝对值不超过原贡献。进度回退只发布 target-no-longer-reached/review 事件，不自动退分或撤回奖励。

## 7. 权益使用、周期和恢复（P1-a）

### 7.1 周期实例

`BenefitEntitlement` 业务唯一键是 `(user_id,benefit_id,period_instance_key)`，周期实例必须保存 `valid_from/to`、timezone、rule_version、grant_key 和 validity status。未知 `valid_to` 允许对象存在，但必须为 `unknown/needs_review` 并禁止自动 expire/reminder；不能用自然年默认补齐。上期 consume/restore 不得写入新周期，跨周期修正必须引用原 entitlement。

### 7.2 Usage event 与 credential version

Usage 主表是投影，事件表记录 planned/booked/rescheduled/cancelled/presented/redeemed/rejected/disputed/provider_changed/credential_rotated。每个 event 有 sequence、business_key、request_hash、actor、evidence snapshot；改期/取消/现场拒绝不改变 quota。凭证只保存 masked/hash/version/issued/expiry/rotation reason，新凭证追加版本，旧凭证过期但保留历史。

### 7.3 Quota ledger 和 restore 守恒

只有 `usage_model=consumable_quota` 的首次 redeemed/used 在锁定 entitlement 后追加 `consume`；重复命令命中 `(entitlement_id,usage_id,consume)` 唯一业务键。`restore` 必须引用一个既有 consume，且该 consume 未被全额 restore；部分恢复需明确 quantity，所有 restore 累计不得超过原 consume。并发核销要么只有一个成功，要么事实均保留并转 `needs_review`，不能截断余额。

`coverage_claim`、`fee_credit`、`service_record` 保存各自结果/金额，不写 quota ledger；estimate value 不参与已实现价值汇总。非次数权益的使用/恢复约束不能以次数 ledger 的 `consume` 替代。

## 8. 积分账户、批次和兑换深化（P1-b）

### 8.1 PointsAccount 和观察值

PointsAccount 保存 `scope_type/scope_key`、unit_code、points_scale、status、last sequence 和 card scope。官方余额观察为独立事实：`observed_balance`、`as_of`、source snapshot、freshness、timezone、parser/manual provenance。观察值不覆盖 ledger，不自动制造 earn lot；同一账户允许多个观察值，最新值由明确 as_of 选择而非 updated_at 猜测。

账户冻结/关闭不是删除：冻结阻止新的 debit/consume，但允许 correction/reconciliation；关闭后只读，外部已确认 debit/refund 可通过受控恢复流程追加并标 `needs_review`。账户 scope 一旦有 ledger 不允许变更。

### 8.2 Pending/confirmed、负余额和 lot allocation

PointsEntry 至少区分 `pending_earn`、`earn`、`adjustment`、`expire`、`redeem_debit`、`reversal`。confirmed projection 不包含 pending；`ledger_balance=sum(points_delta)` 可以为负。负余额显示真实值并冻结自动建议，不通过 `greatest(0)`、伪造 adjustment 或删除 entry 修复。

Lot 的 `expiry_status`、origin、usage restrictions、remaining 和 allocation watermark 必须可审计。`PointsLotAllocation` 绑定同 user/account/card scope；事务锁定 account -> lots -> ledger，检查 allocation 不超过 origin/remaining，ledger debit 的 allocation 不能超过 debit amount。正的 `unallocated_difference` 不自动造 lot，负差额不自动补 adjustment；未知 expiry 不生成 expire/reminder。P1 允许用户明确选择 lot 或保持未分配，自动 FIFO/跨用途分配属于 P2。

两个差额独立保存 `as_of` 和 source：

```text
reconciliation_difference = confirmed_balance - ledger_balance
unallocated_difference    = ledger_balance - lots_remaining_total
```

任一非零/未知时账户 `reconciliation_status != balanced`；调整只追加 reconciliation adjustment，并保留 adjustment 与 observation 的复合 link。

### 8.3 Redemption 四轴、现金和部分履约

Redemption 订单必须绑定 PointsAccount scope，保存 rule_version/source snapshot、required_points、actual_debit_points、cash_component_amount/currency、provider/order reference masked/hash、不可取消和资格/库存/上限核对结果。`required_points` 是订单规则事实，`actual_debit_points` 是外部扣分证据，两者可不同但差异必须 `needs_review`，不能静默改写 required。

订单、履约、debit、refund 四轴分别追加事件；部分履约使用 line/item facts：requested、fulfilled、rejected、cancelled quantity 与证据。数据库触发器保证每一行 fulfilled+rejected+cancelled 不超过 requested，root projection 只能从行事件重放。现金支付成功不代表积分 debit posted，履约失败/取消不自动退款。

Debit link 至少唯一 `(redemption_id,link_role=debit)`，绑定同账户/卡 PointsLedgerEntry；refund link 可以多次部分退款，但每次有 `refund_key`，累计退款不超过已 posted debit，且必须有外部退分证据。退款先于 debit、跨账户/跨卡、金额/单位不符、重复 key 异 hash 均拒绝并审计。余额不足时保持负数和 `needs_review`，不能回滚外部订单。

建议索引：`redemptions(user_id,account_id,created_at desc)`、`(user_id,order_status,fulfillment_status)`、`redemption_fulfillment_items(redemption_id,status)`、`points_entries(account_id,sequence)`、`points_lots(account_id,expiry_status,expires_on)`、debit/refund link partial unique。

## 9. 索引、约束和触发器清单

### 9.1 必须是 DDL 的约束

- 所有父子表 `unique(id,user_id)`；固定卡父表 `unique(id,user_id,card_id)`；子表使用复合 FK，默认 `ON DELETE RESTRICT`。
- `business_key`/`request_hash`/`client_request_key` 按聚合范围唯一；同 key 异 hash 通过命令函数返回 409，不能用 `ON CONFLICT DO NOTHING` 吞掉冲突。
- 金额/积分 `numeric` 精度、币种/单位代码表、非负输入（除允许负余额/反向 entry）、日期窗口和 sequence 正值由 CHECK/trigger 保障。
- 事实/事件/ledger/lot allocation/delivery attempt 撤销普通 UPDATE/DELETE；projection 更新保留 source sequence、rebuild run 和 audit。
- RuleVersion active 区间不重叠；activation 必须至少一个 primary citation；已引用版本/source snapshot 不可删除或更新。
- `snapshot/entries` 互斥、settled->posted、restore->consume、refund->posted debit、fulfillment quantity 守恒、fixed-card/merged-pool scope 需要 deferred trigger/受控函数。

### 9.2 索引和并发

- 高选择性列表：所有列表先 user/card/status/截止日期，再按 created/updated；partial indexes 只索引未结束/待处理状态，避免把历史事实拖入工作台查询。
- ledger/entry 使用 `(account_id,sequence)`、`(task_id,sequence)`、`(entitlement_id,sequence)`；event/outbox 使用 `(aggregate_id,aggregate_version)` 和 pending partial index。
- 维持固定锁顺序：根聚合 -> account/entitlement/task -> entry/lot allocation -> audit/outbox；跨模块不持锁调用另一个写端口。死锁必须有 retry + metric，不能随意换序。
- 大表新索引先 `CREATE INDEX CONCURRENTLY`，校验后再设约束；唯一索引创建前必须处理重复键，不用 `NOT VALID` 掩盖唯一冲突。

## 10. Expand/contract、backfill 与 rollback

### Stage 0：基线预检（P0 阻断）

1. 固定 PostgreSQL、扩展、角色、RPO/RTO、备份保留/删除等待期、lease/重试和 projection stale 阈值。
2. 检查旧年费跨 user/card/cycle 引用、重复周期、金额/币种/时区异常；导出计数、hash、审计摘要和 orphan report。
3. 为现有父表增加复合 unique index，再 `ADD CONSTRAINT ... NOT VALID` 并离峰 validate；孤儿先人工签收/修正，不能直接 cascade delete。
4. 在隔离库完成全量备份 + WAL/PITR 恢复，记录 migration/schema 版本和权限快照。

### Stage 1：横切基础设施

建立 ISO currency、IANA timezone 校验、SourceReference/Snapshot、Rule/RuleVersion/Citation、idempotency registry、outbox/inbox、projection checkpoint、audit schema 和 append-only functions。先加 RLS deny-by-default 和最小 role，但在 shadow 验证前不切新写。

### Stage 2：P0 活动和任务

建立 Campaign/Participation/Reward event、SpendTask/MethodSnapshot/Entry/Milestone、Reminder canonical。通过旧年费 adapter 回填可证明行，记录 `backfill_run_id`/legacy id；先 shadow replay 对比旧 read model，再开启 canonical 写。P0 只开放活动/单卡任务/奖励人工核对，保持 P1 表只读或 feature flag 关闭。

### Stage 3：P1-a 权益

建立 Benefit/Entitlement period、Usage event/credential、quota ledger 和投影。缺 usage model/validity/凭证证据进入 unknown，不猜周期；并发 redeem/restore、现场拒绝、删除恢复通过后再切换。

### Stage 4：P1-b 积分

建立 account scope、observation、PointsEntry sequence、Lot/Allocation 和 reconciliation。旧总余额只回填 observation + adjustment link，不造 earn lot；先回放两差额，再允许用户选择 lot。账户/lot 账本恒等式和负余额告警通过后再开启到期 reminder。

### Stage 5：P1-b 兑换

建立 Redemption 四轴、fulfillment items、cash fields、debit/refund links。先只读 shadow 旧订单，冻结旧 worker/写入口，逐单对账外部事实；debit/refund consumer 通过 inbox/业务键幂等后才开启。

### Stage 6：切换、观察和 contract

关闭旧写路径，等待完整观察窗口；监测旧 API 写调用、duplicate/conflict、outbox/inbox lag、projection mismatch、negative points、benefit overdraw、lease/dead-letter、RLS deny 和 backfill errors。回滚只能关 flag、停 consumer、切读路由或重放 canonical，不能恢复双写。事实表、业务键和 source evidence 不 contract 删除。

## 11. 旧年费 adapter 和投影重建

旧 `fee_cycles` 映射到 `SpendTask(task_type=annual_fee, legacy_source=fee_cycle)`，冻结 period/rule snapshot；`qualified` 只映射 `target_reached + qualification=unconfirmed`。旧 `progress_entries` 每行变为用户声称的 occurred contribution/correction，稳定 key 为 `legacy:progress_entry:{id}`；若 `updated_at` 覆盖了前值，不虚构编辑历史，标 `needs_review`。

adapter 每次运行拥有 `backfill_run_id`、source row hash、target aggregate id、mapping status、error code 和 created count。相同 source hash/legacy id 重放原映射；不同 hash 不覆盖目标，进入 conflict queue。旧 API 在 canonical 写开启后只读 projection，禁止双向修复。

投影重建采用隔离表/临时 schema：读取事实至固定 watermark，重建 task progress、quota、points balance/lot gap、redemption links、Reminder index，逐项校验后原子替换 projection version。重建失败保留旧 projection 并标 `rebuilding/failed`，不能把空表发布为零余额或零进度。

## 12. P0/P1/P2 数据边界和验收

### 12.1 P0

- 单用户、单卡、单活动周期 participation 独立唯一；同活动两卡/两周期不串进度、奖励和提醒。
- 规则版本 active 区间、primary citation、截止时区和报名 receipt 幂等约束通过；换版/取消不改历史。
- route unknown/排除原因不进入确定进度；snapshot/entries 互斥；settled 无 posted 被拒；refund/reversal 守恒。
- activity/reward/spend/reminder 事实、事件、outbox/inbox、projection watermarks 同事务或可追踪最终一致；重复/乱序/死信不双算。
- 跨 user/card/task 引用、旧 API 写入 canonical、缺 owner context、RLS 绕过和完整敏感值均拒绝并审计。

### 12.2 P1-a

- entitlement 周期实例唯一、valid_to unknown 不 expire；预约/改期/取消/拒绝/争议/credential rotate 不扣额度。
- 首次 redeemed 只产生一次 consume；restore 只能精确反向既有 consume，累计不超原扣减；并发超额可解释且不截断。
- 非次数权益不显示剩余次数；estimate 与 actual value 分离；删除/归档/恢复保留 usage 事实和凭证历史掩码。

### 12.3 P1-b

- pending 不进入 confirmed；confirmed/ledger/lots 两差额分开且带 as_of；负余额可见并进入 mismatch；账户 scope 不可变。
- allocation 与 ledger/lot/account 同 scope，金额不超过 origin，未知 expiry 不自动 expire/FIFO；从零重放得到相同 sequence/差额。
- redemption order/fulfillment/debit/refund 可独立乱序；现金、部分履约、合作方拒绝和不可取消均可追踪；部分 refund 累计不超 posted debit，跨账户/重复异 hash 拒绝。

### 12.4 P2（明确不在当前写模型）

系统内 points hold/reserve/release、自动 lot/FIFO、跨账户 transfer、跨卡联合活动自动归因、银行/账单 connector、自动报名/预约/兑换、库存同步和自动部分退款。任何 P2 功能必须新增双边守恒/状态机、授权撤销、限流、审计、恢复和隐私评审，不能把字段预留或 JSONB 当实现。

## 13. 运行、恢复和删除门槛

- Web 使用 `set local app.user_id`，worker 使用最小权限；所有新增表注册 export/cleanup handler。用户删除先撤销 session/lease、停止未来提醒，再按叶子到根清理，保留合规审计和重试/dead-letter。
- 观测至少包含 outbox/inbox lag、duplicate/conflict、projection watermark/stale、activity pending、spend reversal、benefit overdraw/restore conflict、points negative/two gaps、redemption debit/refund mismatch、Reminder lease/dead-letter、RLS deny 和 adapter conflict。
- 备份恢复在隔离库验证 migration/schema、owner/FK/RLS、事实计数/hash、任务/权益/积分/lot/兑换恒等式、Reminder 尝试与对象 hash。PITR 后重放恢复点之后已确认的外部 debit/refund/cancel，不能重新执行原业务键。
- 删除不能通过 `ON DELETE CASCADE` 静默删除 reward/ledger/usage/order/source evidence；只能在合规清理阶段按注册表执行，并检查备份回灌保护。

## 14. 明确阻断项与未决问题

### 14.1 发布阻断

1. 现有真实 schema/migration 没有新领域表、复合 FK、RLS、outbox/inbox、projection checkpoint 或 append-only functions。
2. PRD/架构早期章节仍列旧状态/API；Gate 0 前必须签收 canonical glossary 和兼容读映射，CI 禁止新写旧语义。
3. 金额/积分精度、ISO currency registry、IANA timezone validation、active interval inclusive/exclusive 策略和 event payload schema 尚未进入正式 DDL。
4. 固定卡/合并池、多卡活动 contribution、Redemption actual debit 与 required points 的差异、部分履约/部分退分尚无真实数据库约束和并发验证。
5. 旧 progress 可变且历史不完整；adapter 不能宣称无损回放，差异必须可见并进入 review queue。
6. RPO/RTO、backfill 保留期、projection stale 阈值、Reminder lease/dead-letter SLA、删除等待期和对象存储密钥恢复尚未由运维/安全/产品签收。

### 14.2 未决决策

- RuleVersion 生效日期是否统一半开区间；跨时区的 `effective_at` 和业务 date 如何同时展示。
- 报名回执/订单/预约/凭证 hash 的算法、provider scope、跨活动复用和掩码策略；哪些字段可以被用户导出。
- 多卡联合活动是否允许用户手动分配贡献；若允许，分配事实由哪个模块拥有、如何双边守恒。
- 积分 allocation 对用途限制、部分 debit/refund 和账户关闭后的外部结果如何建模；P1 是否只允许全额 refund link。
- Benefit restore 是否允许部分 restore、一次 consume 多次 reversal 的上限和 dispute 结案后谁可写。
- 统一 projection schema/checkpoint 是否独立表，还是各模块维护；rebuild 的原子切换和读模型缓存失效策略。

## 15. Handoff

- **Changed files**：仅新增 `docs/research/CARD-DOMAIN-ROUND9-DATA.md`。
- **Key decisions**：兼容投影与 canonical 写模型严格分层；ownership 需要 user/card/account/instance 复合约束和 fixed-card/merged-pool scope；RuleVersion 使用不可变版本、primary citation 和不重叠生效区间；事实/事件/投影统一 sequence/watermark/rebuild run；权益 restore、积分 lot allocation、兑换现金/部分履约/四轴退分均以跨表守恒触发器和幂等键实现；迁移按 baseline -> foundation -> P0 -> P1-a -> P1-b -> contract 分阶段推进。
- **Validation**：静态审查 `docs/PRD-WORKBENCH.md`、`docs/DATABASE-WORKBENCH.md`、`docs/ARCHITECTURE-WORKBENCH.md`、Round8 DBA 稿和当前 `db/schema`/migrations；创建本文后执行 `git diff --check -- docs/research/CARD-DOMAIN-ROUND9-DATA.md`。未执行真实 PostgreSQL、migration、RLS、并发、worker 或 PITR 演练。
- **Risks/open questions**：canonical 状态/API 仍有历史章节漂移；生效区间、精度、receipt/ref/hash、跨卡贡献、actual debit/partial refund、restore 上限、projection checkpoint 和运维 RPO/RTO 尚未冻结。
- **Ready for integration**：yes。主会话应先合并第 14 节阻断和未决决策，再进入 Gate 0；本文未修改正式文档、schema、迁移、代码或锁文件，未 commit/push。
