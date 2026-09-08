# Cardfolio 卡领域第八轮 DBA 数据补充复核

| 项目 | 内容 |
| --- | --- |
| 文档版本 | v0.1 |
| 复核日期 | 2026-08-15 |
| 角色 | DBA｜Cardfolio｜账本与迁移补充复核 |
| 输入 | `docs/DATABASE-WORKBENCH.md`、`docs/research/CARD-DOMAIN-ROUND7-DATA.md`、Round8 产品/架构稿、`db/schema/index.ts`、`db/migrations/0000`--`0003` |
| 产品现状 | 真实数据库仍是年费 MVP；活动、权益、刷卡任务、积分、兑换和通用 Reminder 账本尚未进入 schema/migration |
| 允许修改范围 | 仅本文；不修改正式数据库文档、schema、迁移、代码、锁文件或其他角色文件 |

> 本文是实现前数据契约和迁移门槛，不代表新领域已经实现或可以部署。示例字段/SQL 是待架构和 DBA 签收的设计，必须在真实 PostgreSQL 15、影子库、并发和恢复演练后才能进入正式 migration。

## 1. 结论摘要

Round8 产品补充增加了报名截止与回执掩码、活动取消和规则版本影响、刷前支付路由确认与排除原因、权益预约改期/凭证轮换/周期实例、待入账积分/负余额、兑换现金部分/部分履约。这些不是展示字段，而是会改变唯一性、状态转换、账本守恒和提醒去重的事实。第七轮的 append-only、复合 ownership、`SpendMilestone`、`usage_model`、积分双差额、兑换四轴和 Reminder lease 仍是基线，本轮补足以下硬约束：

1. **现有年费表先修 ownership。** `fee_cycles`、`fee_events`、`progress_entries` 和 `reminders` 当前把 `user_id`、`card_id`、父对象分别外键到不同表，数据库允许“用户 A 的行引用用户 B 的卡/周期”。新领域上线前必须清理孤儿和跨用户行，增加父表复合唯一键，再以 `NOT VALID` 复合外键过渡并 `VALIDATE`。
2. **报名回执和规则取消必须有不可变事件。** `submitted`、`confirmed`、`cancelled` 等投影不能覆盖历史；回执只存掩码和不可逆 hash，重复提交使用参与实例范围内的业务幂等键。报名截止、活动取消和规则换版要停止未来动作，不删除历史消费或奖励。
3. **刷前路由是冻结快照，不是商户名称。** 未知路由、未知商户范围、币种不符或排除项必须有结构化 `reason_code`、证据和下一步；`snapshot` 与 `entries` 互斥由数据库事务/延迟触发器保证。退款/冲正只能通过同用户同卡同任务的反向事实守恒，不能直接改累计缓存。
4. **权益预约和核销分离。** 预约、改期、取消、凭证轮换、现场拒绝都保留时间线；只有 `consumable_quota` 的首次 `redeemed` 写 `consume`。周期实例、未知有效期、凭证版本和服务商变更不得被压成一个可编辑使用行。
5. **积分必须区分待入账、已入账、批次和负余额。** confirmed observation、ledger、lot allocation 和两个差额各自有水位/来源；未知批次不造 lot、不自动 FIFO、不生成到期或兑换承诺。负余额保留真实值并标记 `mismatch/needs_review`。
6. **兑换现金、履约和退分独立。** 现金部分和外部订单号掩码进入订单事实；部分履约使用行/事件表达，不能用一个 `fulfilled` 布尔值。只有已 posted debit 和外部退分证据才能追加等额或明确金额的 reversal，部分退分必须受累计上限约束。
7. **Reminder lease 是可恢复事实。** dedupe key 需包含对象版本/sequence，worker 用 `FOR UPDATE SKIP LOCKED` 租约；lease 过期重试同一 reminder/event，不创建新业务事实。未知有效期、未知批次和没有 `expected_on` 的奖励不生成到期提醒。

当前发布判断：**P0/P1 均阻断实现切换**。数据库目前没有新领域表、事件、outbox/inbox、RLS、复合外键、不可变触发器或恢复证据；只能继续年费 MVP 的读写。

## 2. 静态基线和已发现的现有风险

### 2.1 现有 schema/migration 证据

`db/migrations/0000_initial.sql` 只创建 `users`、`sessions`、`cards`、`fee_cycles`、`fee_events`、`progress_entries`、`reminder_rules`、`reminders` 和 `audit_logs`；`0001`--`0003` 只补用户删除字段和 worker 心跳。`db/schema/index.ts` 与 migration 一致，没有活动、权益、积分、兑换、来源快照、outbox/inbox 或 RLS 定义。

| 现状 | 证据 | Round8 风险 | 优先级 |
| --- | --- | --- | --- |
| 父子 ownership 只有单列 FK | `0000` 中 `fee_cycles.user_id -> users`、`card_id -> cards` 分开；`fee_events`/`progress_entries`/`reminders` 同样如此 | 可插入跨用户卡、周期、事件和提醒，跨用户读模型或账本污染 | P0 |
| `fee_cycles` 唯一键缺少 `user_id` | `unique(card_id, period_start, period_end)` | 迁移时无法以所有权安全区分相同外部实例；父子复合 FK 没有目标键 | P0 |
| 年费进度可变 | `progress_entries` 有 `updated_at`、`reversed_at`，没有 `business_key`、`request_hash`、sequence 或不可变触发器 | 旧编辑历史不能还原；不能证明重放、退款和重复提交只发生一次 | P0（迁移前） |
| reminder 仅有状态/时间 | 没有 `dedupe_key`、`trigger_at`、lease、attempt、dead-letter、对象版本 | worker 崩溃后重复投递或漏投；提醒与取消/换版无法去重 | P0 |
| reminder 父引用可级联删除 | `card_id`、`fee_event_id`、`fee_cycle_id` 均使用 `on delete cascade` | 归档/清理卡片会删除可审计的提醒历史；不符合“停止未来、保留历史” | P1，涉及上线前删除策略 |
| 币种只做三位大写检查 | `cards.currency`/金额字段使用 regex 和 `numeric(14,2)` | `ZZZ` 可写入，未来积分/多币种换算没有受控代码表 | P0（活动金额） |
| 用户时区只是 text | `users.timezone` 无 IANA 数据库校验；新任务尚未有冻结时区 | DST/跨日归属不确定，截止日和 Reminder 可能错一天 | P0 |
| 审计没有请求摘要和复合主体 | `audit_logs` 只有 `request_id`、metadata，未限制敏感值或绑定 owner | 无法证明幂等冲突、回执掩码、退分证据和跨账户拒绝 | P0 |

以上不是建议通过应用层补偿的弱项。新领域必须把复合 FK、唯一约束、append-only 写入口和 RLS 作为数据库边界；应用授权是第一层，不能替代数据库保护。

### 2.2 既有数据预检

第一条 Round8 migration 之前必须在只读影子库运行以下检查并留存结果：

```sql
-- 跨用户父子引用：每一类都应返回 0 行。
select fc.id
from fee_cycles fc join cards c on c.id = fc.card_id
where fc.user_id <> c.user_id;

select fe.id
from fee_events fe
join fee_cycles fc on fc.id = fe.fee_cycle_id
where fe.user_id <> fc.user_id or fe.card_id <> fc.card_id;

select pe.id
from progress_entries pe
join fee_cycles fc on fc.id = pe.fee_cycle_id
where pe.user_id <> fc.user_id or pe.card_id <> fc.card_id;

-- 旧累计行重复/异常；发现后只进入报告，不能自动合并。
select card_id, period_start, period_end, count(*)
from fee_cycles group by 1,2,3 having count(*) > 1;
```

清理必须有审计和人工确认。不能用 `delete` 合并年费事实；不确定的 owner、周期或进度在 adapter 中标 `needs_review`。

## 3. 通用数据契约

### 3.1 复合所有权和父子关系

所有父表提供 `unique(id, user_id)`；固定卡或固定账户的父表额外提供 `unique(id, user_id, card_id)`。子表重复保存 `user_id`、必要时 `card_id`，并使用复合 FK：

```text
(child.user_id, child.card_id) -> cards(user_id, id)
(child.user_id, child.parent_id) -> parent(user_id, id)
(child.user_id, child.parent_id, child.card_id)
  -> parent(user_id, id, card_id)
```

字段顺序可按实际 PostgreSQL 索引选择，但必须一致。固定卡 PointsAccount、固定卡 Redemption 和 BenefitUsage 的复合 FK 不得退化成只引用裸 UUID。跨卡联合活动不是默认允许；需要合并池时显式声明 `scope_type=merged_pool`，由约束触发器验证参与卡集合和账户所有权。

`on delete` 默认 `restrict`。业务事实不随卡归档、活动取消或规则换版删除；账户删除使用可重试的叶子到根清理流程，先撤销 worker/提醒，再处理对象存储和业务行，并写合规审计。

### 3.2 金额、积分、时间和证据

- 法币统一 `numeric(18,3)`（若首版只允许人民币可先用 `numeric(14,2)`，但必须在正式契约冻结精度），币种引用 `iso_4217_currencies(code)`，不能只用 regex。
- 积分/里程使用 `numeric(20,4)`；`points_accounts.points_scale` 限制 0--4，写入触发器校验 `round(delta, points_scale)=delta`。负余额合法，但必须进入 `mismatch/needs_review`。
- 发生日/入账日/到期日用 `date`；事件时间、回执时间、租约和外部同步时间用 `timestamptz`。
- 所有活动/任务/权益周期冻结 IANA `timezone`。`trigger_at`/计算出的 UTC 只作为执行值，本地截止日和原时区必须保留。数据库触发器使用 `pg_timezone_names` 或固定白名单校验，不能接受 `CST`/固定偏移。
- 原始来源、订单号、报名回执和凭证号默认不存明文。至少保留 `*_masked`、`*_hash`、来源快照、采集时间、证据等级和 `evidence_note`。hash 用于去重，不允许通过可逆方式恢复原值；密码、CVV、短信验证码和银行登录凭据禁止入库。

### 3.3 事实、投影、事件和幂等

事实表/事件表/账本表只追加；缓存表可以更新，但保存 `last_applied_sequence` 或 `row_version` 并可从事实零重建。每个写命令在同一事务写入事实、投影水位、审计和 outbox：

```text
business_key        -- 稳定业务事件键，按聚合范围唯一
request_hash        -- 规范化请求摘要（同 key 不同摘要必须 409）
idempotency_key     -- 客户端重试键，保存首次响应/错误摘要
expected_version    -- 乐观并发条件，冲突返回 409
```

同 key 同 hash 返回第一次响应，不增加事实、outbox、ledger 或 Reminder；同 key 异 hash 返回 `IDEMPOTENCY_KEY_REUSED` 并写审计。`request_hash` 不得包含未排序 JSON 或敏感原文，需在服务端规范化和脱敏后计算。需要跨轴幂等时使用轴专属 key，不能把整张 Redemption 的状态作为一个 key。

### 3.4 不可变触发器与受控写入口

规则版本、来源快照、参与事件、奖励事件、SpendEntry/Milestone、Benefit ledger、Points ledger/lot allocation、兑换轴事件和 Reminder delivery attempts 撤销普通应用角色的 `UPDATE/DELETE` 权限。通过固定 `search_path` 的 `security definer` 函数写入，函数内锁定聚合、验证 owner、分配 sequence 和追加审计。管理员纠错也必须追加 correction/reversal，不能临时直改余额、剩余次数或历史状态。

## 4. 活动报名、回执和规则版本影响

### 4.1 参与实例的键和字段缺口

`activity_participations` 的唯一范围固定为 `(user_id, campaign_id, card_id, activity_instance_key)`。需要补充或确认：

| 字段/约束 | 数据要求 |
| --- | --- |
| `activity_instance_key` | 创建后不可变；周期/批次/重复活动必须新建 key，不能覆盖上期；索引和所有子表均携带该 key 或通过参与实例复合 FK 引用 |
| `rule_id`、`rule_version_id` | 以 `(user_id, id, rule_id)` 复合 FK 同时指向 campaign/rule version；版本激活后不可修改 |
| `enrollment_deadline_at`、`deadline_timezone` | 截止时点以 UTC 执行、IANA 时区和本地口径同时保存；未知截止不创建“已逾期”事实 |
| `enrollment_status` 投影 | `not_started/submitted/confirmed/rejected/expired/cancelled/unknown/needs_review`；状态时间 (`submitted_at`、`confirmed_at`、`cancelled_at`) 与 actor 必须和状态相配 |
| 回执 | `receipt_masked` 长度上限、`receipt_hash`、`receipt_captured_at`、`receipt_evidence_status`；hash+provider 在参与实例范围内去重；不存完整短信/订单号 |
| `cancel_reason_code`、`cancelled_by` | 活动取消/规则撤回只停止未来行动和 Reminder，不能把历史 outcome/reward 删除或自动改为已获奖 |
| 版本影响 | 规则换版创建新 `rule_version`/实例或明确迁移动作；旧 participation 保留原版本。可选 `activity_rule_impact` 事件保存 diff 摘要、影响判定和用户确认，不允许静默覆盖 |

参与状态本身是缓存投影；建议从第一版创建 `activity_participation_events`：`sequence`、`event_type`、`business_key`、`request_hash`、`occurred_at`、`actor_type`、`evidence_snapshot_id`、脱敏 payload。唯一 `(participation_id, sequence)`、`(participation_id, business_key)` 和 `(participation_id, request_hash)`；`submitted` 事件必须有截止校验、回执掩码或明确无回执原因。

### 4.2 报名幂等和截止事务

报名命令先锁 participation，再验证当前 UTC 与冻结时区下的截止时点，最后以 `enrollment:{participation_id}:{attempt_key}` 写事件。相同客户端重试返回首次结果；同一外部回执 hash 不能在不同 attempt 下伪造两个 confirmed。截止后只允许记录外部结果/复盘，拒绝新提交并保留 `deadline_passed` 审计。报名失败、名额未分配或活动取消时，停止“继续刷卡” Reminder，但不删除已发生 SpendEntry。

### 4.3 奖励组件

`activity_rewards` 只是 projection；`activity_reward_events` 以 `(reward_id, sequence)`、`business_key`、`request_hash` 去重。奖励组件必须通过 `(user_id, participation_id)` 复合 FK 归属，不能从 `target_reached` 事件自动创建积分、权益或现金事实。每个组件独立记录 `expected_on`、`status`、`source_snapshot_id` 和 `evidence_note`；`expected_on` 未知时不得生成到期 Reminder。

## 5. 刷卡方式、任务事实和退款守恒

### 5.1 激活前路由确认

任务激活时冻结 `spend_method_snapshot`，至少含：`channel_type`、`merchant_scope`/`mcc_scope`、`region_scope`、`currency_scope`、`cutoff_basis`、规则版本、来源快照和 `route_confirmation_status`。`route_confirmation_status` 建议为 `unknown/confirmed/excluded/needs_review`：

- `unknown`、缺来源、币种未知或商户范围未知时允许保存计划，但禁止“确定计入”或自动激活消费提醒。
- `excluded` 必须有结构化 `reason_code`（例如 `channel_excluded`、`currency_mismatch`、`merchant_scope_unknown`）和 `evidence_note`；不能把商户名称当支付路由。
- 激活后快照不可原地编辑；规则/路由变化必须新建 task/instance，旧 entry 仍引用旧快照。

索引建议：`(user_id, card_id, lifecycle_status, window_end)`、`(task_id, snapshot_key)`、`(task_id, route_confirmation_status)`。同一 task 只允许一个激活快照版本，版本切换写事件并带 `expected_version`。

### 5.2 `snapshot` 与 `entries` 互斥

`spend_tasks.input_mode` 激活后不可变。`snapshot` 模式最多一条 `spend_task_snapshots` 事实，`entries` 模式不得写 snapshot；反向操作也拒绝。必须使用延迟约束触发器或模式专属 `security definer` 写入口处理并发，不能依赖 API 判断。

`spend_entries` 只写 occurred 事实，字段至少有：`business_key`、`entry_type`、`occurred_on`、原始时间/时区、金额/币种、method snapshot、evidence status、`qualification_status`、`reason_code`、`source_snapshot_id`。`included/pending/excluded/disputed/unknown` 的原因字段不能为空；排除项不能通过 PATCH 改成 included，只能追加新证据/重算事件。

`spend_milestones` 单独追加 `posted/settled/rejected`，唯一 `(entry_id, milestone_kind, business_key)` 并按 entry sequence 排序。数据库触发器保证 `settled` 之前存在同一 entry 的 `posted`；`rejected` 不删除 occurred。确定进度只能消费满足任务 `cutoff_basis` 且 `qualification_status=included` 的事实，预计进度可单独投影。

### 5.3 退款、冲正和跨卡保护

退款/冲正是新反向 `spend_entry`，`related_entry_id` 使用 `(user_id, task_id, card_id, id)` 复合 FK。写入时锁定原 entry 和 task，验证币种相同、反向 delta 不超过原始贡献的未冲销余额；部分退款允许多行，但累计绝对值不得超过原 entry。任何 reversal-of-reversal 也必须是显式新事实。task、participation、card 不一致、跨用户或跨卡引用一律拒绝。任务达标因退款回退时，同时更新投影、审计和 outbox `TargetNoLongerReached`，绝不自动写奖励退回/积分退分。

### 5.4 任务级幂等键

建议分别使用 `spend-entry:{task_id}:{business_key}`、`spend-milestone:{entry_id}:{milestone_kind}:{external_key}`、`spend-reversal:{entry_id}:{refund_key}`。`business_key` 不能只用金额/日期，导入来源不明时使用用户生成的稳定键并把 `evidence_status` 置为 `user_asserted`。同 key 异摘要必须保留冲突审计，不能静默合并两张消费。

## 6. 权益周期、预约改期和凭证轮换

### 6.1 发放实例和未知有效期

`benefit_entitlements` 需增加不可变 `period_instance_key`/`grant_key`，唯一 `(user_id, benefit_id, period_instance_key)`，并以 `(user_id, benefit_id, card_id, rule_id)` 复合 FK 归属。周期重置创建新 entitlement，不重置旧 ledger。`valid_to` 允许未知，但必须同时保存 `validity_status=known/unknown/needs_review`；未知时不得用自然年或默认天数补齐，也不得生成到期结论。

发放、额度、剩余值和 `last_entry_sequence` 是可重放投影。`benefit_entitlement_ledger` 的 `grant/consume/restore/expire/reversal` 以业务键唯一；只有 `usage_model=consumable_quota` 才允许 consume/restore/expire，非次数权益把 `coverage_claim`、`fee_credit`、`service_record` 存为独立结果，不写次数账本。

### 6.2 Usage 时间线和凭证

当前 usage 状态列不能承载改期/轮换历史。至少建立 `benefit_usage_events`（或等价 append-only 表），字段：`usage_id`、`sequence`、`event_type`（planned/booked/rescheduled/cancelled/presented/redeemed/rejected/disputed/credential_rotated/provider_changed）、`business_key`、`request_hash`、时间、服务商/地区、拒绝原因和证据快照。唯一 `(usage_id, sequence)`、`(usage_id, business_key)`。

凭证只存 `credential_masked`、`credential_hash`、`credential_version`、`issued_at`、`expires_at`、`rotation_reason`，新凭证追加版本，旧版本标过期但不删除。预约号同样掩码/hash；改期或取消不写 consume。现场拒绝、容量不足或地区不符保留 usage 和争议下一步，不能推断已经使用或自动恢复一个不存在的扣减。

`benefit_usages` 的 usage/entitlement/card/user 复合 FK 防止跨卡核销；请求幂等键至少为 `benefit-usage:{entitlement_id}:{client_request_key}`。首次 `redemption_status=redeemed` 在同一事务锁定 entitlement 并追加 consume；重复命中原响应；并发超额要么单个成功其余返回余额冲突，要么全部保留事实并转 `needs_review`，不得截断剩余值为 0。

## 7. 积分账户、待入账、负余额和批次

### 7.1 账户范围和观察余额

`points_accounts` 必须显式声明 `scope_type=fixed_card|merged_pool`、`card_id`（merged pool 可为空）、`unit_code`、`points_scale` 和状态。固定卡账户的 PointsEntry、Lot、Allocation、Redemption debit 均复合引用同一 user/card/account；merged pool 由 scope trigger 验证允许的卡集合，不得用 NULL 绕过 ownership。

官方余额观察单独存 `points_balance_observations`：`confirmed_balance`、`as_of`、来源快照、采集时区、freshness 和 hash。观察值不是账本事实；用户只知道总额时不创建 lot。不能把 `pending` 入账奖励混入 confirmed balance。

### 7.2 Ledger、pending 和负余额

`points_entries` append-only，账户内 sequence 在 `SELECT ... FOR UPDATE` 后分配。建议类型：`pending_earn`、`earn`、`adjustment`、`expire`、`redeem_debit`、`reversal`；每笔保存 `business_key`、`request_hash`、source snapshot、evidence status 和 `occurred_at/posted_at`。confirmed 余额只由已确认类型计算，待入账单独投影。

`ledger_balance = sum(points_delta)` 允许小于 0。`balance_status` 变为 `mismatch/needs_review` 时暂停自动兑换建议，但保留原始负值和下一步；不得 check `balance >= 0` 或在 UI/缓存层 `greatest(balance,0)`。跨账户/跨卡 debit、refund 和 transfer 在 P0 一律拒绝；P2 转移需独立双边守恒设计。

### 7.3 Lots、Allocation 和到期

`points_lots` 以 `(user_id, account_id, lot_key)` 唯一，保存 earn/expiry 来源、`expires_on`、`expiry_status=known/unknown/needs_review`、原始点数和 remaining 投影。`points_lot_allocations` 以 `(user_id, account_id, lot_id, ledger_entry_id, allocation_key)` 唯一，复合 FK 同时绑定 account/user；allocation 累计不能超过 lot quantity，ledger debit 消耗量不能超过分配总量。数据库过程锁定 lot 和 account 后检查守恒，不能仅靠 check 约束跨行 SUM。

保留两个差额及各自水位：

```text
reconciliation_difference = confirmed_balance - ledger_balance
unallocated_difference    = ledger_balance - lots_remaining_total
```

任一差额非零或来源过期，账户状态不得为 `balanced`。正差额不自动造 lot，负差额不自动补 adjustment；未知 expiry 不创建 `expire` 事实和到期 Reminder。P1 只允许用户指定顺序并确认 allocation，禁止自动 FIFO。

## 8. 兑换现金部分、部分履约和退分

### 8.1 四轴事实和金额

`redemptions` 保留 `order_status`、`fulfillment_status`、`points_debit_status`、`refund_status` 四个轴，不再把 `success` 当作唯一事实。订单字段至少包括 `provider_id`、`provider_order_ref_masked`、`provider_order_ref_hash`、`cash_amount`、`cash_currency`、规则/来源快照、适用账户/卡和不可取消说明。`(user_id, provider_id, provider_order_ref_hash)` 唯一；hash 缺失时订单只能是本地计划/待核对。

现金部分必须是非负 `numeric`，金额非 NULL 时币种必填并与兑换规则币种一致；现金支付成功不等于积分扣分成功。所需积分、现金金额、汇率和估值时点分别留存，不能覆盖原规则值。

### 8.2 部分履约和合作方异步结果

部分履约不能只改根表。建立 `redemption_fulfillment_items` 或 append-only fulfillment events，字段包括 item/line key、requested quantity、fulfilled quantity、rejected quantity、provider status、fulfilled_at、evidence snapshot 和 reason。约束为 fulfilled+rejected 不超过 requested；根轴是各行投影，订单已取消不能生成新的履约成功。合作方拒绝、超时、不可取消、争议均可独立 `needs_review`，不自动改变 points debit/refund。

### 8.3 Debit/refund 守恒和幂等

四个轴分别使用专属业务键，例如 `redemption:{id}:order-result`、`:fulfillment:{line_key}`、`:debit`、`:refund:{refund_key}`。debit 只在用户有官方扣分证据时写 `points_entries(type=redeem_debit)`，并以 `(user_id, redemption_id, account_id, card_id)` 复合 FK 绑定范围；fulfilled 不自动扣分，failed/cancelled 不自动退分。

refund 先追加 `pending_refund`/evidence 事实，再由受控函数锁定 redemption 和原 debit，验证 debit 已 `posted`、退款金额非负且累计退款不超过已扣金额，最后追加等额或明确部分金额的 `reversal`。refund 早于 debit、金额不符、跨账户或重复 refund 返回冲突并留审计。余额不足时仍保留真实负余额并把账户/兑换标 `needs_review`，不能截断或“补足”伪造余额。

## 9. Reminder lease、重试、死信和取消

### 9.1 对现有 reminders 的 expand 要求

现有 `reminders` 的 `scheduled_for/status` 和 fee/progress target 只能作为兼容读投影。canonical Reminder 至少补齐：

```text
reminder_type, owner_user_id, target_type, target_id,
target_version_or_sequence, trigger_at (UTC), timezone (IANA),
dedupe_key, delivery_status, lease_owner, lease_until,
attempt_count, next_attempt_at, last_error_code, dead_lettered_at,
dead_letter_reason, completed_at, cancelled_at
```

`unique(user_id, dedupe_key)` 是生成幂等边界；dedupe key 应包含对象类型、对象 id、版本/sequence、Reminder 类型和计划触发时点，不能只用标题。对已有 fee/progress unique index 做 adapter，不让同一对象同时生成旧键和新键两条提醒。业务对象取消、报名失败、任务结束或卡归档只取消未来未发送的 Reminder，delivery attempt 历史保留；不要用 `ON DELETE CASCADE` 删除历史。

### 9.2 Worker 事务和恢复

领取使用 `FOR UPDATE SKIP LOCKED`，在同一事务设置 `lease_owner/lease_until` 并递增 attempt；发送回执和状态更新必须用 reminder id + lease token 条件更新，过期租约不能覆盖新 worker。失败按已冻结退避策略更新 `next_attempt_at/last_error_code`，达到上限进入 dead-letter；重放复用原 reminder/event id，不创建新的业务事件。所有投递尝试另存 append-only `reminder_delivery_attempts`，按 `(reminder_id, attempt_no)` 唯一。

只有明确日期（活动截止、任务截止、奖励 expected_on、已知权益到期、明确积分 lot 到期）才能生成 reminder。未知有效期、未知 lot、未确认奖励、unknown 路由不生成到期结论，只能生成“补证/复核”行动，并设置可取消的 dedupe key。

## 10. Expand/contract 迁移顺序

未来 migration 必须拆分，禁止把草案整份一次性执行。每阶段记录 migration version、备份时间点、行数/hash、水位、错误计数和可回滚动作。

### Stage 0：预检和安全基线（阻断）

1. 确认 PostgreSQL 15+、`pgcrypto`/`citext`/（如采用排斥约束）`btree_gist` 权限，定义应用、worker、迁移和只读审计角色；冻结 RPO/RTO、备份保留期、对象存储区域、删除等待期和 Reminder lease/重试参数。
2. 运行第 2.2 节孤儿、跨用户、重复周期和异常金额检查；把结果存入迁移报告。没有清零或人工签收不得继续。
3. 对 `cards`、`fee_cycles`、`fee_events`、`progress_entries`、`reminders` 增加父表复合唯一索引（先 `CONCURRENTLY`），用 `NOT VALID` 复合 FK 过渡；验证通过后再 `VALIDATE CONSTRAINT`。不能在有重复/跨 owner 数据时强行 `USING` 重写。
4. 先建立加密全量备份 + WAL/PITR 恢复点，并在隔离库恢复一次；记录表计数、关键 hash、`sum(progress)`、Reminder 计数和权限快照。

### Stage 1：横切基础表

建立 `iso_4217_currencies`、`source_references`、不可变 `source_snapshots`、`request_idempotencies`、`outbox_events`、`inbox_consumptions` 和扩展审计。增加 RLS policies、应用/worker role grant 和 append-only trigger；对敏感字段做 secret scanner/长度/掩码检查。源快照先于规则/活动，避免活动行引用不存在证据。

### Stage 2：活动、参与和奖励

先建 `rules/rule_versions/campaigns/activity_participations` 及事件表，再建 `activity_rewards/activity_reward_events`。回填只保留来源可证明的规则；未知资格、报名和名额都落 `unknown/needs_review`。shadow replay 必须验证四元实例唯一、报名重复不重复事件、取消/换版不覆盖历史。

### Stage 3：刷卡任务和里程碑

建立 spend method/template、task、snapshot/entries、milestones 和投影。先以 compatibility adapter 读取旧年费 progress，再回填 `business_key`、evidence status 和规则版本；`snapshot/entries` 互斥触发器与并发测试通过后才允许新写。验证 occurred/posted/settled/rejected、路由未知、排除原因、部分退款和负进度重放。

### Stage 4：权益

建立 benefit/rule version、entitlement period、usage events、credential versions 和 quota ledger。旧记录缺少 usage model 或有效期时不猜测，使用 `unknown/needs_review`；回放 grant/consume/restore 守恒，预约改期/拒绝/凭证轮换不得改变额度。

### Stage 5：积分和批次

先建 PointsAccount、entry sequence、observation 和双差额，再建 lots/allocation。用户只提供余额的旧记录只回填 observation/reconciliation adjustment，不创建 earn lot。shadow replay 对 pending/confirmed、负余额、未分配差额、未知 expiry 和并发 debit 做校验。

### Stage 6：兑换

在积分账本验证后建立 Redemption 四轴、cash fields、fulfillment items、debit/refund links。冻结旧兑换 worker/写入口，逐单对账外部 order/debit/refund；先让新表只读投影，再开启受控手工写。部分履约、现金部分和退款累计恒等式必须通过后才开 P1-b。

### Stage 7：Reminder expand

把旧 fee/progress reminder 通过 dedupe adapter 映射到 canonical target/version；新增 lease、attempt、dead-letter 和 delivery attempt。先 shadow 生成并比对数量/键，再切 worker。未知日期不生成提醒，旧 `on delete cascade` 需改为取消投影而不是删事实。

### Stage 8：切换和 contract

1. 对 canonical 事实执行双读/影子重放，所有差异分类为数据问题、规则未知或投影延迟；不能自动把差异修成零。
2. 关闭旧写入口，等待一个完整保留窗口，监测旧 API 调用数为零、outbox/inbox lag、duplicate key、RLS deny、账本差额、Reminder dead-letter 和恢复演练。
3. 只允许关闭 feature flag、停止 consumer、切读路由或重放 canonical 作为回滚；不能恢复旧表与新表双向写。确认备份/PITR 和删除路径后才删除兼容写权限/旧约束。事实表业务键和历史证据不 contract 删除。

## 11. 旧年费 adapter、回放与删除

### 11.1 年费映射

旧 `fee_cycles`/`progress_entries` 只能作为历史输入，不是新 SpendTask 的确定入账事实：

| 旧数据 | canonical 读映射 | 不得推导 |
| --- | --- | --- |
| `fee_cycle` | `SpendTask`，`activity_instance_key=legacy:fee_cycle:{id}`，规则文本/周期日期冻结；`status=qualified` 映射 `target_reached + qualification=unconfirmed` | 银行 posted/settled、官方资格 |
| `progress_entry` | 一条 legacy occurred entry，`business_key=legacy:progress_entry:{id}`，`evidence_status=user_asserted`；若有 `reversed_at` 追加 reversal | 原编辑前版本、交易明细、支付路由 |
| 旧累计行无法区分修改前值 | 当前快照 + `needs_review`/reconciliation adjustment，保留 `created_at/updated_at` 和审计 | 虚构中间事件或自动标为 included |
| `fee_event` | 继续由年费 projection 读取；如接入奖励/权益只能创建明确来源的独立事实 | 自动生成积分、权益或活动奖励 |

adapter 单向 `legacy -> canonical`。canonical 开写后旧 API 只读投影，重复 backfill 命中稳定业务键；不允许旧表和新表双写、互相修复或物理删除旧事实。对 `progress_entries` 的 `count_delta/amount_delta` 重放必须与旧 read model 一致，差异进入报告。

### 11.2 删除、归档和恢复

卡归档、活动取消、规则过期只停止新命令/未来 Reminder，不删除 participation、entry、ledger、兑换或来源证据。用户删除采用可重试清单：撤销 sessions/worker leases -> 取消未来提醒 -> 删除/脱敏对象存储 -> 删除业务叶子事实 -> 最后处理用户/审计标识；每步有 idempotency key、retry count、审计摘要和 dead-letter。备份中的数据在保留期内不能选择性回写在线库，恢复后必须重跑 owner/RLS/账本检查。

## 12. RLS、观测和备份恢复

### 12.1 RLS/权限

- Web 事务通过 `set local app.user_id`，RLS policy 以 `user_id = current_setting('app.user_id')::uuid` 且与复合 owner 关系共同限制；缺少上下文默认拒绝。
- worker 使用最小 role，只能领取自己的 Reminder、写 delivery attempt/outbox 和调用受控函数，不能直接写 Points/Benefit/Redemption 事实。
- 管理员/迁移角色必须显式审计，不能把 `BYPASSRLS` 作为普通应用连接串；跨用户 IDOR、跨卡固定账户和 merged pool scope 都有数据库测试。
- 金融事实写入前后审计 actor、request/correlation id、对象和状态摘要；metadata 经过敏感字段 allowlist，禁止完整卡号、凭证原文、订单原号、请求体。

### 12.2 运行观测门槛

P0/P1 发布前至少建立：`outbox_lag`、`inbox_duplicate/conflict`、ledger replay mismatch、`confirmed-ledger`/`ledger-lots` 两差额、negative points、benefit overdraw、cross-owner FK violation、Reminder lease expiry/retry/dead-letter、旧 API 写调用、RLS deny、projection stale 和 adapter backfill error。告警必须按 user/account/card 脱敏聚合，不能把完整业务键写日志。

### 12.3 备份恢复验收

生产需要加密全量备份 + WAL/PITR，跨故障域保存；RPO/RTO 数值未由产品/运维签字前不能宣称满足灾备。至少季度恢复到隔离环境，校验：migration/schema 版本、用户/卡/参与实例计数、任务从 entries 重放、权益 grant/consume/restore 恒等式、`sum(points_entries)`、两差额、lot allocation 上限、兑换 debit/refund link、Reminder lease/dead-letter、对象 hash、RLS policy 和权限。PITR 后必须重放恢复点之后已获外部确认的 debit/refund/取消事件，避免恢复成功但重复扣分。

## 13. P0/P1 数据验收与明确阻断项

### 13.1 P0 验收

1. **所有权**：构造用户 A 的 task/participation/card 和用户 B 的子行，复合 FK、RLS、API 三层均拒绝；旧 MVP 跨用户行在 Stage 0 清零或人工签收。
2. **报名截止/幂等**：截止前同 key 重试仅一条事件；截止后新提交返回业务冲突；相同回执 hash 不产生第二 confirmed；掩码/哈希扫描无敏感原文。
3. **取消/换版**：v1 participation 和消费在 v2 生效后仍引用 v1；取消只停止未来 Reminder，新建事件不删历史奖励/entry。
4. **刷前路由**：route unknown/merchant unknown/currency mismatch 阻止确定计入；excluded/pending/disputed 必须有 reason/evidence/next action。
5. **snapshot/entries**：并发写入只允许模式规定的一种事实；激活后修改 input mode 或 method snapshot 被拒绝；缓存可从零重放。
6. **里程碑/退款**：settled 无 posted 被拒；部分退款累计不超过原贡献；跨卡/跨任务 reversal 被拒；重复 refund 只返回首次结果，任务达标回退不自动退分。
7. **Reminder**：同 dedupe key 并发生成一条；lease 过期重试同 reminder/event；attempt 达上限进入 dead-letter；unknown 日期不生成到期提醒。
8. **回放/备份**：乱序、重复事件、consumer 宕机和 PITR 后任务、outbox/inbox、提醒和审计水位可重建且不重复业务事实。

### 13.2 P1-a/P1-b 验收

1. **权益**：预约、取消、改期、凭证轮换、服务商拒绝不扣次数；首次 redeemed 只扣一次；restore 必须关联 consume；周期实例独立；未知 valid_to 不生成 expire。
2. **积分**：pending 不进入 confirmed；账户可保留负余额；并发 sequence 连续唯一；lot allocation 不超过 lot；两个差额分别正确；未知 expiry 不自动 lot/expire/FIFO。
3. **兑换**：现金金额/币种约束正确；履约行允许部分完成但总量不超请求；order/fulfillment/debit/refund 轴可乱序而不互相伪造；只有 posted debit + 官方证据允许退款，部分退款累计不超 debit。
4. **恢复/安全**：归档卡、账户删除、恢复和跨用户 IDOR 不泄漏或删除应保留事实；RLS、append-only 权限和 secret scanner 通过。

### 13.3 发布阻断项（必须主会话确认）

- 新领域正式 DDL/migration 尚不存在，不能把研究稿或原型当可部署能力。
- 现有 MVP 复合 ownership、RLS、幂等、append-only 和 Reminder lease 尚未实施/验证。
- 旧 `progress_entries` 可变且缺失编辑前历史，无法无损还原的行必须进入 `needs_review`，不能自动补齐 posted 或奖励。
- `btree_gist`、ISO 4217 代码表、IANA 时区校验、应用/worker role 和 `set local app.user_id` 尚未冻结。
- Reminder lease 时长、退避/死信保留期、projection stale 阈值、RPO/RTO、备份保留期和删除等待期未由产品/运维签字。
- 多卡联合活动、跨账户积分转移、自动 lot、系统内 reservation、外部库存/银行 connector 和部分复杂退分不属于 P0；没有双边守恒和独立状态机不得开启。

## 14. 剩余风险和未决问题

1. `activity_instance_key` 的用户可见格式、生成责任和规则版本影响算法仍需产品/架构/DBA 共同签收；不能由 period date 猜测。
2. 报名回执 hash 的 hash 算法、跨 provider 复用策略和掩码规则需安全角色确认；同一外部号是否允许跨活动出现不能只靠全局唯一。
3. 交易金额精度、多币种/汇率和积分单位的最终范围未冻结；在冻结前不能逐表选择不同精度。
4. 预约改期是否保留原预约号、凭证轮换的 provider 责任、周期跨年和 unknown valid_to 的用户行动尚需产品验收。
5. 部分履约对应的积分扣减/部分退分时序需产品明确“按行”还是“按订单”；本稿只提供守恒边界，不替代业务选择。
6. Reminder worker 的租约时长、发送方幂等能力和 dead-letter 人工处理 SLA 未冻结；没有这些参数不能做生产容量承诺。
7. 真实 PostgreSQL、RLS、并发、回放、迁移回滚、PITR、对象存储和删除演练尚未运行。

## 15. Handoff

- **Changed files**：`docs/research/CARD-DOMAIN-ROUND8-DATA.md`。
- **Key decisions**：补齐现有年费表的复合 ownership 前置；报名回执掩码/截止/取消与规则版本事件不可变；刷前支付路由快照、排除原因、snapshot/entries 互斥和退款守恒；权益周期/预约/凭证版本与 quota ledger 分离；积分 pending/confirmed/negative/lots 双差额；兑换现金/部分履约/四轴及部分退分上限；Reminder dedupe/lease/attempt/dead-letter；expand/contract、旧年费单向 adapter、RLS 和 PITR 门槛。
- **Validation**：静态检查 `db/schema/index.ts`、`db/migrations/0000_initial.sql`--`0003`、`docs/DATABASE-WORKBENCH.md`、Round7 DBA 稿及 Round8 产品/架构稿；未运行真实 PostgreSQL migration、worker、RLS、并发或恢复演练。创建本文后执行 `git diff --check -- docs/research/CARD-DOMAIN-ROUND8-DATA.md`。
- **Risks/open questions**：实例键和回执 hash 规范、旧进度编辑历史、金额/积分精度、权益周期和凭证责任、部分履约/退分时序、Reminder lease/死信参数、RPO/RTO/删除等待期、多卡联合与跨账户边界仍需签收。
- **Ready for integration**：yes。本文可作为主会话整合 Round8 正式数据库契约的输入；不修改正式文档、schema、迁移、代码或锁文件。
