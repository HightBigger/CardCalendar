# Cardfolio 卡领域架构研究复核

文档版本：v0.1
复核日期：2026-08-14
角色：领域架构师
范围：卡活动、卡权益、刷卡方式/任务、积分账户/批次、兑换
基线文档：[ARCHITECTURE-WORKBENCH.md](../ARCHITECTURE-WORKBENCH.md)（第二轮复核稿）、[PRD-WORKBENCH.md](../PRD-WORKBENCH.md) v0.4、[DATABASE-WORKBENCH.md](../DATABASE-WORKBENCH.md)

本稿是独立研究和冲突清单，不修改正式架构、需求、数据库或代码。正式文档中的第二轮条款仍需由主会话按本稿的“需要修订”清单合并。

## 1. 复核结论

现有架构的模块化单体、PostgreSQL、不可变来源快照、outbox/inbox、按用户隔离和手工录入边界是正确的，足以承载工作台扩展。但正式文档中同时存在第一轮简化状态和第二轮精确状态，若直接实现会出现以下事实错误：

1. 把“适用资格、报名结果、达标结果、奖励到账”压成一条状态，或把 `eligible` 当作已报名。
2. 把预约成功当作权益已使用，提前扣减次数/额度。
3. 把发生的消费当作已入账/清算，把预计进度显示为银行确认的达标。
4. 把兑换订单成功当作积分已扣，把订单失败当作积分已退，或把 `points_held` 当成已经实现的预占。

本稿建议以四条独立事实链为唯一写模型契约。每条链都采用“不可变事实 + 可重算投影 + 用户确认结果”，跨模块只通过命令端口和可靠事件协作。P0 只交付单卡、手工、可追溯的活动/消费纵切；权益、积分和兑换作为独立 P1 纵切；系统内预占、自动导入和外部连接器留在 P2。

## 2. 共同架构不变量

### 2.1 事实、投影和用户判断三分

| 层 | 例子 | 可否覆盖旧值 | 说明 |
| --- | --- | --- | --- |
| 不可变事实 | 来源快照、消费里程碑、预约结果、积分流水、兑换退款确认 | 不可覆盖；更正追加关联事实 | 事实带 `source_snapshot_id`/`provenance`、发生时间、操作者和业务幂等键 |
| 可重算投影 | 任务预计/确定进度、权益剩余、积分账面余额、首页汇总 | 可从事实重建 | 投影必须带 `as_of`/水位，过期时显示 `stale`，不能回写为新事实 |
| 用户确认判断 | 符合资格、银行已确认达标、奖励已到账、官方账户已扣分 | 只能追加新的确认或争议 | UI 必须明确“用户已记录/已核对”，不得写成银行实时确认 |

规则版本在对象实例化时冻结。规则更新只影响未开始对象或新实例；进行中/已结束实例继续引用旧版本并提示 `needs_review`。`unknown` 是合法值，不得用前端默认值替代。

### 2.2 命令、锁和一致性

- 写命令从会话取得 `owner_user_id`，先按 `(aggregate_id, owner_user_id)` 查找并锁定根聚合；跨用户资源统一返回 `404`。
- 同一聚合内使用一个事务和 `expected_version` 乐观锁；账户余额、权益额度和序号分配使用 `SELECT ... FOR UPDATE`。锁顺序固定为“根聚合 -> 不可变 entry/allocation -> 审计/outbox”，禁止跨模块持锁调用。
- 所有会产生事实的命令接受 `Idempotency-Key`。服务端保存用户、命令名、请求哈希和首次响应：同键同哈希返回首次结果，同键不同哈希返回 `409 IDEMPOTENCY_KEY_REUSED`。
- 事实写入、状态投影、审计和 outbox 在同一事务提交；消费者以 `(consumer_name, event_id)` 去重，失败重试或进入死信，不删除已提交事实。
- 跨模块只保证最终一致。命令响应只承诺所属聚合已提交的状态；积分记账、通知和首页投影在 `pending` 时必须显示处理中和 `as_of`，不能返回“成功”。

## 3. 事实链 A：活动资格 -> 报名 -> 达标 -> 奖励

### 3.1 所有权和正交状态

`Campaign` 只拥有活动规则和生命周期；`ActivityParticipation` 以 `(owner_user_id, campaign_id, card_id)` 唯一，拥有个人视角的状态。资格、报名、名额、达标和奖励不是同一个枚举，建议保留五个轴：

| 轴 | 最小状态 | 允许转移 | 禁止/含义 |
| --- | --- | --- | --- |
| 活动生命周期 | `draft -> published -> ended/cancelled` | 结束后可补录历史结果 | `ended` 不自动把个人参与标成失败 |
| 资格 | `unknown -> potentially_eligible -> user_confirmed_eligible/ineligible`；任意状态 -> `needs_review` | 只有用户或官方来源确认才能进入 `user_confirmed_*` | `potentially_eligible` 不能作为可参加或达标条件 |
| 报名 | `not_required` 或 `not_started -> submitted -> confirmed/failed/expired/unknown`；`submitted -> cancelled` | `confirmed` 必须有外部渠道、核对时间或用户证据 | Cardfolio 只记录报名结果，不调用银行报名接口 |
| 名额 | `not_applicable/unknown -> available/full/waitlisted/allocated/not_allocated` | 依据用户官方渠道核对 | `available` 不等于已分配；`full/not_allocated/unknown` 禁止最终达标 |
| 活动结果 | `not_started <-> in_progress <-> target_reached`；任意状态 -> `needs_review` | 任务目标达到只表示本地计算结果 | `target_reached` 不是银行资格确认 |
| 奖励 | `not_expected -> expected_pending -> received`；`expected_pending/received -> delayed/reversed/disputed/needs_review` | 仅在来源有发放时限时计算 `expected_on` | 达标不自动发奖励；奖励积分不自动写 PointsEntry |

其中 `submitted` 表示“用户已在外部渠道执行并记录请求”，不是系统代报名成功。若产品保留旧的 `Enrollment: eligible -> enrolled` 表述，应废弃该表述，采用上述正交轴。

### 3.2 命令/API 契约

| 命令 | 推荐接口 | 结果 |
| --- | --- | --- |
| 创建规则/活动 | `POST /api/v1/campaigns`、`POST /api/v1/rules/{ruleId}/versions` | 生成 draft，激活前必须有 primary source citation |
| 创建参与实例 | `POST /api/v1/campaigns/{id}/participations` | 仅创建用户记录，不代表资格/报名成功 |
| 记录资格/报名/名额 | `POST /api/v1/activity-participations/{id}/actions`，动作 `confirm_eligibility`、`record_enrollment_result`、`record_quota_result` | 写对应轴、证据和审计；不访问外部渠道 |
| 记录任务结果 | `POST /api/v1/activity-participations/{id}/actions`，动作 `record_target_reached`、`confirm_qualification` | `target_reached` 和用户确认分开返回 |
| 记录奖励 | 同上，动作 `confirm_reward_received`、`mark_reward_delayed`、`mark_reward_reversed`、`mark_reward_disputed` | 奖励轴独立变化，不回写任务进度 |

不应提供语义为“代报名”的 `POST /campaigns/{id}/enrollments`；如保留兼容路径，动作名称必须改为 `record_enrollment_result`，请求必须带 `external_channel`、`verified_at` 和 `evidence_note`，并在帮助文案中明确需要用户先在官方渠道操作。

幂等键建议：`participation:{id}:eligibility:{revision}`、`participation:{id}:enrollment:{external_ref}`、`participation:{id}:reward:{confirmation_ref}`。同一参与实例的状态命令锁参与行；并发重复创建由唯一键保证只有一条实例。

### 3.3 事件、读模型和恢复

事实事件使用版本化名称：`CampaignPublished.v1`、`ParticipationEligibilityRecorded.v1`、`EnrollmentResultRecorded.v1`、`QuotaResultRecorded.v1`、`ActivityTargetReached.v1`、`QualificationConfirmedByUser.v1`、`RewardReceiptRecorded.v1`、`RewardStatusChanged.v1`。不要用一个 `ActivityQualified` 事件同时表示目标达到、银行确认和奖励到账。

工作台投影至少返回五轴状态、规则版本、`source_confidence`、`as_of`、`stale` 和待核对原因。事件重复、乱序或消费者宕机只会延迟投影；重放 participation 事件即可恢复，不能把失败重试解释成报名成功。奖励超期仅转 `delayed` 并提醒用户，不能自动发起投诉或创建积分流水。

### 3.4 分期

- P0：单卡、用户自录活动/资格/报名/名额、单一 SpendTask、用户确认达标和奖励状态；不自动报名、不发权益、不记积分。
- P1：活动模板复用、导入预览、更多奖励履约类型；仍需逐条用户确认。
- P2：规则订阅或第三方同步；必须单独授权和安全评审。

## 4. 事实链 B：权益下发 -> 预约 -> 核销/拒绝

### 4.1 两个实例和三个状态轴

`Benefit` 是规则身份，`BenefitEntitlement` 是某张卡某个周期实际下发的实例，`BenefitUsage` 是一次预约/出示/使用尝试。下发、预约和现场结果必须正交：

| 轴 | 最小状态 | 允许转移 | 禁止/含义 |
| --- | --- | --- | --- |
| 下发/可用 | `pending_delivery -> available`；`available -> suspended/expired/revoked`；任意未过期状态 -> `needs_review` | `available` 必须有凭证、下发日期或用户核对 | 活动达标只能发 `EntitlementGrantSuggested`，不能自动变 available |
| 预约 | `not_required/not_booked -> requested -> confirmed`；`requested/confirmed -> rejected/cancelled/unknown` | 保存预约渠道、时间和掩码参考号 | `confirmed` 不代表已现场使用，也不扣次数 |
| 出示/核销 | `not_presented -> presented -> used`；`presented -> rejected/disputed`；`used -> disputed` | 第一次 `used` 才追加 consume ledger | `booked/rejected/cancelled/disputed` 不扣减额度 |

权益额度由不可变 `grant/adjust/consume/restore` 流水重算。使用时锁 `BenefitEntitlement`，检查剩余额度和单位，再以 `usage:{usage_id}:consume` 插入一次消费事实；使用撤销以 `usage:{usage_id}:restore` 追加反向事实。余额负数或重复恢复进入 `needs_review`，不得截断为零。

### 4.2 命令/API 契约

| 命令 | 推荐接口 | 结果 |
| --- | --- | --- |
| 记录外部下发 | `POST /api/v1/benefits/{id}/entitlements`，动作 `confirm_delivery` | 记录用户确认的凭证、周期和来源，不向服务商发请求 |
| 记录预约 | `POST /api/v1/entitlements/{id}/usages`、`.../actions` 的 `record_booking` | 只改变预约轴 |
| 记录现场结果 | `record_presentation`、`confirm_usage`、`record_rejection`、`mark_disputed` | `confirm_usage` 才改变剩余额度 |
| 修正已用 | `reverse_usage` | 追加 restore，原 consume 保留 |

幂等键建议：`entitlement:{id}:delivery:{external_ref}`、`usage:{id}:booking:{booking_ref}`、`usage:{id}:consume`、`usage:{id}:restore`。预约和核销命令使用 `expected_version`；额度检查和 consume 写入必须在同一事务内完成。

事件使用 `BenefitDeliveryRecorded.v1`、`BenefitBookingRecorded.v1`、`BenefitUsed.v1`、`BenefitUsageRejected.v1`、`BenefitUsageReversed.v1`。读模型同时返回 `reservation_status`、`redemption_status`、`remaining_value`、`as_of`；投递失败只影响通知或外部记录状态，不回滚用户已确认的使用事实。

### 4.3 分期

权益账本是 P1。P0 只能保存规则来源和“后续支持”说明，不创建虚假的可用次数。凭证附件和服务商接口属于 P1/P2 的独立安全评审范围。

## 5. 事实链 C：消费发生 -> 入账 -> 清算 -> 退款/冲正

### 5.1 事实与进度正交

一笔消费不能用一个可编辑状态列覆盖所有阶段。建议把事实建模为不可变 entry 加追加 milestone：

| 事实轴 | 状态/转移 | 解释 |
| --- | --- | --- |
| 交易里程碑 | `occurred -> posted -> settled`；`occurred -> rejected` | 只允许追加后续里程碑，不允许把 posted 改回 occurred |
| 修正 | 新 entry `reversal_of=原 entry`，可部分退款；原 entry 保留 | 原 entry 的派生状态可显示 `partially_reversed/reversed`，不物理删除 |
| 资格 | `unknown/pending -> included/excluded/disputed` | 由任务规则快照、日期口径和用户证据决定，不由金额自动推断 |
| 任务生命周期 | `draft -> active -> ended/cancelled` | 归档或结束不删除流水 |
| 任务进度 | `not_started <-> in_progress <-> provisionally_qualified <-> target_reached`；任意状态 -> `needs_review` | `provisionally_qualified` 仅表示预计条件满足；`target_reached` 仍不是银行确认 |
| 用户资格确认 | `unconfirmed -> user_confirmed/rejected`；其后可因退款/规则变更进入 `needs_review` | 必须显示确认人、时间、证据和影响原因 |

`cutoff_basis=occurred/posted/settled` 决定进入确定进度所需的 milestone；缺少所需 milestone 的 entry 只能进入预计进度。`snapshot` 和 `entries` 是互斥输入模式，不能相加。

### 5.2 命令/API 契约

| 命令 | 推荐接口 | 关键约束 |
| --- | --- | --- |
| 建立任务 | `POST /api/v1/cards/{cardId}/spend-tasks` | 冻结规则、方法、币种、时区、窗口和截止口径 |
| 记录发生事实 | `POST /api/v1/spend-tasks/{id}/entries` | `mode=increment` 或 `snapshot`；必须有 `provenance` |
| 追加入账/清算 | `POST /api/v1/spend-task-entries/{id}/milestones` | milestone 只能单向追加，日期必须满足 occurred <= posted <= settled |
| 记录退款/冲正 | `POST /api/v1/spend-task-entries/{id}/reverse` | 新建关联反向 entry；部分反向金额不超过原金额 |
| 确认任务结果 | `POST /api/v1/spend-tasks/{id}/actions` | `confirm_qualification`、`reject_qualification`、`mark_needs_review`；不叫 `bank_confirmed` |

幂等键建议：`spend:{task_id}:entry:{client_key}`、`spend:{entry_id}:milestone:{kind}:{client_key}`、`spend:{entry_id}:reversal:{client_key}`。写入时先锁 task，再锁 entry，重算预计/确定进度并在同一事务写 outbox。并发录入由业务键和版本冲突保护；两个合法不同 entry 可以并发，聚合重算必须串行化。

事件使用 `SpendOccurredRecorded.v1`、`SpendPosted.v1`、`SpendSettled.v1`、`SpendRejected.v1`、`SpendReversed.v1`、`SpendTaskProgressChanged.v1`、`SpendTaskQualificationNeedsReview.v1`。不要使用未带口径的 `SpendTaskQualified` 来表示银行认定。

退款或冲正影响已确认任务时，事务保留原确认快照、追加反向事实并将当前资格置 `needs_review`；消费者失败时重试重算，不能删除原消费或自动判定活动奖励撤回。

### 5.3 分期

这是 P0 的核心链路，但范围限定为手工录入。银行账单导入、MCC 自动识别、自动判定商户资格和第三方同步为 P1/P2；在这些能力上线前，所有“已入账/已清算”都必须是用户从官方渠道核对后的记录。

## 6. 事实链 D：积分余额 -> 批次 -> 兑换扣减 -> 退款

### 6.1 余额、批次和兑换两轴

积分账户必须区分用户观察值、账本值和批次分配值：

```text
ledger_balance = sum(PointsEntry.amount)
lot_remaining_total = sum(有效 PointsLotAllocation)
unallocated_difference = ledger_balance - lot_remaining_total
```

正差额表示未分配，不得虚构到期日；负差额表示超分配，账户进入 `mismatch/needs_review`。`confirmed_balance` 是用户从官方渠道录入的观察快照，不是可 PATCH 的事实余额；对账只产生 reconciliation 和显式 adjustment 流水。

批次状态为 `open -> partially_used -> used/expired`，也可进入 `void/disputed`。P1 允许用户指定批次并逐批确认；`consumption_order=earliest_expiry_first` 只能生成建议，遇用途限制立即停止，不能静默跳过。

兑换状态必须拆成订单和积分两轴：

| 轴 | 状态/转移 | 说明 |
| --- | --- | --- |
| 外部订单 | `planned -> submitted -> processing -> success`；`submitted/processing -> failed/cancelled/unknown`；`success -> refund_pending -> refunded` | 仅记录用户在外部渠道执行的结果；不自动下单 |
| 本地扣减 | `not_debited -> pending -> posted/needs_review`；`posted -> pending_refund -> refunded/needs_review` | `success` 不等于 `posted`；退款不等于积分已退 |

首版不使用 `points_held`/`redeem_hold`。若未来需要系统内预占，必须设计独立 hold/release 流水、到期回收和并发超额测试，不能复用 P1 的 `pending`。

### 6.2 命令/API 契约

| 命令 | 推荐接口 | 关键约束 |
| --- | --- | --- |
| 记录余额观察 | `POST /api/v1/points-accounts/{id}/reconciliations` | 保存官方来源、观察时点和差额；禁止 `PATCH balance` |
| 追加积分事实 | `POST /api/v1/points-accounts/{id}/entries` | 只追加 earn/adjust/expire/redeem_debit/reversal；账户内分配 sequence |
| 指定批次 | `POST /api/v1/points-entries/{id}/lot-allocations` | 用户确认后写 allocation；不自动 FIFO |
| 记录外部兑换 | `POST /api/v1/redemptions` | 创建 planned/submitted 记录，不触发外部渠道 |
| 记录结果/扣减/退款 | `POST /api/v1/redemptions/{id}/actions` | `confirm_success`、`record_failure`、`record_refund`；ledger consumer 以固定业务键记账 |

扣减业务键固定为 `redemption:{id}:debit`，退款为 `redemption:{id}:refund`。账户行锁负责 sequence 和余额投影；兑换行使用 `expected_version`，不能由 redemption 模块直接 UPDATE points ledger。若外部订单已成功而本地余额不足、账户冻结或批次不清，保留订单成功事实，扣减轴进入 `needs_review`，允许负账面余额并告警，不把订单改成失败。

事件使用 `PointsBalanceObserved.v1`、`PointsLedgerEntryPosted.v1`、`RedemptionDebitRequested.v1`、`RedemptionDebitPosted.v1`、`RedemptionDebitNeedsReview.v1`、`RedemptionRefundRequested.v1`、`RedemptionRefundPosted.v1`。`PointsReservationHeld.v1` 和 `PointsReservationReleased.v1` 只能在 P2 系统内预占能力启用后加入事件目录。

读模型并列展示 `confirmed_balance`、`ledger_balance`、`lot_remaining_total`、`unallocated_difference`、订单状态、扣减状态、`as_of` 和 `stale`。消费者重复或宕机时依靠业务键/inbox 重试；永远不能因本地 `failed` 猜测官方积分已经退回，只有用户再次核对并记录退回才写 reversal。

### 6.3 分期

- P0：不创建积分账户、批次或兑换账本。
- P1：余额观察、append-only ledger、批次差额、外部手工兑换双状态、用户确认扣减/退款。
- P2：系统内预占、自动批次建议执行、外部目录/库存或连接器；每项需安全、并发、恢复和合规评审。

## 7. 统一 API 禁止清单

以下行为无论 API 名称如何都不允许进入 P0/P1：

- 代用户报名、预约、购买、兑换或向银行/服务商提交个人信息。
- 把 `pending`、`submitted`、`processing`、`potentially_eligible` 或 `target_reached` 返回为成功、已达标、已扣分或已到账。
- 根据活动达标自动发放权益、生成积分流水或创建兑换订单。
- 根据交易发生时间猜测已经入账/清算；根据订单失败、取消或超时猜测积分退回。
- 根据 `consumption_order` 自动分配用途受限的批次；根据银行名称/卡种模板预填未经核验的规则数值。
- `PATCH` 历史 entry、积分余额、权益剩余或规则版本；修正必须追加 correction/reversal 并保留审计。
- 接受完整卡号、CVV、银行密码、网银会话、短信验证码或原始登录响应。

统一错误语义：参数和来源不足为 `422`，资源不属于当前用户为 `404`，状态/版本/幂等冲突为 `409`，异步处理返回 committed 状态加 `pending`/`needs_review`，不得用 `200 success` 掩盖待处理。

## 8. 事件、缓存和恢复策略

### 8.1 事件信封

事件统一携带 `event_id`、`event_type.v1`、`aggregate_type/id`、`aggregate_version`、`occurred_at`、`actor`、`correlation_id`、`causation_id`、`business_key` 和最小 payload。payload 只包含下游建立投影所需的 ID、金额/单位、规则版本和事实时间，不复制可变展示名称或敏感材料。

发布者在业务事务内写 outbox；publisher 使用 `FOR UPDATE SKIP LOCKED`，消费者写 inbox 去重后调用拥有模块公开命令。消费者更新缓存携带 source sequence，旧事件不得覆盖新水位。死信只触发告警和人工重放，不回滚事实。

### 8.2 事实源与投影

| 投影 | 唯一事实源 | 重建方式 | 不一致处理 |
| --- | --- | --- | --- |
| 资格/报名/奖励 | participation 事件与用户确认 | 按 participation sequence 重放 | 规则变化标 `needs_review` |
| 任务进度 | entry + milestone + reversal | 按 task 全量/水位重算 | 负进度、窗口冲突保留事实并告警 |
| 权益额度 | grant/use/restore ledger | 按 entitlement sequence 重放 | 超额、重复消费标 `needs_review` |
| 积分余额/批次 | points ledger + lot allocation | `sum` 和恒等式重算 | mismatch 不自动调账 |
| 兑换处理 | redemption 状态历史 + ledger link | 业务键对账 | 缺 link/金额不符标 `needs_review` |
| 首页/提醒 | 各领域只读端口或事件投影 | 可丢弃并重建 | 过期显示 `stale`，不写回业务状态 |

跨模块订阅只能建议或更新本模块投影。例如 `SpendTaskTargetReached` 可以生成“奖励待核对”提醒，但不能直接把 ActivityParticipation.reward 设为 received；`RedemptionDebitPosted` 可以刷新 points read model，但不能把外部订单 success 反推为银行兑换履约完成。

## 9. 与正式架构的冲突和需要修订的章节

| 位置 | 冲突/遗漏 | 建议修订（主会话合并到正式文档） |
| --- | --- | --- |
| `ARCHITECTURE-WORKBENCH.md` §5.2 | `Enrollment: eligible -> enrolled` 把资格与报名混为一个轴 | 以 §14.9 四/五轴模型为唯一规范；旧状态图标记 deprecated，补 `quota` 轴和 `submitted/confirmed` 外部结果 |
| §5.3 与 §14.9 | 顶层 Benefit 状态没有预约/使用分离，容易预约即扣减 | 在 §5.3 明确 Entitlement、BenefitUsage、reservation_status、redemption_status；只 `used` 追加 consume |
| §5.4 与 §14.10 | `active -> qualified` 没有 occurred/posted/settled、预计/确定和暂时达标 | 统一采用 entry milestone + `provisionally_qualified/target_reached/user_confirmed`；禁止把 qualified 当银行事实 |
| §5.5、§6.2 | 第一批事件列出 `PointsReservationHeld/Released`，但当前 P0/P1 明确不做预占 | 将事件降为 P2 预留；P1 只使用 ledger entry、debit/refund request/posted |
| §5.6 | `points_held` 出现在 Redemption 状态机，与 P0 手工外部兑换冲突 | 采用订单轴 + debit 轴；`pending` 仅表示本地处理，不是预占 |
| §6.1 | `POST /campaigns/{id}/enrollments` 语义像代报名 | 删除或改为 `record_enrollment_result`，强制证据和用户动作确认 |
| §6.2 订阅示例 | `RedemptionFulfilled -> points ledger 完成扣减` 把履约与扣点绑定 | 改为 `RedemptionDebitRequested -> points-ledger command -> RedemptionDebitPosted/NeedsReview`；履约和扣点并列显示 |
| §7.1 | 幂等描述未限定 response replay、请求哈希和锁顺序 | 补同键同 payload 重放、异键冲突、根行/账本锁顺序和死信恢复 |
| §9 迁移映射 | 旧 `progress_entries` 映射未说明 posted/settled 缺失如何处理 | 历史记录一律迁为 occurred/pending 或 unknown，不得回填银行已入账/清算；旧事实保留 reversal 能力 |
| §10、§15 | “P0/P1 纵切”与 PRD §5.1 的 P0 范围可能被理解为同一发布 | 明确发布门：P0 只活动+任务；P1 权益、积分、手工兑换各自 feature flag 和验收；P2 预占/自动化 |
| §14.8/§14.9 | 所有权表尚未包含 quota 轴，奖励在部分数据库草案中混进 `outcome_status` | 补 quota 和独立 reward；`outcome_status=reward_received` 不能作为规范状态 |
| §14.10 | milestone 规则正确，但事件名和接口仍可能沿用笼统 `qualified` | 事件/接口改用 `target_reached`、`qualification_confirmed`，并返回 expected/confirmed 两套进度 |
| §14.12 | 两轴原则正确，但应明确失败不推断退分、退款前必须有 debit link | 为 `record_refund` 增加“官方退回证据 + 既有 debit link”前置条件；缺失转 `needs_review` |
| `DATABASE-WORKBENCH.md` §4 | `activity_participations.outcome_status` 包含 `reward_received`，与独立 Reward 轴冲突 | 从 outcome 枚举移除 `reward_received`，新增 reward 状态表/事件投影；补 quota 及报名提交结果历史 |
| `DATABASE-WORKBENCH.md` §6 | 权益 SQL 需要确保 booking/rejected/cancelled 不扣额度 | 将使用事实和 quota ledger 的业务键/并发锁写为 DB 验收硬约束 |
| `DATABASE-WORKBENCH.md` §8 | 兑换模型已接近正确，但 `status=success` 与 `ledger_status` 的异步关系需成为 API 合同 | `success + pending` 只允许返回处理中；只有 ledger link 存在才 `posted`；失败不自动反向记账 |

## 10. 实施分期、迁移和回滚风险

### 10.1 建议交付门

| 阶段 | 范围 | 必须通过的门 |
| --- | --- | --- |
| Phase 0 契约 | ID、owner、source/rule、幂等、版本、outbox/inbox、审计 | 同键重放、跨用户 404、规则快照不可变、事件重复去重 |
| Phase 1 P0 | 活动五轴 + 单卡 SpendTask + occurred/posted/settled 手工 milestone + 奖励待核对 | 预计/确定分离、退款重放、资格与报名正交、移动端状态可见 |
| Phase 2 P1-a | Benefit entitlement/usage/booking/quota ledger | 预约不扣减、并发使用不超额、used/reverse 可重放 |
| Phase 2 P1-b | Points account/lot/reconciliation + 外部手工 Redemption 双状态 | sequence 幂等、lot gap 恒等式、success 不等 debit posted、退款只在官方确认后 reversal |
| Phase 3 P2 | 导入预览、自动 lot 建议、系统内 hold、第三方 connector | 权限/撤销、恢复演练、速率限制、敏感材料留存和合规评审 |

### 10.2 迁移风险与可逆措施

- 现有 `progress_entries` 只有年费进度语义，未必有 posted/settled 证据。双读期间将其映射为 `occurred_only/pending`，不把历史累计直接当清算事实；切换失败时关闭 feature flag，继续旧读路径。
- 卡片表仍承载年费字段。先双写规则快照并对比读模型，确认新路径后再把旧字段标记 legacy；不在同一迁移中删除旧列。
- 活动参与数据库草案若已把奖励塞入 `outcome_status`，先增加独立 reward 投影并回填 `not_expected/unknown`，人工有来源时才确认 received；不批量猜测奖励结果。
- 历史积分只有总余额时，只创建 balance observation/reconciliation 和正向 `unallocated_difference`；禁止把余额伪装成 earn lot 或推断到期日。批次需用户逐项确认。
- 兑换历史若没有官方扣分/退分证据，保持 `unknown/not_debited`；不得因为订单状态看起来失败就写退款流水。
- 新消费者上线前冻结旧 worker，使用事件水位和业务键做双写/对账；应用回滚只停止消费者、关闭读模型和恢复旧服务，不删除已提交事实。

## 11. 验收清单（架构级）

1. 同一 `(user,campaign,card)` 并发创建只生成一条参与实例；资格、报名、名额、结果和奖励分别变化，任一未知不会被汇总成完成。
2. 报名接口只记录外部结果，不能产生网络调用；`target_reached`、`qualification_confirmed` 和 `reward_received` 三个事件可单独审计。
3. occurred-only 消费只进预计进度；posted/settled 到达冻结口径后才进确定进度；部分/跨期退款通过关联新 entry 重放，影响确认时标 `needs_review`。
4. booking、rejected、cancelled、disputed 都不减少权益额度；并发两次 used 至多一次 consume；reverse 恢复额度但不删除历史。
5. 积分账户并发流水 sequence 连续且唯一；余额、批次和未分配差额恒等式可从零重建；mismatch 不自动调账或造到期日。
6. redemption success 与 debit posted 可独立存在；重复 debit/refund worker 只产生一条 link；失败/取消不写退分，官方确认退回后才产生 reversal。
7. 所有写命令同键同哈希重放原响应，同键不同哈希返回 409；状态冲突、版本冲突和跨用户资源分别符合错误契约。
8. outbox 重复、乱序、死信和缓存损坏可重放恢复；读模型显示 `as_of/stale`，不把投影缺失回写成业务事实。

## 12. 决定性参考

- PostgreSQL [Explicit Locking](https://www.postgresql.org/docs/15/explicit-locking.html) 与 [Transaction Isolation](https://www.postgresql.org/docs/15/transaction-iso.html)：`FOR UPDATE`、`SKIP LOCKED`、并发更新与重试边界。
- [RFC 9110 HTTP Semantics](https://www.rfc-editor.org/rfc/rfc9110)：方法语义、`404` 资源不可见、`409` 状态冲突；`Idempotency-Key` 是本项目命令契约，不宣称为 RFC 标准。
- OWASP [Authorization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html)：每请求对象级授权、默认拒绝和跨租户隔离。
- [IANA Time Zone Database](https://www.iana.org/time-zones)：业务窗口冻结 IANA 时区，避免 DST/历史偏移造成跨日错误。
- 规则差异以 `PRD-WORKBENCH.md` §10.1 已读取的银行官方页面为证据：例如入账后积分、退款扣回、指定渠道和权益凭证延迟均是计划/卡种特定事实，不能泛化为系统默认。

## 13. Handoff

新增文件：`docs/research/CARD-DOMAIN-ARCHITECTURE-REVIEW.md`。

关键决定：四条事实链各自拥有状态和流水；P0 不代报名、不自动交易/兑换、不使用积分预占；`pending` 不等于成功；失败不推断积分退回；预计/确定进度、外部订单/积分扣减、预约/核销必须分轴展示。

发现的主要冲突：正式架构 §5 的简化状态与 §14 的第二轮状态并存；§6.2 将兑换履约错误地绑定扣点；第一批事件包含未实现 reservation；数据库草案把奖励混进 outcome；旧进度数据缺少入账/清算证据。

验证摘要：本稿只新增研究文档，未改正式架构、PRD、数据库、技术文档或代码；应由主会话执行 `git diff --check -- docs/research/CARD-DOMAIN-ARCHITECTURE-REVIEW.md` 作为最终静态校验。

未决问题：P0/P1 发布门是否按本稿拆分；活动名额和多卡联合活动的事实归属；历史积分批次证据、部分退款和跨账户转移；托管 PostgreSQL 是否允许 `btree_gist`。这些问题未决前不应扩大自动化范围。
