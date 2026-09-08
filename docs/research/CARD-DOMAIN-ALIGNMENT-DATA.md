# Cardfolio 领域对齐数据补充稿

| 项目 | 内容 |
| --- | --- |
| 文档版本 | v0.1 |
| 角色 | DBA |
| 复核日期 | 2026-08-14 |
| 复核范围 | 提醒/通知、活动多卡与奖励、权益使用、积分账户/批次/流水、兑换、迁移与恢复 |
| 基线 | `main@e756538`；当前数据库只有年费 MVP 表 |
| 交付性质 | 只读约束补充；不创建真实迁移，不修改 `db/schema` 或业务代码 |

本文是 `docs/DATABASE-WORKBENCH.md` 与领域对齐会话的实现前置清单。数据库草案不是已部署能力；正式迁移必须拆分、在影子 PostgreSQL 环境验证，并由主会话串行合并。

## 1. 基线与边界

当前 `db/schema` 和 `db/migrations/0000_initial.sql`--`0003_worker_heartbeats.sql` 只有 `users`、`sessions`、`cards`、年费周期/事件、`progress_entries`、提醒、审计和 worker 心跳。没有工作台提醒对象、多卡活动参与、奖励事实、权益、积分、兑换、来源快照、outbox 或 inbox。

本轮边界：

- P0 只落活动、单卡刷卡任务、奖励人工核对和站内提醒；不接银行、不代报名、不自动交易/兑换。
- 权益、积分批次/流水和兑换是 P1 手工纵切；系统内 reservation/hold、自动 lot 分配、外部同步和部分退款另行设计。
- 所有业务事实保留 `user_id`；需要固定卡片或账户归属时保留 `card_id`/`account_id`，并用复合唯一键和复合外键防止跨用户、同用户跨卡误关联。
- 缓存只能由事实重放得到；普通 `PATCH` 不得直接修改余额、剩余量、进度或状态轴。

## 2. P0 提醒与通知数据契约

### 2.1 Reminder 最小字段

`reminders` 应扩展或新建统一表，至少包含：

| 字段 | 约束与含义 |
| --- | --- |
| `id`, `user_id` | UUID；所有查询和写入从会话推导 `user_id`，建立 `(id,user_id)` 唯一键 |
| `object_type`, `object_id` | `fee_event/activity/campaign/participation/spend_task/reward/source_rule`；对象 ID 不接受客户端所有者字段，命令内验证父对象归属 |
| `reminder_type` | `annual_fee/activity_end/task_due/reward_verification/verification_due`；P1 再加入 `benefit_expiry/points_expiry/redemption_followup` |
| `trigger_at`, `timezone` | `trigger_at` 保存 UTC `timestamptz`；`timezone` 保存冻结的 IANA 时区，写入时通过 `pg_timezone_names` 校验，不接受固定偏移量 |
| `status` | `pending/snoozed/completed/ignored/overdue/cancelled`；状态变化只能由命令/存储过程执行并记录审计 |
| `snoozed_until`, `completed_at`, `ignored_at` | 与状态互相校验；`snoozed` 必须有未来时间，`completed/ignored` 必须有对应时间 |
| `dedupe_key` | 服务端规范化生成，包含用户、对象、提醒类型、规则版本/截止节点；同一业务节点只能有一条有效提醒 |
| `source_sequence`, `created_at`, `updated_at` | 记录触发事实水位和审计时间；旧事件不得覆盖新水位 |

### 2.2 状态、去重与索引

- 生成提醒必须与业务事实在同一事务中写入，使用 `unique(user_id, dedupe_key)` 或等价部分唯一索引；网络重试、定时任务重复执行和多 worker 只能返回同一提醒。
- 归档卡片、已取消任务和已确认结果停止未来提醒，但保留历史提醒。`completed/ignored` 不能重新生成同一 `dedupe_key`，除非规则版本或周期实例改变。
- 查询索引至少包括 `(user_id,status,trigger_at)`、`(user_id,object_type,object_id)`，以及 `status in ('pending','snoozed','overdue')` 的部分索引。worker 用 `FOR UPDATE SKIP LOCKED` 领取待投递项，并有租约、重试次数和死信状态。
- 提醒投递失败不得回滚原始活动、任务或账本事实；重试/死信写审计和最小错误码，不写敏感请求体。P0 只做站内提醒，email/push 属 P1。
- `trigger_at` 应从对象的冻结时区和规则版本计算；用户改默认时区只影响未来提醒，不重算历史业务日期。DST、闰日、截止日 00:00/23:59 必须有集成测试。

## 3. 活动多卡、名额与独立奖励事实

### 3.1 归属和唯一性

- `campaigns` 只表示活动身份、提供方和生命周期；不保存某张卡的报名、名额、消费或奖励结果。
- `activity_participations` 以 `unique(user_id,campaign_id,card_id)` 建立卡实例；`(campaign_id,user_id,rule_id)`、`(card_id,user_id)`、`(rule_version_id,user_id,rule_id)` 使用复合外键。禁止以 `applicable_card_ids` 数组代替实例。
- 名额属于 participation 的独立状态轴，例如 `unknown/available/full/waitlisted/allocated/not_allocated`，不能由资格或任务达标推断。并发创建同一三元组只允许一条记录。

### 3.2 Reward 不能藏在 participation 状态

PRD/架构要求资格、报名、名额、结果、奖励五条事实链。`activity_participations` 仅保存状态投影；应新增 `participation_rewards` 或等价 append-only 事件表，至少包含：

- `(id,user_id,participation_id)` 复合归属、`reward_key`、类型和原文金额/上限文本；不将银行奖励文字强行解析为通用金额。
- `status`: `not_expected/pending/delayed/received/reversed/disputed/unknown`；`expected_on` 仅在来源明确给出发放规则时填写。
- `received_on`、`reversed_on`、`reason`、`source_snapshot_id`、`request_hash/business_key`、`created_at`；状态历史追加，不覆盖已到账事实。
- 同一 participation 的奖励业务键唯一；奖励确认不得自动生成 PointsEntry，P0 只写用户确认和审计。

奖励达标提醒只能由独立 reward 状态触发。任务 `target_reached` 不等于奖励到账；退款/规则变化只能转 `needs_review/disputed`，不能删除原事实。

## 4. P1 权益使用与额度账本

### 4.1 Usage 两条状态轴

PRD 同时要求预约/出示/核销和争议事实。建议 `benefit_usages` 拆成：

- `reservation_status`: `not_required/not_booked/requested/confirmed/rejected/cancelled/unknown`；预约参考号只能掩码或哈希保存。
- `redemption_status`: `not_presented/presented/redeemed/rejected/disputed/unknown`；另有 `presented_at/redeemed_at`、`dispute_status` 和最小原因。

若保留单一 `status`，必须建立不可变 usage event 表并由状态投影明确两个轴；不能用 `booked` 代替“已预约且未出示”，也不能用 `used` 隐含现场核销。

### 4.2 复合所有权、数值和 append-only

- `benefit_usages` 必须带 `(user_id,card_id,entitlement_id)`，并以 `(entitlement_id,user_id,card_id)` 复合 FK 引用发放实例；usage 与 entitlement ledger 的引用必须为 `(usage_id,entitlement_id,user_id)`。
- `client_request_key + request_hash` 在用户范围内唯一；同键同摘要返回原结果，同键异摘要返回 `409`。预约不扣额度，只有首次 `redemption_status=redeemed` 才追加 `use` entry。
- `requested_count`、`requested_amount` 非负且与权益单位互斥；金额必须带合法 ISO 4217 币种，禁止 JSONB 隐藏单位、数量、状态或所有权。
- `benefit_entitlement_ledger` 只允许 `grant/use/expire/adjustment/reversal`，保留 `sequence` 和 `business_key`；应用角色撤销 `UPDATE/DELETE`。reversal 必须引用同一 entitlement 的原 entry，并精确反向。
- `remaining = grant + adjustment - use - expire + reversal` 从 ledger 重放；超用、单位错配或重复 reversal 保留真实事实并标 `needs_review`，不能截断为零或直接改 cache。

## 5. P1 积分账户、批次与兑换

### 5.1 PointsAccount/PointsLot/PointsEntry

- `points_accounts` 使用稳定 `account_key` 区分“按卡账户”和“同计划合并池”；`card_id` 可空不等于两种语义。账户、卡片、流水、批次和 allocation 均用 `(id,user_id)`/`(id,account_id,user_id)` 复合 FK。
- `points_ledger` 是余额唯一事实，`unique(account_id,sequence)` 与 `unique(account_id,business_key)`；流水带 `request_hash`、正负 `points_delta`、来源和可选 reversal。普通角色不能更新/删除，修正只能追加 adjustment/reversal。
- `points_lots` 以 `(account_id,lot_key)` 唯一；lot 到期日和置信度未知时不生成提醒。`points_lot_allocations` 以 `(ledger_entry_id,lot_id)` 唯一，允许一笔流水拆到多个 lot，分配序号必须与 ledger sequence 分开。
- 账户恒等式必须可重放：`ledger_balance = sum(points_delta)`；`allocated_balance = sum(lot allocations)`；`unallocated = ledger_balance - allocated_balance`。正差不伪造到期批次，负差进入 `mismatch/needs_review`。
- 本地余额不足但用户确认外部兑换已成功时保留真实负余额并标 `needs_review`；不得使用 `greatest(balance,0)`，也不得因为负数删除历史流水。P1 不启用 hold/reservation。

### 5.2 Redemption 双状态和账户/卡兼容

`redemptions` 至少分开：

- 订单状态：`planned/submitted/processing/success/failed/cancelled/refund_pending/refunded/disputed/unknown`。
- 账本状态：`not_debited/pending/posted/needs_review/reversed`。

约束与处理顺序：

1. `account_id`、可选 `card_id` 和 `user_id` 必须同属用户；若账户绑定固定卡，必须由 `(account_id,user_id,card_id)` 复合 FK 或事务触发器阻止同用户跨卡关联。合并池必须显式 `card_id is null`。
2. `client_request_key + request_hash` 幂等；订单成功只写 `success + debit_pending` 和 outbox，不能直接假设积分已扣。
3. debit consumer 锁账户，以 `redemption:{id}:debit` 写一条负向 ledger entry 和 debit link；重复 HTTP、worker、outbox 和乱序事件都只能得到一条事实。
4. 失败/取消不猜测退分。退款必须先存在 `posted` debit link，随后以固定 `redemption:{id}:refund` 写等额 reversal/refund link；退款先于扣分、重复退款或金额不等均拒绝并留审计。
5. 订单参考号只存掩码/哈希或最小非敏感尾段；服务端拒绝完整 PAN、CVV、Cookie、Authorization、token 和来源敏感 query 参数进入业务字段、JSONB、审计、日志或导出。

## 6. 迁移、重放与备份前置

### 6.1 Expand/contract 顺序

1. 预检 PostgreSQL 15、扩展权限、RLS/worker 角色、备份/PITR 时间点、表计数、孤儿与跨用户引用。
2. 先清理现有 cards/cycles/progress 的跨用户/孤儿关系，再建立父表复合唯一键，以 `NOT VALID` 添加复合 FK，离峰 `VALIDATE`。
3. 先落 source reference/snapshot/rule version、不可变触发器和 outbox/inbox/idempotency 基础，再落活动参与/奖励/任务事实和提醒。
4. 旧 `progress_entries` 通过 adapter 作为 `legacy_progress` 回填；缺 occurred/posted/settled/business key 的记录标 `needs_review`，不能伪造银行入账。双写观察期内比较全量重放值后才切读。
5. 后续按权益 -> 积分账户/ledger -> lot/allocation -> redemption consumer 分阶段启用 feature flag；每阶段保留旧读路径、停止 consumer 即可回滚，不删除已写事实。

### 6.2 重放、删除和恢复验收

- 从零重放 participation reward、task、entitlement、points ledger/lot 和 redemption link，必须与缓存、状态水位和审计引用一致；旧 sequence/乱序事件不得覆盖新投影。
- 同一命令重试、同键异 payload、重复 outbox/inbox、两个 debit worker、死信重放、退款重试均需 PostgreSQL 集成测试。
- 账户删除清单覆盖 reminders/worker leases、活动与奖励、权益及 ledger、points/lot/allocation、redemption、source snapshot、导出链接、缓存和对象。append-only 审计采用匿名化策略，不保留原始敏感值。
- `source_snapshots.actor_user_id` 不能使用会阻断用户删除的 `ON DELETE RESTRICT` 自引用；改为可匿名化主体或删除 job 先匿名化再删除，并做真实级联测试。
- 生产备份需加密、跨故障域保存并定义在线数据/日志/对象/备份保留期、RPO/RTO；至少每季度在隔离环境用全量+WAL 恢复，校验 RLS、账本恒等式、兑换 link、对象引用和删除结果。恢复副本不得回灌已删除账户。

## 7. 发布阻断与已知文档漂移

当前不能以工作台版本发布，阻断包括：

1. 新增表和复合 FK/RLS/outbox/inbox 尚未进入真实迁移；
2. `activity_participations` DDL 仍缺第一类 reward fact/event 的可执行表；
3. `spend_task_entries` DDL 尚未明确 PRD 的 processing/qualification 状态投影与 snapshot/entries 互斥；
4. `benefit_usages` 单轴 DDL 与 PRD 的预约/出示/核销双轴不一致；
5. `redemptions` 分别 FK account/card 但缺同用户跨卡兼容约束；
6. QA/SECURITY/UX 旧章节仍将权益/积分/兑换列为 P0，或把负余额/失败退分写成相反语义，必须先统一契约；
7. 导出/删除再认证时效、清理注册表、备份保留、RPO/RTO 和恢复演练证据未签收。

## 8. 交接

- **Changed files**: `docs/research/CARD-DOMAIN-ALIGNMENT-DATA.md`。
- **Decisions**: P0 提醒以 UTC + 冻结 IANA 时区和稳定去重键实现；活动奖励独立事实；权益预约/核销双轴；积分账本 append-only 且允许真实负余额；兑换订单/账本双状态并要求账户/卡兼容；迁移按 expand/contract、adapter、重放和恢复演练推进。
- **Validation**: `git diff --check -- docs/research/CARD-DOMAIN-ALIGNMENT-DATA.md`；未创建迁移、未运行数据库测试。
- **Risks**: 正式文档仍存在 P0/P1、状态词、负余额和失败退分漂移；真实数据库约束尚未实现；同用户跨卡 redemption 与删除自引用 FK 必须在迁移前解决。
- **Ready for integration**: yes，主会话需先评审第 7 节阻断项，再串行合并到正式 DBA/QA/PRD/架构契约。

## 9. 本轮安全/DBA 边界复核

本节是对活动、权益、刷卡任务、积分、兑换及其横切能力的上线门槛补充。它只定义验收条件，不代表当前代码或数据库已经满足。

### 9.1 P0/P1 必须门槛

1. **对象级所有权**：每个 API、命令、worker 和下载链接都从会话/任务上下文取得 `user_id`，拒绝客户端 `owner_user_id`。主体与所有关联的 card、campaign、participation、task、rule version、source snapshot、entitlement、points account、lot、redemption 必须在同一事务通过复合 ownership 校验；不存在与无权限统一 `404`。同一用户的不同卡、固定卡账户与合并池也必须有明确兼容规则，不能只校验用户相同。
2. **账本不可篡改**：SpendEntry、reward event、benefit entitlement ledger、points ledger、lot allocation、redemption link 和审计事件均 append-only；普通应用角色无 `UPDATE/DELETE`。更正、冲正、退分只能通过受控 command 追加新事实，并在同一事务提交审计、幂等结果和 outbox。
3. **幂等与重放**：所有写命令持久化 `Idempotency-Key/client_request_key`、规范化请求哈希和结果；同键同摘要返回原结果，同键异摘要返回 `409`。重复 HTTP、双标签页、重复 outbox、乱序/重复 inbox、两个 debit worker 和死信重放都不得复制事实或账本余额。
4. **积分/权益守恒**：积分余额只能由 ledger 重建；lot allocation、权益 grant/use/reversal 和兑换 debit/refund 必须通过账户/entitlement 行锁、唯一业务键和精确反向校验。外部兑换成功但本地余额不足时保留真实负余额并标 `needs_review`；不得截断、删除或伪造为失败。
5. **状态正交性**：活动资格、报名、名额、任务进度和奖励分别持久化；权益预约、出示、核销分别可追溯；兑换订单履约状态与积分账本状态分离。`target_reached`、`booked`、`success` 或 `fulfilled` 均不得自动宣称银行确认、权益已核销或积分已扣/已退。
6. **敏感数据阻断**：服务端、数据库约束/触发器、日志脱敏和导出扫描必须拒绝完整 PAN、CVV、密码、验证码、Cookie、Authorization、token、银行登录材料和未脱敏附件 URL。`external_ref`、reservation/order reference、来源摘要、`conditions_json`、`normalization_json`、事件 payload、audit metadata 和导出 JSON/CSV 不能成为绕过入口。
7. **来源与导入边界**：P0 只登记用户粘贴的 HTTPS 公开来源或人工摘要，不由应用服务器任意抓取；禁止私网、localhost、云 metadata、敏感 query 参数和跨用户来源引用。P1 导入必须是私有隔离对象、魔数/MIME/大小/行数限制、恶意文件扫描、preview/逐条 confirm、文件/行去重和事务化写入；解析器不能直接写任务或账本。
8. **删除与审计**：导出/删除必须近期再认证、短时一次性结果、限流和审计；删除注册表覆盖新表、提醒/worker lease、缓存/索引、来源对象、导出链接、outbox/inbox 和附件。删除任务可重试且不泄露失败数据；审计只保留最小脱敏摘要并定义匿名化/备份自然过期语义。
9. **真实迁移与恢复证据**：上述约束必须落入真实 PostgreSQL 迁移并通过 RLS、复合 FK、IDOR、并发、重放、敏感扫描、删除 job、全量+WAL 恢复和账本重建测试；静态文档或 mock 测试不能作为发布证据。

### 9.2 可延后但不得隐含开放

- 系统内积分 reservation/hold、释放和过期；P1 手工兑换保持“外部完成后确认扣减”。
- 自动 lot/FIFO/最早到期扣减、跨账户积分转移和部分退款；加入前需新的双边守恒模型。
- 银行/账单第三方同步、OAuth connector、webhook、自动报名/预约/兑换；归入 P2，需独立供应商评估、最小 scope、KMS token 隔离、撤销和重放防护。
- 服务器抓取动态网页、HTML/PDF 解析和 OCR；在 SSRF、DNS rebinding、重定向、沙箱、XSS/压缩炸弹和资源上限测试完成前只保留 URL/手工摘要。
- 附件长期保存、全文搜索、批量确认、推荐排序和价值预测；不得以 JSONB 或缓存字段提前承载这些能力。

### 9.3 本轮复核结论

- **必须阻断发布**：真实迁移未完成；复合 ownership/RLS/IDOR 未验证；Reward fact、SpendTask processing/qualification、BenefitUsage 双轴和 redemption account-card 兼容仍需落库；通用幂等/inbox/outbox 未落地；敏感扫描、删除清理、再认证、备份保留/RPO/RTO 未签收。
- **可接受的设计方向**：SourceReference 与不可变 SourceSnapshot 分离；账户/权益/任务/兑换事实可重放；失败不猜测退分；P0/P1/P2 手工边界清晰；未知值不推断为资格或余额。
- **Ready for integration**：yes。主会话应将本节门槛转入正式 SECURITY/QA/DB 文档后，再决定迁移和实现排期；本文件本轮仍为研究/审查稿。
