# Cardfolio 卡领域后续架构复核

| 项目 | 内容 |
| --- | --- |
| 文档版本 | v0.1 |
| 复核日期 | 2026-08-14 |
| 角色 | 领域架构师 |
| 基线 | `e756538008a4ba55b920d22a28d9dac352067a0c` + 当前 working tree |
| 范围 | 活动、消费任务、权益、积分、兑换的状态、命令/API、事件、分期与旧 MVP 兼容 |
| 交付性质 | 只读架构研究；不代表代码、迁移或工作台能力已经实现 |

## 1. 复核结论

当前 working tree 已把主要方向收敛为 P0 活动/单卡任务、P1-a 权益、P1-b 积分/兑换、P2 自动化。`ARCHITECTURE-WORKBENCH.md` 第 14.8--14.12 节也已补入活动名额轴，因此 `CARD-DOMAIN-ALIGNMENT-QA.md` 第 10.1 节关于“正式架构仍缺名额轴”的结论在当前基线上已经过期，不能继续作为现状描述。

仍有五类会造成状态漂移的实现前阻断项：

1. `SpendEntry` 的架构契约要求后续 `posted/settled` 以不可变 milestone 追加，但数据库草案仍把 `posted_on`、`settled_on` 和 `processing_status` 放在同一可变 entry 上。若直接照 DDL 实现，用户补录入账日会覆盖事实而不是追加事实。
2. 积分到期在架构第 14.12 节是“P1 只提醒，不自动写 expire entry”，数据库第 7.2 节却要求到期 worker 自动新增 `expire`。两种恢复与审计语义互不兼容。
3. `CARD-DOMAIN-ALIGNMENT-ARCHITECTURE.md` 第 6 节把 `unallocated_difference` 写成 `confirmed_balance - lots_remaining_total`，与 PRD、正式架构和数据库的 `ledger_balance - lots_remaining_total` 冲突；前者把“余额对账差额”和“批次分配差额”错误合并。
4. 兑换的 `status/order_status`、`ledger_status/debit_status/points_debit_status` 仍有命名漂移，且部分流程把订单 `success` 直接作为扣分请求条件。实物、票券、里程等场景中，订单受理、履约、扣分和退分并不同时发生。
5. 多个枚举把 `needs_review`、`disputed`、`expired`、`failed` 混入生命周期或数值进度，导致进入异常后丢失原业务状态。新写模型应保留原轴，并用独立 `review_status` 表达待核对/争议；旧值只在兼容投影中保留。

最终建议是：所有用户记录和外部结果采用 append-only 事实；每个正交轴由拥有聚合重放事实得到；跨轴的“可继续、可核对奖励”等结论只做读模型 gate，不保存成另一个可写总状态。当前产品代码和真实迁移仍只有年费 MVP，以下全部是实现前契约。

## 2. 统一写模型约束

### 2.1 事实、投影和提醒

| 类型 | 例子 | 写入规则 |
| --- | --- | --- |
| 业务事实 | 资格核对、报名结果、消费发生、入账 milestone、权益核销、积分流水、外部兑换结果 | 只追加；更正使用 correction/reversal 或新的结果事件，不覆盖历史 |
| 状态投影 | 当前报名状态、任务进度、权益剩余、积分余额、兑换积分处理状态 | 由事实按 sequence 重放；带 `as_of`、`last_sequence`、`stale` |
| 组合 gate | 活动是否可继续、是否可核对奖励、兑换是否需要退分核对 | 只读派生；不得反向改写组成它的状态轴 |
| 提醒 | 报名截止、任务截止、奖励核对、批次到期 | 只改变 Reminder；完成提醒不改变业务事实 |

所有聚合另有 `review_status = clear | needs_review | disputed`。`review_status` 不能覆盖生命周期、进度、订单或账本状态；解决争议时追加 resolution 事实并恢复为 `clear`，原争议仍在时间线中。

### 2.2 命令通用不变量

1. 所有写命令从会话取得 `user_id`，按 `(aggregate_id,user_id)` 锁根聚合，并验证所有父子 ID 的复合归属；不存在或越权统一返回 `404`。
2. 所有写命令要求 `Idempotency-Key`、规范化 request hash 和 `expected_version`。同键同 hash 返回首次响应；同键异 hash 返回 `409 IDEMPOTENCY_KEY_REUSED`；状态和版本冲突分别返回 `409 STATE_CONFLICT`、`409 VERSION_CONFLICT`。
3. 事实、状态投影、幂等结果、审计和 outbox 在一个本地事务提交。禁止持有本模块行锁时同步写另一个模块。
4. 跨模块消费者使用 `(consumer_name,event_id)` inbox 去重；业务效果另由稳定 `business_key` 去重。重复、乱序、重启和人工重放不能产生第二次扣减或恢复。
5. API 返回所属聚合已经提交的事实和投影，不把异步 `pending` 返回为“成功完成”。金额用十进制定点，积分按计划最小单位；时点为 UTC，业务窗口冻结 IANA 时区和 inclusive date 边界。
6. `unknown` 是合法业务值。缺来源、外部结果或规则口径时返回待核对原因，不以默认值升级为资格、到账、可用、已扣分或已退分。

### 2.3 事件信封

事件统一包含 `event_id`、`event_type`、`schema_version`、`aggregate_type`、`aggregate_id`、`aggregate_version`、`owner_user_id`、`occurred_at`、`actor`、`correlation_id`、`causation_id`、`idempotency_key`、`source_snapshot_id` 和最小化 payload。事件名描述已经发生的事实，不使用含糊的 `Completed`、`Success` 或 `Qualified`。

## 3. 活动：资格、报名、名额、进度、奖励

### 3.1 规范化状态表

| 所有者/轴 | canonical 状态与转换 | 关键约束 |
| --- | --- | --- |
| `Campaign.lifecycle_status` | `draft -> published -> ended`；`draft/published -> cancelled` | `ended/cancelled` 只停止新参与，不推导个人失败 |
| `ActivityParticipation.eligibility_status` | `unknown -> potentially_eligible -> user_confirmed_eligible | user_confirmed_ineligible` | `potentially_eligible` 不是个人资格确认 |
| `ActivityParticipation.enrollment_status` | `not_required`，或 `not_started -> submitted -> confirmed | rejected | expired | cancelled | unknown` | `submitted` 只表示用户记录了外部提交；`confirmed` 必须有核对证据和时间 |
| `ActivityParticipation.quota_status` | `not_applicable`，或 `unknown -> available | full | waitlisted | allocated | not_allocated` | `available` 不等于 `allocated`；不得由资格或报名推断名额 |
| `SpendTask.lifecycle_status` | `draft -> active -> ended`；`draft/active -> cancelled` | 截止只结束写入窗口，不把数值进度写成失败 |
| `SpendTask.progress_status` | `not_started <-> in_progress <-> provisionally_qualified <-> target_reached`；结束时可派生 `shortfall` | 进度可因退款回退；`failed/expired/disputed/needs_review` 不再作为新写入进度值 |
| `SpendTask.qualification_status` | `unconfirmed -> user_confirmed | rejected` | 用户核对结果独立于本地 `target_reached`；争议走 `review_status` |
| `ActivityReward.status` | `unknown | not_expected | expected_pending`；`expected_pending -> delayed | received`；`delayed -> received`；`received -> reversed` | 每个 `reward_key` 独立；争议走 `review_status`，奖励状态不回写任务 |

`ActivityParticipation.outcome_status` 不作为第六条写轴。兼容读层可以从单卡 SpendTask 的 progress/qualification 派生它，但新命令、DDL 和事件不得直接写 `outcome_status`。若一个 participation 未来关联多个任务，组合规则必须冻结在 RuleVersion 中，不能用“任一任务更新最后写赢”的方式维护 outcome。

活动最终 gate 只做读模型计算：

```text
can_confirm_activity_result =
  eligibility_status == user_confirmed_eligible
  and enrollment_status in (not_required, confirmed)
  and quota_status in (not_applicable, allocated)
  and spend_task.progress_status == target_reached

reward_may_be_expected =
  can_confirm_activity_result
  and spend_task.qualification_status == user_confirmed
  and reward rule exists
```

任一条件未知时列出具体阻断轴；不得写一个 `qualified=true` 反向推进五轴。

### 3.2 命令/API 与事件

| 命令 | P0 HTTP 入口 | 事件 |
| --- | --- | --- |
| `CreateActivityParticipation` | `POST /api/v1/campaigns/{campaignId}/participations` | `ActivityParticipationCreated.v1` |
| `RecordEligibilityResult` | `POST /api/v1/activity-participations/{id}/eligibility` | `ActivityEligibilityResultRecorded.v1` |
| `RecordEnrollmentResult` | `POST /api/v1/activity-participations/{id}/enrollment` | `ActivityEnrollmentResultRecorded.v1` |
| `RecordQuotaResult` | `POST /api/v1/activity-participations/{id}/quota` | `ActivityQuotaResultRecorded.v1` |
| `CreateSpendTask` | `POST /api/v1/cards/{cardId}/spend-tasks` | `SpendTaskCreated.v1` |
| `RecordTaskQualificationResult` | `POST /api/v1/spend-tasks/{id}/qualification` | `SpendTaskQualificationResultRecorded.v1` |
| `CreateActivityReward` | `POST /api/v1/activity-participations/{id}/rewards` | `ActivityRewardCreated.v1` |
| `RecordRewardResult` | `POST /api/v1/activity-rewards/{id}/result` | `ActivityRewardResultRecorded.v1` |

命令名都使用 `Record`，明确 Cardfolio 只记录用户在官方渠道完成的动作。不得提供语义为代报名、代领取或自动发奖的 `enroll/claim/reward` 写接口。活动事件不能直接创建 BenefitEntitlement、PointsEntry 或 Redemption；P0 最多创建提醒或建议。

## 4. 消费：发生、入账、清算与进度

### 4.1 规范事实与投影

`SpendEntry` 保存不可变的发生事实：任务、类型、金额/次数、币种、`occurred_on`、冻结的 SpendMethodSnapshot、来源和 business key。后续状态由独立 `SpendMilestone` 追加：

| 事实/投影 | canonical 值 | 约束 |
| --- | --- | --- |
| `SpendEntry.entry_type` | `contribution | refund | correction | reversal` | refund/correction/reversal 带原因；reversal 必须精确引用原 entry |
| `SpendMilestone.kind` | `posted | settled | rejected` | 同 entry、kind、业务引用唯一；`settled` 要求已有 `posted`；`rejected` 不能与 posted/settled 共存 |
| `SpendEntry.qualification_status` 投影 | `unknown | pending | included | excluded` | 由规则快照与用户证据事件重放；争议走 review 轴 |
| `processing_status` 兼容投影 | `occurred_only | posted | settled | rejected | reversed` | 只读派生，API/SQL 不直接写 |

日期必须满足 `occurred_on <= posted_on <= settled_on`。`cutoff_basis=occurred|posted|settled` 决定确定进度所需的事实；缺 required milestone 或资格不是 `included` 时只能进入 pending/预计进度。退款和 reversal 以带符号的新 entry 参与相同重放，不修改原记录。

`snapshot` 与 `entries` 是任务级互斥模式。snapshot 每次记录 observed total，并生成与前一投影之差的 correction；entries 逐笔追加。任何 API 都不接受客户端提交 `confirmed_*`、`remaining_*` 或 `progress_status`。

### 4.2 命令/API、事件与事务边界

| 命令 | P0 HTTP 入口 | 事件 |
| --- | --- | --- |
| `RecordSpendOccurred` | `POST /api/v1/spend-tasks/{id}/entries` | `SpendOccurredRecorded.v1` |
| `RecordSpendMilestone` | `POST /api/v1/spend-entries/{id}/milestones` | `SpendPostedRecorded.v1`、`SpendSettledRecorded.v1` 或 `SpendRejectedRecorded.v1` |
| `ReverseSpendEntry` | `POST /api/v1/spend-entries/{id}/reversals` | `SpendEntryReversed.v1` |
| `RecordSpendQualification` | `POST /api/v1/spend-entries/{id}/qualification` | `SpendQualificationRecorded.v1` |

命令先锁 SpendTask，再锁目标 entry，分配聚合内 sequence，追加事实并重算预计/确定进度。投影变化发布 `SpendTaskProgressRecomputed.v1`；若退款影响已用户确认的任务，额外发布 `SpendTaskQualificationReviewRequired.v1`，但不能自动撤回 ActivityReward。

数据库实现必须新增 milestone/event 表或等价 append-only 结构。把 `posted_on/settled_on/processing_status` 留在 entry 上作为缓存可以接受，但普通业务角色不得直接 UPDATE，它们只能由 milestone 重放刷新。

## 5. 权益：下发、预约、出示、核销

### 5.1 规范化状态表

| 所有者/轴 | canonical 状态与转换 | 关键约束 |
| --- | --- | --- |
| `BenefitEntitlement.delivery_status` | `pending_delivery -> available | delivery_failed`；`available <-> suspended`；`available/suspended -> expired | revoked`；可为 `unknown` | 下发状态不包含额度是否用尽；争议走 review 轴 |
| `BenefitEntitlement.quota_status` | `not_applicable | available -> partially_used -> exhausted` | 仅 `consumable_quota` 使用；从额度 ledger 派生，不能直接写 |
| `BenefitUsage.reservation_status` | `not_required`，或 `not_booked -> requested -> confirmed | rejected | cancelled | unknown`；`confirmed -> cancelled` | 预约确认不表示已出示或核销 |
| `BenefitUsage.redemption_status` | `not_presented -> presented -> redeemed | rejected`；可为 `unknown` | 只有首次 `redeemed` 扣额度；争议独立记录，不覆盖现场结果 |

`BenefitUsage.status=planned/booked/used/...` 仅为旧读模型映射，禁止新 API 直接写。映射必须由两轴确定；无法无损映射时返回 `unknown + needs_review`，不能用最后写入值覆盖另一轴。

额度账本只使用 `grant | adjustment | consume | restore | expire`。业务键分别为 `entitlement:{id}:grant:{grant_key}`、`usage:{id}:consume`、`usage:{id}:restore`。预约、取消、拒绝、出示和争议均不产生 consume；restore 要引用原 consume，且同一 consume 只能有一条有效 restore。负剩余保留原值并进入 review，禁止截断为零。

### 5.2 命令/API 与事件

| 命令 | P1-a HTTP 入口 | 事件 |
| --- | --- | --- |
| `RecordBenefitDelivery` | `POST /api/v1/benefits/{id}/entitlements` | `BenefitDeliveryResultRecorded.v1` |
| `CreateBenefitUsage` | `POST /api/v1/benefit-entitlements/{id}/usages` | `BenefitUsageCreated.v1` |
| `RecordBenefitReservation` | `POST /api/v1/benefit-usages/{id}/reservation` | `BenefitReservationResultRecorded.v1` |
| `RecordBenefitPresentation` | `POST /api/v1/benefit-usages/{id}/presentation` | `BenefitPresentationResultRecorded.v1` |
| `ConfirmBenefitRedemption` | `POST /api/v1/benefit-usages/{id}/redemption` | `BenefitRedeemed.v1`，同事务追加 consume |
| `RestoreBenefitUsage` | `POST /api/v1/benefit-usages/{id}/restore` | `BenefitUsageRestored.v1` |

Entitlement 是额度聚合根；核销命令锁 Entitlement 和 Usage，在同一事务校验单位、剩余量、首次核销、写 consume、刷新投影、审计和 outbox。`coverage_claim`、`fee_credit`、`service_record` 不复用次数型 consume 状态机。

## 6. 积分：账本、批次与对账

### 6.1 唯一公式与状态轴

```text
ledger_balance             = sum(PointsEntry.points_delta)
confirmed_balance          = latest user observation, if any
reconciliation_difference  = confirmed_balance - ledger_balance
lot_remaining_total        = sum(active PointsLotAllocation.allocated_delta)
unallocated_difference     = ledger_balance - lot_remaining_total
```

`reconciliation_difference` 回答“用户看到的官方余额与本地账本是否一致”；`unallocated_difference` 回答“本地账本中多少积分尚未归入已知批次”。两者不能合并，也不能用 confirmed balance 计算 lot 差额。

| 所有者/轴 | canonical 状态 | 规则 |
| --- | --- | --- |
| `PointsAccount.lifecycle_status` | `active | frozen | closed` | review/archived 不混入生命周期；closed 保留历史 |
| `balance_reconciliation_status` | `unobserved | balanced | mismatch` | 从 observation 与 ledger 派生；不因 lot 差额改变 |
| `lot_allocation_status` | `unknown | balanced | unallocated | overallocated` | 由 `unallocated_difference` 的未知/零/正/负派生 |
| `PointsLot.status` | `open | partially_used | used | expired | void` | `disputed` 走 review；只有已确认 expire 事实后才投影 `expired` |
| `PointsLot.expiry_urgency` | `unknown | future | due_soon | past_due` | 只读日期投影；`past_due` 不等于银行积分已经从余额扣除 |

PointsEntry canonical 类型为 `earn | adjustment | expire | redeem_debit | reversal`；`transfer` 留 P2 双边账本。所有流水带账户内单调 sequence 和唯一 `(account_id,business_key)`，普通角色无 UPDATE/DELETE。lot allocation 也是不可变事实；一条流水可以拆分到多个 lot，正差保留为未分配，负差进入 review 并停止新的自动建议。

### 6.2 对账和到期命令语义

用户观察余额与调整账本必须是两个显式效果：

1. `ObservePointsBalance` 保存 observation、来源和 `balance_as_of`，不改账本。
2. 用户选择“按观察值调整”后，`PostReconciliationAdjustment` 以差额追加 adjustment；也可不调整并保留 mismatch。

允许 UI 将两步放在同一确认界面，但请求必须显式 `post_adjustment=true` 并返回 observation 与 adjustment 两个结果，不能把任意余额输入静默转换成流水。

P1-b 到期 worker 只生成 Reminder。`RecordPointsExpiration` 必须由用户基于明确到期规则确认，才写 `expire` entry 和对应负 allocation；P2 若要自动记过期，需新的授权、可撤销策略、规则确定性和重放测试。

### 6.3 命令/API 与事件

| 命令 | P1-b HTTP 入口 | 事件 |
| --- | --- | --- |
| `ObservePointsBalance` | `POST /api/v1/points-accounts/{id}/observations` | `PointsBalanceObserved.v1` |
| `PostReconciliationAdjustment` | `POST /api/v1/points-accounts/{id}/adjustments` | `PointsLedgerEntryPosted.v1` |
| `RecordPointsEntry` | `POST /api/v1/points-accounts/{id}/entries` | `PointsLedgerEntryPosted.v1` |
| `CreatePointsLot` | `POST /api/v1/points-accounts/{id}/lots` | `PointsLotCreated.v1` |
| `AllocatePointsLot` | `POST /api/v1/points-entries/{id}/lot-allocations` | `PointsLotAllocationRecorded.v1` |
| `RecordPointsExpiration` | `POST /api/v1/points-lots/{id}/expiration` | `PointsExpirationRecorded.v1` |

账户命令锁 PointsAccount，分配 sequence，再写 ledger/allocation、缓存、审计和 outbox。来源于兑换的 debit/refund 只能由 points-ledger 模块执行，并使用 `redemption:{id}:debit`、`redemption:{id}:refund` 业务键。

## 7. 兑换：订单、履约、扣分与退分

### 7.1 三条正交轴

当前两轴模型仍把订单受理和履约塞进 `order_status=processing/success`。P1-b 应冻结为三轴：

| 轴 | canonical 状态与转换 | 含义 |
| --- | --- | --- |
| `Redemption.order_status` | `planned -> submitted -> accepted | rejected | cancelled | unknown` | 用户记录外部订单是否被受理；Cardfolio 不提交订单 |
| `Redemption.fulfillment_status` | `not_started -> processing -> fulfilled | failed | cancelled | unknown` | 实物送达、票券到账、里程到账等外部履约；争议走 review 轴 |
| `Redemption.points_debit_status` | `not_debited -> pending_debit -> posted`；`posted -> pending_refund -> refunded`；任一步可进入 `needs_review` | 本地账本处理结果；`pending_debit` 不是 reservation/hold |

三个轴没有自动相等关系。订单 `accepted` 不等于履约 `fulfilled`，也不等于积分 `posted`；履约失败/取消不证明积分已退；外部订单退款不证明积分已经回到账户。真实外部结果与本地账本不一致时保留所有事实并进入 review，允许真实负账面余额。

### 7.2 命令/API 与事件

| 命令 | P1-b HTTP 入口 | 事件/后续效果 |
| --- | --- | --- |
| `CreateRedemptionRecord` | `POST /api/v1/redemptions` | `RedemptionRecordCreated.v1`；不占用积分 |
| `RecordRedemptionOrderResult` | `POST /api/v1/redemptions/{id}/order-result` | `RedemptionOrderResultRecorded.v1`；不自动扣分 |
| `RecordRedemptionFulfillment` | `POST /api/v1/redemptions/{id}/fulfillment` | `RedemptionFulfillmentRecorded.v1`；不自动扣分/退分 |
| `ConfirmPointsDebitObserved` | `POST /api/v1/redemptions/{id}/points-debit` | `RedemptionPointsDebitRequested.v1`；points consumer 幂等写 debit |
| `RecordExternalRefund` | `POST /api/v1/redemptions/{id}/refund-result` | `RedemptionRefundResultRecorded.v1`；只改变外部事实 |
| `ConfirmPointsRefundObserved` | `POST /api/v1/redemptions/{id}/points-refund` | `RedemptionPointsRefundRequested.v1`；仅原 posted debit 可写 reversal |

points consumer 成功后发布 `RedemptionPointsDebitPosted.v1` 或 `RedemptionPointsRefundPosted.v1`；失败发布 `RedemptionPointsPostingReviewRequired.v1`。Redemption 模块不得直接 UPDATE PointsEntry。请求扣分必须包含用户核对时点、官方渠道证据、积分数量和账户；请求退分必须引用已 posted debit，整单 reversal 与原 debit 精确反向。部分兑换退款、现金退款、重新发货和积分新有效期均未被当前模型完整覆盖，留作单独决策。

## 8. P0/P1/P2 边界

| 阶段 | 允许交付 | 明确排除 |
| --- | --- | --- |
| P0 | SourceSnapshot/RuleVersion；多卡活动规则；每卡独立 participation、名额和 ActivityReward；单卡 SpendTask；手工 occurred/posted/settled milestone；退款/冲正；用户核对任务/奖励；站内提醒 | 权益额度、积分、兑换写入口；跨卡合并；自动资格、报名、奖励、MCC 判断或交易导入 |
| P1-a | Benefit/Entitlement；预约、出示、核销、拒绝/争议；consumable quota 的 grant/consume/restore；站内到期提醒 | 自动预约、附件作为业务事实、保险理赔自动判断、活动达标自动下发 |
| P1-b | PointsAccount、observation、append-only ledger、lot/allocation、双差额；外部手工兑换的订单/履约/积分三轴；用户确认扣分/退分；站内提醒 | 自动 expire 记账、自动 lot 分配、系统内 hold/reservation、外部下单、部分退款 |
| P2 | 受控导入确认、自动 lot 建议/分配、系统内 hold/release、动态抓取、连接器和外部通知 | 未经单独授权、安全评审、限流、撤销与恢复验证的任何自动化 |

每个阶段都必须以真实迁移、API、领域/数据库/权限测试和 feature flag 为准。文档出现字段或原型不构成已实现；当前可部署范围仍仅为年费 MVP。

## 9. 旧年费 MVP 兼容迁移

### 9.1 Expand

1. 先新增幂等命令、outbox/inbox、source/rule、SpendTask、SpendEntry、SpendMilestone 和通用 Reminder 结构；不修改或删除 `fee_cycles`、`progress_entries`、`fee_events`、现有 `reminders` 及旧 API。
2. 为旧 API 建 compatibility adapter，保持响应字段、错误码和年费用户流程。新工作台路由默认关闭，P1-a/P1-b 分别使用独立 feature flag。
3. 新事实表使用确定性 legacy business key，例如 `legacy-progress:{progress_entry_id}`；这只保证迁移重放幂等，不声称旧请求原本具有幂等键。

### 9.2 Backfill 与语义保真

| 旧数据 | 新模型 | 迁移规则 |
| --- | --- | --- |
| `fee_cycle` | `SpendTask(task_type=annual_fee)` | 冻结原周期、目标、币种和用户时区；保留 `legacy_fee_cycle_id` |
| 正向 `progress_entries.manual` | `SpendEntry.contribution` | `occurred_on=entry_date`、`provenance=legacy_mvp`；不得补造 posted/settled milestone |
| `correction/reversal` | 同类型关联事实 | 能确定原记录时建立引用；不能确定时保留 note/source 并置 review |
| 旧累计值 | snapshot observation + correction | 保存 observed total 和迁移前投影，验证差额后追加；不与 entries 重复相加 |
| 年费/进度提醒 | 通用 Reminder | 保留原 ID 映射、状态和时间；dedupe key 包含旧对象 ID、节点和周期 |

旧年费进度按发生日累计的行为可通过 `cutoff_basis=occurred` 的 legacy 规则快照保持，但不得把它解释为银行入账或清算证据。任何无法确认币种、关联 entry、原时区或来源的记录保留原值并标 `needs_review`，不能为了通过 parity 而伪造事实。

### 9.3 Verify、Switch 与 Contract

1. 在影子读模型逐用户、逐周期比较旧/新 count、amount、remaining、状态和提醒；对负值、累计 correction、reversal、闰日和跨时区样本单独对账。
2. 切换前保持单一事实写源。先让旧命令写旧表并增量回放到 shadow；切换后旧 API 调用新 command，由兼容层返回旧响应。不要长期双写两个可独立失败的事实表。
3. 按用户/批次灰度新读路径，监控 parity、幂等冲突、outbox lag 和 review 数。异常时只回退读路径、关闭新命令/consumer，不删除已经提交的新事实。
4. 至少一个稳定观察期和一次备份恢复演练后，旧表才可变只读；删除旧表、旧状态或兼容字段属于后续独立 contract 迁移，不与 P0 发布同批执行。

## 10. 漂移防护与验收不变量

1. 对每条状态轴执行表驱动的合法/非法转换测试；任何一轴变化都断言其他轴保持不变。
2. 从零重放 activity、spend、benefit、points、redemption 事实必须得到与缓存相同的版本、余额、剩余量和状态。
3. 重复 HTTP、重复 outbox、乱序事件和 worker 重启最多产生一次业务效果；旧 sequence 不覆盖新投影。
4. `occurred` 不产生 posted/settled；预约/出示不产生 consume；订单 accepted/fulfilled 不产生 debit；失败/取消不产生 refund reversal。
5. `ledger_balance = sum(entries)`、`unallocated_difference = ledger_balance - lot_remaining_total` 在 earn、adjustment、expire、redeem_debit、reversal 和多 lot 分配后始终成立。
6. 活动五轴任一未知/阻断值都不能输出“已确认达标”；reward received 不写积分，除非 P1-b 中用户另行记录积分入账事实。
7. 跨用户和同用户跨卡不兼容引用在 API、复合 FK/RLS 和 worker port 三层失败；错误不泄露资源存在性。
8. `git`/文档静态检查不能替代真实 PostgreSQL 并发、迁移 parity、恢复、API contract 和 E2E 证据。

## 11. 已冻结建议与未决决策

### 11.1 建议立即冻结

1. `ActivityParticipation.outcome_status`、`BenefitUsage.status`、`SpendEntry.processing_status` 均降为只读兼容投影，不进入新写 API。
2. Spend posted/settled/rejected 采用 append-only milestone；P1-b 积分到期只提醒，用户确认后才写 expire。
3. 两个积分差额和两个对账状态分开；修正 `CARD-DOMAIN-ALIGNMENT-ARCHITECTURE.md` 第 6 节的错误公式时，以本稿第 6.1 节为准。
4. 兑换采用订单、履约、积分处理三轴；扣分/退分分别由显式用户确认触发，不由 order/fulfillment 状态自动触发。
5. P0/P1 不使用 reservation/hold，不代用户报名、预约、支付、兑换或联系银行。

### 11.2 仍需产品、DBA、QA 共同签收

1. 是否在真实 DDL 中立即拆出通用 `review_status`，还是首版保留旧 `needs_review/disputed` 枚举并同时保存 `previous_status`；推荐立即拆轴，避免不可逆信息损失。
2. 兑换不同 `fulfillment_type`（实物、票券、里程、账单抵扣）的最小必填时间和终态；未签收前只允许 `unknown`，不生成统一“已到账”文案。
3. balance observation 后的 adjustment 是单独确认还是同屏显式原子命令；无论选择哪种，都必须保留 observation，并禁止隐式 PATCH balance。
4. P1-b 是否允许整单以外的部分退分。当前 ledger link 和“一条 reversal 精确反向”只能支持整单；部分退分必须有 refund component/business key 和累计上限。
5. 已 `confirmed` 的报名能否记录用户主动取消，以及取消后能否重新提交；推荐保留历史 attempt，并由新 attempt 产生新 enrollment fact，而不是把 confirmed 原地改写。
6. 同一 participation 多 SpendTask 的组合语义，以及无需消费任务的活动如何确认结果；未冻结前 P0 限制为零或一个单卡 SpendTask。
7. lot `expires_on` 已有官方规则时，何时允许从 P1 手工确认升级到 P2 自动 expire；必须先定义时区、宽限期、撤销和规则版本变化处理。

## 12. 交接

- **Changed files**: 仅 `docs/research/CARD-DOMAIN-FOLLOWUP-ARCHITECTURE.md`。
- **Decisions**: 五轴活动 gate；append-only spend milestone；权益预约/出示/核销分离；积分双差额/双对账状态；兑换订单/履约/积分三轴；P0/P1-a/P1-b/P2 边界；旧年费 MVP expand/verify/switch/contract 迁移。
- **Validation**: 本稿完成后运行 `git diff --check` 和目标文件范围检查；不运行应用、数据库、迁移或 E2E 测试，因为本任务只允许研究文档写入。
- **Risks/open questions**: 见第 11.2 节；真实 DDL、API、事件目录、迁移 parity、RLS、并发和恢复尚未实现或验证。
- **Ready for integration**: yes。主会话应先冻结第 11 节决策，再串行修改正式 PRD/架构/DB/安全/QA/UX 契约；不得把本研究稿描述为已经部署的工作台能力。
