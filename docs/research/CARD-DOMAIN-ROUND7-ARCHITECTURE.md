# Cardfolio Card Domain Round 7 Architecture Review

## 1. 角色与范围

- 角色：架构师（只读复核）。
- 目标：把卡活动、权益、刷卡任务、积分和兑换收敛为一套可重放、可隔离、可分阶段发布的领域契约。
- 输入：`docs/ARCHITECTURE-WORKBENCH.md` v0.6、`docs/PRD-WORKBENCH.md` v0.8、`docs/DATABASE-WORKBENCH.md` 第六轮附录，以及 Round 6 研究稿。
- 非目标：本稿不创建 migration、不修改应用代码、不接入银行或合作方、不把规划能力表述为已上线能力。

公开银行页面只能证明规则维度和可能的状态，不证明个人资格、库存、实时余额、奖励到账或退分结果；这些结果必须由用户官方渠道证据或人工确认写入。

## 2. 结论摘要

1. 活动参与实例的边界必须是四元组 `(owner_user_id, campaign_id, card_id, activity_instance_key)`。`activity_instance_key` 表示周期/批次/重复活动实例，不能被 `period_start` 的推导值替代。
2. 活动定义、参与资格、报名、名额、参与结果和每个奖励组件是独立事实链。奖励组件按 `reward_key` 独立确认、撤回和争议，不能由 `target_reached` 自动生成到账事实。
3. `SpendEntry` 只保存不可变的 occurred 事实；posted、settled、rejected 追加为独立 `SpendMilestone`。旧 entry 上的 `posted_on`、`settled_on`、`processing_status` 只能作为重放缓存或兼容读投影。
4. SpendMilestone 的 canonical API 是 `/api/v1/spend-entries/{entryId}/milestones`；`/spend-task-entries/{id}/milestones` 只作为带弃用标识的兼容读取/写入过渡路径，不能在新客户端继续生成。
5. 权益先声明 `usage_model`。只有 `consumable_quota` 在首次 `redemption_status=redeemed` 时写 consume；预约、出示、拒绝、争议以及 `coverage_claim`、`fee_credit`、`service_record` 不进入次数账本。
6. 积分永远保留两个差额：`reconciliation_difference = confirmed_balance - ledger_balance` 与 `unallocated_difference = ledger_balance - lots_remaining_total`。未知差额不得自动生成 lot、到期事实或扣分建议。
7. 兑换保持 `order_status`、`fulfillment_status`、`points_debit_status`、`refund_status` 四轴。失败/取消不推断退分；只有已入账 debit 和官方退回证据才能追加 reversal。
8. Reminder 是持久化事实，由对象变更命令或 worker 通过稳定 dedupe key 生成；不能每次首页查询临时推导，也不能把“已提醒”当作业务状态。

## 3. 领域边界与聚合责任

| 聚合 | 规范事实 | 允许的跨域输入 | 禁止的隐式副作用 |
| --- | --- | --- | --- |
| Campaign / RuleVersion | 活动身份、规则版本、适用期和来源快照 | 卡片、用户自录规则 | 不写个人资格、任务进度、奖励到账 |
| ActivityParticipation | 四元参与实例、资格/报名/名额/结果投影 | Campaign、Card、用户确认 | 不写 SpendEntry、BenefitUsage、PointsEntry |
| ActivityRewardComponent | `reward_key`、预计日、到账/撤回/争议及证据 | Participation、SourceSnapshot | 不因任务达标自动到账 |
| SpendTask | 周期、规则/方法快照、进度投影和确认状态 | Participation、RuleVersion | 不把预计进度变成银行确认 |
| SpendEntry / SpendMilestone | occurred 事实与后续入账/清算/拒绝里程碑 | SpendTask、方法快照 | 不覆盖历史 entry、不跨卡累计 |
| BenefitEntitlement / BenefitUsage | 下发事实、预约事实和核销事实 | Benefit、Card、用户证据 | 预约不扣额度，非配额权益不写 consume |
| PointsAccount / Ledger / Lot | 观察余额、流水、批次分配和差额 | User、Card、SourceSnapshot | 不 PATCH balance、不猜批次和到期 |
| Redemption | 外部订单、履约、扣分、退分四轴 | PointsAccount、Card、用户官方证据 | 外部成功不自动扣分，失败不自动退分 |
| Reminder | 提醒生命周期和发送去重 | 上述对象、用户时区 | 不改变业务聚合状态 |

所有跨域写入都通过公开 command 或 outbox consumer；写入端从会话派生 `owner_user_id`，不能信任请求体中的 owner。

## 4. Canonical 状态与事件

### 4.1 活动参与

规范参与键：

```text
(owner_user_id, campaign_id, card_id, activity_instance_key)
```

`activity_instance_key` 可以是用户自定义的周期标签或来源批次键，但必须在创建时冻结；同一活动下一周期必须创建新 participation。旧 `(owner_user_id, campaign_id, card_id)` 三元唯一语义只能作为迁移前兼容检查，不能阻止不同周期实例并存。

规范状态轴：

```text
eligibility: unknown -> potentially_eligible -> user_confirmed_eligible | user_confirmed_ineligible
enrollment: not_required | not_started -> submitted -> confirmed
            submitted -> rejected | expired | cancelled | unknown
quota: not_applicable | unknown | available | full | waitlisted | allocated | not_allocated
outcome: not_started -> in_progress -> target_reached | failed | expired | needs_review
review: clear | needs_review | disputed
```

奖励不再是 participation 的单一终态，而是独立组件：

```text
expected_pending -> received | delayed | reversed | disputed | unknown
```

Canonical 事件：`ActivityEligibilityRecorded.v1`、`ActivityEnrollmentResultRecorded.v1`、`ActivityQuotaRecorded.v1`、`ActivityOutcomeRecorded.v1`、`ActivityRewardComponentRecorded.v1`。旧 `ActivityEligibilityConfirmed.v1`、`ActivityEnrollmentRecorded.v1`、`ActivityRewardConfirmed.v1` 仅在 adapter 中映射读取，并标记 deprecated；新写入必须使用 canonical 事件。

### 4.2 SpendEntry 与 SpendMilestone

`SpendEntry` 创建时只写 occurred：金额/次数、发生日、币种、支付方式快照、资格待核对状态和稳定 `business_key`。随后每个里程碑都是 append-only：

```text
milestone_kind: posted | settled | rejected
unique: (entry_id, milestone_kind, business_key)
```

约束：`settled` 必须先有 `posted`；`rejected` 不删除 occurred；退款/冲正通过新的反向 entry 关联原 entry。任务的预计进度可使用 occurred，确定进度只能使用满足 `cutoff_basis` 的 milestone 和 `qualification_status=included`。

Canonical commands/API：

```http
POST /api/v1/spend-tasks/{taskId}/entries
POST /api/v1/spend-entries/{entryId}/milestones
POST /api/v1/spend-entries/{entryId}/reverse
POST /api/v1/spend-tasks/{taskId}/actions
```

旧 `/spend-task-entries/{entryId}/milestones` 在迁移期间可返回 `Deprecation` 和 `Link` 响应头，但不再扩展新字段；在所有客户端切换后移除写权限。

### 4.3 权益

`entitlement_status` 描述下发，`reservation_status` 描述预约，`redemption_status` 描述现场核销，`review_status` 描述争议。只有同一 entitlement 实例上首次 `redeemed` 产生 `benefit_usage:{usage_id}:consume`；误记或争议只能追加 `restore`，不得覆盖原 usage。重复 command 必须返回原结果。

### 4.4 积分

Points ledger 是余额的唯一事实，lot allocation 是批次的唯一事实。账户读模型至少返回：`confirmed_balance`、`ledger_balance`、`lots_remaining_total`、两个差额及其 `as_of` 水位。任一差额未知或非零时 `reconciliation_status` 不得为 `balanced`；不得把差额合并为一个“可用余额”。

### 4.5 兑换

四轴分别由四类 command 写入：

```text
record_order_result -> order_status
record_fulfillment -> fulfillment_status
record_points_debit -> points_debit_status
record_refund_result -> refund_status
```

`record_points_debit` 只有在用户确认官方已扣分时才允许写入幂等 `redemption:{id}:debit`。`record_refund_result` 先记录待核对，只有已 posted debit 且存在外部退回证据时才写同额 reversal `redemption:{id}:refund`。`pending_refund/refunded` 只读映射到 `refund_status`，不得作为新写入语义。

## 5. API、幂等与所有权

所有写 command 必须包含 `Idempotency-Key`、request hash 和 `expected_version`：

- 同一 key + 同一 hash 返回首次响应，不产生第二个事实、事件或提醒。
- 同一 key + 不同 hash 返回 `409`，并保留审计。
- 资源不属于当前会话用户、卡/账户不兼容或跨用户引用时统一返回 `404`，不泄露资源存在性。
- parent/child 引用必须带 `(owner_user_id, parent_id)` 复合约束；不能只验证裸 UUID。
- 命令事务同时提交事实、投影水位、审计和 outbox；consumer 通过 inbox 去重后再更新下游投影。

## 6. Reminder worker 契约

Reminder 使用 `trigger_at`（UTC）、用户 `timezone`（IANA）、`dedupe_key` 和对象版本/sequence。生成规则：活动结束、任务截止、奖励核对、权益到期、积分明确批次到期和兑换跟进分别有独立 `reminder_type`。未知日期、未知批次或没有明确 expected_on 不生成到期提醒。

worker 使用租约 + `FOR UPDATE SKIP LOCKED`，发送成功与状态更新幂等；归档卡、取消任务和已完成对象停止未来提醒但保留历史。Reminder 状态变化不改变业务对象状态。

## 7. 迁移与发布门

建议顺序：

1. Gate 0：冻结 canonical 枚举、四元参与键、SpendMilestone API、四轴兑换和兼容映射；完成契约测试。
2. Gate 1：expand 新表/复合键/事件与 outbox，保留旧年费 adapter；shadow replay 验证任务、积分和权益投影可从事实重建。
3. Gate 2：切换新写模型和 feature flag；完成 RLS/IDOR、并发幂等、跨时区 Reminder、负余额/退分和备份恢复演练。
4. Gate 3：所有客户端停止旧 milestone 路径和旧事件写入后，contract 删除旧约束/兼容写权限。

当前阻断项：正式架构已收敛到实例键和 canonical milestone 路径，旧路径仅保留迁移期兼容；数据库尚无正式 SpendMilestone、reward component history 和完整 Reminder migration；真实 PostgreSQL、RLS、worker、重放、恢复和 E2E 均未验证。因此 Round7 仍是实现前契约，不能宣称工作台已可部署。

## 8. 验收样例

1. 同一 campaign、同一卡、两个 `activity_instance_key` 可并存，两个任务/奖励/提醒互不累计；不同用户即使使用相同 key 也互不可见。
2. 同一 participation 的积分奖励已 `received`、返现奖励仍 `expected_pending` 时，参与结果不能显示“全部奖励到账”。
3. occurred entry 先产生预计进度；没有 posted milestone 时确定进度不变；settled 没有 posted 先决条件时返回 `409`。
4. 重放相同 milestone command 不产生第二条 milestone、事件或提醒；旧 URL 返回弃用头并映射到同一事实。
5. 非 `consumable_quota` 权益发生预约/保险理赔记录时，quota ledger 不变；consumable 权益首次 redeemed 扣一次，重复 redeemed 返回原响应。
6. `confirmed=100, ledger=90, lots=80` 时展示 `reconciliation_difference=10`、`unallocated_difference=10`，状态为 `mismatch/needs_review`，不自动造 lot 或 expire。
7. 兑换 order accepted、fulfillment fulfilled 但官方扣分未知时，debit 为 `pending_debit`，不会写 ledger；失败/取消也不会自动 refund。
8. 已 posted debit 且有官方退分证据时，首次 refund 写等额 reversal；重复 refund、refund 先于 debit、金额不符均拒绝并留审计。

## 9. Handoff

- Changed artifact: `docs/research/CARD-DOMAIN-ROUND7-ARCHITECTURE.md`。
- Key decisions: 四元活动参与实例、SpendMilestone canonical 路径、奖励组件事件、权益 usage model、积分双差额、兑换四轴、Reminder worker 和 Gate 0--3。
- Validation: `git diff --check -- docs/research/CARD-DOMAIN-ROUND7-ARCHITECTURE.md` 通过；本稿未运行迁移、应用或 E2E。
- Risks/open questions: `activity_instance_key` 的生成与用户可见格式、旧 milestone 写路径的退役窗口、历史 `posted_on/processing_status` 映射、Reminder worker 租约参数、PITR/RPO/RTO 数值仍需产品/DBA/运维共同冻结。
- Ready for integration: yes。
