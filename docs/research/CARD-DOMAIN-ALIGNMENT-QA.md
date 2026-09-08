# Cardfolio 卡领域 QA 对齐与发布门槛

| 项目 | 内容 |
| --- | --- |
| 文档版本 | v0.1 |
| 角色 | QA / 发布审查 |
| 复核日期 | 2026-08-14 |
| 复核范围 | PRD、领域架构、数据库、UX、现有 QA 文档及领域研究稿 |
| 交付性质 | 只读验收与阻断清单；不修改业务代码、迁移或正式契约 |

## 1. 结论

当前代码仍是年费 MVP，不能以“工作台第一版已可部署”对外发布。领域扩展文档已经具备较完整的产品方向，但正式 PRD、架构、DBA、UX 和 QA 之间仍有契约漂移。必须完成 Gate 0（契约冻结）后，才允许实现 P0 活动/刷卡任务纵切；权益、积分和兑换属于后续 P1-a/P1-b。

本稿采用以下测试基线：

- **P0**：活动规则可关联多张卡，但每张卡独立 participation、单卡 SpendTask 和奖励事实；五条状态轴分别验证；手工录入、发生/入账/清算口径、退款/冲正、奖励核对和站内提醒。
- **P1-a**：权益下发、预约、出示、核销、拒绝/争议和额度流水；只有 `redeemed` 扣减。
- **P1-b**：积分账户/批次/流水和外部手工兑换；订单履约与积分扣减双状态，失败不推断退分。
- **P2**：导入、自动 lot、系统内 reservation/hold、连接器、外部推送等自动化，必须另行授权和安全评审。

## 2. 跨文档冲突矩阵

| 领域 | 当前漂移 | QA 采用的 canonical 规则 | 发布门 |
| --- | --- | --- | --- |
| 活动范围 | PRD 的 `applicable_card_ids` 与架构 `ActivityParticipation` 并存，单卡/多卡未在所有章节裁剪 | 活动规则可多卡；实例唯一键 `(user, activity, card)`；任务和奖励按卡独立，禁止跨卡合并 | P0 前补复合所有权、唯一键、E2E 多卡隔离 |
| 活动五轴 | 架构旧图只有资格/报名/结果/奖励，PRD 有名额但 DB 缺独立 reward fact | 资格、报名、名额、任务进度、奖励五轴；奖励有独立事实/历史 | P0 前明确 `quota_status`、奖励表/事件和重放 |
| 状态命名 | `pending/expected_pending`、`fulfilled/success`、`redeem/redeem_debit`、`qualified/target_reached` 并存 | 以对齐产品稿 canonical 表为唯一写入契约；旧词只在兼容读层映射并标 deprecated | Gate 0 状态表、命令、事件、错误码一致 |
| 兑换退分 | 旧 QA/安全章节暗示失败自动退分或余额不能为负，DBA 要求已 posted debit 后才 reversal 且允许真实负余额 | `success + debit pending` 明确处理中；失败/取消不自动退分；只有原 posted debit + 官方退回证据才 reversal；负余额保留并 `needs_review` | P1 并发、乱序、重复 refund 集成测试 |
| 权益使用 | 旧 UX/QA 把预约或“使用”当作扣减 | 预约、出示、核销分轴；只有首次 `redeemed` 写 consume；取消/拒绝/争议不扣 | P1 使用账本重放和并发核销测试 |
| 提醒 | 现有实现只支持 `fee_event/progress`，工作台文档只描述抽象 notification | P0 至少支持 activity end、task due、reward verification；UTC 存储 + 冻结 IANA 时区 + dedupe key | P0 迁移、worker 去重、DST/闰日测试 |
| 积分到期 | 旧章节可能把总余额分配到批次并生成到期提醒 | 到期未知不提醒；`unallocated_difference` 显式展示；不自动造 lot | P1 账本恒等式和负差额测试 |
| 来源确认 | `SourceSnapshotConfirmed` 与“抓取成功不得确认”两种事件规则并存 | 抓取仅 `Captured`；用户核对发布 `RuleVersionVerifiedByUser` | Gate 0 事件目录和审计断言一致 |
| 分期 | 架构/QA 个别章节称权益/积分是“后续 P0”或 Phase 1 | 首个 P0 只活动/任务；P1-a 权益；P1-b 积分/兑换；P2 自动化 | README、PRD、ARCH、DB、QA 全文替换误导措辞 |

## 3. P0 测试矩阵

### 3.1 活动与多卡隔离

| 场景 | 期望 | 证据 |
| --- | --- | --- |
| 同一活动关联两张用户卡 | 创建两条 participation；三元唯一键阻止重复 | PostgreSQL 约束 + API/E2E |
| 修改卡 A 资格/报名/名额/奖励 | 卡 B 状态、任务、时间线不变 | 领域服务单测 + E2E |
| 两张卡各录入 50，单卡目标 100 | 不显示达标，不生成跨卡汇总任务 | 进度重放断言 |
| 报名必须但 `not_started/submitted/rejected/expired/unknown` | 不能进入最终达标 | 状态转换表驱动测试 |
| 名额 `unknown/full/not_allocated` | 阻断最终达标；`available` 不自动变 `allocated` | API 409/业务错误 |
| `potentially_eligible` | 只能待核对，不得当作用户确认资格 | UI 文案 + API 投影 |
| 活动过期后补录历史 | 可补记，不能新报名；仍引用旧 rule version | 时间边界测试 |

### 3.2 刷卡方式、进度与冲正

| 场景 | 期望 | 证据 |
| --- | --- | --- |
| `snapshot` 任务追加流水 | 返回业务错误，快照值不变；`entries` 可逐笔重放 | service/route contract |
| `occurred_only` + `posted/settled` 截止口径 | 前者仅预计值，后者才进入确定值 | 固定日期夹具 + 时区测试 |
| POS/电商/移动支付/二维码/境外/自动扣款 | 方式、商户/MCC、地区、币种和排除项独立保存；unknown 不判定合格 | schema + API validation |
| 重复 `Idempotency-Key` 同 payload | 返回同一 entry/响应，不重复累计 | API 重放测试 |
| 同 key 不同 payload | `409 IDEMPOTENCY_KEY_REUSED`，不写事实 | route contract |
| 退款/冲正 | 原流水只读，追加关联负向流水；反向累计不得超过原值 | ledger/property test |
| 跨周期退款影响已确认任务 | 当前状态转 `needs_review/disputed`，历史达标和退款均可查 | timeline E2E |
| 同时满足/满足其一 | `all` 取最短板；`any` 满足任一；custom 仅显示说明并需确认 | domain table tests |

### 3.3 奖励与提醒

| 场景 | 期望 | 证据 |
| --- | --- | --- |
| 任务 `target_reached` | 不自动写积分、权益或奖励到账；奖励仍待核对 | outbox/event assertion |
| 规则无发放期限 | 不计算预计日、不自动转逾期 | domain test |
| 有发放期限且超期 | `delayed` 并生成一条 reward verification reminder | worker + unique index |
| 奖励到账后被撤回 | 追加撤回事实，不能静默删除达标历史 | reward history |
| 同对象/节点重复生成提醒 | 稳定 dedupe key，只保留一条有效提醒 | PostgreSQL unique + worker retry |
| 归档卡/取消任务 | 停止未来提醒，保留历史提醒 | integration test |

## 4. P1 测试矩阵

### 4.1 权益

1. `pending_delivery` 无凭证不能显示 `available`；下发、凭证类型、服务商和核对时间可审计。
2. 预约 `confirmed`、取消、现场拒绝和争议均不写 consume；只有首次 `redeemed` 写一次 consume。
3. 两个并发 `redeemed` 请求最多产生一条 consume；重复幂等返回原结果。
4. 使用撤销只能追加一次 restore，不能修改或删除原 usage；超用保留真实事实并转 `needs_review`。
5. 归档卡停止未来权益提醒，但历史 usage、估值和争议仍可读。

### 4.2 积分账户/批次/兑换

1. 从零重放满足 `ledger_balance = sum(entries)`；批次余额和 `unallocated_difference` 与快照一致或明确 `mismatch`。
2. 只有有官方证据的 `expires_on` 才生成积分到期提醒；未知 lot 不触发提醒。
3. 用途受限 lot 不适用于目标兑换时，建议停止并要求用户确认，不自动跳过。
4. 本地余额不足但外部订单成功时保留真实负余额，标记 `needs_review`，不截断为零。
5. `success + pending` 显示“订单成功，积分扣减处理中”；订单成功不等于 debit posted。
6. `failed/cancelled` 不写 reversal；仅存在原 `posted` debit 且用户确认官方退回时才写一次等额 reversal。
7. 重复 HTTP、outbox、worker、乱序事件和重复退款均只生成一条账本事实；同 key 异 payload 返回 409。
8. 兑换的 `account_id/card_id/user_id` 不能跨卡或跨用户；合并池必须显式 `card_id IS NULL`。

## 5. Gate 0：契约冻结（实现前）

- [ ] PRD、ARCH、DB、QA、UX 使用同一套 canonical 状态、命令、事件和错误码；旧章节统一标 deprecated。
- [ ] 明确 P0 允许“多卡规则 + 单卡实例”，不允许跨卡合并；数据库给出 `(user, activity, card)` 复合唯一/FK。
- [ ] 明确独立 `ActivityReward` 表或等价 append-only reward fact，并定义状态历史和幂等键。
- [ ] P0 Reminder 表、对象类型、冻结 IANA 时区、dedupe key、状态和索引进入迁移设计。
- [ ] `snapshot/entries` 互斥、occurred/posted/settled 口径、退款 reversal 和旧 `progress_entries` adapter 写入契约。
- [ ] 兑换双状态、真实负余额、posted debit/refund precondition 写入 DB/QA/安全文档。
- [ ] 来源捕获与用户确认事件分离；规则版本历史引用不可覆盖。
- [ ] 所有 P0/P1 命令定义 `Idempotency-Key`、request hash、expected version、409 语义和跨用户 404。

## 6. Gate 1：P0 实现验收

- [ ] 真实 PostgreSQL 影子库迁移、RLS、复合 FK、唯一约束、append-only 触发器通过。
- [ ] 领域单测、API contract、提醒 worker、outbox/inbox 去重和失败重试通过。
- [ ] Playwright 覆盖桌面 1280/1440、移动 360/390；未知、处理中、失败、逾期等状态用文字和图形表达且无横向溢出。
- [ ] 跨用户/跨卡 IDOR 返回 404；完整卡号、CVV、银行凭据和来源敏感 query 参数拒绝或脱敏。
- [ ] UTC 跨日、用户 IANA 时区、DST、闰日、inclusive 截止日和改时区历史归属测试通过。
- [ ] 旧年费 MVP 回归：`npm run typecheck`、`npm test`、`npm run build`、`npm run test:e2e` 全通过。

## 7. Gate 2：P1 实现验收

- [ ] BenefitUsage 预约/核销两轴与额度账本可重放；并发核销和 restore 幂等。
- [ ] Points ledger、lots、allocations、reconciliation 可重放；未知到期不提醒；真实负差额进入 `mismatch`。
- [ ] Redemption success/debit pending、失败/退分、乱序 worker 和 account-card 复合归属测试通过。
- [ ] 导入只进入预览/待确认队列；不绕过来源、权限、账本和审计。

## 8. 发布阻断项

1. 工作台领域表、迁移、RLS、复合 FK、outbox/inbox 尚未实现，当前代码不能支撑 P0。
2. 正式架构旧状态/API/事件仍与新增 canonical 表并存，开发和测试可能选择不同契约。
3. PRD/架构中的名额、独立奖励事实尚未在 DB DDL 中落定。
4. P0 提醒对象、状态、时区、去重和索引缺真实迁移与 worker 验证。
5. QA/UX/SECURITY 仍有“权益/积分/兑换属于 P0”或“失败自动退分/余额不能为负”的过期描述。
6. 历史 `progress_entries` 缺 posted/settled/business key 的迁移策略、对账和 `needs_review` 标记未验证。
7. 账户删除、来源附件/URL SSRF、导出脱敏、RPO/RTO 和恢复演练证据未签收。

## 9. 交接

- **Changed files**: `docs/research/CARD-DOMAIN-ALIGNMENT-QA.md`。
- **Decisions**: 以 P0 多卡规则/单卡实例、活动五轴、独立奖励、P1-a/P1-b 分期、权益核销扣减、积分/兑换双状态为测试契约。
- **Validation**: 本稿仅做静态审查；完成后运行 `git diff --check -- docs/research/CARD-DOMAIN-ALIGNMENT-QA.md`。未运行应用、数据库或 E2E 测试。
- **Risks**: 架构 canonical 表和正式文档合并尚未完成；发布阻断项仍存在。
- **Ready for integration**: yes，主会话应将本稿 Gate 与阻断项合并到正式 QA/PRD/ARCH/DB 文档，再开始实现。

## 10. 第五轮一致性复核（2026-08-14）

本轮只读复核了正式 PRD、架构、数据库、安全、QA、UX 文档和四份研究稿。大部分 P0/P1 决策已合并，但以下问题仍会让实现或测试选择不同契约，必须在 Gate 0 关闭。

### 10.1 阻断级冲突

1. **架构权威章节仍缺名额轴**：`ARCHITECTURE-WORKBENCH.md` 第 14.9 节把 ActivityParticipation 写成资格/报名/结果/奖励四轴，所有权表也写“四轴”，但 PRD、DB 和对齐稿要求五轴（资格、报名、名额、任务进度、奖励）。应在第 14.9、14.8 及事件/API表同时加入 `quota_status`、`RecordQuotaResult`/`ActivityQuotaResultRecorded.v1`，并补 `unknown/full/not_allocated` 阻断测试。
2. **架构仍保留互相矛盾的事件/命令样例**：第 6.2 节列出 `SourceSnapshotConfirmed.v1`，第 14.13 节又规定抓取不得确认；第 14.2/14.11 节仍示例 `enroll`、`record_enrollment_failure`、`confirm_reward`，而 canonical 契约使用 `RecordEnrollmentResult`、`RecordQuotaResult`、独立 `RecordRewardResult`。旧样例必须删除或明确标为 `deprecated/compat-read-only`，否则契约测试无法确定允许值。
3. **P0 提醒没有正式数据库契约**：PRD 已要求活动截止、任务截止和奖励核对提醒，DBA 研究稿给出字段和去重规则，但 `DATABASE-WORKBENCH.md` 未见提醒/通知表、对象类型、`dedupe_key`、IANA 时区和索引 DDL。P0 迁移前必须补表或明确现有 `reminders` 的 expand/contract 方案，并增加重复 worker、归档取消、DST/闰日和状态审计测试。
4. **Redemption/Points 写模型在 PRD 与 DB/架构仍是两套**：PRD 兼容字段仍写 `status=fulfilled`、`points_debit_status=debited/returned`，DB/架构写 `status=success`、`ledger_status=posted/pending_refund/refunded`。必须在 PRD 字段段落补“兼容投影只读映射”，新 API/DDL/QA 只使用 `success + ledger_status`；`fulfilled`、`debited`、`returned` 不得进入新写入。

### 10.2 高优先级遗漏或不完整映射

5. **权益下发状态未统一**：PRD 有 `delivery_failed`，架构 canonical 有 `revoked`，DB DDL 又有 `exhausted/cancelled/needs_review`。`exhausted` 是额度投影而非下发事实，`cancelled` 也不应和 `expired/revoked` 混用。应选择“下发状态 + 独立额度投影”两层模型，建立旧值映射和合法转换表，再锁定 DDL check constraint。
6. **权益使用的兼容 `status` 可能被误当事实**：DB 同时有 `status=planned/booked/used/...` 与 `reservation_status/redemption_status`，架构/产品只承认后两条轴。必须把 `status` 明确标为派生投影（或删除），禁止 API 直接写；QA 只断言预约/出示/核销双轴和 ledger consume/restore。
7. **SpendTask 投影名称漂移**：活动参与使用 `outcome_status`，单卡任务使用 `progress_status`；架构旧章节还使用 `outcome`。应明确 `ActivityParticipation.outcome_status` 是兼容投影，任务 canonical 为 `SpendTask.progress_status`，并规定 `provisionally_qualified/shortfall/disputed` 的来源和重算方式，避免数据库只覆盖简化枚举。
8. **积分流水类型未统一**：PRD 使用 `earn/redeem/expire/adjust/transfer/reversal`，DB 使用 `earn/bonus/redeem/expire/reconciliation_adjustment/reversal`，架构和对齐稿又使用 `redeem_debit` 语义。应发布一张 entry type 映射表（包括 transfer 是否 P2、reconciliation adjustment 是否独立事实），并要求 ledger、lot allocation、兑换 consumer 和导出使用同一 canonical 名称。
9. **报名取消语义未定稿**：DB 和架构旧状态含 `enrollment_status=cancelled`，产品 canonical 列表未含该值。应明确取消是报名轴状态还是 participation 生命周期（推荐保留 `cancelled`，但记录为用户主动取消且不等于 rejected），在状态表、事件和 UI 文案中统一。
10. **安全文档仍出现 `bank_confirmed`**：`SECURITY-WORKBENCH.md` 的报名/资格威胁条目把 `bank_confirmed` 与 `user_confirmed` 并列，产品和架构已禁止把银行确认当作系统可证明事实。应改为“用户在官方渠道核对的证据”并使用 `user_confirmed_*`，避免实现出未定义状态。

### 10.3 推荐修订顺序

1. 先修 `ARCHITECTURE-WORKBENCH.md` 第 14.8/14.9/14.11/6.2 的五轴、命令、事件和 deprecated 标记，形成唯一 canonical 表。
2. 再修 `PRD-WORKBENCH.md` 的权益、PointsEntry 和 Redemption 字段，显式标注兼容投影与新写模型，更新验收用词。
3. 再修 `DATABASE-WORKBENCH.md`：补 P0 Reminder DDL；将 participation quota/reward、BenefitUsage 双轴/投影、SpendTask 状态、积分 entry type、Redemption 双状态与 canonical 表逐项对齐。
4. 随后修 SECURITY/UX/QA 中的 `bank_confirmed`、预约/使用单轴、`fulfilled/debited` 和 P0/P1 旧措辞，所有矩阵改引用 canonical 名称。
5. 最后在影子 PostgreSQL 上执行迁移、约束、RLS/复合 FK、账本重放、提醒 worker 和并发兑换测试；文档静态检查通过不能替代这些证据。

### 10.4 本轮交接

- **Changed files**: 仅追加本文件 `docs/research/CARD-DOMAIN-ALIGNMENT-QA.md`。
- **Decisions**: 将五轴缺名额、旧事件/命令、P0 Reminder 缺 DDL、兑换字段双轨、权益/积分/报名/安全状态映射列为 Gate 0 阻断；按架构 -> PRD -> DB -> SECURITY/UX/QA -> 影子库顺序修订。
- **Validation**: 待追加后运行 `git diff --check -- docs/research/CARD-DOMAIN-ALIGNMENT-QA.md`；本轮未运行应用、数据库或 E2E 测试。
- **Risks**: 正式文档尚未完全收敛，当前只能发布年费 MVP，不能宣称工作台 P0/P1 已部署。
- **Ready for integration**: yes，主会话应把 10.1--10.3 加入正式 Gate 和协调 ledger。
