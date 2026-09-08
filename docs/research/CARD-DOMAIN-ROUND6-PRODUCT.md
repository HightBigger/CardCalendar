# Cardfolio 卡领域第六轮产品复核

| 项目 | 内容 |
| --- | --- |
| 文档版本 | v0.1 |
| 复核日期 | 2026-08-14 |
| 角色 | 产品经理 |
| 复核范围 | 卡活动、卡权益、刷卡方式/任务、积分账户/批次、积分兑换，以及 P0/P1/P2 首纵切 |
| 输入 | `docs/PRD-WORKBENCH.md` v0.7、`docs/research/CARD-DOMAIN-PRODUCT-RESEARCH.md`、`CARD-DOMAIN-ALIGNMENT-*`、`CARD-DOMAIN-FOLLOWUP-*`、架构/DBA/QA/UX/安全稿 |
| 产品现状 | 当前代码仍是年费 MVP；本文所有新能力均为规划和发布门，不代表已经实现 |
| 允许修改范围 | 仅本文件；不修改正式 PRD、架构、DBA、QA、UX、安全文档、代码、迁移、锁文件或 ledger |

## 1. 输入与复核方法

本轮先对正式 PRD 与前五轮角色稿做交叉复核，再复查公开银行页面的产品维度。重点不是再增加字段数量，而是检查下列事实能否被用户分开记录、解释和行动：

1. 活动发现、资格、报名、名额、任务达标和多奖励组件。
2. 权益下发、预约、出示、核销，以及次数型和非次数型使用模型。
3. 支付路由、刷卡方式、发生/入账/清算口径和重复周期实例。
4. 官方积分观察值、本地流水值、批次值的两个差额。
5. 兑换履约和积分扣分/退分的独立状态轴。
6. P0/P1/P2 的首条可交付纵切，以及未知状态的下一步动作。

当前发现：领域方向已经基本正确，主要缺口是“线索是否已成为事实”的边界、资格适用范围的表达、支付路由快照、周期实例唯一身份、双差额公式在旧稿中的漂移，以及验收没有逐条绑定用户行动和证据位置。

## 2. 公开资料复核

以下页面于 2026-08-14 通过公开 HTTP 页面复查，未保存账户、卡号或其他敏感信息。页面只用于证明产品维度存在，不用于推导 Cardfolio 用户资格、当前库存、实时余额或跨银行默认规则。

| 来源 | 访问日期 | 可用于产品建模的事实 | 适用范围与不能推出的事实 |
| --- | --- | --- | --- |
| [中国银行：2026 年信用卡年费减免政策](https://www.boc.cn/bcservice/bi2/202511/t20251114_25568422.html) | 2026-08-14 | 产品/周期和消费排除项可能不同；退货会影响累计值；用户可在官方渠道查询达标 | 仅适用于页面列出的中行产品和 2026 周期；不能推出其他银行的年费、MCC、入账或个人资格 |
| [招商银行：信用卡积分介绍](https://cc.cmbchina.com/content/cusservice/8.htm) | 2026-08-14 | 消费积分可能按入账金额计算，入账后生效，退款扣回；交易积分与活动积分可分开 | 概览不代表特殊卡、联名卡、活动排除项或用户实时余额 |
| [招商银行：个人用户积分奖励计划](https://market.cmbchina.com/MPage/online/240131174121650/JLJH2024JF/index.html) | 2026-08-14 | 交易奖励和活动奖励是不同来源；有效期、到期提醒、退款追回和合作方履约可同时存在 | 取整、排除费用、期限、扣回条件和合作方规则只适用于该计划及对应卡种 |
| [招商银行：积分兑换航空里程及酒店集团积分](https://market.cmbchina.com/MPage/online/220607120009184/vippc/vipjh/jflc.html) | 2026-08-14 | 兑换有指定卡资格、库存/个人上限、合作方异步到账和不可取消等维度 | 不证明当前库存、个人资格、比例、到账时间或退分结果 |
| [中国银行：高端信用卡贵宾厅服务活动规则](https://www.bankofchina.com/bcservice/bc5/bc58/202010/t20201015_18542423.html) | 2026-08-14 | 历史权益可包含凭证下发、现场核验、容量限制、服务商和争议渠道 | 规则适用期为 2020-11-01 至 2021-10-31，只能证明分型必要性，不能代表当前权益 |
| [建设银行：信用卡积分兑换入口](https://creditcard.ccb.com/cn/creditcard/jfdh.html) | 2026-08-14 | “积分当钱花”和“积分换礼”等兑换入口、账户和商城渠道分离 | 导航页不证明未登录用户资格、库存、余额或兑换比例 |
| [建设银行积分商城帮助中心](https://jf.ccb.com/exchangecenter/help/index.jhtml) | 2026-08-14 | 登录、积分查询、订单、支付、活动/积分规则、配送、售后是不同履约维度 | 帮助目录不是具体商品条款；不证明当前商品、配送、库存或退货结果 |
| [建设银行：龙卡信用卡优惠/云闪付专题](https://www.ccb.com/cn/html1/office/xyk/subject/25/04/0416dsn/index.html) | 2026-08-14 | 活动可能绑定特定支付渠道；正文动态或不完整时应保留待核对状态 | 页面标题或摘要不能推出活动时间、名额、MCC、奖励金额或个人资格 |

来源约束：原文标题、URL、访问日期、发布/适用期（如有）、适用卡/地区、摘录和来源等级随规则版本保存。历史或动态页面只能作为“结构证据”；搜索摘要、第三方攻略和成熟产品页面只能进入“线索，待官方核对”，不得直接创建可执行任务。

## 3. 结论与产品决策

### 3.1 线索和正式活动分开

活动发现是用户任务，但发现结果不是活动事实。P0 可以保存一条“活动线索”供用户补全，线索必须有 `source_level=lead_pending_verification` 或等价可信度、`next_action` 和来源 URL（若只有摘要则只保存候选 URL）。在来源、适用期和关键口径补齐前：

- 不能创建最终可执行的 SpendTask 或确定奖励金额。
- 不能把线索放入“可参加”列表或工作台确定收益。
- 可以提醒用户“补充官方规则”，但不能提醒用户继续刷卡。
- 用户补齐官方原文后，才创建/激活 Campaign、Participation、RuleVersion 和任务；历史线索仍保留。

P0 不要求单独的活动推荐或抓取服务。是否将线索单独建成 `DiscoveryLead` 表，交由架构/DBA 在 Gate 0 决定；产品语义必须先保持独立。

### 3.2 资格、报名、名额和奖励必须以参与实例为中心

同一活动可以适用多张卡，但每个 `(owner_user_id, campaign_id, card_id, activity_instance_key)` 都是独立参与实例。资格需要同时表达“适用谁/依据是什么”和“用户是否已在官方渠道核对”：

- `eligibility_scope`：`card`、`customer`、`invitation`、`transaction`、`unknown`。
- `eligibility_status`：沿用 canonical `unknown`、`potentially_eligible`、`user_confirmed_eligible`、`user_confirmed_ineligible`、`needs_review`。
- `enrollment_status`、`quota_status`、`progress_status` 和每个奖励组件的 `reward_status` 不互相覆盖。

报名 `submitted` 只代表用户记录了外部提交，名额 `available` 只代表规则/页面显示仍有信息；只有必需报名已 `confirmed`、名额已 `allocated`（或不适用）、任务本地达标且用户完成规定核对，才可显示“达标，待奖励核对”。该文案仍不表示奖励到账。

### 3.3 多奖励组件必须独立核对

一个参与实例可同时有积分、返现、礼品、费用减免等多个 `reward_key`。每个组件拥有自己的来源、发放条件、预期日期、状态、到账证据、撤回和争议记录。组件 A `received` 不得把组件 B 改成 `received`；活动级摘要只显示“仍有奖励待核对”及组件数，不保存单一会覆盖事实的 `reward_received=true`。

P0 最小夹具仍只要求一个奖励组件，但写模型和验收必须能保存多个组件；多组件自动编排、跨合作方追踪延后 P1/P2。

### 3.4 支付路由和周期实例在任务激活时冻结

`SpendMethod` 不是商户名称的同义词，而是消费是否符合规则的证据口径。P0 要求任务激活时保存 method snapshot，至少包括渠道、钱包/支付产品（如有）、线上/线下、地区、币种、商户/MCC 范围和排除项；交易流水只能引用该快照。用户不知道路由或规则没有给出路由时，流水进入 `pending/unknown`，不得计入确定值。

周期任务必须有稳定的 `activity_instance_key`，建议由规则版本、卡片、周期起止和用户时区共同确定。上一周期的消费、资格、奖励和提醒不能通过标题、商户或卡片自动合并到下一周期；P0 由用户显式创建实例，自动生成重复实例、版本差异检测延后 P2。

### 3.5 积分双差额公式固定为两个问题

本轮正式冻结以下 canonical 口径，修正旧研究稿中把未分配差额写成 `confirmed_balance - lots_remaining_total` 的漂移：

```text
reconciliation_difference = confirmed_balance - ledger_balance
unallocated_difference    = ledger_balance - lots_remaining_total
```

- `confirmed_balance`：用户从官方渠道观察到的余额快照，不是本地可 PATCH 的事实源。
- `ledger_balance`：由 append-only PointsEntry 重放得到的本地账面余额。
- `lots_remaining_total`：已有证据的 PointsLot 剩余合计。
- `reconciliation_difference` 回答“官方观察与本地账面差多少”。
- `unallocated_difference` 回答“本地账面中有多少尚未归入已知批次”。

示例：`confirmed=100`、`ledger=90`、`lots=80` 时，页面分别显示 `+10` 和 `+10`，不合并成“可用 20”。任一数未知、差额不为零或批次证据不足，都进入 `mismatch/needs_review`；正差额不能自动造 lot 或到期日，负差额不能截断为零。

### 3.6 兑换履约与扣分必须分轴

用户从官方商城或银行 App 自行兑换后，Cardfolio 记录：

1. 订单/履约轴：计划、提交、受理、处理中、实物/票券/里程/抵扣履约、成功、失败、取消、争议；写模型拆为 `order_status` 和 `fulfillment_status`。
2. 积分扣分轴：`points_debit_status=not_debited|pending_debit|posted|needs_review`。
3. 退分轴：`refund_status=not_applicable|not_requested|pending_external_confirmation|confirmed_external|posted|needs_review`。

订单成功不等于积分已扣，订单失败/取消不等于已退分。只有用户确认官方账户已扣分，才写一次幂等 `redeem_debit`；只有存在已入账扣分且有官方退回证据，才写等额 `reversal`。P1 不做系统内 `hold/reservation`、自动 lot/FIFO、自动兑换或跨账户转移。

### 3.7 未知状态必须可行动

`unknown` 表示事实不存在或无法确认，`needs_review` 表示已有冲突/过期/证据不足，`disputed` 表示用户记录与外部结果冲突；三者不能被一个红色标签替代。所有未知/待核对对象至少保存：

`reason_code`、`evidence_note`、`last_verified_at`、`source_id`（可空但要说明原因）、`next_action`、`next_action_due_at`（可空）。

`next_action` 必须是用户能执行的动作，例如“打开银行活动原文”“补报名结果”“核对入账日期”“确认官方余额”“确认积分是否退回”。没有明确日期的奖励、积分到期或权益下发，不生成“逾期/即将过期”结论；只能生成维护型“补充核对信息”提醒。

## 4. P0/P1/P2 首纵切与影响

| 发布门 | 首纵切 | 必须交付 | 明确不做 |
| --- | --- | --- | --- |
| Foundation/Gate 0 | 所有领域共用事实契约 | 用户/卡片复合所有权、来源/规则版本、时区、审计、幂等、未知字段、提醒去重、canonical 状态映射 | 不新增活动、权益、积分或兑换入口 |
| P0 | 活动 + 单卡刷卡任务 + 奖励核对 | 线索保存；有来源的规则；每卡 Participation；资格/报名/名额；冻结支付路由和周期实例；snapshot/entries 二选一；发生/入账/清算；退款反向流水；奖励组件；站内提醒 | 银行同步、自动报名、自动判断资格、自动发奖/积分、复杂 custom 表达式、自动周期生成 |
| P1-a | 基础权益使用 | `consumable_quota` 和 `service_eligibility` 的下发、预约、出示、核销/拒绝/争议；只有 `redeemed` 扣减 | `coverage_claim`、`fee_credit`、保险理赔、年费返还、服务商连接器、附件长期保存 |
| P1-b | 积分账户/批次/手工兑换 | 确认余额、账本、批次、双差额、兑换订单与积分轴、用户确认扣分/退分、可重放流水 | 自动 lot/FIFO、系统内 hold、跨账户 transfer、自动兑换、库存/合作方同步 |
| P2 | 受控自动化和扩展 | 只在新授权、安全、隐私、恢复和供应商评审后考虑导入、规则模板、重复活动检测、外部连接器、批量写入 | 不把 P2 计划写成当前工作台能力，不以推荐替代证据 |

产品发布门：P1-a 和 P1-b 必须分别通过迁移、并发、重放、恢复、移动端和未知状态验收后再打开 feature flag；不能用一个空的“权益中心/积分中心”入口代表已交付。

## 5. 用户任务与关键指标

### 5.1 用户任务

| 优先级 | 用户任务 | 完成定义 |
| --- | --- | --- |
| P0 | 发现并保存活动 | 线索与正式规则分开；来源、适用期和下一步清晰 |
| P0 | 核对资格、报名和名额 | 每个参与实例独立记录，未知时说明阻断原因 |
| P0 | 规划和更新刷卡任务 | 支付路由、周期实例、截止口径、确定/待入账值可解释 |
| P0 | 核对多个奖励结果 | 每个组件独立记录待发、到账、撤回或争议 |
| P1-a | 使用权益并追踪失败 | 下发、预约、出示、核销和拒绝可追溯，只有核销扣次数 |
| P1-b | 对账积分并记录兑换 | 三个余额、两个差额、订单和扣分轴同时可见，失败不猜退分 |

### 5.2 指标

分母均为用户主动录入或确认的数据，不把银行实际资格、库存、发奖或实时余额当作 Cardfolio 可控指标。

- **P0 建档到行动率**：新建卡用户中，7 日内完成一个有来源活动/任务且设置下一步的比例，目标不低于 50%。
- **来源可核对率**：活跃活动/任务中有官方来源、适用期和最近核对时间的对象比例，目标不低于 80%。
- **未知可行动率**：进入 `unknown/needs_review` 的对象中，14 日内完成 `next_action` 或被用户明确忽略的比例，目标不低于 60%；不把未知直接消除当成功。
- **临期处置率**：有明确截止日并产生提醒的对象中，截止日前被完成、已核对或明确忽略的比例，目标不低于 70%。
- **状态隔离缺陷**：测试夹具中资格/报名/名额/任务/奖励、订单/扣分任一轴被错误联动的发布缺陷，目标为 0。
- **P1 积分新鲜度**：活跃积分账户的余额核对日在用户设定周期内的比例，目标不低于 70%。
- **P1 兑换结果完整率**：用户已记录兑换的订单中，同时具有履约结果和积分轴结果（或明确未知原因）的比例，目标不低于 80%。
- **错误恢复率**：退款/冲正、兑换失败/退分和权益撤销样本均能保留原事实并通过反向记录重算，目标为 100%。

## 6. Given/When/Then 验收标准

每条验收都应绑定发布门、夹具、UI/API 操作、状态/数值、审计或读模型证据。以下为本轮必须纳入 QA 的最小集合。

### P0

1. **活动线索不变成事实**  
   Given 用户只粘贴第三方摘要，没有官方 URL、适用期和支付口径；When 保存活动；Then 对象为“线索/待官方核对”，带 `next_action=补充官方规则`，不能创建确定 SpendTask、奖励金额或可参加承诺；When 用户补齐官方来源并激活规则；Then 才可创建参与实例和任务；证据为对象时间线和 API 响应。

2. **资格未知阻断最终达标**  
   Given 任务本地累计已达到目标，但 `eligibility_status=unknown`；When 用户打开活动详情；Then 显示“资格待核对”和阻断原因，任务最多为 `target_reached/provisionally_qualified`，不得显示最终“达标待奖励核对”或已到账；证据为五轴状态读模型。

3. **报名与名额不互相推断**  
   Given `enrollment_status=submitted`、`quota_status=unknown`；When 用户确认消费已达标；Then 报名仍为 `submitted`、名额仍为 `unknown`，活动不能进入最终达标；When 用户补录官方确认和名额分配证据；Then 只更新对应轴并写审计；证据为状态事件序列。

4. **同一活动多卡隔离**  
   Given 同一规则适用于卡 A、卡 B；When 用户分别录入消费；Then 生成两条独立 participation、任务和奖励，卡 A 的金额不能满足卡 B 的目标，活动聚合只读显示两条实例；证据为唯一键和两条任务重算结果。

5. **多奖励组件独立**  
   Given 同一 participation 有积分和返现两个 `reward_key`；When 用户确认积分到账但返现仍待发；Then 积分为 `received`、返现为 `expected_pending/delayed`，活动不显示“全部奖励已到账”；证据为两个奖励事实、各自来源和幂等键。

6. **支付路由和周期实例隔离**  
   Given 任务只允许实体 POS，用户录入一笔移动钱包消费和一笔实体 POS 消费；When 重算任务；Then 钱包流水为 `pending/excluded`，实体 POS 按规则计入；Given 下一周期有相同商户和卡；When 创建第二个 `activity_instance_key`；Then 两个周期进度、提醒和奖励不合并；证据为 method snapshot、实例键和聚合结果。

7. **快照和流水不能双算**  
   Given SpendTask 使用 `input_mode=snapshot`；When 用户尝试新增 SpendEntry；Then API 拒绝并返回明确冲突错误，原快照不变；Given `input_mode=entries`；When 相同 `idempotency_key` 同参数重放；Then 返回原结果且不产生第二笔；证据为 409/幂等响应、entry 数量和审计记录。

8. **退款保留历史并重开当前结论**  
   Given 任务曾达到目标；When 用户录入跨截止日的部分退款；Then 原流水和原达标快照保留，追加关联负向流水，当前进度转为 `needs_review/shortfall`，不得删除或静默改写历史奖励；证据为原 entry、reversal_of_entry_id、重算水位。

9. **未知奖励期限不生成逾期**  
   Given 任务已本地达标但规则没有奖励发放期限；When 生成提醒；Then 只允许用户设置“奖励核对”节点，不生成自动预计日或“逾期未发”状态；证据为 reminder dedupe key 和无 expected date 的读模型。

### P1-a

10. **权益预约不扣次数**  
    Given `usage_model=consumable_quota`、剩余 2 次；When 预约成功但尚未现场核销；Then `reservation_status=confirmed`、`redemption_status=not_presented`，剩余仍为 2；When 用户确认现场 `redeemed`；Then 只扣 1 次，重复提交同一 usage key 不重复扣减；证据为 quota ledger 和并发/幂等结果。

11. **非次数权益不进入 quota ledger**  
    Given 权益 `usage_model=coverage_claim` 或 `fee_credit`；When 用户记录理赔/费用抵扣结果；Then 保存独立结果和金额，不生成 quota consume、不显示伪造剩余次数；证据为 usage model、ledger entry 类型和 UI 字段。

### P1-b

12. **积分双差额可解释**  
    Given `confirmed_balance=100`、`ledger_balance=90`、`lots_remaining_total=80`；When 打开账户详情；Then 显示 `reconciliation_difference=+10` 与 `unallocated_difference=+10` 两行及各自 as-of，不显示合并“可用 20”，账户为 `mismatch/needs_review`；证据为从零重放结果和页面快照。

13. **未知批次不造到期提醒**  
    Given 账户只有官方总余额，批次和 `expires_on` 均未知；When 生成积分提醒；Then 不生成某一批次的到期日或 FIFO 扣减建议，只生成“补充批次/到期信息”的维护动作；证据为无 PointsLot 写入和 reminder 记录。

14. **兑换履约与积分扣分分轴**  
    Given 外部订单已成功但官方积分扣分尚未核对；When 用户记录订单结果；Then `fulfillment_status=fulfilled`、`points_debit_status=pending_debit`、`refund_status=not_requested`，不能显示“兑换完成”；When 用户确认官方已扣分；Then 追加一条幂等 `redeem_debit`；同 key 重放不得重复入账；证据为订单、PointsEntry、审计和响应。

15. **失败不等于退分**  
    Given 订单失败或取消，退分结果未知；When 用户保存失败结果；Then 订单保留，`points_debit_status` 不被改写，`refund_status=pending_external_confirmation/needs_review`，不得自动写 reversal；When 用户补录官方退回证据且存在已入账 debit；Then 追加等额关联 reversal 并将 `refund_status=posted`；证据为关联键和账户重算。

16. **未知状态有下一步**  
    Given 任意活动、权益、积分或兑换对象进入 `unknown/needs_review/disputed`；When API 保存或状态转换成功；Then 返回并持久化 `reason_code`、`evidence_note`、`last_verified_at`、`next_action`，列表显示可执行动作；缺少这些字段时拒绝生成最终成功、可用、已到账或到期结论；证据为校验错误、详情页和审计事件。

## 7. 交接事项

### 架构

- 冻结 `DiscoveryLead` 与 Campaign/Participation 的边界，或给现有活动线索投影补充可信度/下一步字段；线索不能触发任务或奖励事件。
- 冻结 `eligibility_scope`、活动实例唯一键、支付路由 method snapshot、奖励 `reward_key` 组件和 canonical 状态映射。
- 将 P0/P1-a/P1-b 做成独立 feature flag 和事件边界；跨聚合只承诺已提交事实，积分/提醒/工作台投影在 pending 时返回处理中和 `as_of`。
- 明确订单履约、积分扣分、积分退分三条事件链，禁止订单成功直接发 debit，禁止失败直接发 reversal。

### DBA

- 以复合所有权约束保护 `(owner_user_id, campaign, card, instance)`、权益 usage、积分 account/lot、兑换 account/card；跨用户和跨卡引用必须失败。
- 固化 `reconciliation_difference` 与 `unallocated_difference` 的公式、精度和有符号值；PointsEntry/权益 ledger append-only，负余额保留并标记 `needs_review`。
- 为支付路由快照、周期实例、奖励组件和提醒 dedupe 建唯一键；同幂等键同参数重放原响应，异参数返回 409。
- 迁移旧年费 `progress_entries` 时只能按可证明的发生日/来源回填；无法推导入账、清算、业务键或周期的记录标 `needs_review`，不能伪造事实。

### QA

- 将本节 16 条 GWT 转为 API、读模型、审计和 UI 测试，至少覆盖：空来源、资格未知、提交未确认、名额未知、多奖励、路由不符、周期隔离、退款跨周期、权益拒绝、双差额、兑换成功 pending、失败退分未知。
- 增加并发/重放/时区/DST/归档/删除/跨用户权限夹具；断言错误码、状态轴不联动、原事实保留和投影可重建。
- 发布门按 P0、P1-a、P1-b 分开出具报告；当前年费 MVP 不得因规划文档测试通过而标记新模块上线。

### UX

- 工作台和详情把“线索、待核对、处理中、失败、已确认”与业务事实分开表达；未知状态必须显示阻断原因、证据日期和唯一下一步。
- 活动首屏显示资格/报名/名额/任务/奖励摘要；多奖励展开后逐项显示。移动端不把五轴压缩成一个“完成”。
- 刷卡任务显示允许的支付路由、周期实例、确认值/待入账值和截止口径；路由未知时提供“补充路由/查看规则”动作。
- 积分账户同屏显示三个余额和两个差额、单位、as-of、对账状态；兑换页面并列显示履约和积分扣分，避免绿色“成功”覆盖 pending。
- P0 入口只在真实实现后开放；当前年费 MVP 不展示活动、权益、积分或兑换空壳入口。

### 安全（补充）

- 只保存后四位、掩码参考号和用户主动录入的证据；不保存完整卡号、CVV、银行凭据或自动抓取的账户页面。
- 来源摘录、凭证备注和兑换参考号按最小权限、删除和导出策略处理；外部 URL 不视为已验证输入，防止把第三方内容升级为规则事实。

## 8. 未决问题与风险

1. `eligibility_scope=customer/invitation` 是否需要单独的“持卡人/受邀人”字段，还是先保留规则文本和用户备注；需架构与 UX 冻结。
2. 同一用户的附属卡、合并积分池和多持有人场景不纳入 P0；若后续支持，必须先定义授权主体和跨卡计入证据。
3. 钱包 token、二维码、银行 App 内支付和实体卡在不同银行的路由定义不统一；P0 只能记录用户从规则和凭证确认的 route snapshot，不能自动从商户名称推断。
4. 发奖期限、服务商到账、名额分配和退分时点常由卡种/活动版本决定；无原文时只能 `unknown`，不能用全局默认天数。
5. P1-b 是否允许用户在没有 PointsLot 的情况下仅记录总余额，已决定为允许，但必须明确 `unallocated_difference` 和到期未知；lot 自动分配仍是 P2。
6. 兑换订单的“成功”是银行受理、商品发出、合作方到账还是账单抵扣完成，需由 `fulfillment_type` 定义终态，不得使用统一成功文案。
7. 当前正式 PRD、部分研究稿仍混有 `pending/expected_pending`、`fulfilled/success` 和不同未分配差额公式；Gate 0 前必须完成 canonical 映射，不能让前端猜测。
8. 当前代码仍是年费 MVP，未实现上述实体、提醒和状态轴；任何宣传、导航或部署说明必须继续标注“规划中/待实现”。

## 9. 交付记录

### Changed files

仅新增/编辑：`docs/research/CARD-DOMAIN-ROUND6-PRODUCT.md`。未修改正式 PRD、架构、DBA、QA、UX、安全文档、代码、迁移、锁文件或 ledger；未提交、未推送、未写入外部系统。

### Decisions

- 线索与正式活动事实分开；来源不足时只能保存线索和补充来源动作，不能创建确定任务或奖励承诺。
- 活动以每卡、每周期参与实例为中心；资格、报名、名额、任务和每个奖励组件独立记录。
- 支付路由和周期实例在任务激活时冻结；路由未知进入待核对，周期不得自动合并。
- canonical 双差额为 `confirmed - ledger` 与 `ledger - lots`，两者不合并成可用余额。
- 兑换履约与积分扣分/退分分轴；失败不猜退分，只有用户确认官方结果才写幂等流水。
- P0 仍只有活动/单卡任务/奖励闭环；P1-a 权益和 P1-b 积分/兑换分别发布；自动化和导入延后 P2。
- 所有未知/待核对状态必须有原因、证据、时间和下一步；未知不能产生最终成功、可用、到账或到期结论。

### Validation

- 已静态复核正式 PRD 与 `CARD-DOMAIN-*` 产品、架构、DBA、QA、UX、安全研究稿。
- 已通过 `curl -L` 复查本节 8 个公开官方 URL，均返回 HTTP 200；动态/历史页面按表格标明了适用范围和局限。
- 未运行应用、数据库迁移、构建或 E2E；当前代码仍是年费 MVP，不能据此宣称活动、权益、积分或兑换已经可用。
- 待执行：`git diff --check -- docs/research/CARD-DOMAIN-ROUND6-PRODUCT.md`。

### Ready for integration

yes。主会话可将第 3、4、6、7 节作为正式 PRD 的 Round6 合并输入；架构/DBA/QA/UX 应先按交接事项完成 Gate 0 对齐，再分别开启 P0、P1-a、P1-b。
