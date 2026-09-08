# Cardfolio 卡领域 Round 8 架构补充复核

| 项目 | 内容 |
| --- | --- |
| 文档版本 | v0.1 |
| 角色 | 架构师（状态、接口与兼容性复核） |
| 复核日期 | 2026-08-15 |
| 输入 | `docs/PRD-WORKBENCH.md` v0.8、`docs/ARCHITECTURE-WORKBENCH.md` v0.6、`docs/research/CARD-DOMAIN-ROUND7-ARCHITECTURE.md`、当前年费 MVP schema/service |
| 交付性质 | 实现前研究稿；不代表活动、权益、积分或兑换已经实现或可部署 |
| 允许变更 | 仅本文件；不修改正式 PRD、架构、数据库、QA、安全、UX、代码、迁移或锁文件 |

## 1. 范围与决策层级

本轮只做静态契约审查，目标是找出正式架构前半部分和 Round7 canonical 契约之间仍会导致错误实现的缺口，并给出可直接合并的补充。产品范围、四元活动实例、`SpendEntry`/`SpendMilestone`、权益 grant/consume/restore/expire、积分双差额、兑换四轴和 Reminder lease/dedupe/retry/dead-letter 视为已冻结决策。

### 1.1 规范优先级

在主会话将结论并入正式文档前，以下优先级适用于实现和评审：

1. 本稿与 `CARD-DOMAIN-ROUND7-ARCHITECTURE.md` 的 canonical 状态、API、事件和发布门。
2. `ARCHITECTURE-WORKBENCH.md` 第 14--21 节的后续修订。
3. 正式架构第 3--13 节及 PRD 中的简化字段，只能作为兼容读模型或历史说明。

如果历史章节与 canonical 决策冲突，不能通过“两个都支持”解决；必须选择一个写模型，并在兼容层明确单向映射和退役时间。

### 1.2 本轮结论

- 领域拆分方向正确，但正式架构的模块表、早期状态图、首批 API 和事件列表仍把简化模型写成规范模型，容易重新引入 `qualified`、`reward_received`、`success`、`points_held` 等混合状态。
- 活动奖励、权益使用流水、`SpendMilestone`、积分批次分配和 Reminder worker 仍未在正式模块边界中作为一等事实源明确列出；Round7 研究稿已有结论，但需要在整合时成为唯一写入口。
- 旧年费模型可以无损保留“用户录入的数值事实”，不能无损补出 posted/settled、银行资格或历史编辑前版本。兼容必须是旧 API 入站翻译到 canonical，切换后旧 API 只读投影，不做双向同步。
- `unknown` 是一个可记录但不能得出确定结论的事实状态；必须统一原因、证据、最后核对时间和下一步动作，以及哪些命令会被拒绝。

## 2. Canonical 聚合与所有权补充

下表是实现时应采用的最小拥有边界。表中的“事实源”只能由拥有模块追加；工作台、提醒和其他订阅者只能读取或投影。

| 根/事实集合 | 拥有模块 | Canonical 身份 | 允许写入 | 明确禁止 |
| --- | --- | --- | --- | --- |
| `CardProfile`、`CardLifecycle` | `card-profile` | `(owner_user_id, card_id)` | 档案、生命周期、归档/恢复 | 活动资格、任务进度、权益额度、积分或兑换 |
| `Campaign`、`CampaignRuleVersion` | `campaign-activity` | `(owner_user_id, campaign_id, rule_version_id)` | 活动规则、发布/结束/取消、来源引用 | 保存某张卡的报名、任务或奖励到账 |
| `ActivityParticipation` | `campaign-activity` | `(owner_user_id, campaign_id, card_id, activity_instance_key)` | 资格、报名、名额、参与结果轴 | 直接写消费、权益或积分事实 |
| `ActivityRewardComponent` | `campaign-activity` | `(participation_id, reward_key)` | 预计、到账、延迟、撤回、争议及证据事件序列 | 用 `target_reached` 自动发奖或写积分流水 |
| `SpendTask`、`SpendMethodSnapshot` | `spend-task` | `(owner_user_id, task_id)` | 任务生命周期、冻结规则/方法、进度投影 | 证明银行已入账、修改积分或奖励 |
| `SpendEntry`、`SpendMilestone` | `spend-task` | `(owner_user_id, entry_id)` | occurred 事实及 posted/settled/rejected 追加里程碑 | UPDATE/DELETE 历史 entry，跨卡累计 |
| `BenefitEntitlement`、`BenefitUsage` | `benefit-entitlement` | `(owner_user_id, entitlement_id)`、`(owner_user_id, usage_id)` | 下发、预约、出示、核销、争议 | 预约即扣额度、跨权益写积分 |
| `BenefitUsageLedgerEntry` | `benefit-entitlement` | `(usage_id, operation, business_key)` | grant/consume/restore/expire；`reversal` 仅技术反向 | 用一个 `used_value` 可变列覆盖流水 |
| `PointsAccount`、`PointsEntry`、`PointsLot`、`LotAllocation` | `points-ledger` | `(owner_user_id, account_id)`及账户内 sequence | 余额观察、append-only 流水、批次和分配 | PATCH 余额、静默 FIFO、自动造 lot |
| `Redemption` | `redemption` | `(owner_user_id, redemption_id)` | order、fulfillment、debit request、refund request 四轴 | 直接 UPDATE PointsEntry 或以订单成功推断扣分 |
| `Reminder`、`DeliveryAttempt` | `notification` | `(owner_user_id, reminder_id)`及 dedupe key | 调度、租约、投递、重试、死信、完成/忽略 | 通过提醒改变业务事实 |
| `SourceReference`、`SourceSnapshot`、`RuleVersion` | `source-rule` | `(owner_user_id, source_snapshot_id)`、规则版本 | 来源捕获、用户核对、不可变规则快照 | 抓取成功即确认资格或规则 |
| `WorkbenchReadModel` | `dashboard` | `(owner_user_id, projection_name)` | 从事件/只读 port 重建 | 任何事实写入、默认填充未知值 |

### 2.1 仍需在正式架构补齐的聚合遗漏

1. 正式架构 §3 的 `campaign-activity` 仍写作 `ActivityEnrollment/ActivityProgress`，应改为 `Campaign + ActivityParticipation + ActivityRewardComponent`；报名不是活动根聚合的单一状态。
2. `benefit-entitlement` 不能只列 `BenefitEntitlement`，必须将 `BenefitUsage` 与使用账本列为同一模块的独立事实集合；`BenefitUsed.v1` 不能作为模糊总事件。
3. `spend-task` 必须同时列出 `SpendMethodSnapshot`、`SpendEntry` 和 `SpendMilestone`。`SpendMilestone` 不是 entry 上的可变字段，也不是 dashboard 投影。
4. `points-account-ledger` 必须列出 `PointsLot` 和 `LotAllocation`；没有分配事实就不能计算 `lots_remaining_total` 或到期提醒。
5. `redemption` 的“锁定/扣减”描述与 P0/P1 不预占冲突。`hold/reserve/release` 只能在 P2 独立 feature flag 下出现，P1 只允许外部结果与手工扣减/退分。
6. `notification` 的根状态需要包含 lease、attempt、dead-letter 和 dedupe 事实；不能只依靠 `NotificationScheduled/Delivered/Failed` 三个投影状态。

## 3. 状态、命令和事件边界缺口

### 3.1 活动参与与奖励

正式架构中 `/cards/{cardId}/campaigns`、`ActivityEnrollment` 和 `qualified` 仍可能被实现成“卡片下挂一条活动状态”。canonical 写入必须改为：

```text
CreateParticipation(campaign_id, card_id, activity_instance_key)
  -> RecordEligibility
  -> RecordEnrollmentResult
  -> RecordQuotaResult
  -> RecordOutcome
  -> RecordRewardComponentResult(reward_key)
```

每个命令只推进一个轴，并要求父对象、规则版本和四元实例键一致。`target_reached` 只表示本地任务投影达到目标；`qualification_status=user_confirmed` 仍需用户提供官方核对，不得由事件订阅者自动写入。

`ActivityRewardComponent` 是必要的 canonical 事实。一个 participation 可以同时有积分、返现和礼品组件，各自拥有 `reward_key`、`expected_on`、证据和事件序列；组件收到 `received` 不会改变其他组件，也不会直接调用 points 或 benefit 的写命令。

### 3.2 消费事实和任务进度

早期 `/spend-task-entries/{entryId}/milestones` 与 entry 上的 `posted_on/settled_on/processing_status` 会产生第二套事实源。canonical 只有：

- `POST /api/v1/spend-tasks/{taskId}/entries`：追加 occurred entry。
- `POST /api/v1/spend-entries/{entryId}/milestones`：追加一个 `posted|settled|rejected` milestone；`settled` 必须先有 `posted`。
- `POST /api/v1/spend-entries/{entryId}/reversals`：追加关联反向 entry，不编辑原 entry。

`cutoff_basis` 决定确定进度需要的 milestone。缺少 milestone、支付方式未知、规则为 `custom` 或资格未核对的事实，只能进入 `pending/provisionally_qualified/needs_review`，不能把预计进度直接改为银行已达标。

`snapshot` 和 `entries` 是任务级互斥输入模式。累计录入必须追加 correction，并保存 `observed_total` 与调整前投影；不能在同一个任务同时把累计快照和流水相加。

### 3.3 权益使用

正式架构的 `BenefitEntitlement` 状态图缺少预约和核销子状态，建议写命令边界如下：

```text
RecordDelivery -> CreateUsage
CreateUsage -> RecordReservation -> RecordPresentation -> ConfirmRedeemed
                                        \-> rejected/cancelled/disputed
ConfirmRedeemed --(first time, consumable_quota)--> append consume
RestoreUsage --(existing consume + evidence)--> append restore
```

`coverage_claim`、`fee_credit`、`service_record` 和 `unknown` 不进入次数型额度账本。重复 `ConfirmRedeemed` 必须返回第一次结果；预约成功、出示或拒绝均不能减少 `remaining_value`。

### 3.4 积分账户和兑换

正式架构的 `/points-accounts/{id}/adjustments` 与 `Redemption success` 描述不足以表达 P1 的两个差额和四轴兑换：

- 余额观察应使用 `/observations`，只保存 `confirmed_balance/as_of/source`；差额调账是显式 `adjustment` entry。
- 通用流水使用 `/entries`；批次使用 `/lots` 和 `/lot-allocations`；P1 不自动执行 FIFO。
- 兑换必须分别调用 `order-result`、`fulfillment`、`points-debit` 和 `refund-result`。`success` 只是旧读映射，不是新写入。
- 只有已有 `posted` debit 且有官方退分证据时才能写 `redemption:{id}:refund` reversal。订单失败、取消、超时或本地 consumer 失败都不能猜测退分。

### 3.5 Reminder

提醒不是首页查询时临时计算的布尔值。每个提醒至少保存 `trigger_at`（UTC）、冻结的 IANA 时区、`dedupe_key`、对象版本/sequence、`lease_until`、`attempt_count`、`last_error` 和死信原因。worker 通过 `FOR UPDATE SKIP LOCKED` 获取租约；租约过期可重新投递同一 reminder/event，不创建新的业务事实。

## 4. Canonical API 与事件映射

### 4.1 写命令通用契约

所有写命令必须满足：

- 从会话派生 `owner_user_id`，请求体不得指定所有者；父子 ID 以 `(id, owner_user_id[, card_id])` 查询和锁定。
- 必须带 `Idempotency-Key`、规范化请求哈希和 `expected_version`（无需并发控制的只读请求除外）。
- 客户端不能提交 `progress_status`、`qualification_status`、`ledger_balance`、`used_value`、`remaining_value` 或其他派生字段作为事实。
- 同 key 同 hash 重放原响应，不新增事实、事件或提醒；同 key 异 hash 返回 `409 IDEMPOTENCY_KEY_REUSED`。
- 事件和事实、审计、幂等结果、outbox 在同一业务事务中提交；consumer 使用 inbox 去重。

### 4.2 Canonical 命令表

| 命令 | Canonical 入口 | 事件/事实 | 关键前置条件 |
| --- | --- | --- | --- |
| 创建参与实例 | `POST /api/v1/campaigns/{campaignId}/participations` | `ActivityParticipationCreated.v1` | 四元键唯一；规则版本属于活动和用户 |
| 记录资格/报名/名额/结果 | `POST /api/v1/activity-participations/{id}/{eligibility\|enrollment\|quota\|outcome}` | 对应 `Activity*Recorded.v1` | 只记录用户或外部结果，不代报名 |
| 记录奖励组件 | `POST /api/v1/activity-participations/{id}/rewards`、`POST /api/v1/activity-rewards/{id}/result` | `ActivityRewardComponentRecorded.v1` | `reward_key` 唯一；不能自动建积分/权益事实 |
| 创建任务/记录发生 | `POST /api/v1/cards/{cardId}/spend-tasks`、`POST /api/v1/spend-tasks/{id}/entries` | `SpendTaskCreated.v1`、`SpendOccurredRecorded.v1` | 激活时冻结 method/rule snapshot |
| 记录里程碑/冲正 | `POST /api/v1/spend-entries/{id}/milestones`、`POST /api/v1/spend-entries/{id}/reversals` | `SpendPostedRecorded.v1` 等 | settled 需 posted；冲正关联原 entry |
| 记录任务核对 | `POST /api/v1/spend-tasks/{id}/qualification` | `SpendTaskQualificationRecorded.v1` | 官方证据或用户明确核对；不等于本地 target |
| 记录权益使用 | `/api/v1/benefit-entitlements/{id}/usages`、`/api/v1/benefit-usages/{id}/{reservation\|presentation\|redemption}` | `BenefitUsage*` | 只有首次 consumable redeemed 扣 consume |
| 观察/记账/批次 | `/api/v1/points-accounts/{id}/{observations\|entries\|lots}`、`/api/v1/points-entries/{id}/lot-allocations` | `PointsBalanceObserved.v1` 等 | 账户锁和 sequence；未知批次不自动分配 |
| 兑换四轴 | `/api/v1/redemptions/{id}/{order-result\|fulfillment\|points-debit\|refund-result}` | `Redemption*Recorded.v1`、ledger entry | 订单、履约、扣分、退分独立 |

### 4.3 旧事件名称的单向 upcast

正式架构早期列表与 Round7 名称不完全一致。事件总线只发布 canonical 事件；旧名称由读取 adapter/upcaster 解释，不能同时发布两份事件，否则会产生重复提醒或重复记账。

| 旧/含混事件 | Canonical 事件 | 不可推导时的处理 |
| --- | --- | --- |
| `ParticipationEligibilityRecorded.v1`、`ActivityEligibilityConfirmed.v1` | `ActivityEligibilityRecorded.v1` | 缺证据时保留 `unknown/needs_review` |
| `EnrollmentResultRecorded.v1`、`ActivityEnrollmentRecorded.v1` | `ActivityEnrollmentResultRecorded.v1` | `enrolled` 只能映射 `confirmed`，不能映射 `submitted` 以外的银行事实 |
| `QuotaResultRecorded.v1` | `ActivityQuotaRecorded.v1` | 没有名额证据时为 `unknown` |
| `ActivityTargetReached.v1`、`SpendTaskTargetReached.v1` | `ActivityOutcomeRecorded.v1` 或 `SpendTaskProgressRecomputed.v1` | 只能表达本地投影，不得生成 reward/points/benefit |
| `RewardStatusChanged.v1` | `ActivityRewardComponentRecorded.v1` | 没有 `reward_key` 时使用 `legacy:unknown` 并标记待核对 |
| `BenefitEntitlementGranted.v1`、`BenefitUsed.v1` | `BenefitDeliveryRecorded.v1`、`BenefitRedeemed.v1`/`BenefitUsageReviewRequired.v1` | `used` 未说明是否现场核销时不得扣额度 |
| `SpendTaskProgressRecorded.v1` | `SpendOccurredRecorded.v1` 或 `SpendTaskProgressRecomputed.v1` | payload 不能区分 entry 与投影时只生成待核对投影 |
| `RedemptionSubmitted.v1`、`RedemptionStatusChanged.v1`、`RedemptionFailed.v1` | `RedemptionOrderResultRecorded.v1` 或 `RedemptionFulfillmentRecorded.v1` | 轴不明确则 `unknown`，不能猜测 debit/refund |
| `NotificationScheduled/Delivered/Failed.v1` | `ReminderScheduled/DeliveryAttemptRecorded.v1` | 旧投递记录补齐 lease/attempt 前只能兼容读 |

所有 canonical 事件必须带 `event_id`、`schema_version`、`aggregate_type/id/version`、`owner_user_id`、`occurred_at`、`actor`、`correlation_id`、`causation_id`、`business_key`、`source_snapshot_id`（适用时）和最小 payload。未知 schema 进入 inbox blocked/dead-letter 并告警，不能静默忽略或部分应用。

## 5. 旧年费和简化活动模型的单向兼容

### 5.1 兼容方向和阶段

不允许 canonical 与旧表双向写入。迁移分两段：

1. **切换前**：旧 API 写入由 `AnnualFeeCompatAdapter`/`LegacyActivityAdapter` 接收，转换成 canonical command；旧表继续作为旧页面的只读来源，禁止 adapter 再把 canonical 结果写回旧表。
2. **切换后**：canonical 是唯一事实源；旧 API 只从 canonical read adapter 生成旧响应，写请求返回 `Deprecation`、`Link` 和 `409 DEPRECATED_WRITE_PATH`，退役后返回 `410 GONE`。POST 不自动重定向，避免客户端重试造成重复事实。

旧表保留期、导出和删除清理必须覆盖 canonical 与兼容投影；不能用“删旧表”作为回滚策略。

### 5.2 年费 `fee_cycles`/`progress_entries` 映射

| 旧对象/状态 | Canonical 映射 | 约束和信息损失 |
| --- | --- | --- |
| `fee_cycles(id, card_id, period_start/end)` | `SpendTask(task_type=annual_fee, activity_instance_key=legacy:fee-cycle:{id})` | 以旧 ID 固定实例键；不按标题或日期重新合并 |
| `waive_rule_type/target_*` | `SpendTaskRuleSnapshot` | `custom` 保留原文并为 `needs_review`，不执行 DSL |
| `fee_cycles.open` | `lifecycle_status=active`、`progress_status=in_progress/not_started` | 不代表银行尚未入账或资格未确认 |
| `fee_cycles.qualified` | `progress_status=target_reached` | `qualification_status=unconfirmed`；旧值不是银行确认 |
| `fee_cycles.closed` | `lifecycle_status=ended` | 以旧周期结束日冻结读投影；不自动判定 shortfall |
| `progress_entries.entry_date` | `SpendEntry.occurred_on` | 没有 posted/settled 来源，里程碑保持缺失；确定进度不能回填 |
| `entry_type=manual` | `contribution`（金额/次数为正） | 仅表示用户录入；证据为 `user_asserted/needs_review` |
| `entry_type=correction` | `correction`，保存旧累计值和调整前投影 | 旧表没有完整版本历史，不能恢复编辑前事实 |
| `reversed_at` 或旧 reversal 行 | `reversal` 关联原 entry | 只能按可识别 ID 关联；关联不完整则保留负向事实并标记争议 |
| 旧 cycle 进度汇总 | `SpendTask` 可重算投影 | 同时保留 `legacy_progress_total` 对账值，差异进入 `needs_review` |

旧进度服务允许 UPDATE entry，而 canonical entry 不可变。迁移时先捕获当前行、`created_at/updated_at`、审计记录和 reversal 关系；若无法证明某次编辑的前值，不得虚构事件序列。迁移后的新客户端只使用 `/spend-entries/{id}/milestones` 和 reversal API。

### 5.3 旧 `CardActivity`/简化活动映射

若历史或未来简化模型只有一行 `CardActivity`：

- 创建一个 `Campaign` 和每张适用卡一个 `ActivityParticipation`；不能把 `applicable_card_ids` 作为个人参与状态数组继续写入。
- 没有周期/批次键时使用稳定 `activity_instance_key=legacy:activity:{id}`，同时记录 `instance_key_source=legacy`；无法确认规则周期则 `needs_review`，禁止自动创建第二周期。
- 旧 `qualified/enrolled/reward_received` 只映射到相应轴的兼容读字段。`reward_received` 没有 `reward_key` 或官方证据时不得生成 PointsEntry、Benefit grant 或确定到账。
- 多卡旧消费不得自动合并。只有显式建模为同一 `PointsAccount` 的积分账户才允许共享账本；任务和参与实例仍按卡隔离。

### 5.4 回滚边界

在 canonical 写路径开启前，可回退到旧读写服务；开启后只能回退读路由，不能让旧服务继续写同一事实。若 canonical projection 落后，显示 `stale/pending` 并重放 outbox；不能回写旧表“修复”页面，也不能删除已经提交的 canonical 事件。

## 6. 并发、幂等与恢复契约

### 6.1 锁顺序与并发边界

- `SpendTask`：锁 task 根行 -> 分配 entry sequence -> 插入 entry/milestone -> 重算投影 -> 审计/outbox。
- `BenefitEntitlement`：锁 entitlement -> 锁 usage ledger 水位 -> 校验首次 consume/restore -> 追加流水。
- `PointsAccount`：锁 account 根行 -> 分配 ledger sequence -> 追加 entry -> 追加 lot allocation（如有）-> 刷新差额/审计/outbox。
- `Redemption`：锁 redemption 仅写自身轴；积分扣减由 points 模块在独立事务处理，不能跨模块持锁调用。
- Reminder worker：只锁 reminder/attempt 行并持租约；不得锁业务聚合后发送外部通知。

固定顺序防止同一模块死锁；跨模块只传事件或公开 command。`expected_version` 过期返回 `409 VERSION_CONFLICT`，客户端必须重新读取后决定是否重试，禁止盲目覆盖。

### 6.2 Idempotency-Key 语义

幂等键作用域为 `(owner_user_id, command_name, resource_id, idempotency_key)`；请求哈希应包含规范化 method/path/schema/body，不包含可变 trace 字段。服务端持久化首次响应、事实 ID、事件 ID、request hash 和过期时间：

- 同 key 同 hash：返回原 HTTP 状态和 body，不重新写事实或发布事件。
- 同 key 异 hash：`409 IDEMPOTENCY_KEY_REUSED`，保留两次请求审计。
- key 记录过期后不能保证重放；业务自然键（如 `redemption:{id}:debit`、`usage:{id}:consume`）必须永久唯一，防止长延迟 worker 重复记账。
- consumer 以 `(consumer_name,event_id)` inbox 去重，副作用再以业务键去重；重试不产生新 aggregate version。

### 6.3 失败、重放和恢复

| 场景 | 必须行为 | 禁止行为 |
| --- | --- | --- |
| 事务已提交、publisher 宕机 | outbox 重试，事实仍可读，读模型标 `pending/stale` | 重新执行用户命令或补写第二事实 |
| consumer 执行中宕机 | lease 到期后按原 event/inbox 重试 | 创建新业务 ID 规避重复 |
| 未知 event/schema | inbox `blocked` + dead-letter + 告警，等待 upcaster | 静默丢弃、只应用部分 payload |
| 投影与事实不一致 | 从 canonical event sequence 重建并比较 checksum | 修改事实表或用缓存覆盖账本 |
| 积分/权益超额或负值 | 保留原流水，投影 `needs_review`，暂停自动建议 | 截断为 0、自动补 adjustment |
| 外部订单成功但扣分未知 | order/fulfillment 保留，debit=`pending_debit/needs_review` | 将订单改失败或猜测退分 |
| 规则/日期/名额未知 | 保存 unknown 及证据和下一步 | 默认填充“可用/达标/已到账/已过期” |

备份恢复必须能够重建 outbox/inbox 水位、Points ledger、Benefit usage ledger 和 Reminder lease。P0/P1 发布前需冻结 RPO/RTO 数值并完成 PITR/恢复演练；在没有真实 PostgreSQL、worker 和恢复证据前，本稿不构成部署许可。

## 7. 未知状态与错误契约

业务状态响应必须同时返回 `status`、`review_status`、`reason_code`、`evidence_note`、`last_verified_at`、`next_action`、`as_of` 和 `stale`（适用时）。`unknown` 可作为已提交的观察事实返回，但不能被包装成成功、可用、已达标、已到账、已扣分或已过期。

| HTTP | 错误码/响应 | 使用场景 | 客户端处理 |
| --- | --- | --- | --- |
| `201/200` | `committed=true` + `status=unknown|needs_review|pending` | 观察事实已提交，但外部结果或投影尚未确定 | 展示待核对和 `next_action`，不显示成功结论 |
| `202` | `accepted=true` + `operation_id` | 命令本身明确异步，事实尚未提交完成 | 轮询 operation；不能当作业务成功 |
| `404` | `NOT_FOUND` | 越权、跨用户、父子不兼容或已隐藏资源 | 不泄露资源是否存在 |
| `409` | `STATE_CONFLICT` | 非法状态转移、归档对象继续写入、unknown 不满足前置条件 | 重新读取状态，要求用户补证据或采取允许动作 |
| `409` | `VERSION_CONFLICT` | `expected_version` 过期 | 重新读取并由用户决定合并 |
| `409` | `IDEMPOTENCY_KEY_REUSED` | 同键不同请求哈希 | 生成新客户端命令键，不覆盖原事实 |
| `410` | `DEPRECATED_WRITE_PATH` | 兼容窗口结束后的旧写 URL | 切换 canonical API；POST 不自动重定向 |
| `422` | `EVIDENCE_REQUIRED` / `UNKNOWN_NOT_ALLOWED` | 命令要求 confirmed/posted/official evidence，但当前为 unknown | 补来源、核对时间和证据；不自动猜测 |
| `422` | `RULE_INCOMPLETE` / `INVALID_BOUNDARY` | 规则版本、币种、周期、method snapshot 或四元键缺失/冲突 | 修正输入或创建新规则/任务 |
| `503` | `DEPENDENCY_UNAVAILABLE` | outbox/数据库等提交依赖不可用，事实未提交 | 可安全重试原 key；服务端不得返回 committed |

状态为 `needs_review/disputed` 时可以记录新的证据命令，但不能直接调用依赖确定状态的扣减、发奖、到期或自动提醒命令。提醒只针对明确日期和事实版本生成；unknown 日期不创建“到期”提醒。

## 8. P0/P1 Rollout Gates

### Gate 0：契约冻结（P0/P1 共用阻断门）

- canonical 聚合、四元活动键、`SpendMilestone` 路径、权益 ledger、积分双差额和兑换四轴写入正式 API/事件目录。
- 删除或标记所有新写入仍会生成的 `qualified`、`reward_received`、`points_held`、单一 redemption `success` 和旧 milestone 路径；保留兼容读映射。
- 所有命令具备 ownership、Idempotency-Key、request hash、expected_version、审计和 outbox/inbox 契约测试。
- 建立旧年费/简化活动 fixture，验证 `legacy -> canonical` 只生成一次事实且未知证据不被升级。

### Gate 1：Expand 与 shadow replay

- 新表、复合所有权、事件序列和投影可扩展部署；旧表和旧 API 仍能读。
- 对每个旧 `fee_cycle` 重放后，canonical 任务的 count/amount 与旧 read model 一致；任何差异进入报告，不自动修正。
- 完成 event upcaster、outbox publisher、inbox 去重、lease 回收、dead-letter 告警和投影重建演练。
- 真实 PostgreSQL 约束、RLS/IDOR、跨时区边界、备份/PITR 演练通过后才允许写切换。

### Gate 2：P0 活动 + 单卡刷卡任务

- 活动资格、报名、名额、任务结果和 reward component 五轴分别可记录；同活动不同卡/周期隔离。
- occurred/posted/settled/rejected、snapshot/entries 互斥、退款/冲正、暂时达标回退和 unknown 错误契约通过集成及 E2E。
- `SpendMilestone` canonical URL 生效；旧 `/spend-task-entries/**` 只读或带弃用头，不再扩展字段。
- 站内提醒只由明确日期/事件版本生成，发送失败不改变任务或奖励事实。

### Gate 3：P1-a 权益

- `consumable_quota` 首次 redeemed 只扣一次；预约、出示、拒绝、争议、非配额 usage 不扣；restore 必须关联 consume。
- 并发核销、重复命令、负额度、归档卡和恢复重放通过真实数据库测试；无法证明 usage model 的对象进入 unknown/needs_review。

### Gate 4：P1-b 积分与手工兑换

- confirmed/ledger/lot 三层及两个差额可重算，PointsEntry/Allocation 禁止 UPDATE/DELETE；余额不足、账户冻结和超分配保留事实并标记 needs_review。
- redemption order/fulfillment/debit/refund 四轴可独立推进；成功订单不自动扣分，失败/取消不自动退分，重复 debit/refund 只命中同一业务键。
- 并发记账、乱序/重复事件、consumer 宕机、PITR 恢复和跨用户 IDOR 通过测试；P1 不启用 hold/reserve、自动 lot 或外部 connector。

### Gate 5：Contract 与退役

- 所有客户端切换 canonical API/事件，旧写路径在观测窗口内无调用；导出、删除和审计覆盖 canonical 与兼容投影。
- 先禁用旧写，再等待保留期和恢复验证，最后删除兼容约束；任何回滚只能切换读路由或重放 canonical，不能恢复双向写入。

## 9. 验收样例与剩余风险

### 9.1 最小契约样例

1. 同一 campaign、同一卡、两个 `activity_instance_key` 能并存；一张卡的任务和奖励不会被另一周期消费污染。
2. 旧 `fee_cycles.qualified` 迁移后显示 `target_reached + qualification=unconfirmed`，没有 posted milestone 时确定进度仍为 pending。
3. 重复 milestone、consume、debit 或 refund 命令返回首次响应，不产生第二事实、事件或提醒。
4. `confirmed=100, ledger=90, lots=80` 分别显示两个 `+10` 差额，状态为 mismatch/needs_review，不生成 lot 或 expire。
5. 订单 fulfilled 但官方扣分未知时，四轴显示 fulfilled + pending_debit；订单取消不写 refund。
6. unknown 记录缺少 `reason_code/evidence_note/next_action` 时返回 `422`；补齐后可提交 unknown 观察，但不能返回成功结论。
7. 旧写 URL 在兼容期返回弃用信息并只通过 adapter 生成 canonical 事实；退役后返回 `410`，不存在 POST 自动重定向。

### 9.2 风险与未决项

- `activity_instance_key` 的用户可见格式、规则版本与周期的生成责任仍需产品和 DBA 签收。
- 旧 `progress_entries` 的可变编辑缺少完整历史；迁移只能保证当前快照与可识别 reversal，无法恢复未知的中间版本。
- Reminder lease 时长、重试退避、dead-letter 保留期、RPO/RTO 和 projection stale 阈值尚未冻结。
- 部分退分、跨卡联合活动、自动 lot 建议、系统内 reservation 和外部连接器继续属于 P2，不能由本稿默认开启。
- 以上契约尚未在真实 PostgreSQL、RLS、worker、迁移回滚、恢复和领域 E2E 中验证。

## 10. Handoff

- **Changed files**：`docs/research/CARD-DOMAIN-ROUND8-ARCHITECTURE.md`。
- **Key decisions**：补齐 canonical 聚合所有权；统一活动/奖励、SpendMilestone、权益 usage ledger、积分 lot allocation、兑换四轴和 Reminder 的命令/事件边界；旧年费与简化活动只做单向 adapter；明确 unknown、幂等、并发、恢复和 P0/P1 gates。
- **Validation**：静态审查 PRD/ARCH/DBA/代码基线；`git diff --check -- docs/research/CARD-DOMAIN-ROUND8-ARCHITECTURE.md` 已通过；未运行真实迁移、API、worker、RLS 或 E2E。
- **Risks/open questions**：实例键生成、旧进度编辑历史、worker lease/dead-letter 参数、RPO/RTO、部分退分和多卡联合活动仍需产品/DBA/运维签收。
- **Ready for integration**：yes。主会话可将本稿作为 Round8 架构补充合并；本稿未修改正式文档、代码或迁移。
