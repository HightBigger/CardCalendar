# Cardfolio 卡领域第七轮产品研究

| 项目 | 内容 |
| --- | --- |
| 文档版本 | v0.1 |
| 复核日期 | 2026-08-14 |
| 角色 | 产品经理 |
| 复核范围 | 卡活动、卡权益、刷卡方式/消费任务、积分账户/批次、积分兑换和工作台提醒 |
| 输入 | `docs/PRD-WORKBENCH.md` v0.8、`CARD-DOMAIN-ROUND6-PRODUCT.md`、Round6 架构/DBA/QA/安全研究稿、Round7 台账 |
| 产品现状 | 当前代码仍是年费 MVP；本文的新领域全部是规划和发布门，不代表已经实现 |
| 允许修改范围 | 仅本文件；不修改正式 PRD、架构、DBA、QA、UX、安全文档、代码、迁移、锁文件或 ledger |

## 1. 研究目标与方法

本轮不是继续堆字段，而是验证用户在五类任务中能否回答“现在是什么、依据是什么、下一步做什么”，并检查正式 PRD 与 canonical 状态是否仍然一致：

1. 活动：发现、资格、报名、名额、消费达标和多奖励是否可分开核对。
2. 权益：下发、预约、出示、现场核销、拒绝和争议是否不会被误记为已使用。
3. 刷卡方式：支付路由、消费日期口径、入账里程碑和周期实例是否可解释、可重放。
4. 积分：官方观察余额、本地流水余额、已知到期批次和两个差额是否各自有行动。
5. 兑换：订单、履约、积分扣减和退分是否分轴，失败时是否保留未知而不猜测。

研究步骤：先静态复核 PRD 与 Round6 角色稿，再复查银行公开页面的产品维度；只记录可由页面支持的建模维度，不记录卡号、账户、凭据或个人资格。公开页面可能动态变化，页面标题、搜索摘要和第三方攻略不能单独创建活动事实。

## 2. 官方来源复查

以下页面在 2026-08-14 通过公开 HTTP 复查，均返回 200。来源只用于说明规则可能包含哪些维度，不能推出 Cardfolio 用户当前资格、库存、实时余额、发奖结果、退分结果或其他银行的默认规则。

| 来源 | 访问日期 | 支持的建模维度 | 边界和不可推导事实 |
| --- | --- | --- | --- |
| [中国银行：2026 年信用卡年费减免政策](https://www.boc.cn/bcservice/bi2/202511/t20251114_25568422.html) | 2026-08-14 | 产品/周期可能不同；消费笔数、金额和排除项可能分开；退货会影响累计；用户可在官方渠道查询达标 | 仅适用于页面列出的中行产品和 2026 周期，不能推出其他银行、年份或个人资格 |
| [招商银行：信用卡积分介绍](https://cc.cmbchina.com/content/cusservice/8.htm) | 2026-08-14 | 可能按入账金额计算，入账后生效，退款扣回；交易积分和活动积分可分开 | 概览不覆盖特殊卡、联名卡、活动排除项或个人实时余额 |
| [招商银行：个人用户积分奖励计划](https://market.cmbchina.com/MPage/online/240131174121650/JLJH2024JF/index.html) | 2026-08-14 | 交易奖励和活动奖励、有效期、退款追回、合作方履约可同时存在；官方渠道可能提供到期提醒 | 取整、排除费用、期限和合作方条款只适用于对应计划与卡种 |
| [招商银行：积分兑换航空里程及酒店集团积分](https://market.cmbchina.com/MPage/online/220607120009184/vippc/vipjh/jflc.html) | 2026-08-14 | 兑换可能有指定卡资格、库存/个人上限、合作方异步到账和不可取消等维度 | 不证明当前库存、资格、兑换比例、到账时间或退分结果 |
| [中国银行：高端信用卡贵宾厅服务活动规则](https://www.bankofchina.com/bcservice/bc5/bc58/202010/t20201015_18542423.html) | 2026-08-14 | 历史权益包含凭证下发、现场核验、容量限制、服务商和争议渠道 | 规则适用期为 2020-11-01 至 2021-10-31，仅证明权益需要分型，不能代表当前权益 |
| [建设银行：信用卡积分兑换入口](https://creditcard.ccb.com/cn/creditcard/jfdh.html) | 2026-08-14 | “积分当钱花”和“积分换礼”等入口、账户和商城渠道可能分离 | 导航页不证明未登录用户资格、库存、余额或比例 |
| [建设银行积分商城帮助中心](https://jf.ccb.com/exchangecenter/help/index.jhtml) | 2026-08-14 | 登录、积分查询、订单、支付、活动规则、配送和售后是不同履约维度 | 帮助目录不是商品条款，不证明当前库存、配送或售后结果 |
| [建设银行：龙卡信用卡优惠/云闪付专题](https://www.ccb.com/cn/html1/office/xyk/subject/25/04/0416dsn/index.html) | 2026-08-14 | 活动可能绑定指定支付渠道；正文不完整时应保留待核对 | 标题或摘要不能推出时间、名额、MCC、返奖金额或个人资格 |

## 3. 产品结论

### 3.1 活动是“参与实例”，不是一行全局状态

用户真正需要管理的是某张卡在某个周期是否可以参加、是否已报名、是否拿到名额、消费是否满足口径、各奖励是否到账。活动规则本身与用户参与实例必须分离：

- 唯一业务范围固定为 `(owner_user_id, campaign_id, card_id, activity_instance_key)`；同一活动的两张卡、两个周期都不能合并进度。
- 资格要记录适用范围（卡片、持卡人、邀请、交易或未知）和用户核对结果。`potentially_eligible` 不能展示为已确认资格。
- `enrollment_status=submitted` 只表示用户记录了外部提交；`quota_status=available` 只表示来源页面仍有信息。它们不能互相推导，也不能代替 `confirmed/allocated`。
- 多奖励必须以 `reward_key` 独立记录。积分到账不代表返现、礼品或费用减免到账；活动摘要只能显示“仍有奖励待核对”。
- 来源缺失或只有第三方摘要时，保存为线索并提供“补充官方规则”动作；不得创建确定刷卡任务、奖励金额、可参加承诺或自动提醒继续消费。

### 3.2 权益要按使用模型区分

用户需要知道“有资格”“凭证已下发”“是否预约”“是否出示”“现场是否核销”，而不是只看一个剩余次数。产品口径如下：

- `consumable_quota` 才有次数/额度账本；只有用户确认首次 `redeemed` 才产生 consume。预约、出示、拒绝、取消和争议不扣额度。
- `coverage_claim`、`fee_credit`、`service_record` 保存独立结果和金额/服务记录，不显示伪造的剩余次数。
- 下发失败、服务网络变化或现场拒绝必须保留原因和下一步；不自动推断已使用，也不自动恢复不存在的扣减。
- P1-a 只开放用户手工记录和可重放的额度事实；保险理赔、服务商连接器、附件长期保存和自动预约后置。

### 3.3 刷卡方式是冻结的资格证据

活动规则可能限定实体 POS、线上支付、钱包、地区、币种、商户或 MCC。商户名称不能代替支付路由，用户不确定路由时只能保存待核对记录：

- 任务激活时冻结 `SpendMethodSnapshot`，至少包含线上/线下、钱包或支付产品（如有）、地区、币种、商户/MCC 范围和排除项。
- `occurred`、`posted`、`settled` 是不同里程碑；`cutoff_basis` 决定哪些事实进入确定进度。缺少必要里程碑时只进入预计/待核对值。
- 退款和冲正追加关联反向事实，不能覆盖原消费或静默撤回历史奖励。部分退款可能让当前任务回到 `shortfall/needs_review`。
- `snapshot` 与 `entries` 二选一，周期由稳定 `activity_instance_key` 区分。相同卡片和商户不能自动合并相邻周期。

### 3.4 积分页面要回答两个不同的差额问题

积分页必须同时展示官方观察值、流水值和已知批次值，并固定公式：

```text
reconciliation_difference = confirmed_balance - ledger_balance
unallocated_difference    = ledger_balance - lots_remaining_total
```

`reconciliation_difference` 回答官方观察余额和本地账面差多少；`unallocated_difference` 回答本地账面中有多少尚未归入有证据的批次。示例 `confirmed=100`、`ledger=90`、`lots=80` 时应显示 `+10` 和 `+10` 两行，不能合并为“可用 20”。

- 余额快照是用户确认的 observation，不是可直接 PATCH 的事实源；流水 append-only，可从零重放。
- 未知批次没有可靠 `expires_on` 时不生成批次到期提醒，不自动 FIFO、不自动造 lot 或 expire entry。
- 任何差额不为零、余额未知、批次证据不足或真实余额为负，都显示 `mismatch/needs_review` 和补证据动作。

### 3.5 兑换必须把订单和积分账本拆开

用户可能在银行 App 或商城完成兑换，但本地不知道订单是否受理、合作方是否到账或积分是否已经扣减。产品显示和写模型必须保留四条底层事实轴：

1. `order_status`：计划、提交、受理、拒绝、取消、未知。
2. `fulfillment_status`：未开始、处理中、履约完成、失败、取消、未知。
3. `points_debit_status`：未扣、待核对、已入账、需复核。
4. `refund_status`：不适用、未申请、等待外部确认、外部已确认、已入账、需复核。

订单成功不等于履约完成，也不等于本地积分已扣；失败/取消不等于已退分。只有用户确认官方扣分才写幂等 `redeem_debit`，只有存在已入账 debit 且有官方退回证据才追加等额 reversal。P1 不做系统内 hold、库存锁定、自动 lot/FIFO、自动兑换或跨账户转移。

### 3.6 未知状态必须给出行动

`unknown`、`needs_review`、`disputed` 各自表达不同原因，不能都显示为“失败”。所有未知对象至少需要 `reason_code`、`evidence_note`、`last_verified_at`、`next_action`；有条件时增加 `next_action_due_at`。

可执行动作应是“打开官方规则”“补报名结果”“核对入账日期”“确认官方余额”“确认积分是否退回”等。没有明确日期时不能生成“即将过期/已经逾期”的结论，只能生成维护型核对提醒。

## 4. P0/P1/P2 产品范围

| 发布门 | 用户价值 | 必须交付 | 明确不做 |
| --- | --- | --- | --- |
| Gate 0 | 所有领域有一致事实契约 | 复合所有权、来源/规则版本、时区、未知字段、幂等、提醒去重、canonical 映射、审计 | 不开放新业务入口 |
| P0 | 知道活动是否值得继续、还差多少、奖励是否需要核对 | 活动线索与规则分离；每卡每周期 participation；资格/报名/名额；冻结支付路由；单卡 SpendTask；snapshot/entries；发生/入账/清算；退款反向流水；多奖励组件；站内提醒 | 银行同步、自动报名、自动判断资格、自动发奖、自动周期生成、复杂 custom 表达式 |
| P1-a | 能使用权益并解释被拒或争议 | `consumable_quota`/`service_eligibility` 的下发、预约、出示、核销/拒绝/争议；只有核销扣额度 | 保险理赔、年费抵扣、服务商连接器、自动预约、附件长期保存 |
| P1-b | 能解释积分余额和兑换结果 | 确认余额、append-only 流水、lot、双差额、订单/履约/扣分/退分四轴、用户确认后幂等记账 | 自动 lot/FIFO、hold/reservation、跨账户 transfer、库存同步、自动兑换 |
| P2 | 在授权和安全审查后减少手工工作 | 隔离导入、重复活动检测、外部连接器、批量确认、自动提醒渠道和受控规则模板 | 不把计划能力提前显示成当前可用功能 |

P1-a 与 P1-b 必须分别通过迁移、复合 ownership、并发/重放、备份恢复、移动端和未知状态验收后再打开 feature flag。当前代码只能发布年费 MVP。

## 5. 用户任务与产品指标

### 5.1 用户任务

| 优先级 | 用户任务 | 完成定义 |
| --- | --- | --- |
| P0 | 保存一条活动线索或正式规则 | 来源等级、适用期、待核对原因和下一步清晰；线索不产生刷卡承诺 |
| P0 | 核对每张卡的资格/报名/名额 | participation 独立，状态轴互不覆盖，证据可追溯 |
| P0 | 建立可解释的刷卡任务 | 支付路由、周期实例、截止口径、确定/预计进度和退款影响可见 |
| P0 | 核对多个奖励组件 | 每个 `reward_key` 有独立状态、来源和证据 |
| P1-a | 记录权益使用或拒绝 | 预约、出示、核销和争议可追溯，只有核销扣额度 |
| P1-b | 对账积分和兑换 | 三个余额、两个差额、订单/履约/扣分/退分同时可见，未知有动作 |

### 5.2 指标建议

指标只以用户主动录入或确认的数据为分母，不把银行实时资格、库存、发奖或余额准确率当作 Cardfolio 可控结果：

- **从建卡到行动率**：新建卡用户 7 日内完成一个有来源任务并设置下一步的比例，目标不低于 50%。
- **来源可核对率**：活跃活动/任务中具有官方来源、适用期和最近核对时间的比例，目标不低于 80%。
- **未知可行动率**：进入未知/待复核后 14 日内完成下一步或明确忽略的比例，目标不低于 60%。
- **临期处置率**：有明确截止日且产生提醒的对象，在截止日前完成、核对或忽略的比例，目标不低于 70%。
- **状态隔离缺陷数**：资格/报名/名额/任务/奖励或订单/扣分轴错误联动的发布缺陷，目标为 0。
- **积分新鲜度**：活跃积分账户的余额核对日在用户设定周期内的比例，目标不低于 70%。
- **兑换结果完整率**：已记录兑换同时有履约结果和积分轴结果（或明确未知原因）的比例，目标不低于 80%。
- **错误恢复率**：退款/冲正、退分和权益纠错样本保留原事实且可重算的比例，目标为 100%。

## 6. Given/When/Then 验收建议

每条验收需绑定发布门、夹具、UI/API 操作、错误码和事实/审计证据。

### P0

1. **线索不变成活动事实**：Given 用户只有第三方摘要；When 保存；Then 只能保存线索、来源等级和“补充官方规则”动作，不得生成确定任务、奖励金额或可参加承诺。
2. **资格未知阻断最终结论**：Given 本地消费已达目标但资格为 `unknown`；When 查看；Then 显示待核对原因，不能显示最终达标或奖励到账。
3. **报名和名额独立**：Given 报名 `submitted`、名额 `unknown`；When 记录消费达标；Then 两个状态不变；补录官方证据只更新对应轴并追加审计。
4. **多卡隔离**：Given 同一活动适用卡 A/B；When 分别录入消费；Then 两个 participation、任务、提醒和奖励不相加，跨卡引用返回 404。
5. **多奖励独立**：Given 同一 participation 有积分和返现；When 只确认积分到账；Then 返现仍待发/延迟，活动不能显示全部奖励到账。
6. **支付路由隔离**：Given 规则只允许实体 POS；When 录入移动钱包和实体 POS 两笔；Then 钱包为待核对/排除，实体 POS 才可进入确定进度。
7. **周期实例隔离**：Given 相同卡和商户存在两个周期；When 创建第二个 `activity_instance_key`；Then 进度、奖励和提醒不合并。
8. **snapshot/entries 不双算**：Given task 为 snapshot；When 新增 entry；Then 返回明确冲突错误且快照不变；entries task 重放同幂等键只返回首次结果。
9. **退款保留历史**：Given 任务曾达标；When 录入跨周期部分退款；Then 原 entry 保留，追加反向事实，当前结果回到 `shortfall/needs_review`，不静默删除奖励。
10. **未知奖励期限不生成逾期**：Given 规则没有奖励发放期限；When 生成提醒；Then 只能生成用户设置的核对节点，不生成自动预计日或逾期结论。

### P1-a

11. **预约不扣额度**：Given consumable quota 剩余 2；When 预约成功但未核销；Then剩余仍为 2；首次 `redeemed` 只扣 1，重复请求不重复扣。
12. **非次数权益不写 quota**：Given usage model 为 `coverage_claim` 或 `fee_credit`；When 记录结果；Then 保存独立金额/服务结果，不写 consume 或剩余次数。
13. **现场拒绝不扣额度**：Given 已预约并出示但现场拒绝；When 保存拒绝；Then额度不变，保留拒绝原因和可执行的争议动作。

### P1-b

14. **双差额可解释**：Given confirmed=100、ledger=90、lots=80；When 查看；Then 分别显示 +10 和 +10，账户为 mismatch/needs_review，不显示合并“可用 20”。
15. **未知批次不造到期提醒**：Given 只有总余额且批次未知；When 生成提醒；Then 不写 lot、不生成具体到期日，只提示补充批次证据。
16. **订单成功但扣分待核对**：Given 外部履约成功、官方扣分未确认；When 保存；Then fulfillment 为 fulfilled、debit 为 pending_debit、refund 为 not_requested，页面不能显示“兑换完成”。
17. **失败不等于退分**：Given 订单失败/取消且退分未知；When 保存；Then不自动写 reversal；只有已 posted debit 加官方退回证据才可追加等额 reversal。
18. **固定卡与合并池语义**：Given 固定卡积分账户和合并池账户；When 兑换引用卡片；Then 固定卡账户必须同卡，合并池才允许未指定卡；不兼容引用返回 404 或明确校验错误。

### 横切

19. **未知状态有下一步**：Given 任一对象为 unknown/needs_review/disputed；When 保存；Then 持久化原因、证据时间和 next_action；缺字段不得生成最终成功、可用、到账或到期结论。
20. **幂等和越权**：Given 同 key 同参数重放；When 重试；Then 返回首次结果且只产生一条事实；同 key 异参数为 409；跨用户/不兼容跨卡引用为 404。

## 7. 当前契约漂移与发布阻断

本节记录研究开始时发现的事项及其整合方向。主会话已将状态、奖励事件、权益枚举、兑换 scope 和 Reminder 约束写入正式契约；它们仍未在代码/迁移中实现，因此实现前 Gate 0 仍然是发布阻断。

| 严重性 | 位置 | 问题 | 产品影响 | 处理建议 |
| --- | --- | --- | --- | --- |
| High | `docs/QA-WORKBENCH.md:298` | 仍把兑换写成 `status=success` + `ledger_status=posted` | QA 可能测试第二套写模型，用户会看到成功覆盖待核对 | 删除旧句或标记 compat-read-only，统一四轴 |
| High | `docs/DATABASE-WORKBENCH.md:247-280` | 奖励主表可变，事件表/幂等约束未给出完整 DDL | P0 奖励撤回、争议和重放不可验证 | DBA 补独立 reward event/history 和唯一业务键 |
| High | `docs/DATABASE-WORKBENCH.md:562-590` | 权益使用 `use/adjustment`，其他稿使用 `consume/restore` | UI、API、导出和测试会产生不同枚举 | Gate 0 冻结 canonical 新写入枚举，兼容读单向映射 |
| High | `docs/DATABASE-WORKBENCH.md:776-815` | `redemptions.card_id` 可空，复合 FK 可能误放固定卡账户 | 固定卡与合并池的兑换语义混淆 | 采用非空/部分唯一或等价触发器，并加入跨卡测试 |
| Medium | `docs/DATABASE-WORKBENCH.md:961-996` | Reminder 仅有 dedupe/status，worker lease、重试、死信字段未落表 | 多 worker 和失败恢复的用户提醒可能重复或丢失 | DBA 明确 lease/attempt/error/dead-letter 所属表和验收 |
| Medium | `docs/ARCHITECTURE-WORKBENCH.md:497-506` | 早期样例仍使用 success/fulfilled 单轴 | 实现者可能沿用旧 API/事件 | 删除或明确 deprecated compat-read-only |

发布判断：上述契约尚未实现真实迁移、RLS、API、outbox/inbox、worker、安全扫描和领域 E2E 前，不能把工作台 P0/P1 说成可部署。当前可部署范围仍只有年费 MVP。

## 8. 交接与未决项

### 产品经理交接

- 将本稿第 3、4、6 节作为 PRD 的用户决策和 GWT 输入；保持线索、资格、报名、名额、进度、奖励、订单和积分轴独立。
- 不把公开页面中的资格、库存、比例、到账时长或退分结果写成默认值；所有未知都要有下一步。

### 架构师交接

- 冻结 `activity_instance_key`、`eligibility_scope`、奖励 `reward_key`、SpendMethodSnapshot 和 Redemption 四轴；旧 success/fulfilled 仅可兼容读取。
- 为 P0/P1-a/P1-b 建立独立 feature flag、事件和读模型，跨模块只传递已提交事实与 `as_of`。

### DBA 交接

- 为奖励历史、权益 canonical 枚举、固定卡/合并池兑换、提醒 worker lease/dead-letter、snapshot/entries 互斥提供 DDL/trigger/唯一约束。
- 复合 ownership、RLS、账本守恒、幂等 409、跨卡 404 和恢复重放必须进入 PostgreSQL 集成测试。

### QA/安全/UX 交接

- QA 将 20 条 GWT 绑定 API、事实表、读模型、审计、移动端和时区证据；安全补敏感 JSON/URL/导出扫描与删除/再认证门槛；UX 保持未知状态的原因和下一步可见。

### 未决问题

1. `eligibility_scope=customer/invitation` 是否需要独立持卡人/受邀字段，还是先以规则文本和用户证据表达。
2. 附属卡、合并积分池和多持有人授权是否永远排除 P0；若开放必须先定义 ownership 和跨卡计入证据。
3. 支付钱包、二维码、银行 App 内支付的 route 如何在不自动推断的前提下被用户选择和核对。
4. 兑换“成功”究竟是银行受理、商品发出、合作方到账还是账单抵扣完成，需由 fulfillment_type 明确定义。
5. P1 是否允许没有 lot 的总余额记录（当前建议允许），以及 unknown 批次提醒的文案和关闭动作。
6. Reminder worker 的 lease、重试和死信由提醒表还是通用 job 表承载，需 DBA/SRE 在 Gate 0 签收。

## 9. 交付记录

### Changed files

仅新增 `docs/research/CARD-DOMAIN-ROUND7-PRODUCT.md`；未修改正式 PRD、架构、DBA、QA、UX、安全文档、代码、迁移、锁文件或 ledger；未提交、未推送。

### Decisions

- 活动以每卡、每周期 participation 为中心；线索与正式规则分离；多奖励按组件独立核对。
- 权益按 usage model 分型，只有 consumable quota 的首次 redeemed 扣额度；预约/拒绝/争议不扣。
- SpendMethodSnapshot、occurred/posted/settled 和 snapshot/entries 二选一保证刷卡任务可解释、可重放。
- 积分固定两个有符号差额；未知批次不造 lot、到期日或 FIFO 建议。
- 兑换订单、履约、扣分和退分四轴分离；失败不猜退分，posted debit 加官方证据才允许 reversal。
- P0 仍为活动 + 单卡任务 + 奖励人工核对；权益为 P1-a，积分/兑换为 P1-b，自动化为 P2。

### Validation

- 8 个官方来源在 2026-08-14 通过 `curl -L --max-time 20` 复查，均返回 HTTP 200；每个来源均记录适用范围和不可推导事实。
- 已静态复核 PRD v0.8、Round6 产品研究稿、架构/DBA/QA/安全研究稿和 Round7 台账。
- `git diff --check -- docs/research/CARD-DOMAIN-ROUND7-PRODUCT.md` 通过；未运行应用、数据库迁移、构建或 E2E。

### Ready for integration

yes。主会话可将第 3、4、6、7 节合并到正式 PRD，并将契约漂移交给架构、DBA、QA 和安全角色在 Gate 0 前签收。当前代码仍为年费 MVP，本文不能作为工作台已上线证明。
