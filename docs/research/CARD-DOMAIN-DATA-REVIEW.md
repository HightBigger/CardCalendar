# Cardfolio 卡活动、权益与积分数据研究稿

文档版本：v0.1

复核日期：2026-08-14

角色：DBA（独立数据约束复核）

范围：卡活动、活动参与、刷卡方式/任务、权益额度与使用、积分账户/流水/批次、积分兑换，以及从当前年费 MVP 演进到工作台的数据库约束和迁移边界。

本稿只修改本文件，不创建真实迁移，不修改 `db/schema`、PRD、架构文档或业务代码。它是给主会话合并到 `docs/DATABASE-WORKBENCH.md` 的研究证据和变更清单。

## 1. 研究输入与结论

### 1.1 复核输入

- 需求输入：`docs/PRD-WORKBENCH.md`，尤其是活动资格/报名/奖励、发生/入账/清算、权益核销、积分未分配差额和兑换退款的第二轮边界。
- 架构输入：`docs/ARCHITECTURE-WORKBENCH.md`，确认模块化单体、聚合所有权、不可变事实、outbox/inbox、时区和幂等约定。
- 数据设计输入：`docs/DATABASE-WORKBENCH.md`，重点复核第 2、4--8、11、13、14 节的 DDL 草案和验收条件。
- 实际基线：`db/schema/index.ts`、`db/migrations/0000_initial.sql`--`0003_worker_heartbeats.sql`。当前只存在 users、sessions、cards、fee_cycles、fee_events、progress_entries、reminder_rules、reminders、audit_logs、worker_heartbeats；没有活动、权益、积分、兑换、source snapshot、outbox 或 inbox 表。
- 规则建模证据：PRD 已列招商银行积分概览/奖励计划/兑换说明、中国银行年费与贵宾厅规则等官方来源。它们只能证明“交易入账、退款追回、权益凭证/核验、批次有效期、兑换到账延迟”等维度存在，不能给 Cardfolio 推导个人资格或实时余额。

### 1.2 结论

1. **一个活动身份可以关联多张卡，但参与事实必须按卡实例化。** 唯一键应是 `(owner_user_id, campaign_id, card_id)`；同一用户同一活动的另一张卡可以有另一条参与记录，资格、报名和奖励不能放在 campaign 单行上。
2. **任务进度不是一列金额。** 任务必须冻结规则/刷卡方式快照，并保留追加事实；`occurred`、`posted`、`settled`、是否符合口径是四个可重放维度。退款/冲正是新事实，不能覆盖原交易或把负数截成零。
3. **预约不是消费。** 权益 reservation 只表示计划/已预约/预约失败；只有现场核销确认才写额度扣减。并发核销要锁 entitlement，并用 usage 业务键去重。
4. **积分余额、lot 余额和未分配差额是三个数。** `unallocated = ledger_balance - allocated_lot_balance`；正差不得伪造到期日，负差必须 `mismatch/needs_review`。一笔兑换扣分可分配到多个 lot，lot allocation 不能使用会禁止这种拆分的唯一约束。
5. **兑换订单和账本扣分最终一致但状态独立。** 外部兑换成功时先记录 `success + debit_pending`，worker 在账户行锁下用 `redemption:{id}:debit` 幂等写入；失败不猜测退分，退款必须在 debit 已确认后追加等额 reversal。
6. **当前 DB 草案方向正确但有四个必须修正的硬缺口：** 权益 usage 到 entitlement 的复合外键不完整；积分账户唯一键不支持同计划按卡分账；lot allocation 的 `unique(account_id, sequence)` 会阻止一笔流水分多个 lot；任务和 redemption 的状态词与 PRD 不一致且缺少可数据库验证的状态边界。

## 2. 规范化实体和所有权

所有新增表均保留 `user_id`，需要固定卡归属时同时保留 `card_id`；除了主键，再建立能被子表引用的复合唯一键。跨用户、跨卡引用不能只依赖 API 查询。

| 聚合/实体 | 最小关键字段 | 事实与派生边界 | 必须的唯一键/引用 |
| --- | --- | --- | --- |
| `Campaign` | `user_id`、`campaign_key`、`rule_id`、当前来源版本、提供方、活动状态 | 活动身份和规则版本；不保存某张卡的报名/消费结果 | `unique(user_id, campaign_key)`；`rule_id,user_id` 复合 FK |
| `ActivityParticipation` | `user_id`、`campaign_id`、`card_id`、`rule_version_id`、资格/报名/结果/奖励四轴、`row_version` | 同一活动在一张卡上的参与事实；状态列由事件投影 | `unique(user_id,campaign_id,card_id)`；`campaign_id+user_id`、`card_id+user_id`、`rule_version_id+user_id+rule_id` 复合 FK |
| `ActivityParticipationEvent` | participation、单调 `sequence`、`business_key`、动作、操作者、发生时间、摘要 | 报名、资格、名额、结果、奖励确认的 append-only 事实 | `unique(participation_id,sequence)`、`unique(participation_id,business_key)` |
| `SpendTask` | `user_id`、`card_id`、可选 participation、`rule_version_id`、窗口、IANA 时区、`cutoff_basis`、目标、输入模式、进度水位 | 激活时冻结规则和方式；进度缓存可重建 | `unique(user_id,card_id,instance_key)`；与 participation 必须同用户同卡同 rule |
| `SpendMethodSnapshot` | task、渠道、商户/地区/币种范围、排除项、来源快照 | 任务内不可变的刷卡方式快照；模板编辑不影响进行中任务 | `unique(task_id,snapshot_key)`；复合 FK 到 task/source |
| `SpendTaskEntry` | task、task 内 `sequence`、`business_key`、发生/入账/清算日期、处理状态、资格状态、增量、`related_entry_id` | 唯一交易/累计事实；退款、修正、冲正均为新行 | `unique(task_id,sequence)`、`unique(task_id,business_key)`；反向事实同 task、同币种 |
| `Benefit` | card、rule、`benefit_key`、类型 | 权益规则身份，不是额度余额 | `unique(user_id,card_id,benefit_key)`；card/rule 复合 FK |
| `BenefitEntitlement` | benefit、卡、规则版本、周期、grant key、单位、额度状态、缓存水位 | 某卡某周期的实际发放实例 | `unique(user_id,benefit_id,grant_key)`；子表必须带 entitlement/card/user 复合引用 |
| `BenefitUsage` | entitlement、client key/hash、预约状态、核销状态、数量/金额、证据 | 一次预约/出示/现场核销事实；预约不扣额度 | `unique(user_id,client_request_key)`；`(id,entitlement_id,user_id)` 唯一以供 ledger 复合 FK |
| `BenefitEntitlementLedger` | entitlement、sequence、业务键、`grant/use/expire/adjustment/reversal`、增量、usage | 权益额度唯一事实，缓存由其重放 | `unique(entitlement_id,sequence)`、`unique(entitlement_id,business_key)`；usage 必须引用同一 entitlement |
| `PointsAccount` | user、可选 card、program、unit、scale、状态、余额/批次水位 | 余额为账本投影；用户确认余额通过 reconciliation 进入 adjustment | 需要一个稳定 `account_key`；按卡账户和合并池分别唯一，不能只用 `(user,program,unit)` |
| `PointsLedger` | account、账户内 `sequence`、业务键/hash、类型、带符号点数、时间、可选 reversal | 积分余额唯一事实，禁止更新/删除 | `unique(account_id,sequence)`、`unique(account_id,business_key)`；反向流水同账户且金额精确相反 |
| `PointsLot` | account、lot key、获得/到期日、置信度、限制、状态 | 可解释的到期批次；剩余量由 allocations 重算 | `unique(account_id,lot_key)`；同账户复合 FK |
| `PointsLotAllocation` | ledger entry、lot、分配量、独立 allocation sequence | 流水和 lot 之间的不可变分配事实；允许一笔 entry 拆到多个 lot | `unique(ledger_entry_id,lot_id)`；若使用 sequence 必须命名为 `allocation_sequence`，不能与 ledger sequence 混淆 |
| `PointsReconciliation` | account、请求 key/hash、官方/用户观察余额、账本余额前值、调整值、as-of/source | 对账事实和调整入口，不是可编辑 balance | 推荐 `unique(account_id,client_request_key)`，同 key 跨账户应冲突 |
| `Redemption` | account、可选 card、请求 key/hash、外部引用、所需点数、订单状态、`ledger_status`、履约/退款日期 | 外部兑换订单和积分处理两条状态轴 | `(user,client_request_key)` 或 `(account,client_request_key)` 明确作用域；account/card 必须同用户 |
| `RedemptionLedgerLink` | redemption、debit/refund 角色、ledger entry | 兑换与账本事实的链接 | `primary key(redemption_id,link_role)`、`unique(ledger_entry_id)` |

金额使用 `numeric(14,2)` 并带 ISO 4217 币种；积分使用 `numeric(20,4)`，账户 `points_scale` 限制小数位。禁止使用 JSONB 隐藏金额、状态、所有权、有效期、幂等键或跨实体 ID；JSONB 只能承载受版本控制的说明/来源摘要。

## 3. 状态和数据库不变量

### 3.1 活动参与：同一活动多卡

`Campaign` 是活动身份，`ActivityParticipation` 才是卡实例。建立一条活动记录后，用户可以分别为卡 A、卡 B 创建 participation；禁止用 `applicable_card_ids` 数组代替参与行。

建议的四轴状态（词汇应与 PRD 统一）：

```text
eligibility: unknown -> potentially_eligible -> user_confirmed_eligible
            \-> user_confirmed_ineligible / needs_review
enrollment:  not_required | not_started -> submitted -> confirmed
            \-> rejected / expired / cancelled / unknown
outcome:     not_started -> in_progress -> target_reached -> reward_pending
            \-> failed / expired / disputed / needs_review
reward:      not_expected -> pending/delayed -> received
            \-> reversed / disputed / unknown
```

数据库只允许状态转换函数或带 `row_version` 的命令执行；普通 `PATCH` 不得直接改轴。报名成功不代表资格确认，资格确认不代表名额分配，任务目标达到不代表奖励到账。必须报名时，`confirmed` 之外不可将任务置为最终 `qualified`；名额/资格未知时只能预计达标。

### 3.2 刷卡任务：occurred / posted / settled / refund

任务激活时固化 `window_start/window_end`、`timezone`、`cutoff_basis`（`occurred`、`posted`、`settled`、`unknown`）、目标关系（count/amount/all/any）和 method snapshot。

每条 entry 至少包含：

- `occurred_on`、可空 `posted_on`、可空 `settled_on`，三者存在时满足 `occurred_on <= posted_on <= settled_on`；
- `processing_status`：`occurred_only`、`posted`、`settled`、`rejected`、`reversed`、`unknown`；
- `qualification_status`：`included`、`excluded`、`pending`、`disputed`、`unknown`；
- `count_delta`、`amount_delta`、币种、method snapshot、稳定 `business_key`；
- 退款/冲正的 `related_entry_id`。

确定进度只汇总：窗口内、满足任务 cutoff 日期、`qualification_status=included` 且不是已被反向的 entry。尚未达到 cutoff 的记录进入 `pending_*` 预计进度；系统不宣称银行已确认。

反向规则必须由 deferred trigger 或唯一存储过程验证：

```text
reverse.count_delta  = -original.count_delta   （完整冲正）
reverse.amount_delta = -original.amount_delta  （完整冲正）
sum(all reversals for original).abs <= original.abs（允许部分退款）
same(task_id, currency, method snapshot compatibility)
```

退款跨越任务窗口或任务已关闭时，原任务保留历史结果；任务投影转 `disputed/needs_review`，写审计和 `SpendTaskTargetNoLongerReached` outbox，不删除原达标事实。`count` 和 `amount` 可同时为负，但负进度不得被截断为零。

### 3.3 权益：预约不扣额度

建议将 `reservation_status` 与 `redemption_status` 分列；若实现上继续使用单状态，必须由 transition trigger 明确其含义并保留事件历史：

```text
reservation: not_required/not_booked -> requested -> confirmed
             \-> rejected/cancelled/unknown
redemption:  not_presented -> presented -> redeemed
             \-> rejected/disputed/unknown
```

`planned`、`requested`、`confirmed reservation`、`rejected`、`cancelled`、现场争议都不写 `use`。第一次由用户确认 `redeemed` 时，在锁定 entitlement 的事务中以 `benefit_usage:{id}:use` 追加一条负向额度流水；重复命令命中同一业务键。已用后误记通过一条精确 `reversal` 恢复，不能直接改 `remaining_cache`。

`benefit_entitlement_ledger.usage_id` 仅引用 `(id,user_id)` 不够，可能把同一用户另一权益的 usage 接到本 entitlement。应补 `unique(id,entitlement_id,user_id)` 并使用：

```sql
foreign key (usage_id, entitlement_id, user_id)
  references benefit_usages (id, entitlement_id, user_id)
```

否则至少用事务触发器查询并拒绝跨 entitlement；仅在文档中声称“触发器保证”不算可执行约束。

额度恒等式：

```text
remaining = grant + adjustment - use - expire + reversal
```

余额低于零时保留真实结果并标 `needs_review`，不能以 `greatest(remaining,0)` 隐藏超用。

### 3.4 积分账户、lot 和未分配差额

积分账本是账户余额唯一事实；账户行在一次事务内锁定，分配连续账户序号，插入 entry、审计和 outbox。余额缓存由 `sum(points_delta)` 重建：

```text
ledger_balance       = sum(points_ledger.points_delta)
allocated_lot_balance = sum(points_lot_allocations.allocated_delta)
unallocated_difference = ledger_balance - allocated_lot_balance
```

`confirmed_balance`（用户从官方渠道确认的快照）和上述 `ledger_balance` 也必须并列展示。正的 `unallocated_difference` 没有可推断的到期日，不触发虚假到期提醒；负差表示 lot 超过账面余额，账户进入 `mismatch/needs_review`，不得自动生成 adjustment。

lot allocation 必须允许一条 earn/redeem/expire/reversal ledger 拆到多个 lot。当前草案的 `unique(account_id, sequence)` 若把 `sequence` 当 ledger sequence，会拒绝合法拆分；改为 `allocation_sequence`（账户内分配事件序号）或删除该唯一键，只保留 `(ledger_entry_id,lot_id)`，并由 deferred trigger 校验：

- allocation 总量的绝对值不超过对应 ledger entry 的绝对值；
- allocation 正负方向与 entry 类型一致；
- 同一 lot 不能被消耗到负数，除非明确进入 `needs_review`；
- ledger、lot、allocation、account 必须同一 user/account。

P0 只允许用户明确指定 lot，或让差额保持未分配；`earliest_expiry_first` 只能产生建议。用途限制不满足时停止建议，不静默跳过。跨账户 transfer、自动 FIFO、部分 lot 预占留到 P2。

### 3.5 兑换：成功、延迟扣分、失败和退款

订单履约和积分扣减必须是独立状态轴：

```text
order:        planned -> submitted -> processing -> success
              \-> failed/cancelled/disputed/unknown
success:      success -> refund_pending -> refunded
ledger:       not_debited -> pending -> posted
              \-> needs_review; posted -> reversed
```

P0/P1 是用户已在外部渠道完成兑换后的手工确认，不做系统内 reservation：

1. `confirm_success` 锁 redemption、校验 `row_version`，提交 `success + ledger_status=pending`，同事务写审计和 `RedemptionDebitRequested` outbox。
2. consumer 按固定业务键 `redemption:{id}:debit` 锁 points account，写 `-required_points` 和 debit link；重复 worker、HTTP 重试和事件重放只得到一条 entry。
3. 外部已成功但本地余额不足仍写真实负数，账户和兑换置 `needs_review`；不能伪造余额为零或把成功改成失败。
4. `failed/cancelled` 在 debit 前不得写流水。技术失败由 outbox 重试；同 key 不同请求摘要进入 `IDEMPOTENCY_CONFLICT`/死信。
5. `record_refund` 先进入 `refund_pending`；仅在 debit link 已 `posted` 后写等额反向 PointsEntry 和 refund link，再转 `refunded + ledger_status=reversed`。退款先于扣分、重复退款和金额不符都拒绝并保留审计。

P0 只支持整单退款；部分退款、系统内 hold/release、外部自动履约和跨账户积分转移必须另做双边守恒模型。

## 4. 约束矩阵

| 主题 | 数据库硬约束 | 事务/触发器校验 | 不可由数据库推断的事项 |
| --- | --- | --- | --- |
| 所有权 | 所有子表 `user_id`；`(id,user_id)`、必要时 `(id,user_id,card_id)` 唯一；复合 FK | 命令从 session 推导 user；RLS；固定锁顺序 | 用户是否真实符合银行资格 |
| 活动多卡 | `unique(user,campaign,card)`；campaign/card/rule 复合 FK | row_version、participation event sequence | 名额是否由银行分配 |
| 规则版本 | version_no、active 生效区间排斥、source citation FK | 激活时锁 rule，恰好一个 primary snapshot；已激活 version 不可改删 | 来源网页未来是否仍有效 |
| 任务日期 | `end >= start`；日期顺序 check；币种 FK | cutoff 计算、entry 重放、跨周期退款重开 | 银行是否认定入账 |
| 任务冲正 | 同 task/账户、related entry FK、每原 entry 最多一条完整 reversal | 精确反向、部分退款累计不超原值、无环、锁 task 分配 sequence | 退款原因是否合理 |
| 权益额度 | grant/use/reversal entry 符号；usage 同 entitlement 复合 FK | 锁 entitlement、usage 幂等、状态转换和余额重放 | 预约是否真的拿到现场服务 |
| 积分精度 | numeric(20,4)、points_scale、account unit 继承 | 锁 account 分配序号；reversal 精确相反；lot allocation 恒等式 | 银行实时余额和到期策略（若无来源） |
| lot 差额 | `unique(account,lot_key)`；ledger/lot/account 复合 FK | allocation 可拆分；正/负差 `mismatch`；不自动造 lot | 哪个 lot 应优先扣（除非用户确认） |
| 兑换幂等 | account/card/user 复合 FK；业务 key/hash；每订单一个 debit/refund link | outbox/inbox、账户锁、状态图、debit 前退款拒绝 | 外部订单是否最终履约 |
| 审计/事实 | ledger、snapshot、event 禁止 update/delete | correction/reversal 只追加；缓存可重建 | 用户备注的真实性 |

### 4.1 并发、锁定和幂等执行顺序

所有写命令都在一个数据库事务中完成。固定锁顺序为“根聚合行 -> 事实序号/额度行 -> 审计与 outbox”，禁止在持有数据库锁时调用外部服务或跨模块 HTTP：

1. 活动 participation 锁 participation 行并检查 `row_version`；活动事件使用 participation 内单调 sequence。并发创建使用 `(user,campaign,card)` 唯一键兜底。
2. SpendTask 锁 task 行，按 `last_entry_sequence + 1` 分配 entry sequence，再写 append-only entry 和进度缓存；重复 `business_key + request_hash` 返回原结果，不同 hash 以 409 结束。
3. BenefitUsage 锁 entitlement 行，再检查 usage 业务键和剩余额度；reservation 命令不持有或改变额度，只有 `redeemed` command 才追加 use ledger。若并发核销超过余额，保留失败事实并标 `needs_review`，不能静默丢弃或截断。
4. PointsLedger/Redemption consumer 锁 points account 行，分配 account sequence，写 ledger、lot allocation、link、缓存和 outbox；固定业务键保证 worker 重试和事件重放只生成一条事实。账户锁期间不读取或调用银行/兑换商。
5. Outbox publisher 使用 `FOR UPDATE SKIP LOCKED` 领取；每个 consumer 先插入 `(consumer_name,event_id)` inbox，重复事件直接确认，失败进入可重试/死信而不回滚已提交事实。旧 source sequence 的投影更新必须被拒绝。

数据库 append-only 表撤销应用角色的 `UPDATE/DELETE`，由受控 `security definer` command 写入 correction/reversal；同一事务提交事实、审计、幂等结果和 outbox，避免出现“已扣分但没有可重放事件”或“事件已发出但事实回滚”的半状态。

## 5. 当前 DATABASE-WORKBENCH 的冲突和修订建议

| 优先级 | 现有位置/问题 | 风险 | 建议并入的修订 |
| --- | --- | --- | --- |
| P0 | 第 2 节只给未来复合 FK；实际 `cards`、`fee_cycles`、`fee_events`、`progress_entries` 仍只有单列 FK | 现有行可以跨用户/跨卡引用；新表无法安全回填 | 在第 2.1 节增加基线盘点：先查孤儿和跨 owner 行，创建 `(id,user_id)`/`(id,user_id,card_id)` 唯一索引，以 `NOT VALID` 复合 FK 加入并离峰 `VALIDATE`；不能直接启用 RLS 伪装修复 |
| P0 | 第 4 节 `enrollment_status` 使用 `enrolled/failed/cancelled`，PRD 要求 `submitted/confirmed/rejected/expired/unknown`；`outcome` 未含 reward_pending/disputed | API、查询和验收无法共享状态词；报名失败可能被误当活动失败 | 统一 PRD 词汇，状态投影由 append-only participation events 驱动；补状态转换测试 |
| P0 | 第 5 节 entry 有 posted/settled 日期但无 `processing_status`、`qualification_status`、任务 `cutoff_basis` | 无法区分发生但未入账、已入账但排除、待核对；会提前宣布达标 | 在 task/entry 增加显式字段和日期顺序/口径约束；将预计与确定进度分开重算 |
| P0 | 第 5 节只声明 trigger 保证 reversal 精确相反，DDL check 只验证符号 | 业务错误可写入非精确 reversal，历史重算错误 | 增加 deferred constraint trigger/唯一 command；验收覆盖部分退款累计、跨周期重开、无环 |
| P1 | 第 6 节 `benefit_entitlement_ledger.usage_id` 只 FK `(id,user_id)` | 同一用户的另一个 entitlement usage 可被错误连接 | `benefit_usages` 增加 `(id,entitlement_id,user_id)` 唯一键，ledger 使用三列复合 FK；或实现等价 deferred trigger |
| P1 | 第 6 节把 usage 状态写成 planned/booked/used/...，未拆 reservation 与 redemption | 预约取消、预约成功现场拒绝和已用争议的语义不稳定 | 与 PRD 对齐为两轴，或保留单列但追加 reservation/use 事件和严格 transition trigger；明确 booked 不扣额度 |
| P1 | 第 7 节 `unique(user_id,program_code,unit_code)` 不含 `card_id`，而 `card_id` 又可空 | 同一计划按卡分账会冲突；合并池的 NULL 唯一语义也不明确 | 增加 `account_key`；按卡唯一 `(user,program,unit,card_id,account_key)`，合并池单独 partial unique；同计划多卡参与必须能表达 |
| P1 | 第 7.2 节 `unique(account_id,sequence)` 位于 lot allocation | 一笔扣分/获得拆到多个 lot 时第二行失败 | 将其改成 `allocation_sequence` 或删除；只以 `(ledger_entry_id,lot_id)` 去重，并用 trigger 验证 allocation 守恒 |
| P1 | 第 7 节 `points_reconciliations` 唯一键是 `(user_id,client_request_key)` | 同一用户不同账户复用自然 key 可能误冲突；同 key 跨账户冲突规则不明确 | 选择并写明命名空间：推荐 `(account_id,client_request_key)`，请求摘要不同返回 409 |
| P1 | 第 8 节 `success/refund_pending/refunded` 的 check 未强制 refund 必须已有 posted debit | 可产生退款订单但无扣分 link，余额被错误反向 | transition function 强制 `refund_pending` 仅从 success 且 debit link 存在；consumer 先锁 account 再写 reversal |
| P1 | 架构/数据库稿提到 outbox/inbox/RLS，但 baseline 无表、无角色、无 `iso_4217_currencies` | 按文档上线会缺依赖或在应用层漏写 | 把 outbox/inbox、币种参考表、最小角色/权限作为基础迁移；没有 `btree_gist` 时用锁 rule 的 constraint trigger |
| P0 | 现有 `progress_entries` 只有 `entry_type`、`reversed_at`，没有 business key、posted/settled、related entry | 无法无损转换成 SpendTaskEntry；重复累计和退款历史可能已丢 | 不把旧表直接当新事实源；建立 adapter/回填标 `source_kind=legacy_progress`、`needs_review`，双写观察后再切读 |
| P0 | PRD 将活动任务列为 P0，架构第 14.11 又把权益/积分/兑换排除在首个纵切 | 实现范围和验收会被误读为“全部可用” | 主文档明确 P0 = 活动参与 + 单卡手工 SpendTask + 奖励手工确认；权益/积分/兑换分别完成 P1 纵切后再接首页 |

## 6. P0/P1/P2 数据边界

| 阶段 | 可交付数据事实 | 明确不做 |
| --- | --- | --- |
| P0 手工纵切 | Campaign/Participation 四轴、单卡任务规则快照、手工 occurred/posted/settled 录入、退款/冲正、用户确认资格/奖励、outbox/audit/idempotency | 银行同步、自动资格判断、权益额度账本、自动积分记账、系统内兑换预占 |
| P1 手工工作台 | Benefit/Entitlement/Usage/Quota ledger；PointsAccount/Ledger/Reconciliation/Lot（用户指定分配）；外部兑换结果 + 成功后幂等 debit + 整单退款 reversal；首页只读投影 | OCR/CSV 直接写事实、自动 lot FIFO、自动报名/兑换、自动外部履约、跨账户转移、部分退款 |
| P2 受控自动化 | 导入 inbox/preview/confirm、版本化 parser、可解释的 lot 分配建议、系统内 hold/release（独立流水）、外部 connector、通知渠道 | 把 P0/P1 缓存当事实；绕过复合 FK、不可变账本、业务 key 或审计 |

导入必须先生成 source snapshot 和待确认候选行；用户确认后才调用业务 command。原始账单、完整卡号、登录凭据和敏感附件不写进 JSONB、审计或普通业务表。

## 7. Expand/contract 迁移与回滚

### 7.1 Expand 顺序

1. **预检和恢复点**：确认 PostgreSQL 15、当前 `pgcrypto/citext`、是否允许 `btree_gist`、备份/PITR、RLS/worker 角色和 `set_updated_at()`；记录表计数、跨 owner 行、孤儿、重复自然键。
2. **所有权前置**：先为现有父表增加复合唯一索引；清理或隔离跨用户数据；以 `NOT VALID` 加入复合 FK，离峰 `VALIDATE CONSTRAINT`。失败时保持旧约束和只读报告，不强行删除行。
3. **基础横切**：建立 `iso_4217_currencies`、source reference/snapshot、rule/version/citation、audit append-only 触发器、outbox/inbox 和最小角色；没有 primary citation 的规则不得激活。
4. **P0 活动/任务**：新增 campaign/participation/events、spend task/method snapshot/entries；旧 `progress_entries` 进入只读 adapter。双写一段观察期，以全量重放比较旧累计与新缓存；无法推导 posted/settled 的旧行统一标 `needs_review`，不伪造日期。
5. **P1 权益**：建立 benefit/entitlement/usage/ledger；回填只能从有稳定业务 key 的记录建立 grant/use，预约记录不得回填为 use；补齐同 entitlement 的复合 FK 后再开放核销命令。
6. **P1 积分和 lot**：先建 account/ledger/sequence 和 reconciliation，再建 lots/allocations。旧余额只回填为确认快照/adjustment，不作为 earn lot；没有明确到期日的差额保持未分配。
7. **P1 兑换**：建立 redemption/link/状态转换和 outbox consumer；冻结旧兑换 worker（若存在），逐单核对成功/失败/退款后再开启 debit/refund consumer。
8. **Contract**：至少两个完整核对周期且重放、并发、导出/删除和备份恢复通过后，关闭旧写入口、切换新读路径；继续保留 legacy 表只读和业务 key，观察期后才评估删除。

### 7.2 回滚

- 常规回滚使用 feature flag：停止新命令入口和 outbox consumer，恢复旧读路径；不删除已产生的新事实、不把新账本反写回旧累计字段。
- 若缓存损坏，冻结相关命令，从 ledger/entry 全量重建缓存并记录 repair audit；先修复事实或追加 correction/reversal，再解冻。
- 新表数据已被外部渠道确认后，不得用回滚脚本删除 debit/refund；需要以业务 key 对账并重放缺失事件。
- 只有全库灾难才使用 PITR。PITR 后要重放恢复点之后外部已确认的兑换/退款，并验证所有恒等式和 RLS；不得把数据库恢复成功等同于账务恢复成功。

## 8. 数据库验收案例

以下案例应使用 PostgreSQL 集成测试和真实事务，不用 mock 或只测 service 层：

1. **活动多卡**：同一 `(user,campaign)` 为卡 A、卡 B 各插入一条成功；重复创建卡 A 被唯一键拒绝；把用户 B 的 card 或 rule version 关联到用户 A 被复合 FK 拒绝。
2. **活动四轴**：报名 `submitted/rejected/confirmed` 不改变 eligibility/outcome；必须报名且报名未 confirmed 时，任务不能进入最终 qualified；奖励 pending 不得显示 reward_received。
3. **任务口径**：occurred 日期在窗口内但 posted 在窗口外时，只计预计不计确定；cutoff=posted 与 cutoff=settled 的结果不同且可解释；发生/入账/清算日期倒序写入失败。
4. **任务冲正**：一笔正向 entry 后追加部分退款，累计反向绝对值不超原值；第二条完整 reversal、跨 task reversal、引用自己的 reversal、非精确 reversal 均失败；已关闭任务跨周期退款后变 disputed/needs_review 并保留原快照。
5. **任务并发**：两个事务同时写 task，sequence 连续且唯一；相同 business key + 相同 hash 返回原记录，不同 hash 返回 409，不能重复计数。
6. **权益预约**：planned/booked/confirmed reservation、cancelled/rejected 不产生 use ledger；两个并发 `redeemed` 命令只成功一个，usage key 和 entitlement remaining 只扣一次；跨 entitlement usage FK 失败。
7. **权益重放**：grant + use + reversal 后重放 remaining 与缓存相同；误记导致负余额保留负数并进入 needs_review，不被截断为零。
8. **积分序号/精度**：并发追加 entry 得到连续账户 sequence；超出 points_scale 的数值失败；已存在 business key 的不同 request hash 冲突；普通角色不能更新/删除 ledger。
9. **lot 恒等式**：一笔 earn 或 redeem 拆成两个 lot allocation 成功；`ledger_balance = allocated + unallocated` 始终成立；正 unallocated 不生成到期提醒，负差进入 mismatch；跨账户 allocation 失败。
10. **兑换延迟扣分**：confirm_success 后订单 success 但 ledger pending；重复 debit worker 只有一个 debit link；本地余额不足仍写负余额并标 needs_review；failed/cancelled 不写 debit。
11. **兑换退款**：debit 未 posted 时 refund 被拒；posted 后重复 refund 只有一条 reversal；refund 金额不是原 debit 相反值时失败；订单状态与 ledger_status 各自可见。
12. **幂等/事件**：重复 outbox 投递由 inbox `(consumer_name,event_id)` 去重；乱序事件不能让旧缓存覆盖新 sequence；死信重试不产生第二条流水。
13. **权限与删除**：RLS、复合 FK、API 三层都覆盖跨用户/跨卡 IDOR；新表注册导出/账户删除清理；归档卡不生成新提醒但历史事实可读。
14. **迁移 parity**：旧 progress_entries 可回放的 count/amount 与新 task cache 一致；缺失 posted/settled 的行标 needs_review；无法确定原 business key 时不伪造 idempotency。
15. **时间和恢复**：用户时区、UTC 跨日、DST、闰日和 inclusive 截止日结果固定；从全量备份+WAL 恢复后重新检查账户、lot、兑换 link、outbox、RLS 和导出/删除注册表。

## 9. 给主会话的合并优先级

### P0（合并前必须修订）

1. 明确 P0 手工纵切范围，避免把权益/积分/兑换规划文档误读为当前可用。
2. 在 DATABASE-WORKBENCH 第 2.1 节补充现有单列 FK 的数据盘点和复合所有权迁移前置。
3. 在第 4 节统一 participation 状态词并落 append-only participation event；保留同活动多卡唯一键。
4. 在第 5 节补 `cutoff_basis`、`processing_status`、`qualification_status`、日期顺序和精确 reversal trigger；把旧 progress 映射标为有损风险。
5. 将 P0 验收加入 occurred/posted/settled、退款回退、同活动多卡和重复累计四类案例。

### P1（开始权益/积分/兑换纵切前必须修订）

1. 补 BenefitUsage -> Entitlement 的三列复合 FK或等价 deferred trigger，明确预约不扣额度。
2. 修正 PointsAccount 的账户业务键和按卡/合并池唯一语义；修正 lot allocation sequence 唯一约束，支持一笔流水多 lot。
3. 增加 PointsLot allocation 的方向、绝对值、负差和重放约束；`unallocated_difference` 不得写入或生成到期日。
4. 给 Redemption 增加严格 transition function：debit posted 前不得退款，订单成功和 ledger posted 独立展示，余额不足保留真实负数。
5. 把 `iso_4217_currencies`、outbox/inbox、append-only 权限、RLS 和新增表的导出/删除清理列为基础迁移，而不是“以后再补”的隐含依赖。

### P2（不应提前承诺）

- 系统内积分 reservation/hold/release、自动 FIFO/跨用途分配、部分退款、跨账户积分 transfer、CSV/PDF/OCR 直写、银行/兑换商自动 connector。每项都需要新的守恒模型、权限/隐私评审和独立回滚方案。

## 10. 验证摘要与未决问题

### 已完成

- 对照实际 Drizzle schema 和四条现有 migration，确认当前生产形态仍是年费 MVP，没有新增领域表。
- 复核了 DATABASE-WORKBENCH 已有 DDL、状态、复合 FK、ledger 恒等式、幂等、outbox/inbox、迁移和验收章节，并单独标出与 PRD/实际 baseline 不一致之处。
- 研究稿只写入本文件；未创建 migration、未修改正式数据库文档、未提交或推送。

### 未决且阻断上线

- 托管 PostgreSQL 是否允许 `btree_gist`；不允许时必须用锁 rule 的 constraint trigger 保证 active 规则区间不重叠。
- `iso_4217_currencies` 的来源和维护方式；不能用仅正则的 `^[A-Z]{3}$` 代替有效币种约束。
- 多卡联合活动如何分摊贡献、跨账户积分转移如何双边守恒、部分兑换退款是否允许；当前 P0/P1 不支持。
- 账户删除、导出和备份保留期的产品/合规参数尚未确定；新增事实表不能漏注册清理和导出。
- 旧 `progress_entries` 是否含任何可推导 posted/settled 的来源信息尚未盘点；在盘点前不得承诺无损迁移。

## 11. 检查

- `git diff --check -- docs/research/CARD-DOMAIN-DATA-REVIEW.md`：应通过（本稿完成后执行）。
- 兼容性判断：所有建议均以 PostgreSQL 15、现有 `pgcrypto/citext` 和普通约束/触发器为基线；`btree_gist`、RLS、outbox/inbox、币种参考表均明确列为迁移前置或待确认依赖，没有假设尚未批准的扩展已经存在。
