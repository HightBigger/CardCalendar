# Cardfolio 卡功能扩展第十轮 DBA 数据与恢复约束核验

| 项目 | 内容 |
| --- | --- |
| 文档版本 | v0.1 |
| 复核日期 | 2026-08-15 |
| 角色 | DBA｜Cardfolio｜扩展账本与查询约束核验 |
| 输入 | `docs/DATABASE-WORKBENCH.md`、`docs/PRD-WORKBENCH.md`、`docs/research/CARD-DOMAIN-ROUND8-DATA.md`、`docs/research/CARD-DOMAIN-ROUND9-DATA.md`、当前 `db/schema` 与 migrations |
| 产品现状 | 真实数据库和代码仍是年费 MVP；活动、权益、刷卡任务、积分和兑换没有正式表、migration、worker 或新领域 E2E |
| 交付性质 | report-only；不修改正式数据库/PRD/架构文档、schema、migration、代码或锁文件，不 commit/push |

> 本文是 Round10 的增量数据核验。Round8/9 已冻结的状态、四元 participation、SpendEntry/Milestone、权益 usage model、积分双差额、兑换四轴、UTC/IANA、复合 ownership、append-only 和旧年费 adapter 继续有效；本轮只补足其在 schema、投影重建、迁移和恢复中容易被错误实现的约束。

## 1. 结论与增量阻断

当前正式数据库文档已经覆盖大部分事实表、账本和触发器，但仍有五类必须在 Gate 0/1 前冻结的实现问题：

1. **canonical/legacy 写入围栏不够具体。** `CardActivity`、`ActivityEnrollment`、旧 `/spend-task-entries`、`pending/success/fulfilled` 等名称仍可能被新 migration 或 API 当作事实表。必须建立 canonical-only 写权限和兼容 view/read adapter，写入旧路径在 contract 阶段明确拒绝。
2. **scope 需要落到跨域复合键。** 仅有 `user_id` 不能阻止同一用户的卡、活动周期、权益周期、积分账户或 Redemption 串账；固定卡/合并池、多卡活动、reward 到 points/benefit 的关联都需要 `user_id + card_id + account_id + instance_key` 的同序复合 FK/trigger。
3. **投影水位和 backfill fence 没有统一字段。** append-only 事实有 sequence，但 dashboard、quota、points、lot、redemption 和 Reminder 需要 `projection_name/source_sequence/rebuild_run_id/status`；旧年费 adapter 需要 `backfill_run_id/source_hash/mapping_status`，否则 PITR、乱序事件和重复回填无法证明只生效一次。
4. **精度和日期区间仍有正式文档漂移。** DATABASE-WORKBENCH 使用 `numeric(14,2)`，Round9 DBA 允许未来 `numeric(18,3)`；RuleVersion 既有 inclusive `daterange '[]'`，又有半开 `[from,to)`建议。必须在第一条 migration 前统一，否则跨表金额和边界日期会出现不可逆差异。
5. **恢复和删除路径未形成可运行门槛。** 需要证明 migration、RLS、projection、ledger、Reminder lease、外部 debit/refund 在 PITR 后可重放且不重复；不能用 `ON DELETE CASCADE` 删除可审计事实，也不能用空 projection 覆盖旧值。

没有真实 PostgreSQL 15、复合 FK/RLS、并发、shadow replay、PITR 和删除恢复证据时，P0/P1 均为规划/阻断；当前仅年费 MVP 可部署。

## 2. 事实、事件、投影分层核验

### 2.1 Canonical 表与兼容读取

| 领域 | Canonical 事实/事件 | 只读兼容名称 | 新写入禁止项 |
| --- | --- | --- | --- |
| 活动 | `Campaign`、`ActivityParticipation`/events、`ActivityReward`/events | `CardActivity`、`ActivityEnrollment` | 不建立第二套活动/报名表；CardActivity 只能 view/read model |
| 刷卡 | `SpendTask`、`SpendEntry`、`SpendMilestone` | 旧 `SpendEntry.posted_on/settled_on` 投影、`/spend-task-entries` | 旧 task-entry 路由只读兼容并返回 deprecation；不能写第二事实源 |
| 权益 | `BenefitEntitlement`、period、`BenefitUsage`/events、quota ledger | 旧 `BenefitUsage.redemption_status=redeemed` 读映射 | 新写 canonical `used -> consume`；非次数权益不得写 quota consume |
| 积分 | `PointsAccount`、observation、`PointsEntry`、`PointsLot`、Allocation | 旧 balance/ledger 简化字段 | 客户端不得写 balance；pending/confirmed、lot/差额不合并 |
| 兑换 | order/fulfillment/debit/refund 四轴 events、fulfillment lines、ledger links | `success/fulfilled/debited/refunded` 旧投影 | 不用单一 status 或 `ON CONFLICT DO NOTHING` 吞同键异 payload |
| 提醒 | canonical Reminder、DeliveryAttempt、outbox/inbox | 旧 fee/progress reminders | 旧 key 通过 adapter；不删除发送尝试或业务事实 |

每个兼容映射必须保存 `legacy_source`、`legacy_id`、`backfill_run_id`、原始 row hash、`mapping_status` 和 `error_code`。相同 source hash 重放原目标；不同 hash 不覆盖目标，进入 conflict queue。canonical 写启用后，旧 API 只能读取 projection，数据库权限和 API route 都必须拒绝旧写。

### 2.2 统一投影水位

新增 `projection_checkpoints`（或各域等价表）至少保存：

```text
projection_name, aggregate_type, aggregate_id,
source_sequence, source_watermark, rebuild_run_id,
status (current|stale|rebuilding|failed), rebuilt_at,
last_error_code, attempt_count, created_at, updated_at
```

约束和行为：

- `(projection_name, aggregate_id, source_sequence)` 唯一且水位只能前进；旧事件只能记为 late event，不能覆盖新投影。
- rebuild 先锁定 `source_watermark`，在隔离表/临时 schema 计算并校验 hash/恒等式，成功后原子切换 `rebuild_run_id`；失败保留旧 projection 并标 `failed`，不得将空表发布为 0。
- Dashboard 响应必须带 `as_of/source_sequence/stale/rebuilding`；最终一致不允许用默认值伪装实时余额/进度。
- backfill 与 projection rebuild 不得同时写同一 canonical 聚合；以 `backfill_fence`/feature flag 防止双写。

## 3. 跨域 ownership、scope 与核心约束

### 3.1 三层 ownership

所有写命令必须同时通过：

1. application port 从会话/job context 派生 `user_id`，拒绝请求体 owner；
2. RLS 使用 `set local app.user_id`，缺少上下文默认拒绝，worker 使用最小 role；
3. PostgreSQL 复合 FK/trigger 校验 user/card/account/instance scope。

三层任一缺失均为 P0 阻断。子表不能只持裸 UUID；固定卡、固定账户和同活动周期必须重复并约束对应 scope 字段。默认 `ON DELETE RESTRICT`，只有账户删除清理 job 可按叶子到根执行。

### 3.2 各域最小复合键

| 对象 | 必须可引用的复合键 | 必须拒绝的关系 |
| --- | --- | --- |
| Rule/Source | `(user_id, rule_id, version_id, source_snapshot_id)` | 引用他人规则/来源、无 primary citation、已离开 draft 的版本被原地改写 |
| Participation | `(user_id, campaign_id, card_id, activity_instance_key)` | 同卡不同周期合并、不同卡复用 outcome/reward、rule_id 与 campaign 不一致 |
| SpendTask/Entry/Milestone | `(user_id, card_id, task_id, activity_instance_key)` | entry/milestone 引到另一 task/card/participation；跨卡 reversal |
| Entitlement/Usage | `(user_id, card_id, entitlement_id, period_instance_key)` | usage 核销另一周期，restore 另一 entitlement/usage |
| PointsAccount/Lot/Allocation | `(user_id, account_id, scope_type, card_id)` | fixed_card 空 card、merged_pool 任意挂卡、跨账户 lot allocation |
| Redemption/Debit/Refund | `(user_id, redemption_id, account_id, card_id)` | order 属于 A 账户但 debit/refund 写 B 账户；固定卡与另一卡串账 |
| Reminder/Outbox/Inbox | `(owner_user_id, target_type, target_id, target_version_or_sequence)` | 旧版本提醒作用于新版本、跨用户 event 被 consumer 应用 |

### 3.3 CHECK/UNIQUE/FK/trigger 重点

- RuleVersion：`version_no > 0`、IANA timezone、统一日期区间策略、active interval 不重叠、至少一个 primary citation；已激活/已引用版本和 SourceSnapshot 禁止 update/delete。
- Activity：四元 participation unique；`activity_instance_key` immutable；报名 confirmed 必须有 verified timestamp/actor；receipt masked/hash 有长度、provider scope 和 evidence status；reward 事件 sequence/business key/request hash 唯一。
- Spend：task 激活后 `input_mode`/method snapshot immutable；snapshot/entries 互斥由 deferred trigger/受控函数强制；`settled` 必须先有 `posted`；entry/milestone sequence 正值且唯一；included/excluded/pending/disputed/unknown 必须有 reason/evidence/next action；reversal 累计不超过原贡献。
- Benefit：`period_instance_key`/`grant_key` unique；unknown `valid_to` 不能 expire；只有 consumable quota 的首次 used/redeemed 写 consume；restore 必须引用既有 consume 且累计不超过原 consume；预约/拒绝/争议不扣额度。
- Points：`points_scale between 0 and 4`、unit_code 继承 account；pending 不进入 confirmed；账户 scope 首条 ledger 后 immutable；两个差额独立；allocation 总量不超 lot/origin/debit；负余额合法但必须 mismatch/needs_review。
- Redemption：四轴状态和专属业务键；现金非负且金额有币种；required_points 与 actual_debit_points 分开；fulfillment line 的 fulfilled+rejected+cancelled 不超 requested；refund 只能绑定 posted debit，累计不超 debit，部分 refund 每条有 refund key。
- Reminder：dedupe key 含 target/version/sequence/type/trigger；`unique(user_id,dedupe_key)`；lease token 条件更新，delivery attempt `(reminder_id,attempt_no)` unique；unknown 日期不生成确定性到期提醒。

## 4. 精度、时区与 RuleVersion 边界

### 4.1 金额和积分精度决策

正式文档存在 `numeric(14,2)` 与未来 `numeric(18,3)` 两套说法。建议 Gate 0 冻结：

- P0 仅人民币金额采用 `numeric(14,2)`；若 P1 支持三位小数币种，必须在所有金额列一次性迁移至 `numeric(18,3)`，不得逐表扩展。
- 所有金额列引用 `iso_4217_currencies(code)`，不接受仅正则；汇率换算保存原/目标金额、币种、`numeric(20,10)` rate、估值时点和 source snapshot。
- 积分/里程统一 `numeric(20,4)` + `points_scale`，数据库触发器验证 `round(delta,points_scale)=delta`；客户端不得另传 unit 或 balance。
- 次数使用 integer，正负方向只用 delta 符号表达，不同时保存 direction 形成两套真相。

### 4.2 日期区间策略

RuleVersion、活动、任务、权益周期和积分到期必须明确一种策略：推荐业务窗口使用 inclusive `date`（`window_start <= date <= window_end`），RuleVersion 生效区间使用半开 `[effective_from,effective_to)`；数据库 `daterange` 和 API 展示都按该策略转换。禁止同时以 `[]` 和 `[)` 作为同一实体的含义。

所有事件时间/回执/lease 使用 `timestamptz`；银行发生/入账/清算/到期和业务窗口使用 `date`。对象冻结 IANA timezone；UTC trigger 是执行值，local_date 是按冻结 timezone 固化的解释。改用户默认时区只重排未来提醒，不修改历史事实、task window 或 rule version。

## 5. Expand/contract 迁移、adapter 与恢复

### Stage 0：预检与安全基线（P0 阻断）

1. 固定 PostgreSQL 15+、pgcrypto/citext/btree_gist（或等价 trigger）、应用/worker/迁移/只读审计 role、RPO/RTO、lease/backoff/dead-letter、projection stale 阈值和删除等待期。
2. 扫描现有 `fee_cycles`、`fee_events`、`progress_entries`、`reminders` 的跨 user/card/cycle 引用、重复周期、金额/币种/timezone 异常；输出 orphan report、计数/hash、审计摘要和人工签收。
3. 父表先建复合 unique index，再以 `NOT VALID` 复合 FK 过渡并离峰 `VALIDATE`；孤儿不得 cascade delete。旧可变 progress 无法还原的行标 `needs_review`。
4. 建立加密全量备份 + WAL/PITR 恢复点，隔离库恢复并记录 migration/schema 版本、权限/RLS 快照、`sum(progress)` 和提醒计数。

### Stage 1：基础设施

建立 ISO currency、IANA timezone 校验、SourceReference/Snapshot、Rule/RuleVersion/Citation、idempotency registry、outbox/inbox、projection checkpoints、audit allowlist 和 append-only functions。RLS deny-by-default 先在 shadow 环境启用，验证后才切新写。

### Stage 2：P0 活动、任务和 Reminder

先建 canonical Campaign/Participation/Reward events、SpendTask/MethodSnapshot/Entry/Milestone、canonical Reminder/DeliveryAttempt；旧年费仅走单向 adapter。以 `backfill_run_id/source_hash` 记录映射，shadow replay 对比旧 read model；P1 表继续 feature flag 关闭。

### Stage 3：P1-a 权益

建立 Benefit/Entitlement period、Usage events/credential versions、quota ledger 和 projection。周期/validity/usage model 不确定时写 unknown/needs_review；通过 grant/consume/restore、并发超额、删除恢复和凭证脱敏后才切写。

### Stage 4：P1-b 积分

建立 PointsAccount scope、observation、PointsEntry sequence、Lots/Allocation/reconciliation。旧总余额只回填 observation + adjustment link，不造 earn lot；先 shadow replay 双差额、负余额、allocation 守恒，再开启用户确认 allocation/expiry。

### Stage 5：P1-b 兑换

建立 Redemption 四轴、fulfillment items、cash、debit/refund links；冻结旧 worker/写入口，先只读 shadow 对账。debit/refund consumer 用轴专属业务键和 inbox 去重，部分履约/退分累计通过后才开放手工写。

### Stage 6：切换、观察和 contract

关闭旧写路径，等待完整观察窗口；监测旧 API writes、duplicate/conflict、outbox/inbox lag、projection mismatch/stale、negative points、benefit overdraw/restore conflict、Reminder dead-letter、RLS deny 和 adapter conflicts。回滚只能关 flag、停 consumer、切 read route 或重放 canonical，不能恢复双写。

### 年费 adapter 与投影恢复

旧 `fee_cycle` 映射为 `SpendTask(task_type=annual_fee, legacy_source=fee_cycle)`；`qualified` 只读映射 `target_reached + qualification=unconfirmed`。每个 `progress_entry` 使用稳定 `legacy:progress_entry:{id}`，无法还原编辑前历史的行标 `needs_review`。旧 API 在 canonical 写启用后只读 projection。

投影重建在隔离表固定 source watermark，校验任务进度、权益 quota、积分/lot 两差额、兑换 links、Reminder index 后原子切换；PITR 后重放恢复点之后已确认的 debit/refund/cancel，命中原业务键，不重复事实。

### 删除与恢复门槛

- 卡归档、活动取消、规则换版和账户关闭停止未来动作但不物理删除事实；普通外键默认 `RESTRICT`。
- 用户删除按 registry 从 sessions/lease -> future reminders -> object storage -> 业务叶子 -> 用户标识顺序，步骤有幂等键、retry/dead-letter 和合规审计；禁止级联删除 reward/ledger/usage/order/source evidence。
- 恢复后重新执行 owner/RLS、事实计数/hash、ledger/lot/quota/redeem 恒等式、Reminder lease 和 object hash；备份保留期内不允许选择性回灌旧数据覆盖在线事实。

## 6. 数据库验收清单（Round10）

以下 16 条必须使用真实 PostgreSQL（迁移后）和受控函数/API；mock 不能代替约束或并发证据。

| 编号 | 验收场景 | 预期与证据 |
| --- | --- | --- |
| D-01 | canonical/legacy 写围栏 | 新 migration/API 向旧 CardActivity、旧 task-entry、旧 success/pending 字段写入被拒；兼容 view 可读且有 `legacy_source/backfill_run_id`；deprecation 事件可审计。 |
| D-02 | 活动四元唯一与 scope | 并发创建同 `(user,campaign,card,instance_key)` 仅一条；不同卡/周期不串 outcome/reward/task；跨 user/rule/source/非 active version 复合 FK/RLS/API 均拒绝。 |
| D-03 | RuleVersion 区间与 citation | 无 primary citation、时区/日期非法、active 区间重叠、已激活 version 原地更新均失败；锁 rule 并发激活分配连续 version_no。 |
| D-04 | 报名 deadline/receipt 幂等 | deadline 前同 key 重试一条事件；deadline 后新提交冲突；同 provider receipt hash 不生成第二 confirmed；masked/hash 约束和审计通过。 |
| D-05 | P0 task scope 与快照 | 激活后 input_mode/method/rule/timezone 不可改；跨卡 task/participation/method snapshot 失败；route unknown 只能保存计划。 |
| D-06 | snapshot/entries 并发互斥 | 两事务同时写 snapshot/entry 时只有激活模式允许的一种事实；deferred trigger/受控函数回滚另一事务；缓存水位无双算。 |
| D-07 | Milestone 顺序和日期 | settled 无 posted、日期逆序、重复 milestone key 均失败；posted/settled/rejected append-only，乱序 event 不改变已确认投影。 |
| D-08 | 部分退款/冲正守恒 | 同卡同 task 的多次部分 refund 累计不超过原贡献；跨 user/card/task、第二条相同 reversal、金额/币种不精确失败；回退写 audit/outbox。 |
| D-09 | 权益预约/拒绝/consume | booked/rescheduled/cancelled/rejected/disputed 不扣额度；首次 used 只一条 consume；并发核销只能一成功或显式 needs_review；restore 必须引用未全额 restore 的 consume。 |
| D-10 | 权益周期/凭证 | `(user,benefit,period_instance_key)` 唯一；unknown valid_to 不 expire；credential rotation 追加版本且旧凭证不可恢复为当前，跨周期 usage/restore 复合 FK 失败。 |
| D-11 | 积分精度/负余额 | 超 `points_scale`、错 unit、非法币种失败；ledger 可为负并标 mismatch/needs_review；UI/cache 不执行 `greatest(0)`；sequence 并发连续唯一。 |
| D-12 | 积分 lot/双差额 | allocation 不超 lot/origin/debit，跨账户/跨卡失败；pending 不进 confirmed；两差额可从 observation/ledger/lots 重建，正差额不造 lot、未知 expiry 不造 expire/reminder。 |
| D-13 | Redemption scope/现金 | 固定卡 Redemption 必须同卡，merged pool 只能显式 scope；cash 非负且有币种；required_points 与 actual_debit_points 差异进入 needs_review，不静默改写。 |
| D-14 | 部分履约/重复退款 | fulfillment line 的 fulfilled+rejected+cancelled 不超 requested；两个 worker 只有一个 debit link；refund 早于 debit、跨账户、重复异 hash、累计超过 posted debit 均冲突并审计。 |
| D-15 | Reminder lease/watermark | 同 target/version/type/trigger 只有一个 dedupe；lease token 防旧 worker 覆盖新 worker，attempt/dead-letter 可重放同 event id；projection watermark 单调且 late event 不回退。 |
| D-16 | PITR/backfill/delete | backfill 相同 source hash 不重复，冲突入 queue；PITR 后重放外部 debit/refund/cancel 命中原 key；删除流程保留事实/审计并恢复后 owner/RLS/账本/对象 hash 检查通过。 |

## 7. 观测与发布门

### 7.1 必须观测且不得泄露敏感值

至少建立脱敏指标：

- `legacy_write_attempts`、`backfill_conflicts/errors`、`projection_watermark/stale/rebuild_failed`；
- `outbox_lag`、`inbox_duplicate/conflict/dead_letter`、`RLS_deny`、复合 FK violation；
- `spend_reversal_conflict`、`benefit_overdraw/restore_conflict`、`points_negative/reconciliation_gap/unallocated_gap`；
- `redemption_debit/refund_mismatch`、`fulfillment_quantity_conflict`、Reminder lease expiry/retry/dead-letter；
- PITR restore checksum、migration rollback、旧 API 写调用和删除 job dead-letter。

日志只允许 actor、owner hash、aggregate/version、request/correlation、error code 和计数；禁止完整卡号、订单/回执原号、凭证原文、token、request body。

### 7.2 Gate 0：数据契约冻结（当前阻断）

- 签收 canonical/legacy 名称表、scope 复合键、RuleVersion 半开区间、金额/积分精度、IANA 校验、event envelope、projection checkpoint/backfill fence。
- 签收所有 CHECK/UNIQUE/FK/deferred trigger、scope trigger、append-only 权限、幂等保留期、Reminder lease/backoff/dead-letter 和 RPO/RTO。
- 现有年费跨 owner/重复周期/可变 progress/旧 reminder key 影子扫描、备份/PITR 和人工清理报告完成。

**当前状态：阻断。** 正式文档仍有精度/区间/兼容名称漂移；新 schema 尚未创建。

### Gate 1：P0 数据迁移与事实可重放（当前阻断）

- Stage 0/1 完成后，P0 canonical 活动、任务、milestone、Reminder 与旧年费 adapter 在临时 PostgreSQL 迁移、回滚、RLS/复合 FK、append-only、并发、shadow replay 中通过 D-01--D-08、D-15--D-16。
- 事实、事件、outbox/inbox、projection checkpoint 同事务或有明确最终一致水位；从零重建与旧年费 read model 一致，未知/needs_review 不被归零。
- P0 只开放手工活动、单卡单周期任务和奖励核对；P1 表或写入口必须 feature flag 关闭。

**当前状态：阻断。** 现有代码只能跑年费 MVP 回归，不能证明 P0 工作台可部署。

### Gate 2：P1-a/P1-b 账本与兑换（当前阻断）

- P1-a 通过 D-09--D-10 和删除/恢复门；P1-b 通过 D-11--D-14、四轴读模型、余额/lot/履约/退分从零重放及真实并发。
- 外部成功/失败、负余额、部分履约/部分退分、账户 scope、用途限制和 unknown 到期均有事实、证据和下一步；不开放自动 FIFO、系统 reservation、跨账户 transfer。
- 只有 posted debit + 外部退分证据可写 reversal；失败/取消/履约拒绝不能猜测退分。

**当前状态：阻断。** 没有积分/兑换 migration、API、worker 或真实账本测试。

### Gate 3：P2 导入/同步/自动化（当前规划）

- SourceSnapshot 预览、文件隔离、逐行确认、幂等导入、撤销、解析器/connector 最小权限、撤销/删除/恢复和死信演练全部通过。
- 自动 lot/FIFO、system reservation、跨卡联合、银行 connector、自动报名/预约/兑换和附件长期保存都要独立 threat model 和双边守恒，不得用 JSONB/缓存预留冒充实现。

**当前状态：规划。** P0/P1 UI 不得出现可操作的自动化入口。

## 8. 年费 MVP 回归影响

扩展 migration 不得改变旧年费事实：

- `fee_cycles`、`progress_entries`、`fee_events` 仍是年费 projection 的 legacy 输入；adapter 单向读取，不能将活动/积分事实写回旧表。
- `calculateProgress` 非有限/负数拒绝、金额两位小数、count/amount 短板、追加/累计和 progress reversal 必须与旧 read model 一致；无法还原编辑前历史标 `needs_review`。
- 旧 reminders 通过 canonical dedupe adapter 读；归档/取消只停止未来提醒，不能级联删除历史 attempts。
- 卡归档、账户删除、导出、RLS/ownership 扩展必须覆盖旧表和新表；影子 backfill 先比较 counts/hash/sum(progress)，差异进入 conflict queue。
- 现有命令继续执行：

```text
npm run typecheck
npm test -- --run
npm run build
npm run test:e2e
npm audit --omit=optional
git diff --check
```

## 9. 风险与未决项

1. `numeric(14,2)` 与 `numeric(18,3)`、RuleVersion inclusive/half-open 区间、event envelope/schema version 需要 Gate 0 冻结；否则迁移无法安全回滚。
2. `projection_checkpoints`/`backfill_run` 是统一表还是各域表尚未决定；无论选型，必须有单调 watermark、隔离 rebuild 和原子切换。
3. SourceSnapshot 的主体匿名化与 `ON DELETE RESTRICT` 需协调，不能阻断账户删除，也不能物理删除被引用证据；需要明确 subject anonymization 规则。
4. 多卡活动 ContributionAllocation、PointsAccount merged_pool 成员集合版本和 Redemption required/actual debit 差异仍未有正式 owner/双边守恒模型。
5. Reminder 发送方幂等、lease 时长、dead-letter SLA、projection stale 阈值、RPO/RTO、备份保留期和删除等待期未由产品/运维签收。
6. 现有数据库无新领域 schema/RLS/outbox/inbox；Round10 文档不能替代真实 PostgreSQL、并发、PITR、删除和安全扫描。

## 10. Handoff

### Changed artifacts

- `docs/research/CARD-FEATURE-ROUND10-DATA.md`（本文件，唯一研究稿修改）

### Key decisions

- canonical-only 新写与 legacy read adapter 分离，并用 legacy source hash/backfill fence 防止双写/重复回填。
- 所有跨域关系采用 user/card/account/instance scope 复合 FK + RLS + application port 三层保护；fixed-card/merged-pool scope 一旦有账本不可变。
- 增加 projection checkpoint/watermark/rebuild run、backfill conflict queue、PITR 后外部事件重放和缓存原子切换要求。
- 在 Gate 0 统一金额精度、积分 scale、ISO/IANA 校验和 RuleVersion 区间；D-01--D-16 作为真实 PostgreSQL 数据库验收。
- 迁移按 Stage 0 预检 -> Stage 1 基础 -> Stage 2 P0 -> Stage 3 P1-a -> Stage 4/5 P1-b -> Stage 6 contract，旧年费 adapter 单向、可回滚、可重放。

### Validation

- 已静态读取并交叉核验 Round10 台账、`DATABASE-WORKBENCH.md`、`PRD-WORKBENCH.md`、Round8/9 DBA 数据稿及当前 schema/migrations。
- 待文件落盘后运行：`git diff --check -- docs/research/CARD-FEATURE-ROUND10-DATA.md`。
- 仅 report-only；未执行真实 PostgreSQL migration、RLS、并发、worker、PITR、删除或恢复演练。

### Risks / open questions

- 见第 9 节；首要风险是精度/区间漂移、scope 复合约束未实施、projection/backfill 无水位、旧年费历史不可还原和 PITR/删除参数未签收。

### Ready for integration

yes。主会话可将本稿作为 Round10 DBA 增量，按 Gate 0 -> P0 -> P1-a/P1-b -> P2 串行整合；在真实 migration、RLS/ownership、重放、并发、PITR 和删除恢复证据齐全前，活动、权益、刷卡任务、积分和兑换仍只能标为规划/阻断。
