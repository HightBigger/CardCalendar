# Cardfolio 卡领域第六轮架构契约复核

| 项目 | 内容 |
| --- | --- |
| 文档版本 | v0.1 |
| 角色 | 领域架构师 |
| 复核日期 | 2026-08-14 |
| 复核基线 | `main@e756538008a4ba55b920d22a28d9dac352067a0c` + 当前 working tree |
| 输入 | `ARCHITECTURE-WORKBENCH.md`、`PRD-WORKBENCH.md`、`DATABASE-WORKBENCH.md`、`CARD-DOMAIN-ALIGNMENT-ARCHITECTURE.md`、`CARD-DOMAIN-FOLLOWUP-ARCHITECTURE.md` 及同轮产品/DBA/QA 研究稿 |
| 交付性质 | 实现前架构研究；不代表代码、迁移、API 或工作台能力已经实现 |
| 允许变更 | 仅本文件；不修改正式架构、PRD、DB、代码、迁移、锁文件或协调 ledger |

## 1. 输入、证据与边界

### 1.1 本轮检查的问题

本轮不是重新设计产品，而是把已有产品需求和架构研究稿收敛成一份可以交给产品、DBA、QA 实施和验收的 canonical contract，重点检查：

1. 活动五轴是否仍然正交，奖励是否是独立的多组件事实。
2. `SpendTask` 是否能同时表达刷卡方式、任务周期、发生/入账/清算 milestone，以及预计和确定进度。
3. 权益是否有清晰的 usage model、预约/出示/核销状态轴和不可变 usage ledger。
4. 积分是否严格区分确认余额、账本、lot 及两个有符号差额。
5. 兑换是否不会把订单履约、积分扣减和退分证据混成一个 `status`。
6. 同一用户跨卡、跨账户，以及不同用户之间的所有权是否由 API、领域 port 和数据库共同约束。
7. 旧年费 MVP 能否在不伪造入账/清算证据的前提下被 adapter 兼容。

### 1.2 已有证据可以证明什么

- 现有正式架构和 PRD 已明确“模块化单体 + PostgreSQL + outbox/inbox”、事实与投影分离、来源/规则版本、手工优先和 P0/P1-a/P1-b/P2 分期。
- 对齐稿已明确活动实例按 `(owner_user_id, campaign_id, card_id)` 隔离，活动资格、报名、名额、任务进度、奖励五轴正交。
- 后续架构稿已提出 Spend milestone、积分双差额、权益 usage 与兑换多轴的方向，并指出旧稿的枚举和 DDL 漂移。
- 当前代码和数据库仍是年费 MVP；能运行的年费事实不能证明活动、权益、积分或兑换领域已经存在。

### 1.3 本文件不能替代的证据

本文件不证明真实 PostgreSQL 约束、RLS、迁移回滚、并发锁、outbox/inbox worker、API 权限、Playwright、备份恢复或银行来源核对已经通过。任何字段、状态、示例 URL 或效果图都只是实现输入；没有迁移、测试和发布 Gate 证据，不得对外宣称对应能力可用。

## 2. 复核结论与决策

### 2.1 结论先行

Cardfolio 应继续采用模块化单体。业务事实由所属聚合追加，投影由事实重放；跨模块只通过稳定 ID、拥有方 port 和版本化领域事件协作。`CardProfile` 只拥有卡片档案与生命周期，不能成为活动、权益、任务、积分或兑换的“大聚合”。

本轮冻结以下规则：

1. 活动使用资格、报名、名额、任务进度、奖励五条写轴；奖励拆成可独立核对的 `reward_component`，不能用一个 `qualified` 或 `reward_received` 覆盖。
2. `SpendEntry` 只保存发生事实；`posted`、`settled`、`rejected` 是独立 append-only `SpendMilestone`。entry 上的兼容日期/状态只能由重放刷新。
3. 任务级 `input_mode` 为 `snapshot` 或 `entries`，二者互斥。`cutoff_basis` 决定哪一条 milestone 可以进入确定进度；缺 milestone 的记录只能进入预计/待核对进度。
4. 权益使用必须有明确的 `usage_model`。`consumable_quota` 才能使用 grant/consume/restore/expire ledger；预约、出示、拒绝、争议不扣额度。
5. 积分的两个差额固定为 `confirmed_balance - ledger_balance` 与 `ledger_balance - lot_remaining_total`，不得使用确认余额计算批次差额，也不得把差额自动变成 lot 或 adjustment。
6. 兑换展示可以把外部订单和履约归为“订单进展”，但写模型必须保留 `order_status`、`fulfillment_status`、`points_debit_status` 和 `refund_status` 的独立事实。`success`、`fulfilled`、`posted`、`refunded` 不互相推导。
7. 所有状态轴另有 `review_status = clear | needs_review | disputed`。待核对和争议不得覆盖生命周期、进度、履约或账本轴。
8. P0/P1 不提供自动报名、自动预约、自动兑换、自动 lot 分配、系统积分 hold 或直接导入写入；这些能力必须进入 P2 单独评审。

### 2.2 聚合和所有权

| 聚合 | canonical 所有者 | 关键实体/事实 | 不能写入 |
| --- | --- | --- | --- |
| `CardProfile` | `card-profile` | 卡片档案、生命周期、脱敏标识 | 活动报名、任务金额、权益余额、积分或兑换 |
| `Campaign` / `ActivityParticipation` / `ActivityReward` | `campaign-activity` | 规则版本；每卡/每周期 participation；多组件 reward | SpendEntry、BenefitUsage、PointsEntry |
| `SpendTask` / `SpendEntry` / `SpendMilestone` | `spend-task` | 单卡任务、刷卡方式快照、发生事实、入账/清算 milestone | 银行证明、积分扣减、奖励到账 |
| `BenefitEntitlement` / `BenefitUsage` / `BenefitUsageLedgerEntry` | `benefit-entitlement` | 下发实例、使用事实、额度流水 | 活动达标自动下发、积分流水 |
| `PointsAccount` / `PointsEntry` / `PointsLot` / `LotAllocation` | `points-ledger` | 账户观察、append-only 账本、批次及分配 | 客户端 PATCH 余额、自动造 lot、兑换履约 |
| `Redemption` | `redemption` | 外部订单/履约/退货事实、扣分请求 | 直接写 PointsEntry |
| `SourceSnapshot` / `RuleVersion` | `source-rule` | 原始来源快照、用户核对、规则生效区间 | 抓取成功即确认规则 |
| `Reminder` | `notification` | 节点、冻结时区、投递和去重 | 推导或修改业务状态 |
| `WorkbenchReadModel` | `dashboard` | 带 `as_of`、`last_sequence`、`stale` 的只读组合 | 任一事实表写入 |

### 2.3 所有权规则

每个根聚合和子事实都携带 `owner_user_id`。固定单卡的实体还携带 `card_id`，并通过 `(id, owner_user_id, card_id)` 复合引用验证父子一致性。活动参与实例的身份是 `(owner_user_id, campaign_id, card_id, activity_instance_key)`；非周期活动使用稳定的 `single` key，周期活动必须为每个规则版本/周期生成新 key，不能按标题或卡片合并。积分账户 `card_id` 可空表示同银行合并池，但这不是跨用户共享，也不允许把单卡任务的消费自动合并到池账户。跨卡只有在产品明确建模为同一 PointsAccount 时才可共用该账户；跨账户兑换必须显式选择目标账户。

API、worker 和领域 port 都必须校验所有父子 ID 的同用户归属；数据库复合 FK/RLS 是最后一道保护。越权、跨用户、已归档对象或不兼容的跨卡引用统一返回 `404`，不能通过错误差异泄露资源存在性。

## 3. Canonical 状态契约

### 3.1 通用状态轴规则

- 事实事件只追加，状态是按 `aggregate_version` 重放的投影。
- `unknown` 表示缺少来源或外部结果，不是 `false`，不能升级为资格、可用、已到账或已扣分。
- `needs_review/disputed` 只能写到 `review_status`；旧进度中的同名值只作兼容读映射。
- 所有未知、待核对或争议记录必须保存 `reason_code`、`evidence_note`、`last_verified_at` 和 `next_action`。
- 未列出的转换返回 `409 STATE_CONFLICT`；自动任务只能触发允许的提醒，不能替用户确认外部事实。

### 3.2 活动五轴和奖励组件

| 轴/实体 | canonical 状态 | 所有者与约束 |
| --- | --- | --- |
| `Campaign.lifecycle_status` | `draft`、`published`、`ended`、`cancelled` | 活动生命周期不表示个人资格；`ended/cancelled` 只停止新动作 |
| `ActivityParticipation.eligibility_status` | `unknown`、`potentially_eligible`、`user_confirmed_eligible`、`user_confirmed_ineligible` | 必须有适用卡和规则版本；potentially 不等于确认 |
| `ActivityParticipation.enrollment_status` | `not_required`、`not_started`、`submitted`、`confirmed`、`rejected`、`expired`、`cancelled`、`unknown` | `submitted` 只是用户记录外部提交；Cardfolio 不代报名 |
| `ActivityParticipation.quota_status` | `not_applicable`、`unknown`、`available`、`full`、`waitlisted`、`allocated`、`not_allocated` | `available` 不等于 `allocated`；不可由资格推断 |
| `SpendTask.progress_status` | `not_started`、`in_progress`、`provisionally_qualified`、`target_reached`、`shortfall` | 退款可使状态回退；异常走 review 轴 |
| `SpendTask.qualification_status` | `unconfirmed`、`user_confirmed`、`rejected` | 用户官方核对与本地 target reached 分离 |
| `ActivityRewardComponent.status` | `not_expected`、`expected_pending`、`delayed`、`received`、`reversed`、`unknown` | 每个 `reward_key` 独立；没有 reward 规则不得虚构 expected_on |

活动是否可确认只作读模型 gate：

```text
can_confirm_activity =
  eligibility_status == user_confirmed_eligible
  and enrollment_status in (not_required, confirmed)
  and quota_status in (not_applicable, allocated)
  and spend_task.progress_status == target_reached
  and (qualification_required == false or qualification_status == user_confirmed)
```

这个 gate 不产生新的 `qualified` 写状态；应返回具体阻断轴。奖励组件可包含积分、返现、礼品等不同事实，某一组件 received 不得推导其他组件 received，也不直接创建积分或权益事实。

参与实例的 `activity_instance_key` 必须与活动规则版本、卡片、周期起止和对象时区一致；新周期只能创建新实例。活动截止、任务进度、奖励和提醒均按该 key 隔离，不能由同一商户、标题或卡片自动合并。

### 3.3 SpendTask、刷卡方式与 milestone

`SpendTask` 在激活时冻结 `SpendMethodSnapshot`、`rule_version_id`、周期日期、IANA 时区、`cutoff_basis`、指标和目标。P0 计算表达式限于 `count`、`amount`、`count_and_amount`、`count_or_amount`；`custom` 仅保存原文和待核对原因，不进入自动计算。

`SpendEntry` 是不可变发生事实，至少包括 `entry_type = contribution | refund | correction | reversal`、`occurred_on`、金额/次数、币种、method snapshot、来源和 `business_key`。后续状态追加到 `SpendMilestone`：

| `SpendMilestone.kind` | 语义与顺序 |
| --- | --- |
| `posted` | 银行入账的用户确认；同一 entry 最多一个 |
| `settled` | 清算/结算确认；必须先有 posted |
| `rejected` | 明确拒绝；不能与 posted/settled 共存 |

`occurred_on` 是 entry 的发生日期，不是 milestone。`cutoff_basis` 决定确定进度所需日期：缺少 required milestone 或 `qualification_status != included` 时只能计入 pending/provisional。entry 上的 `posted_on`、`settled_on`、`processing_status` 只能是重放缓存，不允许业务角色直接更新。退款/冲正必须关联原 entry，反向累计不得超过原事实；跨周期影响已确认任务时保留原快照并将 `review_status` 设为 `disputed`。

### 3.4 权益 usage model 和 usage ledger

`BenefitEntitlement` 首先声明 `usage_model`：

- `consumable_quota`：次数、金额或单位额度，允许 quota ledger。
- `service_eligibility`：是否具备服务资格，不因为“展示/预约”而扣减。
- `coverage_claim`、`fee_credit`、`service_record`：保留业务记录，但不能复用次数型 consume。
- `unknown`：来源不足时只能记录线索，不能显示可用余额。

权益下发和使用采用独立轴：`delivery_status = pending_delivery | available | delivery_failed | suspended | expired | revoked | unknown`；`BenefitUsage.reservation_status = not_required | not_booked | requested | confirmed | rejected | cancelled | unknown`；`BenefitUsage.redemption_status = not_presented | presented | redeemed | rejected | disputed | unknown`。`presented` 是 redemption 轴中的现场阶段，不另建一条可写的 presentation 轴；预约确认不代表现场出示，出示不代表核销。

只有 `consumable_quota` 且首次 `redemption_status=redeemed` 才能追加 `BenefitUsageLedgerEntry.operation=grant | adjustment | consume | restore | expire`。每条 consume 以 `usage:{usage_id}:consume` 幂等；restore 必须引用原 consume，且同一 consume 最多一条有效 restore。预约、取消、拒绝、争议、下发失败不写 consume；负剩余保留并进入 review，不能截断为零。

### 3.5 积分 confirmed、ledger、lot 三层

积分账户必须把三层事实分开：

1. `PointsBalanceObservation`：用户从官方渠道看到的确认余额和 `balance_as_of`，不改变账本。
2. `PointsEntry`：账户内有序、append-only 的 `earn | adjustment | expire | redeem_debit | reversal` 流水；客户端不能提交新余额。
3. `PointsLot` 与 `LotAllocation`：批次、到期证据和用途限制；allocation 也只追加。

唯一计算公式：

```text
ledger_balance            = sum(PointsEntry.points_delta)
reconciliation_difference = confirmed_balance - ledger_balance
lot_remaining_total       = sum(active lot allocations)
unallocated_difference    = ledger_balance - lot_remaining_total
```

`reconciliation_status`（`unobserved | balanced | mismatch`）和 `lot_allocation_status`（`unknown | balanced | unallocated | overallocated`）分别由两个差额派生。明确到期日才允许到期提醒；P1-b worker 只提醒，用户基于明确来源确认后才写 `expire`。正的未分配差额不生成虚假 lot，负差额保留并进入 review；不得用 FIFO 静默分配受限 lot。

### 3.6 兑换 order/fulfillment、扣分与 refund

按产品术语，本节是三类轴：外部 `order/fulfillment`、本地 `points debit`、`refund`。其中外部订单和履约在写模型中必须拆成两个事实轴；“三轴”不能被实现成一个可变的总 `status`，因为外部受理、实际履约、积分扣分、退分通常不同时发生。UI 可以把前两项放在“订单进展”分组，但 canonical 写模型保留以下四个状态轴：

| 轴 | canonical 状态 | 触发事实 |
| --- | --- | --- |
| `order_status` | `planned`、`submitted`、`accepted`、`rejected`、`cancelled`、`unknown` | 用户记录外部订单是否受理；Cardfolio 不下单 |
| `fulfillment_status` | `not_started`、`processing`、`fulfilled`、`failed`、`cancelled`、`unknown` | 用户记录实物、票券、里程或抵扣履约 |
| `points_debit_status` | `not_debited`、`pending_debit`、`posted`、`needs_review` | points-ledger 记账结果；不等于 hold |
| `refund_status` | `not_applicable`、`not_requested`、`pending_external_confirmation`、`confirmed_external`、`posted`、`needs_review` | 外部退回证据与本地 reversal 分离 |

`accepted` 不等于 `fulfilled`，`fulfilled` 不等于 `points_debit_status=posted`；失败/取消/超时不自动退分。只有已 posted debit 且有官方退回证据，才能以 `redemption:{id}:refund` 写一次等额 reversal。P1-b 只支持整单退分；部分退分需要独立 refund component 和累计上限决策后再开放。

## 4. 命令、API 与事件建议

### 4.1 通用命令契约

所有写请求要求：`Idempotency-Key`、规范化 `request_hash`、`expected_version`、会话推导的 `owner_user_id` 和最小必要 `source_snapshot_id`。同键同 hash 返回原响应；同键异 hash 返回 `409 IDEMPOTENCY_KEY_REUSED`；状态/版本冲突分别返回 `409 STATE_CONFLICT`/`409 VERSION_CONFLICT`；跨用户或不兼容跨卡引用返回 `404`。

客户端不得提交 `confirmed_*`、`remaining_*`、`progress_status`、`ledger_balance`、`used_value` 或任何可重算字段作为事实；服务端由事实重放后返回投影和 `as_of`。

### 4.2 Canonical commands 和 HTTP 入口

| 命令 | 建议入口 | 所属聚合 | 关键结果 |
| --- | --- | --- | --- |
| `CreateActivityParticipation` | `POST /api/v1/campaigns/{campaignId}/participations` | campaign | 建立唯一 `(user,campaign,card)` |
| `RecordEligibility` / `RecordEnrollmentResult` / `RecordQuotaResult` | `POST /api/v1/activity-participations/{id}/{eligibility|enrollment|quota}` | participation | 只记录用户核对或外部结果 |
| `CreateSpendTask` | `POST /api/v1/cards/{cardId}/spend-tasks` | spend-task | 冻结规则、刷卡方式、周期和 cutoff |
| `RecordSpendOccurred` | `POST /api/v1/spend-tasks/{id}/entries` | spend-task | 追加 occurred entry |
| `RecordSpendMilestone` | `POST /api/v1/spend-entries/{id}/milestones` | spend-task | 追加 posted/settled/rejected，不能 UPDATE entry |
| `ReverseSpendEntry` | `POST /api/v1/spend-entries/{id}/reversals` | spend-task | 追加带关联的退款/冲正 |
| `RecordTaskQualification` | `POST /api/v1/spend-tasks/{id}/qualification` | spend-task | 记录用户官方核对，不写银行判断 |
| `CreateActivityRewardComponent` / `RecordRewardResult` | `POST /api/v1/activity-participations/{id}/rewards`、`POST /api/v1/activity-rewards/{id}/result` | campaign | 独立记录 reward component |
| `RecordBenefitDelivery` / `CreateBenefitUsage` | `/api/v1/benefits/{id}/entitlements`、`/api/v1/benefit-entitlements/{id}/usages` | benefit | 建立下发与 usage 实例 |
| `RecordBenefitReservation` / `RecordBenefitPresentation` / `ConfirmBenefitRedemption` | `/api/v1/benefit-usages/{id}/{reservation|presentation|redemption}` | benefit | presentation 更新 redemption 轴，只有首次 redeemed 写 consume |
| `RestoreBenefitUsage` | `POST /api/v1/benefit-usages/{id}/restore` | benefit | 关联一次 restore，不改旧流水 |
| `ObservePointsBalance` | `POST /api/v1/points-accounts/{id}/observations` | points | 保存 confirmed balance，不调账 |
| `PostReconciliationAdjustment` / `RecordPointsEntry` | `POST /api/v1/points-accounts/{id}/{adjustments|entries}` | points | 显式追加 adjustment 或 earn/debit |
| `CreatePointsLot` / `RecordLotAllocation` | `/api/v1/points-accounts/{id}/lots`、`/api/v1/points-entries/{id}/lot-allocations` | points | 维护批次和分配事实 |
| `RecordPointsExpiration` | `POST /api/v1/points-lots/{id}/expiration` | points | 用户确认后写 expire |
| `CreateRedemptionRecord` | `POST /api/v1/redemptions` | redemption | 建单，不预占积分 |
| `RecordRedemptionOrder` / `RecordRedemptionFulfillment` | `/api/v1/redemptions/{id}/{order-result|fulfillment}` | redemption | 分别记录 order/fulfillment |
| `ConfirmPointsDebitObserved` | `POST /api/v1/redemptions/{id}/points-debit` | points-ledger | 由 points 模块幂等写 debit |
| `RecordExternalRefund` / `ConfirmPointsRefundObserved` | `/api/v1/redemptions/{id}/{refund-result|points-refund}` | redemption/points | 外部退回与本地 reversal 分离 |
| `CaptureSourceSnapshot` / `VerifyRuleVersion` | `/api/v1/source-snapshots`、`/api/v1/rule-versions/{id}/verify` | source-rule | 捕获不等于用户核对 |

### 4.3 事件信封和稳定事件

outbox 在所属聚合事务内写入，事件至少包含：`event_id`、`event_type`、`schema_version`、`aggregate_type`、`aggregate_id`、`aggregate_version`、`owner_user_id`、`occurred_at`、`actor`、`correlation_id`、`causation_id`、`idempotency_key`、`source_snapshot_id` 和最小 payload。消费者以 `(consumer_name,event_id)` 去重；副作用另以稳定 `business_key` 去重。

事件名必须描述已经发生的事实，不使用模糊的 `Success`、`Completed`、`Qualified`：

- 活动：`ActivityParticipationCreated.v1`、`ActivityEligibilityRecorded.v1`、`ActivityEnrollmentResultRecorded.v1`、`ActivityQuotaResultRecorded.v1`、`ActivityRewardComponentRecorded.v1`。
- 消费：`SpendOccurredRecorded.v1`、`SpendPostedRecorded.v1`、`SpendSettledRecorded.v1`、`SpendRejectedRecorded.v1`、`SpendEntryReversed.v1`、`SpendTaskProgressRecomputed.v1`。
- 权益：`BenefitDeliveryRecorded.v1`、`BenefitUsageReservationRecorded.v1`、`BenefitUsagePresentationRecorded.v1`、`BenefitRedeemed.v1`、`BenefitUsageRestored.v1`、`BenefitUsageReviewRequired.v1`。
- 积分：`PointsBalanceObserved.v1`、`PointsLedgerEntryPosted.v1`、`PointsLotCreated.v1`、`PointsLotAllocationRecorded.v1`、`PointsExpirationRecorded.v1`、`PointsReconciliationChanged.v1`。
- 兑换：`RedemptionCreated.v1`、`RedemptionOrderResultRecorded.v1`、`RedemptionFulfillmentRecorded.v1`、`RedemptionPointsDebitPosted.v1`、`RedemptionExternalRefundRecorded.v1`、`RedemptionPointsRefundPosted.v1`。
- 横切：`SourceSnapshotCaptured.v1`、`RuleVersionVerifiedByUser.v1`、`ReminderScheduled.v1`、`ReminderCompleted.v1`。

事件订阅者只能刷新自己的投影或生成提醒。`SpendTaskTargetReached` 不能直接创建 reward received；`ActivityRewardComponentReceived` 不能直接写 PointsEntry；`RedemptionOrderResultRecorded` 不能直接写 debit/refund。

### 4.4 事务和一致性

同一聚合的事实、投影、幂等结果、审计和 outbox 在一个本地事务中提交。跨模块调用采用异步 outbox/inbox；不得持有 A 模块行锁同步写 B 模块。命令返回所属聚合已提交的事实和投影；跨模块汇总可显示 `pending`、`as_of` 和 `stale`。未知事件、乱序事件、重复 worker 和重放都必须保留原事实且不产生第二次扣减、consume、refund 或提醒。

## 5. 兼容与迁移注意

### 5.1 旧年费 MVP adapter

现有 `fee_cycles`、`progress_entries`、`fee_events` 和旧 `reminders` 在 P0 不删除、不改写。建议按 Expand -> Backfill -> Verify -> Switch -> Contract 执行：

1. **Expand**：新增 canonical 表、幂等表、outbox/inbox、SpendTask/Entry/Milestone 和通用 Reminder；旧 API 继续可用，新工作台入口由 feature flag 关闭。
2. **Backfill**：每个 `fee_cycle` 生成 `SpendTask(task_type=annual_fee, source_kind=legacy_adapter)`；每条正向 progress 生成 contribution entry，使用 `legacy-progress:{id}` business key。旧累计值生成 snapshot observation 或 correction，但不能与 entries 相加。
3. **语义保真**：旧 progress 的 `entry_date` 只能映射为 `occurred_on`；缺少 posted/settled、原来源、币种或时区时标 `unknown/needs_review`，不能补造银行入账证据。旧撤销生成关联 reversal，无法关联时保留原 note 并阻止自动确认。
4. **Verify**：按用户/周期对比旧新 amount、count、remaining、状态和提醒；覆盖累计 correction、负值、闰日、跨时区和空数据。shadow replay 必须可从零重建。
5. **Switch/rollback**：切换前保持单一写源；切换后旧 API 由 adapter 调用 canonical command 并返回旧响应。异常只回退读路径、关闭 consumer 或 feature flag，不删除已提交 canonical 事实。
6. **Contract**：经过稳定观察期和恢复演练后旧表才可只读；删除旧表、旧枚举和兼容字段是独立 contract migration，不与 P0 同批。

### 5.2 兼容读映射

旧 `qualified`、`enrolled`、`reward_received`、`BenefitUsage.status`、`Redemption.status`、`SpendEntry.processing_status` 只能在 read adapter 映射为 canonical projection。映射必须保存 `legacy_value`、`adapter_version`、`mapped_at` 和证据缺口；没有用户/官方证据的旧 `eligible` 不得升级为 `user_confirmed_eligible`。新写 API、DDL、事件目录不得继续使用这些旧枚举。

### 5.3 数据和发布风险

- 数据库草案若把 posted/settled 直接放在可变 entry 上，会破坏事实重放；必须有 milestone 表或等价 append-only 结构。
- 若到期 worker 自动写 `expire`，会把提醒误当银行事实；P1-b 只能提醒，用户确认后写入。
- 兑换如果保留单一 `status` 或把 `success` 触发扣分，会产生订单成功但账本未扣、订单失败但已扣分的不可解释状态。
- 活动和权益状态若继续把 `needs_review/disputed` 混入 progress/lifecycle，解决争议后会丢失原本的业务状态。

## 6. 可验证不变量

以下不变量必须在领域单测、数据库约束/事务测试、API contract 和 E2E 中分别提供证据；文档通过不等于通过。

1. 同一 `(owner_user_id,campaign_id,card_id,activity_instance_key)` 至多一个 participation；同一活动的卡 A/B 或相邻周期更新不会改变另一张卡/周期的五轴、任务、奖励或提醒。
2. 任一活动五轴为 `unknown`、`rejected`、`full`、`not_allocated` 或 `review_status != clear` 时，读模型不得输出“已确认达标”；必须返回具体阻断轴。
3. 同一 participation 的每个 `reward_key` 独立追加和重放；积分、返现、礼品中的一个 received 不会自动改变其他组件或 PointsEntry。
4. SpendTask 的 `input_mode` 只能是一个；snapshot observation 与 entries 不得同时计入同一确定/预计进度。
5. `occurred_on <= posted_on <= settled_on`；settled milestone 没有 posted 时被拒绝；rejected 与 posted/settled 不共存。
6. 同一 entry、milestone kind 和业务引用至多一个事实；重复请求相同 key 返回原响应，异 payload 返回 409。
7. 任一 refund/reversal 的反向累计绝对值不超过原 contribution；原 entry 不可 UPDATE/DELETE，跨周期影响只能追加 review/reversal。
8. `cutoff_basis=posted/settled` 且没有对应 milestone 的 entry 只能进入 pending/provisional，不能进入确定值或 `user_confirmed`。
9. 权益预约、取消、拒绝、出示和争议不产生 consume；同一 usage 最多一个有效 consume，restore 必须精确引用该 consume 且最多一次。
10. 非 `consumable_quota` usage model 不得写次数型 consume；负剩余不能被截断为零，必须保留并进入 review。
11. `ledger_balance = sum(PointsEntry.points_delta)`；任何客户端提交余额都不会直接改变该等式。
12. `reconciliation_difference = confirmed_balance - ledger_balance` 与 `unallocated_difference = ledger_balance - lot_remaining_total` 分开计算；一个差额不为零不得伪装成另一个差额已平衡。
13. 未知到期日的 lot 不生成 points-expiry reminder；P1-b worker 不自动写 expire entry。
14. Redemption `order_status=accepted`、`fulfillment_status=fulfilled`、`points_debit_status=posted` 和 `refund_status=posted` 可以独立存在；任何一个状态变化不得隐式更新其他轴。
15. 只有已 posted debit + 官方退回证据才可写 refund reversal；同一 redemption 的 debit/refund business key 各自最多一个有效事实，乱序 worker 不重复扣分或退分。
16. 所有固定卡关系同时满足 `(user_id,card_id)` 复合归属；跨用户、同用户跨卡不兼容引用在 API、领域 port、RLS/FK 三层均失败且返回 404。
17. 事件重放、投影重建、缓存丢失和 worker 重启不会生成第二次 consume、debit、reversal 或 reminder；每个投影带 `last_sequence/as_of/stale`。
18. 年费 adapter 迁移后，旧/新读模型在约定观察样本上 amount、count、remaining 和提醒 parity 一致；缺失 milestone 不会被迁移脚本补造成 posted/settled。

## 7. 发布 Gate 与当前阻断

### Gate 0：契约冻结（实现前）

- [ ] PRD、正式架构、DB、QA 使用同一五轴、reward component、SpendMilestone、权益三状态轴、积分双差额和兑换四轴命名。
- [ ] `review_status` 是否独立成轴、兑换部分退分、同一 participation 多任务组合语义由产品/DBA/QA 签收。
- [ ] 所有命令的 ownership、Idempotency-Key、request hash、expected version、404/409 和审计字段已写入契约测试。
- [ ] `snapshot/entries` 互斥、`occurred/posted/settled` milestone、来源捕获/用户核对分离和 Reminder dedupe 规则已有 DDL 方案。
- [ ] 旧年费 adapter 的 read mapping、backfill provenance、parity 样本、灰度和 rollback 方案已评审。

### Gate 1：P0 活动 + 单卡任务 + 奖励人工核对

- [ ] 真实 PostgreSQL 迁移、复合 FK/RLS、append-only 约束、outbox/inbox 和 worker 重试通过。
- [ ] 多卡隔离、活动五轴、奖励延迟/撤回、Spend milestone、预计/确定进度、退款冲正和来源版本测试通过。
- [ ] 现有年费 MVP 回归和 adapter parity 通过；不能用年费 E2E 代替扩展领域证据。
- [ ] 360/390 px 能并列显示五轴、任务当前/目标/剩余、来源和下一步；unknown/review 不依赖颜色表达。

### Gate 2：P1-a 权益

- [ ] usage model 与 usage ledger 的 grant/consume/restore/expire 可重放；预约/出示/拒绝/争议不扣减。
- [ ] 并发核销至多一次 consume，恢复不重复，负剩余进入 review；保险/年费抵扣未误用次数账本。

### Gate 3：P1-b 积分和兑换

- [ ] confirmed/ledger/lot 三层及两个差额可从零重建；到期 unknown 不提醒，负差额不静默调账。
- [ ] order/fulfillment/debit/refund 独立展示和重放；失败/取消不自动退分，posted debit + 官方证据才允许 reversal。
- [ ] 跨账户、跨卡、并发、乱序和备份恢复测试通过；P1 不启用 hold、自动 lot 或自动兑换。

### Gate 4：P2 自动化

- [ ] 导入确认写入、自动 lot、reservation/hold、连接器和外部通知分别完成权限、限流、撤销、死信、安全和恢复评审。
- [ ] P2 失败不能改变 P0/P1 事实语义，也不能把自动化结果显示为银行确认。

### 当前阻断项

当前代码、迁移、API、RLS、outbox/inbox、worker 和扩展 E2E 尚未落地；因此 Gate 0 尚未关闭，P0/P1/P2 均不能对外宣称已部署。旧研究稿仍可能保留历史枚举、提醒 DDL 或权益命名，主会话需以本轮正式 PRD/架构/DB 的 canonical glossary 为实现依据，并由对应角色签收。

## 8. 未决事项

1. **兑换部分退分**：P1 是否严格整单 reversal；推荐先限整单，部分退分需要 component、累计上限、来源和 UI 显示。
2. **同一 participation 多任务**：推荐 P0 限零或一个单卡 SpendTask；若开放多个任务，必须在 RuleVersion 冻结 all/any/custom 组合，禁止最后写入覆盖。
3. **活动无需消费任务**：资格/报名/名额完成后是否可以直接确认结果，需产品定义 `qualification_required=false` 的 gate。
4. **权益 usage model 迁移**：旧 `BenefitUsage.status` 无法无损拆 presentation/redeem 时，推荐映射为 `unknown + needs_review`，不猜测现场核销。
5. **积分 observation + adjustment**：推荐 UI 同屏但 API 显式返回两个结果；观察余额不能隐式创建 adjustment。
6. **lot 到期自动化**：P2 前需要规则确定性、时区、宽限期、撤销和审计策略；当前只做提醒。
7. **跨卡积分池**：需要产品明确池账户的卡归属变更、关闭卡影响、兑换授权和展示口径；不能从 `card_id=null` 推断共享。
8. **legacy adapter 的时间语义**：旧 entry_date 只表示发生日；是否允许用户补录 posted/settled 必须由来源和审计约束，不应由迁移脚本推断。
9. **兑换 refund 轴归属**：第六轮整合冻结 `refund_status` 为独立 canonical 轴；`pending_refund/refunded` 只保留为旧读模型映射，不能进入新写入。产品、DBA、QA 需在 Gate 0 验证迁移与兼容读只存在一套写语义。

## 9. 角色交接

### 产品经理

- 冻结活动五轴、reward component 的用户文案和最终 gate；确认无需消费活动、多任务组合和 `not_required` 语义。
- 确认权益四类 usage model 的页面边界、预约/出示/核销文案，以及哪些价值可以进入收益记录。
- 确认兑换四轴和失败/退分/部分退分流程；接受 P0/P1 不自动报名、预约、兑换和 lot 分配。

### DBA

- 将所有权复合 FK/RLS、SpendMilestone、BenefitUsageLedgerEntry、PointsLotAllocation、幂等表、状态历史和 outbox/inbox 落成迁移设计。
- 固化数值精度、账户 sequence、append-only 触发器、业务唯一键、退款上限和 adapter provenance；演练 Expand/backfill/rollback/restore。
- 为两个积分差额、quota ledger 和兑换 refund 前置条件提供数据库级约束或可验证查询。

### QA

- 将第 6 节 18 条不变量拆成 D/I/A/E 证据矩阵，至少覆盖双卡、跨用户、跨时区、DST、重复/乱序 worker、退款重开、负差额和移动端状态。
- 对 P0/P1 Gate 建立 Given/When/Then fixture；不要以当前年费 MVP 回归替代扩展领域测试。
- 对 legacy adapter 做旧/新 parity、缓存重建、备份恢复和 feature flag rollback 验证。

### 主会话集成顺序

1. 先把本稿的 canonical 命名、权益 delivery + reservation/redemption usage 轴、兑换“三类产品轴/四类底层事实轴”和公式差异转给 PRD/DB/QA；保留本文件作为实现前证据边界。
2. 产品、DBA、QA 分别签收 Gate 0 未决项；未签收前不创建扩展迁移或开放 UI 入口。
3. 实现时先 P0，完成真实迁移和测试后再独立开启 P1-a、P1-b；P2 不得以预留字段提前发布。

## 10. 交付说明

- **Changed files**：仅新增 `docs/research/CARD-DOMAIN-ROUND6-ARCHITECTURE.md`。
- **Decisions**：活动五轴与多组件奖励；SpendTask 的 occurred/posted/settled milestone；权益 usage model 与 usage ledger；积分 confirmed/ledger/lot 三层和双差额；兑换 order/fulfillment/debit/refund 独立；同用户跨卡与跨用户所有权；旧年费 adapter；Gate 0/P0/P1-a/P1-b/P2。
- **Validation**：完成后运行 `git diff --check -- docs/research/CARD-DOMAIN-ROUND6-ARCHITECTURE.md`；本轮不运行应用、数据库迁移或 E2E 测试。
- **Risks/open questions**：正式文档仍有 canonical 漂移；兑换 refund 轴归属、部分退分、多任务组合、权益旧状态拆分、积分池和到期自动化待角色签收；真实数据库、权限、并发和恢复证据缺失。
- **Ready for integration**：yes，研究稿可供主会话整合；工作台扩展能力仍为 not ready，直至适用 Gate 关闭。
