# Cardfolio 卡功能扩展第十轮领域架构核验

| 项目 | 内容 |
| --- | --- |
| 角色 | 领域架构师 |
| 复核日期 | 2026-08-15 |
| 输入 | `docs/ARCHITECTURE-WORKBENCH.md`、`docs/PRD-WORKBENCH.md`、`CARD-DOMAIN-ROUND8-ARCHITECTURE.md`、`CARD-DOMAIN-ROUND9-ARCHITECTURE.md` |
| 交付性质 | 实现前契约核验；不修改代码、正式架构、PRD、数据库或迁移 |
| 规范优先级 | Round9 canonical；本稿只补充其未落地的依赖、边界和发布细节 |

## 1. 结论与不变边界

Cardfolio 仍是模块化单体。四条业务链路共享 `owner_user_id`、稳定 ID、来源快照和可靠事件，但不共享可变表、不跨聚合事务写入，也不把工作台 read model 当事实源。

```text
SourceSnapshot -> RuleVersion -> Campaign
                         -> ActivityParticipation (campaign, card, instance)
                            -> SpendTask (method/rule snapshot)
                               -> SpendEntry -> SpendMilestone
                                  -> progress/qualification projection
                            -> ActivityRewardComponent (per reward_key)

CardProfile -> BenefitEntitlement -> BenefitUsage -> quota ledger

PointsAccount(scope) -> Observation / PointsEntry / PointsLot / Allocation
                                      ^                         |
                                      |                         v
                          Redemption order -> fulfillment -> debit -> refund
```

连线只表示稳定引用、公开 command、只读 port 或 outbox/inbox 事件；兑换箭头是用户可见的业务编排顺序，不是跨聚合事务或强同步依赖。`SpendTaskTargetReached`、奖励到账、权益下发和积分记账之间不得建立自动副作用链：奖励组件、权益 grant、PointsEntry 都必须由用户确认的独立命令创建。当前可部署范围仍只有年费 MVP；本稿不构成活动、权益、积分或兑换已实现的证明。

## 2. 端到端流程与依赖图

### 2.1 流程阶段

1. **来源与规则**：用户保存脱敏 `SourceSnapshot`，再创建不可变 `RuleVersion`。抓取成功只代表材料保存，不代表资格或规则已确认。
2. **活动参与**：`Campaign` 发布后，以四元键 `(owner_user_id, campaign_id, card_id, activity_instance_key)` 创建 `ActivityParticipation`。资格、报名、名额、结果和每个 `reward_key` 都分别记录。
3. **刷卡任务**：参与实例显式创建一个或多个 `SpendTask`；激活时冻结 `SpendMethodSnapshot`、`cutoff_basis`、日期窗、币种、路由/商户/地区/附属卡和退款口径。`SpendEntry` 只追加发生事实，`SpendMilestone` 追加 posted/settled/rejected。
4. **活动结果**：任务重放只更新预计/确定进度和 `qualification_status`。达标事件可触发提醒或待核对投影，不能自动写 `ActivityRewardComponent.received`。
5. **奖励核对**：用户按 `reward_key` 记录预期、到账、延迟、撤回或争议。若奖励是积分或权益，分别调用 points/benefit 的公开 command，写入原奖励 ID 和证据；订阅奖励事件不能越权记账。
6. **权益履约**：`BenefitEntitlement` 先记录 delivery，再建立 `BenefitUsage`。预约、出示、拒绝和争议只记使用事实；只有 `consumable_quota` 的首次 `redeemed` 在同一模块事务追加 `consume`，恢复追加 `restore`。
7. **积分观察与记账**：用户在 `PointsAccount` 记录官方余额观察；赚取、调整、过期、兑换扣减和反向流水均追加 `PointsEntry`。`ledger_balance`、批次余额、`reconciliation_difference` 和 `unallocated_difference` 可从事实重算，不能 PATCH 余额。
8. **兑换与回滚**：`Redemption` 依次记录订单、履约（允许部分履约）、积分扣分和退分四轴。订单/履约提交后通过 `RedemptionDebitRequested.v1` 请求 points command；只有外部退分证据且已有 posted debit 才允许 refund reversal。失败、取消、超时或 consumer 重试均不猜测退分。

### 2.2 依赖方向和一致性

| 上游事实 | 下游消费者 | 允许的动作 | 禁止的动作 | 一致性 |
| --- | --- | --- | --- | --- |
| `RuleVersionActivated.v1` | future task/participation factory | 允许新实例引用新版本；标记未开始对象可迁移 | 改写进行中/已结束对象的 snapshot | outbox 最终一致 |
| `ActivityParticipation*` | dashboard、reminder | 刷新五轴视图和待核对提醒 | 直接创建 SpendEntry、BenefitUsage 或 PointsEntry | 事件重放 |
| `SpendTaskProgressRecalculated.v1` / `SpendTaskTargetReached.v1` | activity projection、notification | 更新 outcome 投影，生成核对提醒 | 自动发奖、发权益、记积分 | 秒级最终一致 |
| `ActivityRewardComponentRecorded.v1` | 用户确认流程、dashboard | 展示 `expected_pending/received/disputed` | 以 `reward_key` 缺失的事件建账 | 命令所属事务 |
| `BenefitRedeemed.v1` / `BenefitUsageRestored.v1` | dashboard、value read model | 重算 quota 和新鲜度 | 由活动或任务事件改额度 | benefit 本地事务 |
| `PointsLedgerEntryPosted.v1` | redemption、dashboard、提醒 | 以业务键回填 debit/refund 轴，刷新账面余额 | 反推外部履约成功或自动造 lot | points outbox |
| `RedemptionOrderResultRecorded.v1` / `RedemptionFulfillmentRecorded.v1` | redemption、notification | 更新订单/履约轴（可为 `partially_fulfilled`） | 直接写 PointsEntry 或 refund | redemption 本地事务 |
| `CardArchived.v1` | 各领域自己的 pause/freeze command | 停止未来动作，保留历史事实可读 | 跨模块直接 UPDATE 状态或物理删除 | 异步，失败需重试 |

消费者使用 `(consumer_name, event_id)` inbox 去重；乱序时保留 `pending/needs_review`，等待前置事实，不用默认值补齐。跨模块同步调用只做 ownership、存在性和兼容性检查，不持对方锁写表。

## 3. Canonical 聚合、scope 与状态轴

### 3.1 聚合所有权

| 模块/聚合 | 身份与核心事实 | 允许的写入 | 明确不拥有 |
| --- | --- | --- | --- |
| `campaign-activity`：`Campaign`、`ActivityParticipation`、`ActivityRewardComponent` | Campaign 规则版本；参与四元键；奖励 `reward_key` 序列 | 发布/结束/取消、资格、报名、名额、结果、奖励组件 | 消费流水、权益额度、积分流水 |
| `spend-task`：`SpendTask`、`SpendMethodSnapshot`、`SpendEntry`、`SpendMilestone` | task 的 card/instance、冻结方法、不可变发生和里程碑 | 创建/激活/暂停/结束、entry、milestone、reversal、资格核对 | 银行最终认定、奖励到账、跨卡汇总 |
| `benefit-entitlement`：`BenefitEntitlement`、`BenefitUsage`、quota ledger | 周期 grant、使用时间线、`grant/consume/restore/expire` | delivery、usage 子状态和额度流水 | 活动规则编辑、积分扣减、代预约 |
| `points-ledger`：`PointsAccount`、`PointsObservation`、`PointsEntry`、`PointsLot`、`LotAllocation` | account scope、sequence、观察、账面和批次守恒 | observations、append-only entry、用户确认 allocation、reconciliation | 订单履约、自动 FIFO、跨账户 transfer |
| `redemption`：`Redemption` 与四轴事实 | order、fulfillment、debit、refund，各自金额/单位/证据 | 创建和推进四轴、部分履约、扣分/退分请求 | 直接 UPDATE PointsEntry、P1 hold/reserve |
| `source-rule`、`notification`、`dashboard` | 来源/规则快照、提醒租约、只读投影 | 各自事实和投影重建 | 改写业务聚合或在查询时补账 |

### 3.2 固定卡与合并池 scope

`PointsAccount` 必须有不可变 `scope_type=fixed_card|merged_pool` 和 `scope_key`；`card_id=NULL` 不能单独证明合并池。固定卡账户的 `PointsEntry`、`Lot`、`Allocation`、`Redemption` debit/refund 必须引用同一 `(owner_user_id, card_id, account_id)`。`merged_pool` 仅在规则来源和账户允许的卡集合均已确认时使用；P1 不实现跨账户转移或跨卡自动归因。活动 participation、SpendTask 和 SpendEntry 始终按卡隔离，即便奖励积分进入合并池。

不兼容的跨卡/跨账户父子引用统一 `404`；合法合并池引用必须通过明确 scope 校验，而不是把 card 列置空绕过约束。

### 3.3 独立状态轴

| 聚合 | 状态轴（canonical） | 关键约束 |
| --- | --- | --- |
| Participation | `eligibility`、`enrollment`、`quota`、`outcome`、`review_status` | `submitted` 不等于 confirmed；`target_reached` 不等于银行资格 |
| RewardComponent | `reward_status=not_expected|expected_pending|received|reversed` + `review_status` | 每个 `reward_key` 独立；缺证据为 `needs_review` |
| SpendTask | `lifecycle_status`、`progress_status`、`qualification_status`、`review_status` | `snapshot/entries` 互斥；settled 必须先 posted |
| Benefit | `delivery_status`、usage `reservation/presentation/redemption`、quota projection、`review_status` | 只有首次 redeemed 扣 consume；restore 不能删除 consume |
| PointsAccount | `status=open|frozen|closed`、观察新鲜度、reconciliation、`review_status` | 真实负余额保留；差额不可合并 |
| Redemption | `order_status`、`fulfillment_status`、`points_debit_status`、`refund_status`、`review_status` | 订单成功不等于 fulfilled/posted；退款须已有 posted debit |

每个 `unknown|needs_review|disputed` 响应必须带 `reason_code`、`evidence_note`、`last_verified_at`、`next_action`、`as_of` 和（适用时）`stale`。缺少这些字段返回 `422 EVIDENCE_REQUIRED`，而不是生成确定结论。

## 4. Canonical API、命令与事件

### 4.1 写命令共通契约

- 会话派生 `owner_user_id`；请求体禁止指定 owner。父链按 `(id, owner_user_id[, card_id[, account_id]])` 查询并锁定。
- 除只读查询外，命令必须带 `Idempotency-Key`、规范化 request hash 和 `expected_version`；事实、审计、幂等结果、outbox 同事务提交。
- 同 key 同 hash 返回首次 HTTP 状态和 body，不新增事实/事件；同 key 异 hash 返回 `409 IDEMPOTENCY_KEY_REUSED`。永久业务键（如 `usage:{id}:consume`、`redemption:{id}:debit`、`redemption:{id}:refund:{refund_key}`）防止长延迟重试重复记账。
- 非法状态/范围返回 `409 STATE_CONFLICT` 或 `INVALID_BOUNDARY`；跨用户、跨卡、不兼容账户 scope 统一 `404`；未知不满足前置条件返回 `422 UNKNOWN_NOT_ALLOWED`。

### 4.2 命令/事件表

| 命令 | Canonical API | 事件/事实 | 依赖边界 |
| --- | --- | --- | --- |
| 创建参与 | `POST /api/v1/campaigns/{campaignId}/participations` | `ActivityParticipationCreated.v1` | 四元键和 rule version 唯一 |
| 记录资格/报名/名额/结果 | `POST /api/v1/activity-participations/{id}/{eligibility\|enrollment\|quota\|outcome}` | `ActivityEligibilityRecorded.v1`、`ActivityEnrollmentResultRecorded.v1`、`ActivityQuotaRecorded.v1`、`ActivityOutcomeRecorded.v1` | 每次只推进一个轴 |
| 记录奖励组件 | `POST /api/v1/activity-participations/{id}/rewards/{rewardKey}/result` | `ActivityRewardComponentRecorded.v1` | 不自动建 benefit/points 事实 |
| 创建任务/发生事实 | `POST /api/v1/cards/{cardId}/spend-tasks`、`POST /api/v1/spend-tasks/{id}/entries` | `SpendTaskCreated.v1`、`SpendOccurredRecorded.v1` | task 必须属于同卡 participation |
| 里程碑/冲正/资格 | `POST /api/v1/spend-entries/{id}/milestones`、`/reversals`、`POST /api/v1/spend-tasks/{id}/qualification` | `SpendPostedRecorded.v1`、`SpendSettledRecorded.v1`、`SpendRejectedRecorded.v1`、`SpendEntryReversed.v1`、`SpendTaskQualificationRecorded.v1` | settled 先 posted；历史 entry 不 UPDATE |
| 权益使用 | `POST /api/v1/benefit-entitlements/{id}/usages`、`POST /api/v1/benefit-usages/{id}/{reservation\|presentation\|redemption}` | `BenefitUsageReservationRecorded.v1`、`BenefitUsagePresentationRecorded.v1`、`BenefitRedeemed.v1`、`BenefitUsageRestored.v1` | 首次 redeemed 才 consume |
| 观察/记账/批次 | `POST /api/v1/points-accounts/{id}/{observations\|entries\|lots}`、`POST /api/v1/points-entries/{id}/lot-allocations` | `PointsBalanceObserved.v1`、`PointsLedgerEntryPosted.v1`、`PointsLotCreated.v1`、`PointsLotAllocationRecorded.v1`、`PointsReconciliationChanged.v1` | sequence、scope、lot 守恒 |
| 创建兑换/记录四轴 | `POST /api/v1/redemptions`、`/{id}/{order-result\|fulfillment\|points-debit\|refund-result}` | `RedemptionCreated.v1`、`RedemptionOrderResultRecorded.v1`、`RedemptionFulfillmentRecorded.v1`、`RedemptionDebitRequested.v1`、`RedemptionRefundRequested.v1`、`PointsLedgerPostingRejected.v1` | P1 不 hold/reserve；退款须 posted debit |

`RedemptionDebitRequested.v1` 由 redemption 发布，points 模块以 `redemption:{id}:debit` 调用公开 posting command；成功仅发布 `PointsLedgerEntryPosted.v1` 并回填 debit 轴。外部退分证据先记录 refund-result，再以 `redemption:{id}:refund:{refund_key}` 追加 reversal；历史 `RedemptionPointsDebitPosted.v1`/单一 `success` 只做 upcast 读映射。

## 5. 缺口、冲突与补充决策

| 发现 | 风险 | Round10 决策 |
| --- | --- | --- |
| 正式模块早期仍以 `ActivityEnrollment/ActivityProgress` 描述活动 | 把多卡/多周期压成卡片下一行，任务串账 | 以 Campaign + 四元 Participation + RewardComponent 为唯一写模型；旧字段只读映射 |
| 旧 SpendTask entry milestone 路径和 entry 可变日期并存 | 出现第二事实源，posted/settled 无法重放 | canonical 只用 `/spend-entries/{id}/milestones`；entry 不可变，退款/冲正追加事实 |
| 兑换章节的“锁定/扣减”与 P1 不预占冲突 | 订单成功被误显示为积分已扣 | `redeem_hold/reserve/release` 继续关闭；P1 仅外部结果 + 手工 debit/refund |
| PointsAccount `card_id` 可空但未声明 scope | NULL 被用来绕过同户跨卡校验 | 强制 `fixed_card|merged_pool` scope；合并池需来源和卡集合证据 |
| `fulfillment` 只有 success/failed | 无法表达实物部分到货或票券部分入账 | 增加 canonical `partially_fulfilled`；payload 带已履约/剩余数量、价值、单位和证据 |
| 规则激活后缺少进行中对象处理 | 新规则覆盖历史，进度漂移 | 任务/参与保存 rule snapshot；新版本只影响未来实例，迁移须建新 snapshot 并置 `needs_review` |
| `target_reached` 与 reward/points/benefit 的订阅副作用未写死 | 消费事件自动发奖、记账 | 达标只发 projection/reminder；各事实必须显式用户 command 和自己的事务 |
| 积分 posting/兑换 consumer 失败恢复边界不够具体 | 重试重复 debit 或丢失订单事实 | inbox + 永久 business key；外部订单保持事实，debit=`pending_debit|needs_review` |
| unknown 仅作为枚举，没有行动契约 | UI 默认可用/达标/已到账 | 所有未知必须提供 reason/evidence/next_action/as_of；缺失返回 422 |

## 6. 未知、争议、部分履约和冲正处理

- **未知/待核对**：可以保存观察或用户陈述，但不能满足需要 `confirmed`、`posted`、`redeemed`、`official` 的命令；显示 `next_action`，不创建到期、奖励到账或自动扣减事实。
- **规则换版**：新 `RuleVersion` 的生效区间不得重叠；未开始参与可选择新版本，进行中/已结束参与和 SpendTask 永远引用旧 snapshot。用户主动迁移时新建 task/snapshot，并将旧结果置 `needs_review`，不重写旧 entry。
- **部分履约**：`fulfillment_status=partially_fulfilled` 时记录 `fulfilled_quantity/value` 与 `remaining_quantity/value`；可继续追加同一 redemption 的履约事实。积分 debit 按官方实际扣分金额独立记录；不能因部分履约自动按比例退分。
- **退款/冲正**：Spend refund/reversal 关联原 entry，累计反向金额不得超过原未冲销金额；任务达标回退只将 qualification/reward 标记待核对。Redemption refund 必须引用同账户已 `posted` debit，允许多个 `refund_key` 的部分退分，累计不得超过实际 debit；退款早于 debit、跨账户或异单位返回 409。
- **账户负值/差额**：`ledger_balance` 可为负，`reconciliation_difference` 与 `unallocated_difference` 分别保留；不截断为零、不自动造 lot、不自动 expire。

## 7. P0/P1 Feature Flag、发布门与回滚

### 7.1 独立开关

| Flag | 默认 | 开启前置 | 关闭行为 | 范围 |
| --- | --- | --- | --- | --- |
| `card_feature.canonical_read_model` | off | projection rebuild、stale 标记、导出/删除注册表 | 旧读路由；canonical 事实保留 | P0 基础 |
| `card_feature.p0_activity_task_write` | off | Gate 0/1、RLS、幂等、milestone/reversal E2E | 拒绝新活动/任务写入，年费旧写不受影响 | P0 |
| `card_feature.p1a_benefit_usage_write` | off | quota ledger 并发/恢复/移动端验收 | 权益只读/入口隐藏，不删除历史 usage | P1-a |
| `card_feature.p1b_points_redemption_write` | off | points 双差额、scope、四轴、部分履约/退分验收 | 积分/兑换只读，保留 pending/needs_review | P1-b |
| `card_feature.p2_import_connector` | off且不可由 P0/P1 开启 | 独立安全、隐私、撤销和恢复评审 | 仅 source snapshot 预览 | P2 |

### 7.2 发布顺序

1. **Gate 0 契约冻结**：冻结状态轴、四元键、scope、命令/事件、request hash、inbox/outbox、unknown 错误契约和旧 adapter 单向方向。
2. **Gate 1 P0**：先部署 schema/port/read model，再开启 `canonical_read_model`，完成 shadow replay；随后按小流量开启 `p0_activity_task_write`。P0 只含来源、活动、单卡任务、人工奖励核对和站内提醒，不创建权益/积分/兑换写入口。
3. **Gate 2 P1-a**：P0 稳定且权益 ledger 通过并发、重复 redeemed、restore、删除和恢复演练后，只开启 `p1a_benefit_usage_write`；P1-a 与 P1-b 不共享一个总开关。
4. **Gate 3 P1-b**：points scope、双差额、lot allocation、余额负值、订单部分履约、debit/refund 幂等与 PITR 通过后，才开启 `p1b_points_redemption_write`。P2 始终关闭。

### 7.3 回滚顺序和边界

发生数据差异、重复记账、投影延迟超阈值或恢复失败时：先冻结当前 flag 的新写命令，保留原事实和审计；按 `p1b -> p1a -> p0 -> canonical_read_model` 逆序关闭。读路由可切回旧年费/兼容投影，canonical outbox 继续重放或进入人工死信；不得恢复旧服务对同一事实的双向写入，不删除已提交事件，不用删旧表作为回滚。恢复后先重建投影和对账，再按原 Gate 顺序逐级开启。

年费 MVP 单独保留现有 `/cards`、`/cycles`、`/progress-entries`、`/fee-events` 写路径及其测试；新 flag 关闭时不得改变年费周期、提醒、导出和删除行为。年费 legacy adapter 只能向 canonical 转换，不接受 canonical 回写旧表。

## 8. 跨模块接口验收（Given/When/Then）

1. **多卡隔离**：Given 同一 campaign 适用 card-A/card-B；When 各创建 participation 和相同金额 SpendEntry；Then 两个任务分别重算，任一卡不能读取或合并另一卡进度。
2. **多周期隔离**：Given 同卡两个 `activity_instance_key`；When 录入同日消费；Then 两个实例各自计入，重复四元键返回 `409`。
3. **跨卡 entry**：Given task-A 属于 card-A；When 用同用户 card-B 的 method/entry ID 写入；Then 返回 `404`，无事实、事件或提醒副作用。
4. **固定卡/合并池**：Given fixed-card account 与来源确认的 merged pool；When 对固定卡使用另一卡 redemption，或对合并池使用允许卡集合；Then 前者 `404`，后者仅在 scope 校验通过时成功；NULL `card_id` 不绕过校验。
5. **重复参与命令**：Given 相同参与创建请求和相同 `Idempotency-Key`；When 重复提交；Then 返回第一次响应和同一 participation/event，不新增事实。
6. **幂等键复用**：Given 已成功记录 entry；When 同 key 发送不同金额/账户；Then `409 IDEMPOTENCY_KEY_REUSED`，保留冲突审计，不覆盖原 entry。
7. **规则换版**：Given task-A 已 active 引用 rule-v1；When 激活 rule-v2；Then task-A 仍引用 v1，新任务才可引用 v2；主动迁移必须新建 snapshot 且旧 task `needs_review`。
8. **里程碑顺序**：Given entry 只有 occurred；When 直接写 settled；Then `409 STATE_CONFLICT`，posted 缺失且无投影变化；先 posted 后 settled 才成功。
9. **snapshot/entries 互斥**：Given task 使用累计 snapshot；When 提交 increment entry（或反之）；Then `409 INVALID_BOUNDARY`，不将两种输入相加。
10. **退款冲正回退**：Given entry 已部分退款；When 再次退款超过未冲销金额或跨 task/card；Then `409`，原 entry 和既有 reversal 不变；合法 reversal 使 progress 双向重算并把已确认资格置 `needs_review`。
11. **权益现场拒绝**：Given usage booked/presented 后被拒；When 写 rejected；Then quota 不追加 consume，重复 rejected 返回首次响应；只有首次 redeemed 才有 `usage:{id}:consume`。
12. **权益恢复**：Given usage 已 redeemed 且有 consume；When 以新证据 restore 两次；Then 第一次追加一个 restore，第二次命中同一业务键，不得删除 consume 或使额度大于 grant+adjustment。
13. **未知证据**：Given 活动资格或积分观察为 unknown 且缺 `reason_code/evidence_note/next_action`；When 调用需要 confirmed/posted 的命令；Then `422 EVIDENCE_REQUIRED/UNKNOWN_NOT_ALLOWED`，不发奖、不扣分、不建到期提醒。
14. **积分双差额**：Given confirmed=100、ledger=90、lots=80；When 查询 account；Then 显示 reconciliation difference=10、unallocated difference=10，状态 mismatch；不自动造 lot 或可用余额=100。
15. **订单成功但扣分 pending**：Given redemption order accepted、fulfillment partially_fulfilled；When points consumer 未完成；Then 四轴显示 accepted + partially_fulfilled + pending_debit，不能显示 posted 或自动退分。
16. **部分履约继续推进**：Given fulfillment 已部分完成；When 追加剩余履约；Then 同一 redemption 进入 fulfilled，保留两次事实和数量守恒；积分扣分仍由独立 debit 命令决定。
17. **退款前置条件**：Given redemption 无 posted debit 或使用另一 account；When 提交 refund-result；Then `409 STATE_CONFLICT/INVALID_BOUNDARY`；有 posted debit 且官方证据后，按 refund_key 幂等追加等额或部分 reversal。
18. **事件重放**：Given outbox event 或 debit consumer 重复/乱序；When worker 重试；Then inbox/business key 去重，最多一个 PointsEntry/consume/restore，未知前置进入 pending/dead-letter 而非猜测成功。
19. **卡归档**：Given card archived；When 新建任务、权益使用或固定卡兑换；Then 新写入被拒，历史流水和审计可读，未来 reminder 被取消/停止而不物理删除。
20. **P0/MVP 隔离**：Given `p1a_benefit_usage_write` 与 `p1b_points_redemption_write` 关闭；When访问工作台；Then 不显示可写权益/积分/兑换入口，年费周期和旧提醒回归通过；不得以空壳数据冒充已部署能力。

## 9. 风险、依赖与验证记录

- 固定卡/合并池的允许卡集合、`scope_key` 格式和来源证据仍需 DBA/产品签收；在约束和真实 PostgreSQL 测试落地前不开放 merged pool 写入。
- 部分履约/部分退分金额单位、现金部分与库存/不可取消说明需产品冻结；本稿只保证四轴和守恒，不自动推导比例。
- 规则换版、旧 `progress_entries` 编辑历史、source snapshot 哈希、Reminder lease/dead-letter、projection stale 阈值和 RPO/RTO 仍是实现依赖。
- 银行登录/同步、自动报名/预约/兑换、自动 lot/FIFO、跨账户 transfer、系统 hold/reservation、导入直写和外部 connector 均为 P2，不能通过预留字段提前开启。

静态验证计划：`git diff --check` 仅针对本稿和 Round10 台账 handoff；以 `rg` 检查 canonical API、状态轴、事件名和 feature flag 前后一致。未运行真实 PostgreSQL、RLS、worker、迁移、并发或恢复 E2E，因此本稿不提供部署许可。

## 10. Handoff 摘要

- **Changed artifact**：本文件；另更新 Round10 台账 `domain-architecture` handoff。
- **Decisions**：端到端依赖使用 outbox/inbox；四元 participation、固定卡/合并池 scope、部分履约、规则换版、未知/争议和四轴兑换均保持独立；P0/P1-a/P1-b 采用独立 feature flag，年费 MVP 隔离。
- **Ready condition**：等待主会话串行整合，Gate 0--3 和真实数据/并发/恢复证据完成前不 ready for deployment。
