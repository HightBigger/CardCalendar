# Cardfolio 个人信用卡管理工作台需求文档

| 项目 | 内容 |
| --- | --- |
| 文档版本 | v1.1 |
| 文档状态 | 工作台扩展 PRD，第十轮卡功能行动与解释增量，待 Gate 0 实现评审 |
| 基线 | `main@e756538` |
| 产品形态 | 响应式 Web 应用 |
| 文档范围 | 只定义产品需求、实体字段、状态、流程和验收，不实现代码 |
| 调研截止 | 2026-08-15（第十轮卡活动/权益/刷卡方式/积分兑换行动核验） |

## 1. 产品定位与术语

### 1.1 定位

Cardfolio 是以“卡片”为核心聚合的个人信用卡管理工作台。它把持卡人分散在银行 App、活动页面、账单、短信和积分商城中的信息，整理成可核对、可提醒、可追溯的个人记录：我有哪些卡、当前有哪些活动/权益、为了达标还需要怎样消费、积分在哪个账户、何时到期、兑换是否完成，以及年费与实际使用价值如何核算。

产品只保存用户主动录入或确认的数据，不连接银行登录、不代管完整卡号、不自动发起交易或兑换。所有规则都带来源、适用范围、有效期和最后核对时间；规则不完整或过期时，产品应显示“待核对”，而不是推断结论。

### 1.2 术语表

| 术语 | 定义与边界 |
| --- | --- |
| 卡片档案（Card） | 用户持有的一张信用卡的非敏感识别与生命周期记录。卡号只允许后四位。 |
| 卡活动（CardActivity） | 银行或合作方在明确时间窗内提供的报名、消费、返积分/返现、礼品或费用减免活动；可关联一张或多张卡。 |
| 卡权益（Benefit） | 卡片固有或随卡提供的服务/额度/次数权益，如机场礼遇、保险、贵宾室、年费减免；不等同于短期营销活动。 |
| 刷卡方式（SpendMethod） | 用户为完成活动或年费条件记录的消费方式/交易口径，例如线下 POS、线上支付、移动支付、境外或指定商户。不是交易流水。 |
| 刷卡任务（SpendTask） | 将活动或年费规则转成可执行的目标，包含时间窗、计数/金额指标、条件关系和排除项。 |
| 积分账户（PointsAccount） | 某家银行/计划下的一种积分余额账本，余额由用户手动录入或调整；不代表银行实时余额。 |
| 积分流水（PointsEntry） | 对积分账户的获得、扣减、过期、调整等记录，可关联活动、消费任务或兑换。 |
| 兑换记录（Redemption） | 用户发起或确认的一次积分/权益兑换，包含商品、渠道、所需积分、订单状态和结果。 |
| 规则版本（RuleVersion） | 在某一生效区间内适用的活动、权益、积分或年费规则快照；规则变更不得覆盖历史版本。 |
| 来源（Source） | 规则原文的 URL、标题、发布/更新时间（如页面提供）、抓取/访问日期、来源等级及原文摘录。 |
| 可信度 | `官方原文已读取`、`官方页面但关键信息不完整`、`监管或协会原文已读取`、`线索待官方核对`、`用户自录待核对`。搜索摘要和第三方资料只能进入“线索待官方核对”。可信度不是对个人资格或规则持续有效的保证。 |
| 估算价值 | 用户自行填写的人民币金额或区间，仅用于回顾，不是市场报价、收益承诺或理财建议。 |

### 1.3 通用能力与银行差异

**通用能力**：所有规则实体都支持生效/失效时间、适用卡/客群、地区、渠道、报名要求、指标口径、排除项、名额/预约、来源、最后核对时间和“未知”值；任务支持计数、金额、次数与金额的“同时满足/满足其一/自定义表达式”；积分支持多账户、多单位、分桶有效期和流水；兑换支持库存/资格/渠道限制和订单状态。

**银行差异**：积分单位、累计比例、取整方式、入账时点、有效期、消费排除项、年费周期、权益次数和兑换门槛均由银行/卡种/活动决定。系统不能把任何一家银行的具体数值当作默认规则，也不能用一条规则覆盖同一银行的不同卡种。用户未提供原文时，字段显示“未确认”。

## 2. 用户画像、目标与非目标

### 2.1 用户画像

1. **多卡管理者（主画像）**：持有 3--15 张个人卡，跨多家银行；每月或每季度更新一次记录，重点关注年费、消费达标、活动截止日和积分到期。
2. **权益使用者**：持有高端或联名卡，权益价值取决于次数、预约、指定渠道或有效期；需要知道“可用、已用、即将过期、需要预约”。
3. **积分规划者**：有多个积分账户，定期兑换礼品、里程或抵扣；需要看余额、批次到期和已兑换结果，不要求自动下单。
4. **轻度持卡人**：持有 1--3 张卡，只需要快速录入和关键日期提醒。

不服务企业卡、家庭共享账本、代他人管理账户或需要银行自动同步的用户（后续若扩展需重新评估授权与隐私模型）。

### 2.2 产品目标

- 首次登录后 3 分钟内完成首张卡和一个关键提醒的录入。
- 用户打开工作台即可看见未来 90 天的年费、活动、权益、积分到期和待完成任务。
- 用户能把一条规则拆成可核对的任务，看到当前值、目标值、剩余值、截止日和证据。
- 用户能追溯每个余额、兑换和收益数字的来源与修改历史。
- 对规则不确定、已过期、渠道受限的情况明确提示，降低错过权益或错误刷卡的风险。

### 2.3 非目标

- 不读取银行 App、网银、短信、邮箱或账单，不保存登录凭据、完整卡号、CVV、密码或身份证号。
- 不自动判断某笔交易是否符合银行规则，不自动承诺返现/积分/免年费，不提供授信、投资、借贷或税务建议。
- 不代用户报名、支付、兑换、预约或联系银行；不做家庭共享、企业报销和实时资产净值。
- 不将公开活动规则当作对用户个人资质的确认；所有资格需用户在银行官方渠道自行确认。

### 2.4 成功指标

指标以用户主动确认的数据为分母，不以银行实际发奖或资格作为 Cardfolio 可控结果：

- **建档完成率**：首次创建卡片的用户中，7 日内至少补齐一个 P0 活动或任务及来源的比例不低于 50%；P1 再单独统计权益/积分账户建档率。
- **规则可核对率**：活跃活动、权益和任务中，具有官方来源、适用期、最后核对时间的对象比例不低于 80%。
- **临期处置率**：到期前 30 天内产生提醒的对象中，在截止日前被标记完成、已核对或明确忽略的比例不低于 70%。
- **任务对账率**：到期任务中具有用户最终核对结果（达标/未达标/有争议）的比例不低于 60%。
- **积分新鲜度（P1）**：活跃积分账户中，余额核对日期在用户设定周期内的比例不低于 70%；不使用“余额准确率”作为指标，因为 P0 无银行实时数据。
- **错误恢复率**：P0 的退款/冲正与 P1 的兑换失败/退款样本均须 100% 保留原流水，并通过反向记录恢复可重算余额。

## 3. 工作台信息范围与数据原则

### 3.1 首页工作台

默认时间窗为未来 90 天，可切换 30/180/365 天。首页包含：

- **待处理总览**：即将到期的年费事件、活动截止、权益到期、积分批次到期、逾期任务数。
- **任务进度**：按“截止日、剩余量、规则可信度”排序，显示当前值/目标值/剩余值和条件关系。
- **卡片摘要**：使用中/待核对/已归档卡片数，最近核对日期，下一年费日。
- **积分摘要**：按账户显示用户录入余额、最近到期批次和最近兑换结果；不显示“实时”字样。
- **收益摘要**：按自然年或自定义期间汇总已确认年费、用户确认的权益价值、积分兑换价值和净值；估算项单独标识。
- **提醒中心入口**：未处理、稍后处理、已完成、已忽略，并可按对象类型筛选。

每个摘要卡片必须能下钻到对象详情；没有来源或最后核对超过用户设定阈值时，显示“请核对官方规则”。

### 3.2 数据记录原则

- 规则文本以版本快照保存，编辑产生新版本；历史任务和流水引用原版本。
- 金额统一保存数值、币种和精度；积分保存数量、单位和账户，不隐含兑换比例。
- 所有日期带用户时区解释；跨日和夏令时由统一日期库处理。
- 用户录入与系统计算分离：原始值可审计，计算值可重算；删除优先使用归档/作废而非物理删除。
- 规则字段允许 `unknown`，不可用前端默认值填充为事实。

## 4. 实体字段与状态

以下字段为开发契约，`id`、`created_at`、`updated_at`、`owner_user_id` 为所有实体必备；金额/数量禁止使用浮点。

### 4.1 卡片档案 Card（P0）

**字段**：`issuer_name`、`product_name`、`network`（银联/Visa/Mastercard/Amex/其他/未知）、`tier`、`last4`（四位数字）、`currency`、`annual_fee_amount`、`annual_fee_rule_id`、`opened_on`、`activated_on`、`billing_day`、`annual_fee_cycle_type`（激活首账单日/开卡日/固定日期/自定义/未知）、`next_annual_fee_on`、`status`（active/suspended/closed/archived）、`last_verified_on`、`source_id`、`notes`。

**约束**：不接收完整卡号/CVV；`last4` 可选但若填写必须为 4 位数字；年费和币种可为未知；归档卡保留历史但停止新提醒和新任务。

### 4.2 规则来源 Source 与规则版本 RuleVersion（P0）

**Source 字段**：`url`、`title`、`publisher`、`published_on`（未知可空）、`accessed_on`、`source_level`（官方规则/官方商品页/官方商城/监管或协会/成熟产品公开说明/第三方）、`excerpt`、`content_hash`（防止静默替换）、`notes`。

**RuleVersion 字段**：`rule_type`（annual_fee/activity/benefit/spend/points/redemption）、`object_id`、`effective_from`、`effective_to`、`eligibility_text`、`region`、`channel`、`registration_required`、`booking_required`、`quota_text`、`exclusions_text`、`status`（draft/active/expired/superseded/needs_review）、`source_id`、`verified_by_user_at`。

规则版本必须可并存；新规则生效后，旧版本进入 `superseded`，历史记录仍指向旧版本。

### 4.3 卡活动 CardActivity（P0）

**字段**：`title`、`issuer_name`、`activity_type`（消费返积分/返现/礼品/年费减免/报名权益/其他）、`applicable_card_ids`、`eligibility_text`、`eligibility_status`（unchecked/eligible/ineligible/uncertain）、`eligibility_verified_at`、`start_at`、`end_at`、`enrollment_required`（yes/no/unknown）、`enrollment_deadline`、`enrollment_status`（not_required/not_started/submitted/confirmed/rejected/expired/unknown）、`enrollment_verified_at`、`enrollment_evidence_note`、`quota_allocation`（unlimited/first_come/ranking/lottery/unknown）、`quota_text`、`quota_status`（not_applicable/unknown/available/full/waitlisted/allocated/not_allocated）、`quota_verified_at`、`reward_type`、`reward_amount_text`、`reward_cap_text`、`qualification_basis`（occurred/posted/settled/other/unknown）、`qualification_delay_text`、`reward_due_rule_text`、`expected_reward_on`、`reward_status`（not_expected/pending/delayed/received/reversed/disputed/unknown）、`reward_received_on`、`reward_reversed_on`、`reward_reversal_reason`、`region`、`channel`（线下/线上/移动支付/指定 App/指定商户/未知）、`rule_version_id`、`status`（planned/running/ended/cancelled/needs_review）、`notes`。

本节字段是工作台兼容投影；规范写模型以 Campaign、ActivityParticipation 和独立 ActivityReward 事实为准，不能把一行 CardActivity 当作个人报名实例。资格、报名、名额、任务达标和奖励是五条独立事实：`eligible` 不等于 `confirmed`，`confirmed` 不等于 `allocated`，`qualified` 也不等于奖励已到账。只有来源给出发放期限时才能计算 `expected_reward_on`；超过该日只转为 `delayed` 并提醒核对，不自动发起争议。活动不把奖励金额解析成通用数值，除非来源明确且用户确认。

规范写模型的 ActivityReward.reward_status 使用 expected_pending；同一 participation 可有多个 `reward_key` 组件（例如积分、返现、礼品）并独立核对。旧 CardActivity.reward_status=pending 仅保留为兼容读映射，不得用于新写入。

### 4.4 卡权益 Benefit（P1）

**字段**：`card_id`、`name`、`benefit_type`（次数/额度/保险/贵宾室/服务/费用减免/其他）、`usage_model`（consumable_quota/coverage_claim/fee_credit/service_record/unknown）、`period_type`（自然年/持卡年/账单周期/月/一次性/自定义）、`valid_from`、`valid_to`、`quota_value`、`quota_unit`、`used_value`（派生，仅 consumable_quota）、`remaining_value`（派生，仅 consumable_quota）、`entitlement_status`（pending_delivery/available/delivery_failed/suspended/expired/revoked/disputed/unknown）、`quota_status`（not_applicable/available/partially_used/exhausted/needs_review）、`delivery_due_on`、`delivered_at`、`service_provider`、`credential_type`（实体卡/二维码/会员号/预约确认/无需凭证/未知）、`credential_reference_masked`、`requires_booking`、`booking_channel`、`eligible_region`、`merchant_or_mcc_text`、`holder_scope`（主卡本人/附属卡/可携伴/未知）、`companion_cost_text`、`activation_required`、`estimated_value_amount`、`estimated_value_currency`、`actual_value_amount`、`source_id`、`last_verified_on`、`notes`。

**BenefitUsage 字段**：`benefit_id`、`planned_on`、`reservation_status`（not_required/not_booked/requested/confirmed/rejected/cancelled/unknown）、`reservation_reference_masked`、`booked_at`、`redemption_status`（not_presented/presented/redeemed/rejected/disputed/unknown）、`presented_at`、`redeemed_at`、`quantity`、`location_or_provider`、`actual_charge_amount`、`currency`、`rejection_reason`、`dispute_status`（not_disputed/open/resolved_user/resolved_provider/unresolved）、`dispute_opened_at`、`note`。预约成功不等于现场核销；只有用户确认 `redeemed` 才增加 `used_value`，拒绝、取消和争议均不扣减额度。

额度/次数为用户维护的记录，不从“权益存在”推断“可用”；`coverage_claim`、`fee_credit` 和 `service_record` 不进入次数 `consume` 流程，只有 `consumable_quota` 的 `redeemed` 才扣减 quota ledger。预约、地区、渠道和附属卡资格必须在详情中可见。

### 4.5 刷卡方式 SpendMethod 与刷卡任务 SpendTask（P0）

**SpendMethod 字段**：`name`、`channel_type`（POS/电商/银行 App/第三方钱包/二维码/境外/自动扣款/其他）、`merchant_scope`、`region_scope`、`currency_scope`、`mcc_or_exclusion_text`、`evidence_note`、`status`。

**SpendTask 字段**：`card_id`、`activity_id`（可空）、`activity_instance_key`（周期实例键）、`task_type`（年费达标/活动达标/权益解锁/自定义）、`period_start`、`period_end`、`cutoff_basis`（occurred/posted/settled/unknown）、`grace_or_posting_delay_text`、`input_mode`（snapshot/entries）、`metric_type`（count/amount/count_and_amount/count_or_amount/custom）、`target_count`、`target_amount`、`currency`、`condition_relation`（all/any/custom）、`confirmed_count`、`confirmed_amount`、`pending_count`、`pending_amount`、`remaining_count`、`remaining_amount`、`qualified_spend_method_ids`、`exclusions_text`、`include_supplementary_card`（yes/no/unknown）、`progress_status`（not_started/in_progress/provisionally_qualified/target_reached/shortfall/failed/expired/disputed/needs_review）、`qualification_status`（unconfirmed/user_confirmed/rejected/needs_review）、`evidence_level`（user_total/user_entries/user_official_evidence/unknown）、`reconciliation_status`（not_due/pending/reconciled/disputed）、`rule_version_id`、`last_reconciled_on`。

**SpendEntry 字段**：`task_id`、`occurred_on`、`posted_on`、`settled_on`、`processing_status`（occurred_only/posted/settled/rejected/reversed/unknown）、`count_delta`、`amount_delta`、`currency`、`method_id`、`qualification_status`（included/excluded/pending/disputed/unknown）、`reversal_of_entry_id`、`idempotency_key`、`note`。日期若均存在必须满足 `occurred_on <= posted_on <= settled_on`；部分退款允许负向金额小于原金额，累计反向金额不得超过原记录。`cutoff_basis` 决定哪一日期落入任务周期，`qualification_status=included` 决定是否进入确定进度，两者缺一不可。

`snapshot` 模式只保存用户确认的累计快照，`entries` 模式只由流水聚合；同一任务不得同时把快照和流水相加。未满足截止口径或资格仍待核对的记录只计入 `pending_*`。系统不声称银行已经认定，退款/冲正必须新增关联反向流水，不覆盖原记录。

### 4.6 积分账户 PointsAccount、积分流水 PointsEntry（P1）

**PointsAccount 字段**：`issuer_name`、`program_name`、`card_id`（可空，支持同银行合并池）、`points_unit`、`confirmed_balance`（用户从官方渠道确认的快照）、`balance_as_of`、`balance_source`（user_input/bank_statement/official_app/other）、`ledger_balance`（由流水派生）、`lots_remaining_total`（由批次派生）、`reconciliation_difference`（`confirmed_balance - ledger_balance`，有符号派生值）、`unallocated_difference`（`ledger_balance - lots_remaining_total`，有符号派生值）、`expiry_model`（none/fixed_date/rolling/lot_based/unknown）、`default_expiry_text`、`consumption_order`（earliest_expiry_first/issuer_defined/user_selected/unknown）、`reconciliation_status`（balanced/mismatch/pending/unknown）、`status`（active/frozen/closed）、`review_status`（clear/needs_review/disputed）、`source_id`、`last_verified_on`。

**PointsLot 字段**：`account_id`、`earned_on`、`expires_on`、`expiry_basis`（fixed/rolling/activity_specific/unknown）、`expiry_confidence`（official/user_input/inferred/unknown）、`amount`、`remaining_amount`、`usage_restriction_text`、`origin_type`（spend/activity/manual/adjustment）、`origin_id`、`status`（open/partially_used/used/expired/void）、`review_status`（clear/needs_review/disputed）。积分预占字段和 `reserved` 状态不进入 P1 首版，避免把兑换计划误当成银行已扣分。

**PointsEntry 字段**：`account_id`、`entry_type`（earn/adjustment/expire/redeem_debit/reversal；`transfer` 仅 P2 双边账本）、`amount`（earn/正向 adjustment 为正，expire/redeem_debit/reversal 按业务方向带符号）、`occurred_on`、`posted_on`、`lot_id`（可空）、`reversal_of_entry_id`、`idempotency_key`、`reference_text`、`source_id`、`note`、`adjustment_reason`（reconciliation/manual/other，可空）。

`reconciliation_difference = confirmed_balance - ledger_balance`；`unallocated_difference = ledger_balance - lots_remaining_total`。两个差额必须分开显示，任一不为零或未知都进入 `mismatch/needs_review`，不得合并为“可用余额”或自动生成批次/调整流水。积分有效期默认 `unknown`；到期提醒只针对用户录入且明确确认的 `expires_on`。

### 4.7 兑换记录 Redemption（P1）

**字段**：`account_id`、`card_id`（可空）、`catalog_name`、`item_name`、`redemption_type`（商城商品/里程/酒店积分/账单抵扣/年费/其他）、`order_or_reference_no`（掩码保存，不得填完整卡号）、`channel`、`requested_on`、`required_points`、`cash_component_amount`、`currency`、`eligibility_text`、`quota_text`、`fulfillment_type`（instant_credit/voucher/physical_delivery/partner_credit/manual_review/unknown）、`fulfillment_deadline`、`order_status`（planned/submitted/accepted/rejected/cancelled/unknown）、`fulfillment_status`（not_started/processing/fulfilled/failed/cancelled/unknown）、`points_debit_status`（not_debited/pending_debit/posted/needs_review）、`refund_status`（not_applicable/not_requested/pending_external_confirmation/confirmed_external/posted/needs_review）、`failure_reason`、`fulfilled_on`、`refund_expected_on`、`points_returned_on`、`actual_value_amount`、`review_status`（clear/needs_review/disputed）、`source_id`、`note`。旧 `status`、`ledger_status`、`pending_refund`、`refunded` 简化投影仅用于兼容读取，不得作为新写入状态。

兑换订单受理、外部履约、本地积分扣减和退分是四条独立状态轴；`accepted` 不等于 `fulfilled`，也不等于 `points_debit_status=posted`，`refund_status=posted` 也必须有外部退回证据。旧 `fulfilled/debited/returned` 仅为兼容读映射，禁止新写入。`failed/cancelled` 不自动推断积分已退。只有用户确认官方账户已扣减/退回后，才以幂等 PointsEntry 写入一次 `redeem_debit`/关联 `reversal`。兑换比例、库存、每户上限和渠道资格从来源带入；没有来源时只能记录用户实际兑换，不展示推荐排序。

### 4.8 提醒 Reminder 与收益记录 ValueRecord（P0/P1）

**Reminder 字段**：`object_type`、`object_id`、`trigger_at`、`timezone`、`reminder_type`（annual_fee/activity_end/reward_verification/benefit_expiry/task_due/points_expiry/verification_due）、`status`（pending/snoozed/completed/ignored/overdue/cancelled）、`delivery`（in_app，P1 email/push）、`completed_at`、`snoozed_until`、`dedupe_key`。`reward_verification` 只有 ActivityReward 存在明确 expected_on 或用户设置核对节点时才生成。

**ValueRecord 字段**：`card_id`、`period_start`、`period_end`、`fee_amount`、`fee_waived_amount`、`benefit_actual_value`、`benefit_estimated_value`、`points_value`、`cashback_value`、`other_cost_amount`、`net_value_amount`、`currency`、`confidence`（confirmed/estimated/user_input）、`calculation_note`、`source_id`。`net_value_amount` 只做算术汇总，不能表述为预期收益。

## 5. 功能需求与优先级

### 5.1 P0：首个手工纵切（工作台增量 MVP）

P0 只交付一条可端到端验收的闭环：**建卡 -> 保存官方来源/规则版本 -> 手工录入一个活动 -> 核对资格/报名/名额 -> 建立刷卡任务 -> 录入累计快照或手工流水 -> 区分预计与确定进度 -> 记录退款/冲正 -> 核对奖励到账/延迟/撤回 -> 站内提醒和审计历史**。

- 账号、时区、卡片、年费、导出和账户删除沿用现有 PRD 的 P0；工作台新增 Card、Source/RuleVersion、CardActivity、SpendMethod、SpendTask、SpendEntry、Reminder。
- 只做用户手工输入/确认，不导入账单，不连接银行，不自动识别交易，不代报名，不传递用户信息。
- 活动资格、报名、名额、任务进度和奖励状态分开展示；任一为未知时只显示“待核对”，不得合并成“活动完成”。
- 任务支持次数、金额、同时满足/满足其一、截止口径、排除项、预计/确定进度和反向流水；`snapshot` 与 `entries` 二选一。
- 首页 90 天增量范围只加入活动截止、任务截止、奖励核对和待核对来源；活动提醒由用户选择节点，默认 30/7/1 天仍只适用于年费。
- 每个规则对象显示来源等级、原文 URL、发布日期/访问日期、适用范围、最后核对日期和不确定项；第三方或搜索摘要只能保存为“线索待官方核对”。
- P0 明确不包含权益账本、积分批次、兑换账本、收益核算、文件导入和扣减顺序建议；可在界面显示“后续支持”，但不得出现不可用入口或伪造数据。

### 5.2 P1：扩展权益与积分账本

- 交付 Benefit/BenefitUsage 的下发、预约、出示、核销、拒绝、争议闭环；只记录用户确认结果，不代用户预约或向第三方发送个人信息。
- 交付 PointsAccount/PointsLot/PointsEntry/Redemption：余额快照、批次到期、未分配差额、手工扣减/失败/退回；用途限制冲突时停止并要求用户指定批次。
- `consumption_order` 在 P1 仅生成“建议批次”，用户逐批确认后才写扣减流水；不得自动扣分、自动兑换或实现积分预占。
- 收益核算只展示用户输入的已确认/估算分项与计算过程，不输出保留/销卡建议。
- 常用银行/卡种模板只预填字段结构和来源链接，不预填未经核验的数值；P1 只提供 CSV/JSON 只读预览、错误校验和导出，完整批量写入、模板自动填数和重复规则检测延后 P2。
- 本地账单 PDF/短信解析在 P1 只生成脱敏预览和备注，不写入 SpendEntry/PointsEntry；进入 P2 后仍必须逐条确认、幂等写入、失败全回滚。
- 邮件、浏览器 Push 提醒和免打扰时段；提醒失败不影响原始对象。
- 权益使用凭证（用户上传的非敏感截图或备注）和兑换订单附件，默认本地加密/短期保留策略待安全评审。

### 5.3 P2：谨慎探索

- 可撤销、最小权限的第三方账单同步；不保存银行密码，授权范围与供应商合规另行评审。
- 规则变更订阅、差异摘要和用户确认工作流；不自动将变化应用到历史任务。
- PWA 离线查看、快捷录入和多设备同步。
- 基于历史记录的“信息性比较视图”（费用与实际使用情况），不生成个性化金融建议或收益预测。

## 6. 关键用户流程

### 6.1 首次建档

注册/登录 -> 设置时区 -> 新增卡片（银行、卡名、后四位、激活/账单日、年费） -> 选择“规则未知/手动录入/粘贴官方来源” -> 保存卡片 -> 添加年费任务和提醒 -> P0 可添加首个活动；权益或积分账户入口在 P1 开放。

### 6.2 录入并执行活动（P0）

活动列表 -> 新增活动与官方来源 -> 核对适用卡/资格 -> 记录是否需报名及结果 -> 记录名额机制与本人结果 -> 关联 SpendTask -> 选择累计快照或逐条流水 -> 按来源的发生/入账/清算口径计算预计与确定进度 -> 用户在官方渠道核对达标 -> 独立记录奖励待发/延迟/到账/撤回/争议。

### 6.3 维护权益（P1）

卡片详情 -> 权益 -> 录入额度/次数、有效期和下发期限 -> 确认凭证已下发 -> 外部渠道预约并记录结果 -> 现场出示 -> 用户确认核销或记录拒绝/争议 -> 仅核销成功扣减额度 -> 到期后只读保留。

### 6.4 积分到期与兑换（P1）

积分中心 -> 手工录入官方余额快照 -> 按批次维护到期日并显示未分配差额 -> 用户在银行官方商城/APP自行兑换 -> 记录订单履约和积分扣减两个状态 -> 用户确认扣分后选择批次并生成幂等扣减流水 -> 失败保留原单 -> 用户确认积分退回后生成关联 reversal；系统不自动下单、扣减或分配差额。

### 6.5 规则变更

用户打开来源链接核对 -> 新建 RuleVersion -> 填写生效区间和变化摘要 -> 旧版本标记 `superseded` -> 未开始任务可选择迁移，进行中/已完成任务保持原版本并提示重新确认。

### 6.6 异常与争议处理

1. **活动未报名/报名失败**：活动仍可收藏和展示，但任务不得显示“可达标”；用户需记录报名渠道、结果和核对时间。报名截止后状态进入 `failed` 或 `unknown`，不自动删除任务。
2. **交易发生但未入账**：先计入 `pending_count/pending_amount` 并显示“预计进度”；只有用户确认银行已入账/清算且符合口径后，才能进入确定进度。截止日经过仍未入账则进入 `disputed` 或 `failed`，不由系统猜测。
3. **退款/冲正跨周期**：以反向 SpendEntry 关联原记录；如果影响已关闭任务，重新打开为 `disputed` 并保留此前达标快照和变更原因。
4. **奖励迟到或被撤回**：任务达标与奖励到账分开；规范 ActivityReward.reward_status 使用 `expected_pending/delayed/received/reversed/disputed`，旧 `pending` 只作兼容读取。只有规则给出发放期限时，超期才转为 `delayed` 并提醒用户核对。
5. **权益未下发/现场拒绝**：权益可处于 `pending_delivery`，服务商未发凭证或现场容量限制时记录 `rejected/disputed`；未实际使用不得扣减次数，额外收费需用户确认。
6. **积分总额与批次不一致**：账户保存官方/用户确认总额，按公式展示有符号 `unallocated_difference`；系统不得为差额虚构到期日，也不得自动写调整流水，核对后由用户显式修正。
7. **兑换失败、超时或退款（P1）**：订单履约和积分扣减分别记录；只有用户确认官方积分账户发生扣减才写一次幂等扣减流水。失败不自动假定积分已退，只有确认退回才写关联反向流水。系统内积分预占、自动履约和自动兑换不在 P0/P1 范围；实物配送、票券入账和里程到账使用不同履约类型。

## 7. 页面信息架构

```text
应用
├── 登录 / 注册 / 时区
├── 工作台首页
│   ├── 待处理总览
│   ├── 任务进度
│   ├── 年费/活动/权益/积分到期时间线
│   ├── 积分账户摘要
│   └── 最近提醒与待核对规则
├── 我的卡片
│   ├── 卡片列表（搜索/银行/状态/年费/可信度筛选）
│   └── 卡片详情
│       ├── 档案与来源
│       ├── 年费周期与刷卡任务
│       ├── 活动
│       ├── 权益
│       ├── 积分账户与流水
│       ├── 兑换记录
│       └── 年度收益记录
├── 活动中心（时间窗/渠道/报名状态/适用卡）
├── 任务中心（日历、进度、逾期）
├── 积分中心（账户、批次到期、兑换）
├── 提醒中心（待处理/稍后/已完成/已忽略）
└── 设置
    ├── 默认提醒与免打扰
    ├── 数据导出/导入
    ├── 来源可信度与核对周期
    └── 账户、隐私与删除
```

详情页统一提供“规则摘要 -> 适用范围 -> 渠道/排除项 -> 来源与核对 -> 用户记录 -> 历史变更”的顺序，避免把第三方推断显示成银行承诺。

## 8. 功能验收标准

### 8.1 P0 验收

1. 新用户可完成“建卡 -> 保存官方来源 -> 录入活动 -> 核对资格/报名/名额 -> 建任务 -> 手工更新进度 -> 记录奖励结果”的完整路径；只接受卡号后四位，不接受完整卡号、CVV、密码或银行凭据。
2. 活动详情分别显示 `eligibility_status`、`enrollment_status`、`quota_status`、`progress_status`、`reward_status`；改变任一状态不会静默改写其他状态，所有变更有时间和用户记录。
3. 任务支持次数、金额、同时满足、满足其一和自定义说明；`snapshot` 与 `entries` 二选一，测试数据不会因两种输入重复计数。
4. 按 `cutoff_basis` 测试发生日、入账日和清算日：只有日期满足周期且 `qualification_status=included` 的记录进入确定进度，其余进入预计或待核对进度。
5. 退款/冲正以关联负向流水处理；部分退款和跨周期退款均保留原记录，累计反向金额不得超过原记录，并可将原已完成任务转为 `disputed`。
6. 规则版本可新增、失效和替代；历史任务/流水仍指向原版本。来源缺 URL、访问日期、适用范围或关键口径时显示 `needs_review`。
7. 活动截止、任务截止和奖励核对提醒使用稳定去重键；完成、忽略、稍后处理和逾期均可追溯，归档卡不产生新提醒。
8. 首页 90 天视图、卡片详情、活动、任务和提醒中心可互相跳转；移动端 360 px 以上无横向溢出。
9. 服务端执行用户所有权校验；导出和账户删除需要二次确认与审计记录；页面固定显示“不构成金融建议”。

### 8.2 P1 验收

1. 权益的下发、预约、出示、核销、拒绝和争议可独立记录；只有用户确认 `redeemed` 才扣减额度。
2. 积分账户同时显示确认余额、流水余额、批次余额与有符号未分配差额；任一不等时进入 `mismatch`，不自动造批次或调整流水。
3. 兑换订单状态与积分扣减状态独立；失败不等于退分，只有用户确认退回后才写关联 reversal，重复确认不会重复入账。
4. 最早到期建议遇到用途限制即停止；用户逐批确认后才扣减，系统不预占、自动扣分或自动兑换。
5. 导入必须预览、逐行校验、可下载错误行，失败不产生部分隐式写入；规则差异不自动重算已完成任务。

### 8.3 第二轮边界验收

1. 活动设置“必须报名”后，`not_started/submitted/rejected/expired/unknown` 均不允许将任务标为 `qualified`；即使报名已 `confirmed`，资格为 `ineligible/uncertain` 或名额为 `full/not_allocated/unknown` 时仍不得最终达标。
2. 同一任务录入一笔 `occurred_only` 记录时只增加预计进度；满足该任务的 `posted/settled` 截止口径后才增加确定进度；`reversed` 必须通过关联反向流水扣回且审计历史完整。
3. 同时满足次数和金额的任务，任一条件只达到预计值时显示 `provisionally_qualified`，不能显示银行已确认达标。
4. 活动任务达标后，奖励仍可为 `pending`；只有来源给出发放期限时才生成预期日，到期未到账转为 `delayed` 并提醒核对；奖励撤回不会静默改写任务历史。
5. 权益从 `pending_delivery` 到 `available` 需记录凭证类型、服务商和核对时间；预约后取消、现场拒绝或争议均不减少 `remaining_value`，只有 `redemption_status=redeemed` 才扣减。
6. 积分账户余额与批次合计不一致时显示差额并进入 `mismatch`；未知差额不分配到任何到期批次，也不触发虚假到期提醒。
7. 批次设置“最早到期优先”时，P1 仅展示建议扣减批次并要求用户确认，不自动分配；若该批次带用途限制而不适用于当前兑换，则停止建议，不能跳过限制静默扣分。系统内预占不在 P0/P1 范围。
8. 兑换失败/取消或退分结果未知时保留订单、履约、扣分和 `refund_status`；只有记录官方退回证据且存在已入账 debit 后生成 reversal 并将 `refund_status` 设为 `posted`，账户与流水可重算一致。
9. 已结束任务因跨周期退款重新进入 `disputed` 时，原结束状态、发生时间、触发退款和修订后的进度均可查看。
10. 所有搜索发现或第三方整理的活动必须显示“线索，待官方核对”，不得自动填充为当前可参加资格或创建达标承诺。

## 9. 非功能、隐私与安全

### 9.1 安全与隐私

- 数据最小化：只收集实现工作台所需的银行、卡名、后四位、日期、用户手工金额/次数和来源；默认不收集交易明细、商户、地理位置、身份证件、完整卡号、CVV、密码或银行登录信息。
- 字段级校验、服务端所有权校验、CSRF/Origin 校验、速率限制、成熟密码慢哈希、会话过期和 HTTPS 为上线前置条件。
- 日志和错误追踪脱敏；禁止把来源页面中的用户参数、订单号或可识别信息写入分析事件。
- 导出、删除、归档、授权和规则确认均写入审计时间线；账户删除提供可撤销冷静期或明确不可恢复提示，具体保留期由合规评审确定。
- 用户上传的凭证（P1）默认不公开、不用于训练或推荐；文件类型、大小、恶意内容和保留期限须单独评审。

### 9.2 性能、可用性与可访问性

- 首页/详情常规网络下首屏可交互不超过 2 秒，接口 p95 不超过 500 ms；单用户支持至少 100 张卡片、每卡 10 年历史记录。
- 日期计算统一使用用户时区；计算、提醒和规则版本有单元测试，主流程有端到端测试。
- 关键状态不只用颜色表达；表单标签、错误和提醒可被屏幕阅读器读取，支持键盘和 360 px 以上移动端。
- 服务异常不得重复生成提醒、流水或年费事件；写入使用事务和幂等键。

### 9.3 “不构成金融建议”边界

产品只展示用户输入和来源规则的结构化记录、状态与算术汇总，不判断应否申请、保留、降级、销卡、套现、借贷或投资，不承诺积分价值、返现、免年费资格或未来收益。所有“推荐”文案统一改为“记录/比较/待核对”，并在收益、任务和兑换页面固定展示：

> 本工具仅用于个人信息记录和计算，不构成金融、投资、信用、税务或法律建议。银行规则、资格、交易入账及兑换结果以发卡行或活动主办方最新官方说明为准。

## 10. 调研来源、可信度与关键决策

### 10.1 第二轮已读取的官方来源（截至 2026-08-14）

| 官方来源（URL） | 访问日期 | 可核验事实 | 可信度 | 不确定项与使用边界 |
| --- | --- | --- | --- | --- |
| [中国银行：2026 年信用卡年费减免政策](https://www.boc.cn/bcservice/bi2/202511/t20251114_25568422.html)（发布 2025-11-14） | 2026-08-14 | 年费规则按产品区分；年费周期与账单日相关；存款、取现、转账不计达标，退货扣减已累计笔数和金额 | 官方原文已读取，当前年度 | 仅适用于页面列明产品和 2026 年收取场景；不能推成其他银行或 2027 年规则 |
| [招商银行：信用卡积分介绍](https://cc.cmbchina.com/content/cusservice/8.htm) | 2026-08-14 | 消费积分按单笔入账金额计算；消费入账次日生效；退款扣回对应积分；交易积分与活动积分有效期不同 | 官方原文已读取 | 页面是概览，特殊卡、活动和商户例外仍需具体规则；不证明个人实时余额 |
| [招商银行：个人用户积分奖励计划](https://market.cmbchina.com/MPage/online/240131174121650/JLJH2024JF/index.html) | 2026-08-14 | 区分交易/活动奖励积分；异常账户或违规可冻结、扣减或清零；退款可追回已使用积分或已兑换项目；官方 App 提供到期提醒并优先使用即将到期积分 | 官方原文已读取 | “优先使用”是该计划规则，不是跨银行默认；扣回/追回触发条件不得泛化为任意活动奖励撤回 |
| [招商银行：移动支付积分活动规则](https://market.cmbchina.com/personal/zfjf/index.html) | 2026-08-14 | 指定支付方式、商户和排除交易；积分在消费入账后 T+1 工作日入账；退款及风险交易可扣回；按到期先后消耗 | 官方原文已读取，历史活动 | 页面活动期为 2018--2019，只用于证明渠道、入账、退款和批次维度，不代表当前可参加 |
| [招商银行：积分兑换航空里程及酒店集团积分](https://market.cmbchina.com/MPage/online/220607120009184/vippc/vipjh/jflc.html) | 2026-08-14 | 资格按指定高端卡；部分兑换限量且兑完即止；合作方受理后到账存在不同天数；兑换不可取消；合作方服务争议主体独立 | 官方原文已读取 | 页面未证明当前库存或个人资格；具体比例、上限和到账时间必须保存版本，不能作为通用默认 |
| [中国银行：高端信用卡贵宾厅服务活动规则（2020-11-01 至 2021-10-31）](https://www.bankofchina.com/bcservice/bc5/bc58/202010/t20201015_18542423.html) | 2026-08-14 | 激活后权益凭证可能延迟下发；资格可因卡片状态失效；现场需凭证、核验和签名；容量可限制进入，并提供服务商及投诉渠道 | 官方原文已读取，历史规则 | 仅作权益状态建模证据，不代表当前权益次数、服务网络、下发时效或个人资格 |

官方原文未给出可跨银行复用的“报名成功”“清算完成”“争议成立”定义，也未证明未知积分差额属于某个到期批次。因此这些字段均允许 `unknown`，必须由对象自身来源或用户官方渠道核对，不设系统默认。

### 10.2 线索登记（不得作为规则事实）

| 线索 | 访问日期 | 可信度 | 处理 |
| --- | --- | --- | --- |
| [招商银行：美国运通百夫长信用卡产品页](https://market.cmbchina.com/MPage/online/220526165734805/AEbfzpc/index.html) | 2026-08-14 | 官方页面但动态正文未完整读取 | 搜索摘要提及到期优先和用途限制，仅用于定位；具体条款标“待官方核对”，不得预填 |
| [CardPointers](https://cardpointers.com/)；[AwardWallet](https://awardwallet.com/) | 2026-08-12（沿用第一轮记录） | 第三方产品公开资料，只是产品线索 | 只用于信息架构启发，不采信银行规则、个人资格或自动连接能力 |
| 搜索引擎摘要 | 2026-08-14 | 线索待官方核对 | 只保存候选 URL；未读取官方正文前不得创建可执行活动、规则数值或达标承诺 |

### 10.3 关键决策

1. **卡片为核心聚合**：活动、权益、刷卡任务、积分账户和兑换记录独立建模并关联卡片，避免把银行差异堆进卡片表。
2. **规则可追溯而非自动推断**：每条规则必须有来源、版本、适用范围、生效期、渠道/排除项和最后核对日期；缺字段即待核对。
3. **数值不泛化**：官方来源中的具体笔数、金额、积分比例只作为实例或用户自录规则，绝不生成跨银行默认值。
4. **收益只做回顾**：净值是用户输入分项的算术结果，分离估算与已确认，不输出金融建议。
5. **手动纵切优先**：P0 只交付活动/任务/奖励闭环；权益、积分批次和兑换账本在 P1，二者都不接银行、不自动交易或兑换。
6. **快照与流水不双算**：刷卡任务的 `snapshot/entries` 二选一；积分同时保留确认快照、流水值和批次值并显式展示差额。

### 10.4 研究限制与风险

- 银行页面可能按年度、卡种、客户等级或地区变化；本 PRD 的银行事实不代表 2026 年之后仍有效。
- 部分积分商城/活动页需要登录或动态脚本，无法仅凭公开页面验证个人资格、库存或实时余额；产品必须允许“官方页面但信息不完整”。
- 搜索摘要或历史 PDF 只能证明页面存在及其公开表述，不能替代用户当前账单/银行 App 的最终结果；历史规则不得自动套用到新卡。
- 第三方成熟产品的功能说明用于启发信息架构，不作为银行规则证据，也不暗示 Cardfolio 具备其自动化能力。
- 任何自动同步、OCR、文件上传和推送能力在实现前需进行隐私、安全、合规和误判率评审。

### 10.5 第三轮新增公开来源

本轮产品角色又复核了建设银行公开页面，补充验证“活动入口、积分兑换、订单履约和支付渠道”必须作为独立记录维度。以下页面均在 2026-08-14 访问并返回可读页面；动态或导航页只证明入口/结构存在，不证明个人资格、库存或当前数值。

| 官方来源 | 可用于需求的事实 | 使用边界 |
| --- | --- | --- |
| [建设银行：信用卡积分兑换入口](https://creditcard.ccb.com/cn/creditcard/jfdh.html) | 积分抵扣、积分换礼等兑换入口与账户/商城渠道分开 | 不证明未登录用户资格、库存、余额或兑换比例 |
| [建设银行积分商城：帮助中心](https://jf.ccb.com/exchangecenter/help/index.jhtml) | 订单、支付、活动规则、积分规则、配送和售后属于不同履约维度 | 目录不是具体商品条款；必须保存当次规则与订单结果 |
| [建设银行：龙卡信用卡优惠/云闪付专题](https://www.ccb.com/cn/html1/office/xyk/subject/25/04/0416dsn/index.html) | 活动可能绑定特定支付渠道，渠道是刷卡任务口径的一部分 | 正文动态不完整时只能标记“官方页面信息不完整” |
| [建设银行：信用卡频道](https://creditcard.ccb.com/cn/creditcard/index.html) | 活动、积分兑换和信用卡管理是不同入口，不能合并成卡片单一状态 | 导航入口不构成活动规则或当前资格 |

第三轮正式研究稿记录了 10 个官方来源、20 条可执行验收和各来源不可泛化边界，见 [CARD-DOMAIN-PRODUCT-RESEARCH.md](research/CARD-DOMAIN-PRODUCT-RESEARCH.md)。

## 11. 第二轮调研与需求修订

### 11.1 复核结论

第二轮围绕卡活动、卡权益、刷卡方式/任务、积分账户/到期批次/兑换复核。结论是：第一轮实体方向正确，但将“任务完成”视作单一状态不足以覆盖真实规则。官方规则显示至少存在五条相互独立的状态链：

```text
活动：发现 -> 核对资格 -> 报名 -> 交易达标 -> 奖励待发 -> 奖励到账/撤回/争议
权益：等待下发 -> 可用 -> 预约 -> 现场核销 -> 已用/拒绝/争议
交易：发生 -> 待入账 -> 已入账/清算 -> 符合/排除 -> 退款/冲正
积分：确认余额 -> 到期批次/未分配差额 -> 用户指定批次 -> 扣减 -> 退回/过期
兑换：计划 -> 提交 -> 处理 -> 不同履约方式 -> 履约/失败/退款/争议
```

因此本轮把状态拆分为 `eligibility_status`、`enrollment_status`、`quota_status`、`progress_status`、`reward_status`、`entitlement_status`、`reservation_status`、`redemption_status`、`processing_status`、`qualification_status`、`points_debit_status`、`refund_status` 和 `redemption.status`。开发不得用一个“完成”字段替代这些状态。

### 11.2 新增用户场景

- 用户从公开页面发现活动，但不确定本人是否受邀：先保存为“线索”，只在银行官方渠道核对后转为可执行活动。
- 用户报名成功后才消费；如果报名失败、名额用尽或活动已截止，保留记录用于复盘，不提示继续刷卡。
- 用户截止日前完成消费但交易尚未入账：展示预计进度和风险，不提前宣布达标。
- 用户已达标但奖励未按期到账，或到账后因退款被撤回：独立跟踪奖励状态和争议时间线。
- 用户激活卡片后权益凭证延迟下发，或预约成功但现场因容量/服务网络变更被拒：不把权益误记为已用。
- 用户只知道积分总额和一个临近到期批次，无法解释剩余积分：保留未分配差额，不伪造批次。
- 用户兑换时存在最早到期批次，但该批次不可用于目标商品/里程：停止自动扣分并要求人工确认。
- 用户兑换失败但积分是否退回未知：订单与积分扣减分别保留待核对状态。

### 11.3 需求修订摘要

| 范围 | 第一轮缺口 | 第二轮修订 | 优先级 |
| --- | --- | --- | --- |
| 卡活动 | 报名和奖励仅有粗粒度字段 | 增加报名核对、名额分配、资格口径、延迟、奖励到账/撤回/争议 | P0 |
| 卡权益 | 缺下发、凭证、服务商和核销事件 | 增加权益下发、预约、出示、核销、拒绝与争议，核销前不扣额度 | P1 |
| 刷卡任务 | 未区分发生、入账、清算和预计进度 | 增加截止口径、待入账值、暂时达标、争议、退款跨周期重开 | P0 |
| 积分账户 | 批次合计默认等于账户余额 | 区分确认快照、流水余额、批次合计和有符号差额；不自动造批次 | P1 手工 |
| 兑换 | 订单结果与积分扣减耦合 | 分开订单履约与积分扣减；仅用户确认后写幂等扣减/退回流水，不做预占 | P1 |
| 指标 | 只有体验目标，缺工作台运营指标 | 增加建档、规则可核对、临期处置、任务对账、积分新鲜度和错误恢复指标 | P0 埋点定义 |
| 验收 | 缺报名失败、未入账、现场拒绝、余额不一致等边界 | 新增 10 条可测试边界验收并标清 P0/P1 | P0/P1 |

### 11.4 第二轮证据使用原则

- 中国银行 2026 年费页和历史贵宾厅页为直接读取的官方规则证据；前者可说明当前年度年费口径，后者只用于证明权益模型需要哪些维度，不代表当前仍享有对应次数或服务。
- 招商银行积分介绍、积分奖励计划、历史移动支付积分规则和里程/酒店兑换页均为本轮直接读取的官方原文；历史规则只证明建模维度，不代表当前资格。
- 招商银行百夫长产品页的动态正文未完整读取，搜索摘要仅用于定位官方 URL；相关条款标记“待官方核对”，不转成默认值、当前资格或自动任务。
- CardPointers、AwardWallet 仅提供成熟产品的公开信息架构参考；不采信其银行规则，不复制其自动连接账户方式。
- 来源的适用期、发布日期、访问日期和可信度必须随规则版本保存；旧页面只作建模证据或历史快照。

## 12. 验证结果与交付边界

- 已确认当前基线为 `e756538008a4ba55b920d22a28d9dac352067a0c`，本轮开始时工作树无已有改动。
- 产品角色本轮只修改 `docs/PRD-WORKBENCH.md`，未修改代码、技术、数据库、UX 文档，未提交、未推送。
- 静态检查覆盖：官方来源 URL/访问日期/可信度/不确定项；活动、权益、交易、积分和兑换独立状态；P0/P1 边界；至少 5 条边界验收；禁止银行登录、完整卡号、自动交易/兑换和金融建议。
- 未运行应用测试或构建，因为本轮明确只做产品文档；后续开发应据字段、状态转换和验收标准补充单元测试、端到端测试与规则核对测试。

## 13. 第三轮角色调研整合

本轮采用产品、架构、DBA 三个独立研究稿，再由主会话合并。新增结论不改变第二轮“状态正交、来源可追溯、手工优先”的方向，而是把实现门槛写得更明确：

1. **P0 只承诺活动 + 单卡刷卡任务 + 奖励人工核对。** 权益额度、积分批次和兑换账本分别作为 P1 纵切，不能在当前 UI 以伪造数据提前开放。
2. **活动五轴必须独立。** 资格、报名、名额、任务进度和奖励到账分别记录；`potentially_eligible`、`submitted`、`target_reached` 和 `pending` 都不能展示为银行已确认成功。
3. **交易口径必须可重放。** 任务冻结 `occurred/posted/settled` 截止口径和刷卡方式快照；预计与确定进度分开；退款/冲正只追加关联流水并允许跨周期回退到 `needs_review`。
4. **权益只在实际核销时扣减。** 凭证下发、预约、出示、现场核销和拒绝/争议是不同事实；预约取消、现场拒绝和争议不得减少额度。
5. **积分和兑换必须双账本/双状态。** 余额观察值、账面流水、批次余额和有符号未分配差额并列展示；兑换订单成功不等于积分扣减已入账，失败不等于积分已退回。
6. **未知值是业务状态。** 资格、名额、入账口径、奖励期限、凭证、积分到期日和退分结果未知时显示“待核对”，不生成提醒、推荐或默认数值。

角色研究稿：

- [产品研究](research/CARD-DOMAIN-PRODUCT-RESEARCH.md)：10 个官方来源、20 条验收与用户任务。
- [架构复核](research/CARD-DOMAIN-ARCHITECTURE-REVIEW.md)：状态机、API、事件、幂等、恢复和 P0/P1/P2 分期。
- [数据复核](research/CARD-DOMAIN-DATA-REVIEW.md)：复合所有权、账本恒等式、迁移顺序和 15 类数据库验收。

## 14. 第四轮角色复核与需求补充

本轮由产品经理、QA/架构、安全/DBA 分别复核正式文档和研究稿；结论只扩展需求契约，不代表当前代码已经实现。

### 14.1 工作台能力地图

| 领域 | 用户要解决的问题 | 首版承诺 | 后续能力 |
| --- | --- | --- | --- |
| 卡活动 | 我是否适用、是否报名、名额是否确认、消费是否达标、奖励何时到账 | P0：每张卡独立参与、单卡任务、奖励人工核对 | P1：更多模板；P2：受控导入和外部连接器 |
| 卡权益 | 我有多少次/额度、是否需要预约、现场是否核销、被拒如何追踪 | P1-a：下发、预约、出示、核销和争议；只有核销扣额度 | P2：附件、服务商/预约连接器 |
| 刷卡方式 | 哪些渠道、商户、地区、币种和排除项算入目标 | P0：激活时冻结 SpendMethod 快照，区分发生/入账/清算和预计/确定进度 | P1：只读导入预览；P2：自动识别或同步 |
| 积分 | 余额、到期批次和流水为何不一致 | P1-b：确认余额、append-only 流水、lot、双差额对账 | P2：自动分配、跨账户转移和 hold |
| 积分兑换 | 订单成功是否等于扣分，失败后是否退回 | P1-b：外部订单轴与本地 debit/refund 轴分开，用户确认后幂等记账 | P2：系统内预占、库存和服务商连接 |
| 横切工作台 | 规则从哪里来、何时需要处理、价值如何回顾 | P0：来源/规则版本、站内提醒、审计和待核对状态 | P1/P2：导入、外部通知和价值评估增强 |

### 14.2 新增验收标准

1. 同一活动适用多张卡时，系统为每张卡创建独立 participation、名额、任务和奖励事实；跨卡消费不得合并达标。
2. 活动资格、报名、名额、任务进度和奖励到账分别展示；`submitted`、`target_reached`、`pending` 不得显示为银行确认成功。
3. SpendTask 必须显示预计值与确定值，并明确 `occurred/posted/settled` 截止口径；退款/冲正后保留原流水并将受影响确认结果转为待核对。
4. 权益预约、出示和现场核销分别留痕；预约取消、拒绝和争议不扣次数/额度，只有用户确认核销才扣减。
5. 积分页面同时显示用户确认余额、账面余额、已分配批次、`reconciliation_difference` 与 `unallocated_difference`；差额不为零时不得伪造可用余额或到期批次。
6. 兑换页面并列显示订单状态与积分扣减状态；失败/取消不自动退分，退款必须关联已入账 debit 和官方退回证据。
7. 所有新增写命令支持同键重放返回首次结果、同键异参数返回 409；跨用户或同用户跨卡不兼容引用统一返回 404。
8. 规则、来源、提醒和账本历史可追溯到版本、时区、来源和审计事件；未知或过期信息显示“待核对”，不自动生成资格、收益或提醒结论。

### 14.3 需求冻结与发布门

- **Gate 0（实现前）**：冻结 canonical 状态、来源版本、所有权、幂等键、提醒去重、`snapshot/entries` 互斥、旧进度 adapter 以及 P0/P1/P2 feature flag。
- **Gate 1（P0）**：真实迁移、活动奖励事实、SpendTask milestone/qualification、复合 ownership/RLS、outbox/inbox、删除注册表和自动化测试全部通过后，才可发布活动/刷卡任务纵切。
- **Gate 2（P1）**：权益额度账本、积分 lot/对账、兑换双状态及并发/重放/恢复测试分别通过后，才可开启对应模块；当前不能把它们当作已部署能力。

本轮研究证据与未决风险见 [产品对齐稿](research/CARD-DOMAIN-ALIGNMENT-PRODUCT.md)、[架构对齐稿](research/CARD-DOMAIN-ALIGNMENT-ARCHITECTURE.md)、[数据约束稿](research/CARD-DOMAIN-ALIGNMENT-DATA.md) 和 [QA 对齐稿](research/CARD-DOMAIN-ALIGNMENT-QA.md)。

## 15. 第五轮领域需求收敛（2026-08-14）

本轮产品、架构、DBA、安全、QA 与 UX 角色复核了卡活动、卡权益、刷卡方式/任务、积分和兑换的正式契约。本文仍是规划文档；当前代码仍只能称为年费 MVP。

### 15.1 P0 最小成功路径

P0 的最小可验收夹具固定为：一个用户、一张卡、一个有来源的活动、一个单卡 SpendTask、一个奖励组件。多卡适用仍必须支持每卡独立 participation，但首次建档不要求一次录入全部卡片。P0 可执行任务表达式仅包括 `count`、`amount`、`count_and_amount`、`count_or_amount`；`custom` 只保存原文和待核对原因，不参与自动进度计算。

所有 `unknown`、`needs_review`、`disputed` 必须同时保存 `reason_code`、`evidence_note`、`last_verified_at` 和 `next_action`。缺少这些信息时，页面可以保存线索，但不得产生最终达标、可用、已到账、可兑换、到期或收益结论。

### 15.2 P1 发布门收窄

- **P1-a 权益**只交付 `consumable_quota` 和 `service_eligibility` 的下发、预约、出示、核销/拒绝/争议；只有确认核销才扣减额度。保险理赔、年费抵扣/返还、服务商索赔和 `coverage_claim`/`fee_credit` 不得复用次数型账本。
- **P1-b 积分/兑换**必须同时展示 `confirmed_balance`、`ledger_balance`、`lots_remaining_total`、`reconciliation_difference` 和 `unallocated_difference`。兑换订单履约与积分扣减分轴；只有用户确认官方扣分才写幂等 debit，只有已入账 debit 且有官方退回证据才写 reversal。失败或取消不自动退分。
- P1-a 与 P1-b 分别通过真实迁移、重放、并发、恢复和移动端状态验收后，才允许开启对应入口；不能以一个“积分中心”或“权益中心”空壳代替发布门。

### 15.3 验收格式与延后项

新增/修订验收必须采用 Given/When/Then 结构，并标注前置夹具、命令/UI 操作、预期状态/数值、错误码和证据位置。至少覆盖：来源缺失、资格未知、报名提交未确认、名额未知、发生/入账/清算跨时区、重复请求、退款冲正、权益现场拒绝、余额与批次不一致、订单成功但扣分 pending、失败退分未知和跨用户引用。

银行登录/同步、PDF/OCR/CSV 直接写入、自动报名/预约/兑换、系统内积分 hold/reservation、自动 lot、跨账户 transfer、外部连接器和个性化“最优刷卡”建议均继续列为 P2；P1 导入只允许隔离预览，不写入事实表。

本轮交付材料见：[产品复核](research/CARD-DOMAIN-FOLLOWUP-PRODUCT.md)、[架构复核](research/CARD-DOMAIN-FOLLOWUP-ARCHITECTURE.md)、[数据复核](research/CARD-DOMAIN-FOLLOWUP-DATA.md)、[安全复核](research/CARD-DOMAIN-FOLLOWUP-SECURITY.md)、[QA 复核](research/CARD-DOMAIN-FOLLOWUP-QA.md)、[UX 复核](research/CARD-DOMAIN-FOLLOWUP-UX.md)。

## 16. 第六轮扩展能力收敛（2026-08-14）

本轮由产品经理、架构师和 DBA 独立复核，并以中国银行、招商银行、建设银行公开页面作维度核验。公开页面只证明规则可能包含哪些维度，不证明用户当前资格、库存、实时余额、发奖或退分结果；当前代码仍是年费 MVP，以下内容是实现前契约。

### 16.1 能力地图与发布顺序

| 领域 | 用户要解决的问题 | 首个可交付纵切 | 明确延后 |
| --- | --- | --- | --- |
| 卡活动 | 我是否适用、是否报名、名额和奖励是否确认 | **P0**：来源/规则版本、每卡每周期参与实例、资格/报名/名额、单卡刷卡任务、多奖励组件和人工奖励核对 | 自动抓取、自动报名、跨合作方奖励编排 |
| 卡权益 | 我有哪些次数/资格、是否预约、是否核销或被拒 | **P1-a**：`consumable_quota`、`service_eligibility` 的下发、预约、出示、核销/拒绝/争议；只有核销扣减 | 保险理赔、年费抵扣/返还、服务商连接器、长期附件 |
| 刷卡方式/任务 | 哪些支付路由、商户、地区、币种和日期口径计入 | **P0**：激活时冻结支付路由快照和 `activity_instance_key`，区分 occurred/posted/settled 与预计/确定进度 | 自动识别、账单同步、自动周期实例 |
| 积分账户 | 官方余额、本地流水和到期批次为何不一致 | **P1-b**：确认余额、append-only 流水、批次、两个有符号差额和待核对提醒 | 自动 FIFO/lot、跨账户转移、系统 hold |
| 积分兑换 | 外部订单成功是否等于扣分，失败后是否退回 | **P1-b**：订单、履约、积分扣分、退分四轴；用户确认后幂等记账 | 自动下单、库存/合作方连接器、部分退分自动化 |

P1-a、P1-b 必须分别通过真实迁移、所有权、并发/重放、恢复和移动端验收后再开启 feature flag；不能用空的“权益中心”或“积分中心”入口冒充已交付能力。

### 16.2 本轮冻结的产品口径

1. **线索不等于活动事实。** 只有第三方摘要或不完整页面时保存“线索/待官方核对”和 `next_action`，不能创建确定 SpendTask、奖励金额或“可参加”承诺；补齐官方来源、适用期和关键口径后才激活规则。
2. **活动以参与实例为中心。** 唯一业务范围是 `(owner_user_id, campaign_id, card_id, activity_instance_key)`；资格、报名、名额、任务进度和奖励组件各自记录。多卡消费不得跨卡合并。
3. **奖励支持多组件。** 积分、返现、礼品、费用减免等使用独立 `reward_key`、来源、期限、状态和证据；一个组件到账不得改写其他组件。
4. **刷卡方式必须可重放。** 任务激活时冻结支付渠道/钱包、线上线下、商户/MCC、地区、币种和排除项快照；缺少必需 posted/settled milestone 或路由未知时只计入预计/待核对值。`snapshot` 与 `entries` 二选一。
5. **权益按使用模型分型。** 保险和年费抵扣不能套用次数余额；只有 `consumable_quota` 的首次 `redeemed` 才产生 consume，预约、出示、拒绝和争议不扣减。
6. **积分固定两个差额。** `reconciliation_difference = confirmed_balance - ledger_balance`；`unallocated_difference = ledger_balance - lots_remaining_total`。两者必须分开显示并带 `as_of`，未知批次不得生成到期提醒或自动扣减建议。
7. **兑换状态分轴。** 外部 `order_status`、`fulfillment_status`、本地 `points_debit_status` 和 `refund_status` 不互相推导；失败/取消不自动退分，只有已入账 debit 且有官方退回证据才能追加 reversal。
8. **未知必须可行动。** `unknown`、`needs_review`、`disputed` 均需 `reason_code`、`evidence_note`、`last_verified_at`、`next_action`；没有明确日期不得生成“逾期/即将过期”结论。

### 16.3 第六轮 Given/When/Then 验收补充

1. **活动线索隔离**：Given 用户只有第三方摘要；When 保存；Then 只能生成线索和补充官方规则动作，不得生成确定任务或奖励承诺。
2. **多卡多周期隔离**：Given 同一规则适用于两张卡或两个周期；When 分别录入消费；Then participation、进度、提醒和奖励不互相累计。
3. **支付路由隔离**：Given 规则只允许实体 POS；When 同时录入移动钱包和实体 POS；Then 钱包进入 `pending/excluded`，实体 POS 按规则计入确定进度。
4. **多奖励独立**：Given 同一 participation 有积分和返现；When 只确认积分到账；Then 返现仍为待发/延迟，活动不能显示全部奖励已到账。
5. **权益不提前扣减**：Given 权益预约成功但未核销；When 查看额度；Then 剩余额度不变；只有首次 `redeemed` 扣减且重复请求幂等。
6. **积分双差额**：Given `confirmed=100`、`ledger=90`、`lots=80`；When 查看账户；Then 分别显示 `+10` 和 `+10`，不显示合并的“可用 20”，账户进入 `mismatch/needs_review`。
7. **兑换双轴**：Given 外部订单成功但积分扣分未核对；When 保存订单；Then 履约为成功、扣分为 `pending_debit`；失败或取消不得自动写退分流水。
8. **未知可行动**：Given 任一对象为 `unknown/needs_review/disputed`；When 保存状态；Then 缺少原因、证据时间或下一步时拒绝最终成功/可用/到账/到期结论，并在详情显示下一步动作。

### 16.4 第六轮研究稿与责任交接

- [产品经理复核](research/CARD-DOMAIN-ROUND6-PRODUCT.md)：用户任务、优先级、指标、16 条 GWT 和公开来源边界。
- [架构师复核](research/CARD-DOMAIN-ROUND6-ARCHITECTURE.md)：聚合/状态/API/事件/幂等、兼容 adapter 和 Gate 0--2。
- [DBA 复核](research/CARD-DOMAIN-ROUND6-DATA.md)：表/约束/索引、账本恒等式、expand/contract、恢复和 14 条数据库验收。

产品经理负责范围和验收，架构师负责跨模块契约与发布门，DBA 负责事实表/账本/迁移约束；QA、安全和 UX 只做独立验证，不越权改写这些契约。主会话负责整合、验证和发布决策。

### 16.5 第七轮 Gate 0 补充

第七轮产品、架构和 DBA 复核没有扩大产品范围，而是把实现阻断写成用户可验证的门槛：

- 奖励到账、撤回和争议必须可从独立事件重放；主表不是第二事实源。
- 刷卡任务的 `snapshot/entries` 互斥、`SpendMilestone` canonical API、提醒租约/重试/死信、固定卡/合并池 scope 和旧枚举兼容映射必须有数据库/接口验收。
- 权益新写入采用 `grant/consume/restore/expire`，`reversal` 只表达技术性精确反向；未知 usage model 不得扣次数。
- 兑换继续使用订单、履约、扣分、退分四轴；任何旧 `status=success`、`ledger_status`、`pending_refund/refunded` 只能作为兼容读。

第七轮研究稿：[产品研究](research/CARD-DOMAIN-ROUND7-PRODUCT.md)、[架构复核](research/CARD-DOMAIN-ROUND7-ARCHITECTURE.md)、[DBA 复核](research/CARD-DOMAIN-ROUND7-DATA.md)。这些条款用于 Gate 0--3 和后续测试，不代表当前代码已经支持活动、权益、积分或兑换。

## 17. 第八轮用户行动、数据约束与验收补充（2026-08-15）

本轮由产品经理、架构师、DBA 和 QA 分别复核公开规则、正式契约、现有 schema/migration 和跨文档验收。它是对第七轮的增量，不改变“当前代码仍是年费 MVP、扩展能力必须通过 Gate 才能发布”的边界。

### 17.1 调研结论与来源边界

本轮复查了中国银行、招商银行和建设银行的年费、积分、兑换、权益及支付渠道公开页面，8 个 URL 在 2026-08-15 均返回 HTTP 200。页面只证明规则可能包含产品、周期、支付路由、入账、退款、凭证、库存、履约和争议等维度；不证明 Cardfolio 用户的个人资格、名额、实时余额、库存、发奖、退分或服务可用性。来源 URL、访问日期、原文摘录、内容哈希、适用期和可信度必须随 SourceSnapshot/RuleVersion 保存；搜索摘要、第三方攻略、历史规则和导航页只能保存为线索或建模证据。

完整来源表、适用边界和 HTTP 证据见 [第八轮产品研究](research/CARD-DOMAIN-ROUND8-PRODUCT.md)。

### 17.2 本轮新增需求冻结

| 范围 | 新增要求 | 发布门 |
| --- | --- | --- |
| 活动预检 | 活动详情先核对来源、适用卡/客群、活动期、报名截止、名额、支付路由和奖励组件；缺关键事实时只能保存 `lead/needs_review`，禁止激活确定 SpendTask 或“开始刷卡”提醒。 | P0 |
| 报名与换版 | 保存报名提交时间、截止口径、掩码回执/哈希和外部结果；重复提交幂等；截止后只允许记录结果/复盘。规则换版或活动取消停止未来动作，不覆盖历史实例、流水和奖励。 | P0 |
| 刷卡方式 | 激活任务时冻结 SpendMethodSnapshot、`cutoff_basis`、IANA 时区、币种、商户/MCC、路由和排除项。每笔消费显示 `included/pending/excluded/disputed` 原因；发生/入账/清算缺一时只显示预计或待核对。 | P0 |
| 退款与奖励 | 退款/冲正追加反向事实，允许任务回退并标记受影响奖励待核对；不自动写退分或发奖。多奖励组件按 `reward_key` 独立核对。 | P0 |
| 权益 | 以周期实例和使用时间线记录预约、改期、取消、出示、核销、拒绝、争议、凭证轮换和服务商变更；只有 `consumable_quota` 首次核销扣 `consume`，非次数权益保存独立结果。 | P1-a |
| 积分 | 分开待入账/已入账、确认余额、账面余额、批次和两个差额；真实负余额保留并进入 `needs_review`，未知批次不造 lot/FIFO/到期结论。 | P1-b |
| 兑换 | 预检适用账户/卡、所需积分、现金部分、库存/上限和不可取消说明；订单、履约、积分扣分、退分四轴独立，支持部分履约；失败/取消不自动退分。 | P1-b |
| 横切行动 | 所有 `unknown/needs_review/disputed` 必须有 `reason_code`、`evidence_note`、`last_verified_at`、`as_of`、`next_action` 和（如有）复核日期/深链；忽略只停止提醒，不删除证据。 | P0 |

### 17.3 Canonical 状态与兼容读

第八轮架构和 QA 建议在 Gate 0 统一以下写入语义；旧字段只能单向兼容读取，不能继续生成第二套事实：

- `expected_pending` 是奖励尚未确认到账的 canonical 写入；旧 `pending` 只做兼容读映射。
- `ended` 是活动/规则结束的 canonical 写入；旧 `expired` 只作原因或兼容读别名。
- `rejected` 表示外部明确拒绝；`failed` 只作错误结果原因码或兼容读，不新增同义主状态。
- 报名失败、名额未分配等不新增 `blocked` 主状态，使用 `needs_review` 加结构化原因（例如 `registration_rejected`、`quota_not_allocated`），并停止继续消费提醒。
- 用户可见“已核销”映射为权益 `used` 事件；只有次数型权益的首次 `used` 触发 `consume`。`redeemed`、`use` 和 `adjustment` 只保留兼容读语义。
- 任务输入 `snapshot/entries` 互斥；SpendEntry 只追加发生事实，posted/settled/rejected 通过 SpendMilestone canonical 路径追加，旧 entry 字段只做读投影。

### 17.4 新增验收与发布门

第八轮新增 18 条产品 GWT 和 15 条跨文档 QA 用例，重点覆盖报名截止、重复回执、规则换版、支付路由排除、跨时区、活动取消、权益改期/拒绝、待入账积分、负余额、兑换部分履约、Reminder lease 和跨用户 404。详见 [第八轮产品研究](research/CARD-DOMAIN-ROUND8-PRODUCT.md)、[第八轮 QA 复核](research/CARD-DOMAIN-ROUND8-QA.md)。

- **Gate 0（当前阻断）**：签收 canonical 状态、四元 participation、SpendMilestone 路径、来源快照、`snapshot/entries` 互斥、未知行动、幂等和旧年费 adapter；补齐本轮 DBA 表/约束/触发器契约。
- **Gate 1（当前阻断）**：真实 PostgreSQL 迁移、复合 ownership/RLS、append-only/账本守恒、outbox/inbox、回滚和恢复演练；先清理现有年费表跨用户引用风险。
- **Gate 2（P0，当前阻断）**：活动五轴、单卡单周期任务、消费里程碑、退款反向事实、奖励事件、提醒去重和 API/UI/E2E 全部通过。
- **Gate 3（P1-a，当前阻断）**：权益周期、预约/拒绝/争议和额度账本通过并发、重放、恢复和移动端验收。
- **Gate 4（P1-b，当前阻断）**：积分双差额、批次分配、兑换四轴、现金/部分履约、扣分/退分幂等和恢复通过。
- **Gate 5（切换，当前阻断）**：旧写路径停用，canonical 成为唯一事实源；导出、删除、审计、观测和年费回归保持通过。

当前可部署范围仍只有年费 MVP。新领域没有 schema、migration、API、worker 或业务 E2E 时，不得显示为已实现入口，也不得以文档状态代替发布证据。

### 17.5 第八轮角色交接

- [产品经理：领域需求补充调研](research/CARD-DOMAIN-ROUND8-PRODUCT.md)：8 个官方来源、12 项用户行动缺口、P0/P1/P2 和 18 条增量 GWT。
- [架构师：状态与接口补充复核](research/CARD-DOMAIN-ROUND8-ARCHITECTURE.md)：canonical 聚合/事件/API、旧年费单向 adapter、unknown/幂等/恢复和 Gate 0--5。
- [DBA：账本与迁移补充复核](research/CARD-DOMAIN-ROUND8-DATA.md)：ownership 预检、报名/路由/权益/积分/兑换/Reminder 约束、Stage 0--8 迁移和恢复门槛。
- [QA：跨文档验收复核](research/CARD-DOMAIN-ROUND8-QA.md)：15 条跨文档用例、冲突清单、Gate 0--5 和年费回归影响。

以上角色均为只读研究交付；本轮没有修改业务代码、schema、migration 或锁文件，也没有创建提交或推送。研究稿已通过各自 `git diff --check`，真实 PostgreSQL、RLS、worker、迁移、恢复和新领域 E2E 仍未执行。

## 18. 第九轮卡领域需求整合（2026-08-15）

本轮在已有八轮研究基础上，重新按用户动作核对卡活动、卡权益、刷卡方式、积分账户和积分兑换的边界，并分发 DBA、QA、安全角色做独立复核。新增内容是产品契约，不代表当前代码已经实现这些模块。

### 18.1 用户动作与交付阶段

| 模块 | 用户需要完成的动作 | 本项目交付边界 |
| --- | --- | --- |
| 卡活动 | 保存规则来源，核对资格，记录报名/名额，执行刷卡任务，核对奖励组件 | P0：每卡每周期 participation、单卡任务、多奖励组件、人工奖励核对；不自动报名、抢名额或发奖 |
| 卡权益 | 确认下发，预约/改期，记录出示和现场结果 | P1-a：次数型与服务资格型权益；只有确认核销才扣额度；不代预约、不把保险/费用抵扣当次数扣减 |
| 刷卡方式 | 选择支付路由和规则口径，记录发生/入账/清算及退款 | P0：激活时冻结 SpendMethodSnapshot，预计/确定进度分离；不读取交易、不判断银行最终认定 |
| 积分账户 | 录入官方确认余额，补充到期批次，解释流水差额 | P1-b：确认余额、append-only 流水、lot、双差额；不自动造 lot、FIFO、过期或跨账户转移 |
| 积分兑换 | 记录预检、订单、履约、扣分和退分证据 | P1-b：订单/履约/扣分/退分四轴；用户确认后幂等记账；不自动下单、锁库存或猜测退分 |

### 18.2 领域口径冻结

1. **活动不是一条卡片状态。** 活动规则（Campaign）、个人参与实例（ActivityParticipation）、刷卡任务（SpendTask）和每个奖励组件（ActivityReward）分别建模；唯一业务范围为 `(owner_user_id, campaign_id, card_id, activity_instance_key)`，多卡和多周期不得合并。
2. **刷卡方式是规则快照，不是交易流水。** 首版覆盖实体 POS、线上收银台、银行 App、第三方钱包、二维码/移动支付、自动扣款、境外/跨币种等路由维度，并可附加商户/MCC、地区、币种、附属卡和排除项；是否计入由绑定的规则版本决定。
3. **权益按使用模型分型。** `consumable_quota`、`service_eligibility`、`coverage_claim`、`fee_credit` 和 `service_record` 不共享一个余额字段；只有次数型权益首次确认 `redeemed` 才写 `consume`，预约、出示、取消、拒绝和争议不扣减。
4. **积分和兑换是双账本。** 页面同时显示 `confirmed_balance`、`ledger_balance`、`lots_remaining_total`、`reconciliation_difference` 与 `unallocated_difference`；兑换订单成功不等于积分扣减，失败/取消不等于退分，只有已入账 debit 和官方退回证据才允许 reversal。
5. **未知必须可行动。** `unknown`、`needs_review`、`disputed` 均需 `reason_code`、`evidence_note`、`last_verified_at`、`as_of`、`next_action`；没有明确日期、规则版本和来源时不得生成“已达标/可用/已到账/已过期”或对应提醒。

### 18.3 第九轮新增验收

1. 活动缺少官方来源、适用期、报名口径、支付路由或奖励组件时只能保存 `lead/needs_review`，不能激活“开始刷卡”提醒。
2. 同一活动适用两张卡或两个周期时，系统创建独立 participation、任务、奖励和提醒；任一卡的消费不能改变另一卡的确定进度。
3. 规则要求 `posted` 或 `settled` 时，只有对应里程碑落在窗口内且流水为 `included` 才进入确定值；`occurred` 只能进入预计值。
4. 退款/冲正追加反向事实并保留原记录；若影响已达标任务或奖励，状态回到 `needs_review`，不删除历史或自动退分。
5. 权益预约、改期、取消、出示和拒绝均不扣次数；只有首次 `redeemed` 写入 `consume`，重复确认返回第一次结果。
6. 积分差额不为零或批次未知时，账户进入 `needs_review`，不伪造“可用余额”、批次或到期提醒。
7. 兑换外部订单成功但扣分未知时显示 `pending_debit`；失败/取消不自动生成 reversal，确认退分后才写关联且幂等的 reversal。
8. 所有写命令同键同参数重放返回首次结果，同键异参数返回 `409`；跨用户或不兼容跨卡引用统一返回 `404`。

### 18.4 分期发布门

- **Gate 0：** 冻结五条状态链、四元 participation、SpendMethodSnapshot、`snapshot/entries` 互斥、来源快照、未知行动、幂等和旧年费 adapter。
- **Gate 1/P0：** 真实迁移、复合 ownership/RLS、活动五轴、消费里程碑、退款反向事实、奖励组件、提醒去重和 API/UI/E2E 全部通过后，才开放活动与刷卡任务。
- **Gate 2/P1-a：** 权益周期、凭证、预约/拒绝/争议和额度账本通过并发、重放、恢复与移动端验收后，才开放权益入口。
- **Gate 3/P1-b：** 积分双差额、批次、兑换四轴、现金部分/部分履约、扣分/退分幂等和恢复通过后，才开放积分与兑换入口。

当前可部署范围仍只有年费 MVP。研究交付见 [Round9 产品研究](research/CARD-DOMAIN-ROUND9-PRODUCT.md)、[Round9 架构复核](research/CARD-DOMAIN-ROUND9-ARCHITECTURE.md)、[Round9 数据复核](research/CARD-DOMAIN-ROUND9-DATA.md)、[Round9 QA 复核](research/CARD-DOMAIN-ROUND9-QA.md) 和 [Round9 安全复核](research/CARD-DOMAIN-ROUND9-SECURITY.md)。

## 19. 第十轮行动与解释增量（2026-08-15）

第十轮产品、领域架构和 DBA 角色在第九轮契约上做增量核验。本轮不新增一套状态机，重点是让已有状态能够指导用户下一步行动，并让实现边界可以被独立验收。研究稿分别见 [第十轮产品研究](research/CARD-FEATURE-ROUND10-PRODUCT.md)、[第十轮架构核验](research/CARD-FEATURE-ROUND10-ARCHITECTURE.md) 和 [第十轮 DBA 核验](research/CARD-FEATURE-ROUND10-DATA.md)。

### 19.1 关键动作闸门

| 动作 | 新增产品要求 | 未满足时的行为 | 级别 |
| --- | --- | --- | --- |
| 活动报名 | 报名尝试按序号追加，保留外部渠道、提交时间、掩码回执/哈希、结果和重试原因；同键同参数重放幂等。 | 可以保存线索或失败复盘，但不得把提交显示为确认成功；截止后不得创建新的提交尝试。 | P0 |
| 任务激活 | 报名、规则来源、适用卡/客群、活动期、支付路由、截止口径和奖励组件在激活前重新核对；规则超过用户设置的新鲜度阈值时必须重新打开来源确认。 | 允许保存“计划/待核对”，阻止确定达标进度和“开始刷卡”提醒。 | P0 |
| 刷卡记录 | 原始消费事实只保存一次；同一事实若要服务多个任务，必须由后续 `SpendFact` + 任务评估关联模型显式引用。 | 在关联模型未通过 Gate 0 前，禁止复制金额到第二个任务；复制录入应被提示并拒绝。 | P0（关联模型为 Gate 0） |
| 活动取消/退款 | 取消、规则撤回、退款或冲正只停止未来动作并追加反向事实，保留历史参与、消费和奖励证据。 | 任务/奖励转为待核对或短缺，不自动写退分或发奖。 | P0 |
| 权益使用 | 下发、激活、凭证轮换、预约/候补、出示、核销、拒绝和争议有独立时间线；只有次数型首次核销扣额度。 | 凭证未知、候补或现场拒绝时显示下一步，不扣次数、不生成已实现价值。 | P1-a |
| 积分核对 | 余额显示 `as_of` 和新鲜度；确认余额、流水余额、批次余额和两个差额独立展示，提供“补快照/补流水/补批次”动作。 | 过期快照、未知批次或负余额进入待核对，不显示实时/可用余额，不生成 FIFO 或到期结论。 | P1-b |
| 兑换预检与履约 | 兑换计划先核对账户/卡资格、所需积分、现金部分、库存/上限和不可取消说明；订单、分项履约、扣分、退分四轴独立。 | 关键项未知只能保存计划；失败或取消不自动退分，只有官方退分证据才追加 reversal。 | P1-b |

所有 `unknown`、`needs_review` 和 `disputed` 必须显示原因、证据时间、影响、`as_of`（适用时）和可直达的 `next_action`。用户选择“忽略”只停止提醒，不删除事实或证据。首页待核对队列按截止风险、阻断程度和来源新鲜度排序；这是提醒排序，不是收益或最优刷卡建议。

### 19.2 用户可解释文案

规则来源和个人事实必须在界面上明确区分。产品统一使用以下语义：

- “官方规则已读取（访问于 YYYY-MM-DD）”只表示正文可访问，不表示用户符合资格。
- “线索，待官方核对”表示缺少适用期、资格、渠道或奖励关键字段，不得展示为“当前活动/可参加”。
- “已记录外部提交，回执未确认前不视为报名成功”；“预计进度”与“确定进度（按入账/清算口径）”必须带 `cutoff_basis`。
- “用户录入余额：截至 YYYY-MM-DD；不是实时余额”“兑换计划/待核对；未写入积分扣减”禁止被替换成“实时可用积分/可兑换”。
- 权益现场拒绝、兑换争议和奖励延迟显示“结果待外部核对；Cardfolio 不判断银行或服务商责任”。

### 19.3 首个纵切与新增验收

首个可开发纵切仍固定为：一个用户、一张卡、一个有官方来源的活动、一个 participation、一个 SpendTask、一个 canonical 消费事实、一个奖励组件和一个站内提醒。纵切完成“来源预检 -> 外部报名记录 -> 冻结刷卡口径 -> 预计/确定进度 -> 退款反向事实 -> 奖励逐项核对 -> 待核对动作”闭环；权益、积分批次和兑换写入口仍分别受 P1-a/P1-b feature flag 控制。

第十轮新增验收重点如下，完整 24 条 GWT 见产品研究稿：

1. 规则超过新鲜度阈值时，报名或任务激活必须重新核对来源；未核对只能保存计划。
2. 报名拒绝后重试产生新的 attempt，保留旧结果；相同幂等键不得生成第二次事实。
3. 同一原始消费不得复制金额到多个任务；未实现 `SpendFact` 关联前，第二次录入必须被阻止。
4. 活动取消、部分退款和跨周期冲正保留原事实，停止未来提醒并将受影响任务/奖励置为待核对。
5. 权益预约、改期、候补、拒绝和争议不扣次数；首次核销和重复请求分别可审计且幂等。
6. 过期积分快照、未知批次、负余额和兑换关键项未知时，不生成实时余额、到期、FIFO、可兑换或退分结论。
7. 兑换分项部分履约与积分扣分分轴显示；失败/取消只有在官方退分证据到达后才追加 reversal。
8. 所有未知状态缺少原因、证据时间或下一步时，拒绝最终达标/可用/到账/到期结论，并返回可修复提示。

### 19.4 发布边界

第十轮不改变现有 Gate 顺序：Gate 0 冻结新鲜度、报名 attempt、消费关联模型、投影水位和精度/区间；Gate 1/P0 先交付活动与单卡任务；Gate 2/P1-a 再交付权益；Gate 3/P1-b 最后交付积分与兑换。当前代码没有新领域 schema、migration、API、worker 或业务 E2E，故当前可部署范围仍只有年费 MVP。

## 20. 产品策略增量（2026-09-09）

### 20.1 产品方向

Cardfolio 的长期定位是“个人卡片资产工作台”，以卡片档案为入口，聚合年费周期、活动任务、卡权益、积分账户、兑换记录和价值回顾。首页应围绕用户决策组织信息：近期需要处理什么、哪张卡即将产生费用、任务还差多少、哪些权益或积分正在临期。

### 20.2 信息架构

工作台采用“卡片 → 周期 → 任务 → 记录”的主线。卡片是归属和权限边界；周期承载年费或活动有效期；任务承载可执行目标；记录承载用户输入、外部证据和审计历史。活动、权益、积分和兑换作为卡片下的独立事实链，不把它们压缩为卡片状态或单一余额。

### 20.3 体验要求

- 首页优先呈现行动队列，再呈现统计摘要；所有摘要可下钻到原对象。
- “待核对”必须包含原因、证据时间和下一步动作；未知值不能被默认值伪装成确定事实。
- 价值回顾区分已确认、用户估算和待核对金额，不输出保留、销卡或刷卡建议。
- 没有真实数据时不展示空壳扩展模块；P1/P2 功能只在对应发布门通过后开放入口。

### 20.4 交付策略

当前版本继续稳定年费 MVP，优先完成生产监控、备份恢复和数据导出验证。下一条纵切是“官方来源预检 → 活动参与 → 单卡刷卡任务 → 预计/确定进度 → 奖励核对 → 提醒”，通过 Gate 1 后再开放活动与任务。权益和积分兑换分别通过 Gate 2/P1-a、Gate 3/P1-b 后上线，避免一次性引入未经验证的复杂账本。

### 20.5 产品边界

Neiliro 等通用家庭工作台可作为交互和通用能力参考，但 Cardfolio 不迁移其 SQLite 家庭账本模型，也不把通用任务或账务模型当作信用卡事实模型。外部代码引入前必须完成许可证、数据迁移、所有权和恢复评审。
