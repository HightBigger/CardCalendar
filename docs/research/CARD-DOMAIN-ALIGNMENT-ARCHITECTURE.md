# Cardfolio 卡领域架构对齐稿

| 项目 | 内容 |
| --- | --- |
| 文档版本 | v0.1 |
| 角色 | 领域架构（补充复核） |
| 复核日期 | 2026-08-14 |
| 复核范围 | 活动、权益、刷卡任务、积分账本、兑换、提醒的状态/命令/事件与分期 |
| 交付性质 | 实现前架构契约；不创建迁移、不修改正式架构和业务代码 |

## 1. 架构决策

1. 保持 Next.js 模块化单体 + PostgreSQL + outbox/inbox；活动、权益、刷卡任务、积分、兑换和提醒分别拥有自己的聚合状态。
2. 活动规则可以关联多张卡，但用户实例必须是 `(user, activity, card)` 的独立 `ActivityParticipation`。P0 的 `SpendTask` 固定单卡，不能跨卡合并金额或笔数。
3. 活动资格、报名、名额、任务进度和奖励是五条正交状态轴。奖励用独立 `ActivityReward` 事实或等价 append-only 事件投影，不能藏在 participation 的结果枚举里。
4. 事实与投影分离：用户确认、来源快照、手工流水和外部结果是事实；进度、剩余量、首页汇总和提醒是可重算投影。
5. P0 只实现活动/单卡任务/奖励手工核对和站内提醒；P1-a 实现权益；P1-b 实现积分账户/批次/外部手工兑换；P2 才允许导入、lot 自动分配、reservation/hold 和连接器。

## 2. Canonical 状态

正式架构的写 API、事件和数据库约束只能使用以下名称。旧章节中的同义词保留为 deprecated 兼容读映射，不得用于新写入。

| 聚合/状态轴 | canonical 状态 |
| --- | --- |
| `Campaign.lifecycle_status` | `draft`、`published`、`ended`、`cancelled`、`needs_review` |
| `ActivityParticipation.eligibility_status` | `unknown`、`potentially_eligible`、`user_confirmed_eligible`、`user_confirmed_ineligible`、`needs_review` |
| `ActivityParticipation.enrollment_status` | `not_required`、`not_started`、`submitted`、`confirmed`、`rejected`、`expired`、`unknown`、`needs_review` |
| `ActivityParticipation.quota_status` | `not_applicable`、`unknown`、`available`、`full`、`waitlisted`、`allocated`、`not_allocated`、`needs_review` |
| `SpendTask.progress_status` | `not_started`、`in_progress`、`provisionally_qualified`、`target_reached`、`shortfall`、`failed`、`expired`、`disputed`、`needs_review` |
| `SpendTask.qualification_status` | `unconfirmed`、`user_confirmed`、`rejected`、`needs_review` |
| `ActivityReward.status` | `not_expected`、`expected_pending`、`received`、`delayed`、`reversed`、`disputed`、`unknown`、`needs_review` |
| `BenefitEntitlement.status` | `pending_delivery`、`available`、`suspended`、`expired`、`revoked`、`disputed`、`unknown` |
| `BenefitUsage.reservation_status` | `not_required`、`not_booked`、`requested`、`confirmed`、`rejected`、`cancelled`、`unknown` |
| `BenefitUsage.redemption_status` | `not_presented`、`presented`、`redeemed`、`rejected`、`disputed`、`unknown` |
| `Redemption.order_status` | `planned`、`submitted`、`processing`、`success`、`failed`、`cancelled`、`refund_pending`、`refunded`、`disputed`、`unknown` |
| `Redemption.points_debit_status` | `not_debited`、`pending`、`posted`、`needs_review`、`pending_refund`、`refunded` |
| `PointsAccount.reconciliation_status` | `balanced`、`mismatch`、`pending`、`unknown` |
| `Reminder.status` | `pending`、`snoozed`、`completed`、`ignored`、`overdue`、`cancelled` |

关键语义：`target_reached` 是本地按冻结规则计算的结果；`user_confirmed` 是用户在官方渠道核对的结果；两者都不表示奖励已到账。`success` 只表示外部订单结果，不能推断 `posted`。`pending` 在兑换中只表示处理状态，不能作为积分预占。

## 3. 聚合边界与状态所有权

| 模块 | 拥有聚合 | 允许写入 | 不允许写入 |
| --- | --- | --- | --- |
| `campaign-activity` | Campaign、ActivityParticipation、ActivityReward | 规则版本、资格/报名/名额、奖励事实 | SpendEntry、BenefitUsage、PointsEntry |
| `spend-task` | SpendTask、SpendEntry | 发生/入账/清算里程碑、预计/确定进度、冲正 | 银行交易证明、积分/奖励到账 |
| `benefit-entitlement` | Benefit、BenefitEntitlement、BenefitUsage ledger | 下发、预约、出示、核销、争议、consume/restore | 活动达标即自动下发、积分记账 |
| `points-ledger` | PointsAccount、PointsLot、PointsEntry、Allocation | append-only 赚取/扣减/过期/调整/冲正、对账 | PATCH balance、自动造 lot、自动 FIFO |
| `redemption` | Redemption、StatusHistory | 外部订单履约、请求 points debit/refund | 直接写 PointsEntry、P0 reservation |
| `notification` | Reminder、DeliveryAttempt | 规则节点生成、站内投递、重试、稍后/完成 | 推导业务截止、改变业务状态 |
| `source-rule` | SourceSnapshot、RuleVersion | 来源快照、用户确认、版本生效/失效 | 抓取成功即确认规则正确 |

跨模块只保存对方聚合 ID 和 `user_id`；命令通过拥有方 port 验证所有权、状态和 `expected_version`。读模型可以批量查询并带 `as_of/stale`，不能反写事实表。

## 4. Canonical 命令与 API

所有写命令要求 `Idempotency-Key`、request hash 和 `expected_version`。同 key 同 payload 返回首次响应；同 key 不同 payload 返回 `409 IDEMPOTENCY_KEY_REUSED`；状态或版本不匹配返回 `409 STATE_CONFLICT`/`VERSION_CONFLICT`；跨用户资源统一返回 `404`。

| 命令 | HTTP 入口 | 所有者 | 结果 |
| --- | --- | --- | --- |
| `CreateActivityParticipation` | `POST /activity-participations` | campaign-activity | 创建 `(user,activity,card)` 实例，初始五轴均为 unknown/未开始 |
| `RecordEligibility` | `POST /activity-participations/{id}/eligibility` | campaign-activity | 记录用户官方核对和 evidence |
| `RecordEnrollmentResult` | `POST /activity-participations/{id}/enrollment` | campaign-activity | 记录外部报名结果，不代报名 |
| `RecordQuotaResult` | `POST /activity-participations/{id}/quota` | campaign-activity | 记录名额核对，不推断分配 |
| `CreateSpendTask` | `POST /cards/{cardId}/spend-tasks` | spend-task | 创建单卡任务并冻结规则/口径 |
| `RecordSpendEntry` | `POST /spend-tasks/{id}/entries` | spend-task | 追加 occurred/posted/settled 事实并重算投影 |
| `ReverseSpendEntry` | `POST /spend-entries/{id}/reverse` | spend-task | 追加关联负向事实 |
| `ConfirmActivityResult` | `POST /activity-participations/{id}/result` | campaign-activity | 写用户最终核对，不改写五轴历史 |
| `RecordRewardResult` | `POST /activity-rewards/{id}/result` | campaign-activity | 写到账/撤回/争议事实 |
| `RecordBenefitUsage` | `POST /benefit-entitlements/{id}/usages` | benefit-entitlement | 预约/出示/核销；首次 redeemed 才 consume |
| `RecordPointsEntry` | `POST /points-accounts/{id}/entries` | points-ledger | 追加 ledger entry，不允许 PATCH balance |
| `CreateRedemption` | `POST /redemptions` | redemption | 建立 planned/submitted 订单，不预占 |
| `RecordRedemptionResult` | `POST /redemptions/{id}/result` | redemption | 更新订单轴，失败不猜测退分 |
| `ConfirmPointsDebit` | `POST /redemptions/{id}/debit` | points-ledger | 以 redemption business key 幂等写 posted debit |
| `ConfirmPointsRefund` | `POST /redemptions/{id}/refund` | points-ledger | 仅原 posted debit + 官方退回证据可写 reversal |
| `VerifyRuleVersion` | `POST /rule-versions/{id}/verify` | source-rule | 用户核对规则；抓取事件不等同确认 |

## 5. Canonical 事件

事件由事务 outbox 发布，事件消费者以 `(consumer_name,event_id)` 去重；事件乱序或重复不得重复写账本。建议稳定事件包括：

- `ActivityParticipationEligibilityRecorded.v1`、`ActivityEnrollmentResultRecorded.v1`、`ActivityQuotaResultRecorded.v1`、`ActivityResultConfirmed.v1`、`ActivityRewardStatusChanged.v1`；
- `SpendTaskCreated.v1`、`SpendEntryRecorded.v1`、`SpendEntryReversed.v1`、`SpendTaskProgressRecomputed.v1`；
- `BenefitEntitlementGranted.v1`、`BenefitUsageReservationRecorded.v1`、`BenefitUsageRedeemed.v1`、`BenefitUsageReversed.v1`；
- `PointsEntryPosted.v1`、`PointsReconciliationChanged.v1`、`RedemptionCreated.v1`、`RedemptionOrderStatusChanged.v1`、`RedemptionDebitPosted.v1`、`RedemptionRefundReversed.v1`；
- `SourceSnapshotCaptured.v1`、`RuleVersionVerifiedByUser.v1`、`ReminderScheduled.v1`、`ReminderCompleted.v1`。

禁止用 `SourceSnapshotConfirmed` 表示“抓取成功”；只有 `RuleVersionVerifiedByUser.v1` 才能使来源进入用户确认状态。禁止用兼容投影事件 `RewardReceived` 取代 `ActivityRewardStatusChanged.v1`。

## 6. 关键状态不变量

1. 最终活动文案的必要条件是：资格 `user_confirmed_eligible`；报名 `not_required/confirmed`；名额 `not_applicable/allocated`；任务 `target_reached`；如要求最终核对则 `qualification_status=user_confirmed`。未知/失败轴必须显示阻断原因。
2. `snapshot` 与 `entries` 互斥；`occurred_only` 只能进入预计值，`posted/settled` 才能进入对应确定值。
3. 退款只追加 `reversal_of_entry_id`；反向累计不得超过原始事实；跨截止日影响已确认结果时转 `needs_review/disputed`。
4. 权益预约、取消、拒绝和争议不扣额度；只有首次 `redeemed` 追加 consume，恢复只能追加一次 restore。
5. `ledger_balance = sum(points_delta)`；`unallocated_difference = confirmed_balance - lots_remaining_total`。未知 lot 不生成到期提醒，负余额保留并标 `needs_review`。
6. `success + points_debit_status=pending` 是处理中；失败/取消不自动退分；退款必须引用已 posted debit 且使用独立幂等业务键。
7. 所有命令同 key 重放结果稳定；同 key 异 payload 409；跨用户/跨卡引用在 API、复合 FK/RLS 和领域 port 三层拒绝。

## 7. 分期与兼容

### P0

先实现来源/规则版本、提醒基础、活动 participation/reward 和单卡 SpendTask。当前年费 `progress_entries` 通过 legacy adapter 读入；缺失 posted/settled/business key 的历史数据标 `needs_review`，不得伪造银行入账。P0 不创建权益、积分、兑换表的可用写入口。

### P1-a / P1-b

P1-a 增加 BenefitEntitlement/Usage append-only ledger；P1-b 增加 PointsAccount/Lot/Allocation/Entry 和 Redemption 双状态。两者均使用 feature flag、真实迁移和 shadow replay 验证，不能用文档字段冒充已实现能力。

### P2

导入、自动 lot 分配、system reservation/hold、连接器、自动通知渠道必须独立授权、撤销、审计、限流、恢复和合规评审；P2 术语不得进入 P0/P1 的写 API。

旧 API/字段兼容层只在读取时做映射：`eligible -> user_confirmed_eligible`（需用户证据）、`qualified -> target_reached`、`fulfilled -> success`、`redeem -> redeem_debit`。兼容层必须保留原始值和映射版本，不能将不具备证据的旧值升级为确认状态。

## 8. 实现前阻断

- 需要在正式架构第 14 节保留本稿 canonical 表，并将旧状态图、旧动作名和旧事件名统一标记 deprecated。
- 需要 DB 设计落地 participation quota、独立 reward fact、提醒 dedupe、BenefitUsage 双轴、Points ledger/lot/allocation 和 redemption account-card 复合约束。
- 需要定义 outbox/inbox、请求幂等表、状态历史和 append-only 触发器的真实 PostgreSQL 迁移与影子库重放。
- 需要补齐活动/权益/积分/兑换的 owner port、RLS/复合 FK、404/409 错误语义和 worker 重试策略。
- 需要在 QA 中锁定跨卡、跨时区、退款重开、负账面余额、重复 debit/refund 和来源确认事件的测试矩阵。

## 9. 交接

- **Changed files**: `docs/research/CARD-DOMAIN-ALIGNMENT-ARCHITECTURE.md`。
- **Decisions**: canonical 状态、命令、事件；每卡 participation/单卡 task；奖励独立事实；P0/P1-a/P1-b/P2 分期；幂等、outbox/inbox、账本和兼容边界。
- **Validation**: 完成后运行 `git diff --check -- docs/research/CARD-DOMAIN-ALIGNMENT-ARCHITECTURE.md`；未运行应用或数据库测试。
- **Risks**: 正式架构当前仍有旧契约，需主会话串行整合；实际迁移和实现尚未存在。
- **Ready for integration**: yes。
