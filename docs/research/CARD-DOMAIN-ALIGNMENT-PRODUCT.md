# Cardfolio 卡领域产品对齐决策稿

| 项目 | 内容 |
| --- | --- |
| 文档版本 | v0.1 |
| 文档状态 | 供 PRD、架构、DBA、QA 合并的产品决策稿 |
| 调研截止 | 2026-08-14 |
| 负责角色 | 产品经理（Cardfolio） |
| 允许修改范围 | 仅本文件；不替代正式 PRD、架构、数据库和代码契约 |

## 1. 目的与结论

本稿把现有 `PRD-WORKBENCH.md`、产品研究稿和架构复核稿收敛为一套实现可以直接采用的产品口径。卡活动、卡权益、刷卡方式/任务、积分和兑换都属于“用户主动记录、来源可追溯、未知可见”的个人工作台，不是银行同步或自动交易产品。

最终决策如下：

1. **P0 是单卡原子参与、多卡活动规则。** 一条活动规则可以关联多张卡，但每张卡必须生成独立的 `ActivityParticipation(user, activity, card)`；资格、报名、名额、刷卡任务和奖励均按卡独立计算。P0 不支持把多张卡的消费合并为同一个任务，也不支持家庭/附属卡跨持有人合并。
2. **活动采用五轴模型。** 资格、报名、名额、任务进度、奖励是五条独立事实链。UI 可以汇总成“待核对/达标待奖励核对”等派生文案，但不得持久化一个会覆盖五轴的 `completed` 或 `qualified` 状态。
3. **奖励是独立事实。** `ActivityReward`（或等价的奖励事件/事实表）按参与实例记录待发、到账、撤回、争议和来源；不能把 `reward_received` 塞进活动结果枚举，也不能因任务达标自动写积分流水或权益下发。
4. **P0/P1/P2 是发布门，不是模块标签。** 首个 P0 只承诺活动+单卡刷卡任务的手工闭环；P1-a 是权益；P1-b 是积分账户、批次和手工兑换；P2 才考虑导入、自动批次建议、系统内积分预占和第三方连接器。
5. **所有外部动作由用户完成。** Cardfolio 只保存规则版本、用户从官方渠道核对的结果、手工快照/流水、提醒和审计历史；不代报名、预约、消费、兑换、扣分或联系银行。

## 2. 对现有文档的统一口径

### 2.1 规范状态

下表是本稿推荐的 canonical 状态。正式 PRD、架构和 DB 只能保留这一组名称；旧文档中的同义词应标记为 deprecated 并提供迁移映射。

| 事实轴 | canonical 状态 | 说明 |
| --- | --- | --- |
| 资格 `eligibility_status` | `unknown`、`potentially_eligible`、`user_confirmed_eligible`、`user_confirmed_ineligible`、`needs_review` | `potentially_eligible` 只是规则文本推测；只有用户在官方渠道核对后才能进入 `user_confirmed_*`。 |
| 报名 `enrollment_status` | `not_required`、`not_started`、`submitted`、`confirmed`、`rejected`、`expired`、`unknown`、`needs_review` | `submitted` 只表示用户已提交/记录提交，不表示银行受理成功。 |
| 名额 `quota_status` | `not_applicable`、`unknown`、`available`、`full`、`waitlisted`、`allocated`、`not_allocated`、`needs_review` | `available` 不代表这个用户已分配；`full/not_allocated/unknown` 阻止最终达标。 |
| 任务进度 `progress_status` | `not_started`、`in_progress`、`provisionally_qualified`、`target_reached`、`shortfall`、`failed`、`expired`、`disputed`、`needs_review` | `target_reached` 是按冻结规则和用户事实计算的本地结果，不是银行确认。 |
| 用户资格确认 `qualification_status` | `unconfirmed`、`user_confirmed`、`rejected`、`needs_review` | 仅当用户明确从官方渠道核对后才可 `user_confirmed`；不使用 `bank_confirmed` 代替证据。 |
| 奖励 `reward_status` | `not_expected`、`expected_pending`、`received`、`delayed`、`reversed`、`disputed`、`unknown`、`needs_review` | `expected_pending` 只有在规则给出发放期限时才允许计算预期日。 |
| 权益下发 `entitlement_status` | `pending_delivery`、`available`、`suspended`、`expired`、`revoked`、`disputed`、`unknown` | `available` 至少要有凭证/下发记录或用户官方核对。 |
| 权益预约 | `not_required`、`not_booked`、`requested`、`confirmed`、`rejected`、`cancelled`、`unknown` | 预约轴与使用轴分开。 |
| 权益核销 `redemption_status` | `not_presented`、`presented`、`redeemed`、`rejected`、`disputed`、`unknown` | 只有 `redeemed` 产生消费事实并减少额度/次数。 |
| 订单履约 | `planned`、`submitted`、`processing`、`success`、`failed`、`cancelled`、`refund_pending`、`refunded`、`disputed`、`unknown` | `success` 只说明外部订单结果；不代表积分已扣。 |
| 积分扣减 `points_debit_status` | `not_debited`、`pending`、`posted`、`needs_review`、`pending_refund`、`refunded` | 只有官方账户已扣/已退的用户证据才能写入 ledger 事实。 |

旧名称映射：`unchecked -> unknown`，`eligible -> user_confirmed_eligible`（仅在有用户证据时），`uncertain -> unknown/needs_review`，`qualified -> target_reached`（本地计算）或 `user_confirmed`（用户确认，不能混用），`fulfilled -> success`，`redeem -> redeem_debit`。映射必须在迁移脚本和 API 兼容层中明确，不能靠前端猜测。

### 2.2 五轴的完成门槛

每张卡的参与实例只有在以下条件同时满足时，才可在 UI 显示“达标待奖励核对”：

```text
eligibility = user_confirmed_eligible
AND enrollment = not_required OR confirmed
AND quota = not_applicable OR allocated
AND progress = target_reached
AND qualification_status = user_confirmed（如果用户选择核对最终结果）
```

该文案仍不等于奖励到账。若任一轴是 `unknown`、`needs_review`、`full`、`not_allocated`、`rejected` 或 `expired`，UI 必须显示阻断原因；不得把多张卡中一张卡的状态复制给其他卡。

## 3. 范围与发布门

| 发布门 | 交付范围 | 明确不做 | 必须达到的产品结果 |
| --- | --- | --- | --- |
| Foundation（实现前置） | 用户/卡片所有权、来源与规则版本、时区、幂等、审计、提醒去重、事件 outbox/inbox 约定 | 不新增用户可见领域功能 | 规则不可静默覆盖；跨用户引用拒绝；同 key 同 payload 可重放原响应。 |
| P0 | 多卡活动规则 + 每卡独立参与；资格/报名/名额；单卡 `SpendTask`；snapshot 或手工流水；occurred/posted/settled；退款/冲正；奖励待核对/到账/撤回/争议；站内提醒 | 不代报名，不连接银行，不自动判定 MCC，不建权益/积分账本，不跨卡合并任务 | 用户可以从“建卡->来源->活动->每卡参与->任务->进度->奖励结果”走通并重放。 |
| P1-a | 权益下发、凭证、预约、出示、核销/拒绝/争议、额度流水 | 不代预约，不把预约成功当核销，不保存未评审的敏感凭证 | `redeemed` 才扣次数/额度，使用/恢复事实可重算。 |
| P1-b | 积分账户、官方余额观察、批次/到期、append-only 流水、外部手工兑换双状态 | 不自动兑换、不自动扣分、不使用积分预占、不推测退款 | 余额、流水、批次和差额可重算；订单履约与扣减分开。 |
| P2 | CSV/账单导入预览、规则模板、批次扣减建议执行、系统内 hold、外部目录/连接器、推送/附件增强 | 未经授权的银行登录、自动抢名额、自动交易 | 每一项有独立授权、撤销、审计、限流、安全和恢复评审。 |

产品文档中的“后续 P0 纵切”统一改为上述 `P1-a` 或 `P1-b`；“Phase 1”若指首个可部署版本，只能包含 P0，避免权益/积分被误认为首版承诺。

## 4. 产品实体与字段建议

### 4.1 Activity 与 Participation（P0）

`CardActivity` 保存规则层事实：`title`、`issuer_name`、`activity_type`、`applicable_card_ids`、`start_at`、`end_at`、`enrollment_required`、`enrollment_deadline`、`quota_allocation`、`qualification_basis`、`reward_type`、`reward_due_rule_text`、`region`、`channel`、`rule_version_id`、`source_id`、`status`。

`ActivityParticipation` 保存用户/卡视角事实，唯一键为 `(owner_user_id, activity_id, card_id)`，字段至少包括：`eligibility_status`、`eligibility_verified_at`、`enrollment_status`、`enrollment_verified_at`、`quota_status`、`quota_verified_at`、`spend_task_id`、`qualification_status`、`last_confirmed_at`、`evidence_note`、`needs_review_reason`。

`ActivityReward` 必须独立于参与实例的结果状态，唯一关联一个 participation，可记录 `reward_type`、`expected_on`、`status`、`received_on`、`reversed_on`、`source_id`、`evidence_note`。一个参与实例如存在分期发放或多种奖励，可有多条奖励事实，但每条奖励必须有独立业务键。

多卡规则的允许范围：

- 同一活动关联多张用户自己的卡时，为每张卡建立独立 participation 和独立 SpendTask。
- 不允许把卡 A 的资格、名额或奖励推断到卡 B；不允许跨卡累计金额/笔数。
- 附属卡是否计入由活动规则显式记录 `include_supplementary_card=yes/no/unknown`；未知时只能进入 `pending/needs_review`。
- “同一活动只能报一次”的银行规则应由用户在 participation 上记录限制；系统不自动阻止第二张卡，除非来源明确且用户确认该限制。

### 4.2 SpendMethod 与 SpendTask（P0）

`SpendMethod` 是刷卡方式/口径，不是交易流水。建议字段：`channel_type`、`merchant_scope`、`region_scope`、`currency_scope`、`mcc_or_exclusion_text`、`source_id`、`status`。

`SpendTask` 必须冻结：`card_id`、`activity_id`、`period_start/end`、`cutoff_basis`、`input_mode`、`metric_type`、`condition_relation`、目标值、币种、`qualified_spend_method_ids`、排除项和规则版本。`snapshot` 与 `entries` 二选一，不能相加。`confirmed_*` 与 `pending_*` 并列显示；`occurred_only` 只能进入预计进度，达到 `posted/settled` 口径后才进入确定进度。

`SpendEntry` 追加发生/入账/清算里程碑；退款和冲正通过 `reversal_of_entry_id` 新增负向事实，不覆盖原记录。累计反向金额不得超过原记录；已确认任务受跨周期退款影响时，当前状态转 `needs_review`，历史快照保留。

### 4.3 Benefit（P1-a）

权益定义、下发实例和使用记录分开。至少保存周期、次数/额度及单位、凭证类型与掩码、服务商、地区/渠道、主附卡和携伴范围、预约渠道及来源。

使用流程固定为：`available -> reservation confirmed -> presented -> redeemed`。`requested`、`confirmed`、`cancelled`、`rejected`、`disputed` 均不扣额度；只有 `redeemed` 写一次 `consume`，撤销写关联 `restore`。并发使用必须按权益实例加锁，不能把剩余值截断为零掩盖超额。

### 4.4 Points 与 Redemption（P1-b）

积分账户同时展示：用户确认余额 `confirmed_balance`、流水余额 `ledger_balance`、批次余额 `lots_remaining_total`、有符号 `unallocated_difference` 和 `as_of`。未知到期日不得触发提醒；历史只有总余额时只能建 observation，不得伪造 earn lot。

兑换使用两条轴：外部订单履约和本地积分扣减。`success + pending` 在 UI 中显示“订单成功，积分扣减处理中”；`failed/cancelled` 不自动写退分；仅当用户确认官方积分已退且存在原 `posted` debit 时，才写一条关联 reversal。P1 不使用 `points_held`；预占属于 P2 新模型，不能把 `pending` 当预占。

## 5. 用户流程与未知状态

### 5.1 P0 活动流程

```text
新增卡片
  -> 保存活动官方来源/规则版本
  -> 选择适用卡（可多张）
  -> 为每张卡生成 participation
  -> 用户在官方渠道核对资格、报名和名额
  -> 为单卡建立 SpendTask，选择刷卡方式与截止口径
  -> 录入快照或流水，分别显示预计/确定进度
  -> 用户确认最终结果
  -> 独立记录奖励待发、到账、撤回或争议
```

活动详情必须显示每张卡的五轴状态、最后核对时间、来源和阻断原因。活动级列表只能展示聚合计数，例如“3 张卡：1 张达标待奖励、1 张报名未知、1 张未达标”，不能展示一个笼统的活动完成状态。

### 5.2 P1 权益与积分流程

- 权益：卡片 -> 录入权益规则/周期 -> 记录凭证下发 -> 外部预约 -> 出示 -> 核销/拒绝/争议 -> 重算剩余额度。
- 积分：录入官方余额观察 -> 维护有证据的 lot -> 展示差额和到期提醒 -> 用户在官方渠道兑换 -> 记录订单履约 -> 用户核对扣分 -> 逐批确认并写 ledger -> 用户核对退分后 reversal。

### 5.3 必须显示“未知/待核对”的场景

| 场景 | 禁止的推断 | UI 处理 |
| --- | --- | --- |
| 资格、报名或名额无官方确认 | 不显示可参加/已报名/已分配 | 显示“待核对”，允许保存原文和提醒。 |
| 发生/入账/清算口径不明 | 不将发生日当作已入账 | 进入 `pending/unknown`，要求用户选择规则口径。 |
| 规则没有发奖期限 | 不计算预期到账日 | 奖励为 `unknown/expected_pending`，不自动产生逾期争议。 |
| 权益凭证未下发 | 不显示可用、不扣次数 | `pending_delivery`，可提醒用户核对。 |
| 积分无批次或到期证据 | 不造 lot、不造到期提醒 | 显示 `unallocated_difference` 和“到期未知”。 |
| 兑换订单成功但扣分未知 | 不把订单成功当扣分成功 | 两轴并列，积分状态为 `pending/needs_review`。 |
| 失败或取消但退分未知 | 不自动写 reversal | `refund_pending/unknown`，等待官方账户证据。 |

## 6. 产品验收标准

以下验收用于产品、QA 和后续自动化测试，P0/P1 标注表示最晚交付门。

1. **P0 多卡隔离**：同一活动关联两张卡时生成两个唯一 participation；修改卡 A 的资格、报名、名额、任务或奖励不改变卡 B 的任何状态。
2. **P0 禁止跨卡合并**：卡 A 与卡 B 各录入 50 元时，单卡目标 100 元不得显示已达标；系统没有跨卡聚合入口或隐式合并。
3. **P0 五轴独立**：资格、报名、名额、任务进度和奖励在详情与审计时间线中分别展示；改变任一轴不会静默改写另外四轴。
4. **P0 报名门槛**：`enrollment_required=yes` 且报名为 `not_started/submitted/rejected/expired/unknown` 时，即使消费达到目标，也不能显示“达标待奖励核对”。
5. **P0 名额门槛**：名额为 `full/not_allocated/unknown` 时不能进入最终达标；`available` 也不能自动改成 `allocated`。
6. **P0 资格门槛**：`potentially_eligible` 不能作为用户已确认资格；只有 `user_confirmed_eligible` 才能通过最终资格门槛。
7. **P0 预计/确定分离**：截止口径为 `posted` 时，只有具有窗口内 posted milestone 且 `qualification_status=included` 的流水进入确定金额；occurred-only 仅进入预计金额。
8. **P0 输入互斥**：任务选择 `snapshot` 后录入流水返回业务错误并不改变累计值；选择 `entries` 时重复同一幂等键只保留一笔事实。
9. **P0 退款可重放**：部分退款追加关联负向流水，反向累计不超过原记录；跨周期退款使当前确认变为 `needs_review`，原流水和历史确认仍可查看。
10. **P0 奖励独立**：任务 `target_reached` 不自动创建积分/权益事实；奖励无发放期限时不能生成预计日期，超过已确认期限才可转 `delayed`。
11. **P0 提醒去重**：同一对象、节点和用户时区生成稳定 dedupe key；重复事件不会生成重复提醒，归档卡不再产生新提醒。
12. **P0 来源版本**：规则来源缺 URL、访问日、适用期或关键口径时标记 `needs_review`；新版本不覆盖历史任务的 rule version。
13. **P1 权益不提前扣减**：预约成功、取消、现场拒绝和争议均不减少额度；两次并发 `redeemed` 最多产生一次 consume，撤销只能追加一次 restore。
14. **P1 权益凭证门槛**：没有凭证下发或用户官方核对时，权益保持 `pending_delivery/unknown`，不能显示 `available`。
15. **P1 积分恒等式**：`ledger_balance = sum(entries)` 且 `unallocated_difference = confirmed_balance - lots_remaining_total` 可从零重放；负差额进入 `mismatch`，不自动调账。
16. **P1 未知批次**：只有用户有官方证据的 `expires_on` 才能生成到期提醒；总余额没有 lot 证据时不分配到任何到期批次。
17. **P1 兑换双轴**：订单 `success` 与积分 `pending` 并存时显示处理中；订单失败或取消不自动产生退分；没有原 debit link 时拒绝写 refund reversal。
18. **P1 批次建议不越权**：最早到期建议遇到用途限制立即停止并要求用户确认，不跳过受限 lot、不执行自动扣分。
19. **P0/P1 幂等与所有权**：同 key 同 payload 重放原响应，同 key 不同 payload 返回 `409`；跨用户、跨卡引用在 API、复合约束和授权层均拒绝。
20. **P0/P1 时间边界**：固定用户 IANA 时区测试 UTC 跨日、DST、闰日和 inclusive 截止日；同一事实在重放后仍归属于同一任务窗口。

## 7. 公开来源与局限

本次调研沿用产品研究稿已读取的银行官方公开页面；访问日期均为 2026-08-14。来源只用于确定字段维度和边界，不用于预填某个用户的资格或实时数据。

| 来源 | 对产品设计的直接启发 | 局限与使用边界 |
| --- | --- | --- |
| [中国银行：2026 年信用卡年费减免政策](https://www.boc.cn/bcservice/bi2/202511/t20251114_25568422.html) | 年费按产品区分；消费排除项和退货扣减说明为什么任务需要渠道/排除项、负向流水和规则版本。 | 只适用页面列出的中行产品与 2026 周期，不能泛化到其他银行/年份或个人资格。 |
| [招商银行：信用卡积分介绍](https://cc.cmbchina.com/content/cusservice/8.htm) | 入账后积分生效、退款扣回、交易积分与活动积分分离，支持“posted 后计入”和奖励独立事实。 | 概览不覆盖特殊卡、联名卡、活动例外，也不证明个人实时余额。 |
| [招商银行：个人用户积分奖励计划](https://market.cmbchina.com/MPage/online/240131174121650/JLJH2024JF/index.html) | 计划区分交易/活动奖励、有效期和异常扣回；到期提醒及合作方履约说明积分与兑换需要批次和履约双轴。 | 取整、排除、期限和扣回触发条件仅适用于该计划及卡种。 |
| [招商银行：移动支付积分活动规则](https://market.cmbchina.com/personal/zfjf/index.html) | 指定支付方式/商户、入账延迟、退款扣回验证 `SpendMethod`、`cutoff_basis` 和 reversal 的必要性。 | 页面为历史活动（2018--2019），只能证明维度，不是当前活动。 |
| [招商银行：积分兑换航空里程及酒店集团积分](https://market.cmbchina.com/MPage/online/220607120009184/vippc/vipjh/jflc.html) | 指定高端卡、限量/个人上限、合作方到账延迟和不可取消，验证订单履约与积分扣减必须分离。 | 不证明当前库存、用户资格、比例或实际到账时长。 |
| [中国银行：高端信用卡贵宾厅服务规则](https://www.bankofchina.com/bcservice/bc5/bc58/202010/t20201015_18542423.html) | 凭证下发、现场核验、容量和服务商争议解释权益必须有下发/预约/核销/争议轴。 | 规则为 2020--2021 历史活动，不代表当前权益次数、网络或资格。 |
| [建设银行：信用卡积分兑换入口](https://creditcard.ccb.com/cn/creditcard/jfdh.html) | 积分抵扣、换礼、账户/商城是不同入口，支持将兑换类型与渠道分开。 | 导航页不证明余额、库存、比例或未登录用户资格。 |
| [建设银行积分商城帮助中心](https://jf.ccb.com/exchangecenter/help/index.jhtml) | 订单、支付、积分规则、配送和售后是不同履约维度，需保存订单状态、履约期限和参考号掩码。 | 帮助目录不是具体商品条款；库存、配送与售后需按订单原文核对。 |
| [建设银行龙卡信用卡优惠/云闪付专题](https://www.ccb.com/cn/html1/office/xyk/subject/25/04/0416dsn/index.html) | 特定支付渠道是活动规则的一部分，不能只保存“刷卡金额”。 | 动态正文不完整时仅可标记官方页面信息不完整，不能从标题或摘要推断资格。 |

行业产品线索如 CardPointers、AwardWallet 仅用于启发“按卡聚合、奖励/积分到期提醒、兑换记录”的信息架构；其自动连接能力、规则库和数据准确性不构成本项目承诺。银行动态页面、登录后页面、搜索摘要和历史规则均不能证明用户当前资格、库存、余额、入账或退分结果。

## 8. 未决问题与责任边界

以下问题在产品层不能自行拍板，必须在架构/DBA/安全或具体银行规则核对后关闭：

1. `ActivityReward` 采用独立表还是事件事实投影；DBA 需保证奖励幂等键、状态历史和重放方式，不得退回单一 `outcome_status`。
2. 同一银行规定“同一客户只能参加一次”的活动，是否需要应用层跨卡提示或完全由用户记录；在没有可验证的统一规则前，产品只提示并保留原文。
3. 附属卡、联名卡和多币种消费是否计入任务，必须按活动规则逐条确认；未知不能按主卡模板补全。
4. 退款跨周期是否导致银行重开资格、扣回奖励或仅扣金额，产品只能记录用户结果，不能自动替银行判定。
5. 权益凭证/订单附件的加密、保留、导出和删除周期属于安全评审；P1 默认使用备注和掩码引用，不保存完整凭证。
6. 积分批次只有总额无明细时，历史迁移只能建余额观察和未分配差额；是否允许用户批量补录 lot 由 DBA/UX 决定。
7. P2 预占、连接器、自动导入需要独立授权、撤销、限流、恢复和合规评审，不得因 P1 账本已存在而直接扩展。
8. 任何“积分价值”“年费是否值得”“应该办哪张卡”的排序或建议不属于本稿；只能展示用户确认金额的算术回顾。

## 9. 交接给其他角色

### 给架构师

以本稿 canonical 状态、每卡 participation、五轴和独立 reward 为唯一领域契约；将旧简化状态/API/事件标记 deprecated。P0 单卡任务不跨卡聚合，P1 权益和积分分别开 feature flag。

### 给 DBA

为 `(user, activity, card)` 建复合唯一约束；补名额和奖励事实/历史；权益使用采用 consume/restore 账本；积分采用 append-only ledger、lot allocation 和差额恒等式。所有写入需业务幂等键、审计和 outbox/inbox 去重。

### 给 QA

优先实现第 6 节 20 条验收，特别是多卡隔离、五轴未知状态、发生/入账/清算、退款重放、权益预约不扣减、兑换 success 与 debit pending、跨用户拒绝和时间边界。

### 给 UX/设计

活动列表使用“按卡分组”的状态摘要；不要提供一个会掩盖五轴的绿色完成标签。详情页固定顺序为：规则摘要 -> 适用卡/资格 -> 报名/名额 -> 刷卡任务 -> 奖励 -> 来源与核对 -> 历史。

## 10. 验证记录

本稿只新增 `docs/research/CARD-DOMAIN-ALIGNMENT-PRODUCT.md`，未修改正式 PRD、架构、数据库、协调 ledger、代码或 package，未提交、未推送。完成编辑后应运行：

```bash
git diff --check -- docs/research/CARD-DOMAIN-ALIGNMENT-PRODUCT.md
```

与正式文档合并前，主会话还应验证 `npm run typecheck`、`npm test`、数据库影子迁移/重放和端到端状态测试；本稿本身不声称这些实现已经存在。

## 11. 第四轮产品复核：遗漏、优先级与验收补充

本轮只读复核了 `docs/PRD-WORKBENCH.md` 与 `docs/research/*`。前几轮已解决活动五轴、每卡 participation、奖励独立事实和 P0/P1/P2 大分期，但仍存在以下产品层的遗漏或优先级漂移。

### 11.1 必须补进 PRD 的需求

1. **积分差额必须拆成两个可解释的差额。** 当前不同研究稿分别把 `unallocated_difference` 写成 `confirmed_balance - lots_remaining_total` 或 `ledger_balance - lots_remaining_total`，实现会出现同一账户显示两个不同“未分配”数。canonical 产品口径应为：
   - `confirmed_balance`：用户从官方渠道观察到的快照，不是本地事实源；
   - `ledger_balance`：本地 append-only PointsEntry 合计；
   - `lots_remaining_total`：已确认批次剩余合计；
   - `reconciliation_difference = confirmed_balance - ledger_balance`；
   - `unallocated_difference = ledger_balance - lots_remaining_total`。
   UI 必须同时显示两者及 `as_of`，不能把观察差额和批次差额相加后称为“可用余额”。
2. **权益要按使用模型分型。** `insurance`、`fee_waiver`、机场次数和服务预约不能共用一个“剩余次数”模型。PRD 增加 `benefit_usage_model`：`consumable_quota`、`service_eligibility`、`coverage_claim`、`fee_credit`、`informational`。P1-a 只承诺 `consumable_quota/service_eligibility` 的下发、预约、核销；保险理赔、年费减免/返还和争议索赔必须单独记录证据与结果，暂放 P2 或独立 feature flag。
3. **奖励必须支持多奖励组件。** 一次活动可能同时返积分、返现和礼品，不能只有活动级一条 `reward_type/reward_amount_text`。`ActivityReward` 增加 `reward_component_key`、`reward_kind`（points/cashback/fee_credit/gift/other）、金额/单位原文、币种（如适用）、履约方式和独立状态/来源；一个组件到账或撤回不得改写同一 participation 的其他组件。
4. **刷卡方式需要冻结支付路由与活动实例。** `SpendMethod` 不能把“线上、钱包、商户、MCC、境外”塞成一段自由文本。P0 至少区分 `payment_route`、`merchant_scope`、`region/currency`、`exclusions` 和证据；同一商户通过实体卡、Apple Pay/云闪付或银行 App 是否相同，未知时必须进入 `pending/needs_review`。重复或每月周期活动需要 `activity_instance_key`/周期键，避免同一规则被重复创建或把两期消费相加。
5. **P0 提醒类型要有奖励核对专名。** PRD 当前以 `verification_due` 覆盖多类核对，研究稿又使用 `reward_verification`。统一新增 canonical `reward_verification`（P0），只由 `ActivityReward.expected_pending` 或用户设置的奖励核对节点触发；规则没有发放期限时不得自动生成“逾期奖励”提醒。
6. **导入与模板优先级要写死。** PRD 将 CSV/JSON、PDF/短信解析、模板和批量编辑放在 P1，而数据/架构稿将其视为 P2。发布口径统一为：P1 只允许用户手工录入和可逆导出；导入必须先做只读预览、逐行确认、来源绑定和失败全回滚，完整 OCR/PDF、批量写入、模板自动填数和规则重复检测全部 P2。
7. **积分转移从 P1 流水类型移除。** `PointsEntry.entry_type` 在 P1 不得出现可执行的 `transfer`；跨账户/跨计划转移需要源账户出账、目标账户入账、同一凭证和双边守恒，列为 P2。P1 只能记录用户观察到的外部转移备注，不改变本地余额或 lot。
8. **工作台扩展需要统一最小契约。** 未来的保险、权益索赔、返现、年费抵扣或合作方活动都必须声明 owner、来源/规则版本、有效期、状态轴、金额/单位、证据、提醒和审计历史；未满足这组字段时只能作为备注或线索，不能直接增加一级菜单或计算收益。

### 11.2 可延后的需求

- 周期活动自动生成实例、重复活动检测、规则模板库和版本差异摘要；P0 由用户手工填写 `activity_instance_key`，P2 再自动化。
- PDF/短信/OCR/账单/CSV 解析、批量编辑和导入向导；在有预览、逐行确认、错误下载、幂等和全回滚之前不得写入事实。
- 跨账户积分转移、部分兑换退款、系统内积分 hold/release、自动 FIFO 或用途受限 lot 的自动分配；这些都需要双边或守恒模型。
- 保险理赔、年费减免/返还自动核算、服务商索赔和外部预约/兑换连接器；P1 仅保留规则和用户结果备注。
- 邮件/Push、多设备离线、凭证附件、家庭/附属卡协作和跨卡比较；先完成站内提醒、个人所有权和删除/导出策略。
- 兑换价值排序、保留/销卡比较和“最优刷卡方式”建议；只能在用户确认数据充分后作为非建议性的历史比较，并继续显示免责声明。

### 11.3 新增可验收标准

21. **积分双差额**：账户 `confirmed_balance=100`、`ledger_balance=90`、`lots_remaining_total=80` 时，页面分别显示 `reconciliation_difference=+10` 与 `unallocated_difference=+10`，不显示一个合并的“可用 20”；任一差额未知或不一致时账户为 `mismatch/needs_review`。
22. **权益分型**：`benefit_usage_model=coverage_claim` 或 `fee_credit` 的权益不能进入次数 `consume` 流程；保险理赔或年费抵扣只能追加独立结果/金额事实，不得减少 `remaining_value`。`consumable_quota` 才允许 `redeemed` 扣减。
23. **多奖励组件**：同一 participation 同时存在积分和返现两个 `ActivityReward` 组件时，积分到账、返现延迟、礼品未知可以并存；确认其中一项不得把其他组件改为 `received`，每项都有独立来源和幂等键。
24. **刷卡路由与周期实例**：同一商户的一笔实体卡消费和一笔移动钱包消费，在规则只允许实体卡时，钱包流水不得进入确定进度；同一活动的两个周期使用不同 `activity_instance_key` 时，进度和提醒不得互相累计或去重。
25. **导入与转移边界**：P1 发送 CSV/PDF 导入请求只能生成只读预览，不写入 SpendEntry/PointsEntry；P1 记录跨账户积分转移只能保存备注，不能产生 ledger debit/credit。任何写入必须在 P2 feature flag、逐行确认和双边守恒测试通过后才启用。

### 11.4 来源复核与局限

| 来源/类别 | 本轮可确认的产品维度 | 局限 |
| --- | --- | --- |
| [招商银行：个人用户积分奖励计划](https://market.cmbchina.com/MPage/online/240131174121650/JLJH2024JF/index.html) | 交易积分与活动奖励、不同有效期、退款扣回、合作方履约和到期提醒可能同时存在，支持积分账户/批次/订单双轴。 | 仅适用该计划与对应卡种；不能推出其他银行统一的批次、扣回或兑换规则，也不证明用户实时余额。 |
| [招商银行：积分兑换航空里程及酒店集团积分](https://market.cmbchina.com/MPage/online/220607120009184/vippc/vipjh/jflc.html) | 兑换可能有指定卡资格、库存/个人上限、合作方异步到账和不可取消，支持把履约组件与积分扣减分开。 | 页面不证明当前库存、个人资格、比例、退分或实际到账时间；动态内容需用户登录官方渠道核对。 |
| [建设银行积分商城帮助中心](https://jf.ccb.com/exchangecenter/help/index.jhtml) | 商品、活动、支付、积分规则、配送和售后是不同履约维度，支持 `fulfillment_type` 和订单后续状态。 | 帮助目录不是当前商品条款；不提供未登录用户的余额、库存、卡种资格或退货结果。 |
| [中国银行：高端信用卡贵宾厅服务规则](https://www.bankofchina.com/bcservice/bc5/bc58/202010/t20201015_18542423.html) | 权益可能包含凭证下发、服务资格、现场核验、容量和投诉/争议，不应强行建模为次数余额。 | 页面为历史规则（2020--2021），只能证明权益分型的必要性，不代表当前保险、年费减免或机场服务规则。 |
| 中国人民银行/政府关于信用卡业务规范与消费者保护的公开通知 | 可作为“规则应以发卡行最新条款、资格和费用披露为准”、不代用户操作和不保存敏感凭据的合规边界参考。 | 监管/政策文件不提供具体银行活动、积分比例、MCC、名额或个人资格；不能替代活动原文。动态、需登录、历史或搜索摘要页面均只允许 `official_page_incomplete`/`lead_pending_verification`。 |

本轮来源仍不能确认统一的“清算完成”“名额分配”“保险理赔成立”“年费减免到账”定义；这些字段必须保留 `unknown/needs_review`，并以具体卡种、活动版本和用户官方证据为准。

### 11.5 本轮交接

- **Changed files**：仅追加本文件 `docs/research/CARD-DOMAIN-ALIGNMENT-PRODUCT.md`。
- **Decisions**：统一积分双差额公式；权益按使用模型分型；奖励支持多组件；刷卡方式冻结支付路由与活动实例；P0 增加 `reward_verification` 提醒；P1 导入与积分转移不写事实，导入/OCR/跨账户转移延后 P2。
- **Validation**：追加后运行 `git diff --check -- docs/research/CARD-DOMAIN-ALIGNMENT-PRODUCT.md`；本轮仍不运行应用、数据库或 E2E 测试。
- **Risks**：正式 PRD/架构/DBA 仍需清理两种积分差额公式、P1/P2 导入漂移、`transfer` 枚举、权益保险/年费减免的错误 quota 模型；若不合并，积分读模型和权益 UI 会产生误导性“可用/剩余”。
- **Ready for integration**：可交由主会话整合；不得在正式契约合并前实现积分转移、保险理赔账本或自动导入。
