# Cardfolio 卡领域第九轮 QA 验收矩阵与发布门

| 项目 | 内容 |
| --- | --- |
| 文档版本 | v0.1 |
| 复核日期 | 2026-08-15 |
| 角色 | QA｜Cardfolio｜验收矩阵与发布门设计 |
| 输入 | `docs/PRD-WORKBENCH.md` v1.0、`docs/ARCHITECTURE-WORKBENCH.md` v0.6、`docs/DATABASE-WORKBENCH.md`、`docs/SECURITY-WORKBENCH.md`、`docs/UX-WORKBENCH.md`、`docs/QA-WORKBENCH.md`、`docs/research/CARD-DOMAIN-ROUND8-QA.md`、Round8/9 产品/架构/DBA 研究稿 |
| 当前能力 | 代码和迁移仍为年费 MVP；活动、权益、刷卡任务、积分和兑换没有可部署 API、表或业务 E2E |
| 交付性质 | 只读报告；不修改正式文档、代码、测试实现、schema、migration、锁文件；不 commit/push |

## 1. 结论与范围

本稿把 Round8 的状态、来源版本、UTC/IANA、复合 ownership、幂等、append-only 和旧年费 adapter 转成可执行的验收矩阵。验收对象分为：

- **P0**：有来源的活动、每卡每周期 participation、报名/名额/资格核对、单卡单周期 SpendTask、发生/入账/清算里程碑、退款/冲正、奖励人工核对和站内提醒。
- **P1-a**：权益下发、周期实例、预约/改期/拒绝/争议、凭证轮换、次数额度账本和非次数权益结果。
- **P1-b**：积分观察余额、待入账/已入账流水、lot/未分配差额、到期提醒、外部兑换四轴、现金部分、部分履约、扣分和退分。
- **P2**：导入确认写入、自动 lot/FIFO、系统内 reservation/hold、外部同步、附件长期保存和自动化；必须另有安全、授权、恢复及合规评审。

“通过”必须同时有数据库事实/约束、API 响应、读模型、审计/事件和 UI 状态证据。研究稿、静态类型或当前年费测试通过，都不能代表工作台功能已部署。

## 2. 统一测试契约

### 2.1 固定夹具

| 夹具 | 关键值与目的 |
| --- | --- |
| 用户 A | `Asia/Shanghai`，两张卡；一项 P0 活动、一个单卡 SpendTask、一个 P1-a 次数权益、一个固定卡积分账户 |
| 用户 B | `America/Los_Angeles`，复用 A 的资源 ID 发起读写、下载、worker 和兑换攻击 |
| 活动版本 | v1 `active`、v2 `active`/v1 `superseded`；报名截止前后、名额 `unknown/full/allocated/not_allocated` |
| 任务 | `entries` 模式和 `snapshot` 模式各一项；`cutoff_basis=occurred/posted/settled/unknown` 各有边界数据 |
| 权益 | 次数 2 次、非次数 `fee_credit`、未知 `valid_to`、预约已确认后改期/拒绝 |
| 积分 | `pending_earn`、`earn`、已过期 lot、未知 expiry、正/负两个差额、真实负余额 |
| 兑换 | 现金补差、两条履约明细、已 posted debit、待确认退分、部分退分 |
| 故障 | 重复 HTTP、同键异 payload、双 worker、数据库超时、outbox/inbox 重放、lease 过期、PITR 恢复 |
| 敏感输入 | 完整 PAN/CVV、银行凭据、短信验证码、二维码原文、完整订单/回执号；均应拒绝或脱敏 |

### 2.2 断言规则

1. 金额使用数据库十进制定点；积分使用账户 `points_scale`；不以 JavaScript 浮点相等作为断言。法币必须通过 `iso_4217_currencies`，IANA 时区不能用固定偏移或 `CST`。
2. 同一 `business_key`/`Idempotency-Key` + 同一规范请求哈希只产生一次业务效果并返回首次响应；同键异哈希返回 `409 IDEMPOTENCY_KEY_REUSED`，且写冲突审计。
3. 事实、事件和账本 append-only；错误使用 correction/reversal。缓存必须带 sequence/row version，并可从零重放。
4. 所有命令从会话推导 `user_id`，复合 ownership/FK、RLS 和 API 端口三层校验；越权、不兼容跨卡和固定卡/合并池违规统一 `404`，不泄露存在性。
5. `unknown/pending/needs_review/disputed` 必须显示 reason、evidence、来源/核对时间、`as_of`、`next_action` 和复核时间（有则显示）；未知不得被 UI 归零、转成功或生成确定性提醒。

## 3. 验收矩阵

### 3.1 P0：活动、报名和奖励

| 编号 | 场景 | Given / When / Then | 证据与阻断 |
| --- | --- | --- | --- |
| A-01 | 活动 happy path | Given 官方 snapshot、active rule v1、适用卡和完整活动期；When 创建 campaign 并为一张卡建 participation；Then 预检完成后可激活任务，资格/报名/名额/结果/奖励仍是独立轴。 | campaign/rule citation、四元实例唯一键、无跨轴自动写入；P0。 |
| A-02 | 来源 unknown | Given 仅第三方摘要、缺活动期或适用卡；When 保存；Then 只能为 `needs_review/lead`，可补来源但不能显示“可参加”、创建确定 SpendTask 或奖励数值。 | source level、缺失原因、无 `SpendTaskCreated`/奖励到账事件；P0 阻断。 |
| A-03 | 报名截止前 | Given deadline 尚未到；When 用户提交报名；Then 锁 participation、校验冻结 IANA 时区和 rule version，写一条带 masked/hash receipt 的 submitted 事件。 | `enrollment:{participation}:{attempt}` 幂等键、actor、UTC/local 时间、审计；P0。 |
| A-04 | 报名截止后 | Given 本地 deadline 已过；When 再提交报名；Then 返回业务冲突或只允许记录外部结果/复盘，不能新增 submitted/confirmed；历史可读。 | `deadline_passed` 审计、同一 participation 事件数不增加；P0 阻断。 |
| A-05 | 报名/回执重试 | Given submitted 或同 provider receipt hash 已存在；When 重复点击、双标签页或 worker 重放；Then 返回原结果，不创建第二个 confirmed；同键异参数为 409。 | event sequence/business key/request hash 唯一；masked/hash 扫描无明文；P0。 |
| A-06 | 名额与资格 unknown | Given `eligibility=potentially_eligible/unknown` 或 `quota=unknown/full/waitlisted/not_allocated`；When 查看/激活任务；Then 显示限制和下一步，不能最终 qualified/target reached，也不生成继续刷卡提醒。 | 五轴独立状态、`reason_code`、无奖励自动事实；P0 阻断。 |
| A-07 | 规则换版 | Given participation/entry 引用 v1；When v2 生效；Then v1 历史对象不变，新的参与或任务引用 v2；差异可审阅，禁止静默覆盖或跨版本重算。 | rule version/source hash、impact event、旧/新 instance_key、shadow replay；P0。 |
| A-08 | 取消/拒绝后复盘 | Given 报名被拒、名额未分配或 campaign 取消；When 保存外部结果；Then 停止未来 Reminder/刷卡动作但保留 participation、消费、奖励和证据；不用新增 `blocked` 写状态。 | `needs_review + reason_code` 或 canonical `rejected/cancelled`、提醒取消事件、历史事实不删；P0 阻断。 |
| A-09 | 奖励人工核对 | Given target reached 但奖励规则未给 expected_on，或仅部分 reward component 到账；When 用户记录；Then 每个 reward_key 独立为 `expected_pending/received/delayed/reversed/disputed`，不自动写 PointsEntry/Benefit grant。 | reward event sequence、来源/证据、无 expected_on 时无到期提醒；P0。 |

### 3.2 P0：刷卡方式与单卡任务

| 编号 | 场景 | Given / When / Then | 证据与阻断 |
| --- | --- | --- | --- |
| S-01 | 激活前路由确认 | Given task 仅接受实体 POS；When 路由、MCC、商户范围或币种 unknown；Then 可以保存计划，但不能激活确定计入或“开始刷卡”提醒。 | immutable SpendMethodSnapshot、`route_confirmation_status`、next action；P0 阻断。 |
| S-02 | 路由排除 | Given 交易方式明确命中排除项或币种不符；When 录入；Then 保存 `excluded`，reason/evidence 必填，不可 PATCH 为 included，只能追加证据并重算。 | entry append-only、reason code、source snapshot、无确定进度增加；P0。 |
| S-03 | occurred/posted/settled | Given `cutoff_basis=posted`，occurred 在窗口内但 posted 缺失；When 查看；Then 只进 pending/预计；补 posted 后确定进度可重算；settled 无 posted 必须拒绝。 | SpendEntry + SpendMilestone、milestone 唯一键/顺序、旧 task-entry 仅兼容读；P0 阻断。 |
| S-04 | entries/snapshot 互斥 | Given task 激活为 entries；When 提交累计 snapshot 或并发写两种模式；Then 拒绝 snapshot；反向同理，输入模式激活后不可变。 | deferred trigger/受控函数、并发事务、无重复 progress；P0 阻断。 |
| S-05 | count/amount/all/any/custom | Given `count_and_amount`、`count_or_amount`、目标 0、极大目标或 custom；When 重算；Then `all` 取短板、`any` 任一达标，custom 只显示说明并要求用户确认，不执行未知 DSL。 | 十进制定点、溢出/非法目标校验、progress/qualification 分轴；P0。 |
| S-06 | 部分退款/冲正 | Given task 暂时达标；When 录入部分 refund 或 correction；Then 原 contribution 保留，新增同卡同任务反向事实，累计不超过原贡献，进度可回退 `shortfall/needs_review`，不自动退奖励/积分。 | `related_entry_id` 复合 FK、reversal 唯一键、TargetNoLongerReached outbox；P0 阻断。 |
| S-07 | 单卡单周期隔离 | Given 两张卡或两个 `activity_instance_key`；When 录入同一日期/金额；Then 各任务独立重算，不能跨卡合并；卡归档后不允许新事实但历史可读。 | `(user,card,task,instance_key)` ownership、RLS、UI 分卡；P0 阻断。 |

### 3.3 P1-a：权益

| 编号 | 场景 | Given / When / Then | 证据与阻断 |
| --- | --- | --- | --- |
| B-01 | 下发与周期 | Given 权益来源、周期和 usage model 已确认；When 记录下发/凭证；Then 周期实例、服务商、凭证版本和核对时间可追溯，未知 valid_to 不自动过期。 | entitlement/credential event、来源快照；P1-a。 |
| B-02 | 预约改期拒绝 | Given 预约成功后改期、取消或现场拒绝；When 重算额度；Then 只更新 usage 状态，不扣次数，拒绝/争议保留原因和下一步。 | usage event sequence、quota 不变；P1-a 阻断。 |
| B-03 | 并发核销与恢复 | Given 两个请求同时确认同一次数权益，或恢复后重放 consume；When 执行；Then 至多一条 consume，重复请求返回首次结果，restore 必须引用既有 consume 且不超额。 | unique business key、锁/重放/恢复报告；P1-a 阻断。 |
| B-04 | 非次数权益 | Given `coverage_claim/fee_credit/service_record`；When 记录使用/金额；Then 不写 quota consume，不把估算价值当已实现价值。 | model-specific ledger、价值投影；P1-a。 |

### 3.4 P1-b：积分与兑换

| 编号 | 场景 | Given / When / Then | 证据与阻断 |
| --- | --- | --- | --- |
| P-01 | 双差额对账 | Given confirmed、ledger、lots 不一致，或存在 pending earn/真实负余额；When 查看账户；Then 分别显示两个差额，保留负值并进入 `needs_review`，不造 lot/FIFO/expire。 | 从零重放 PointsEntry/Lot/Allocation、UI `as_of`；P1-b 阻断。 |
| P-02 | fixed-card/merged-pool | Given 固定卡账户、合并池账户和错误 card scope；When 创建 lot、debit 或兑换；Then 合法 scope 成功，错误 scope 404/409，不依赖 NULL FK 放行。 | scope trigger、RLS、跨卡负向测试；P1-b 阻断。 |
| P-03 | 订单与扣分分轴 | Given 外部订单成功但积分扣分未知，或订单失败/取消；When 保存结果；Then order/fulfillment/debit/refund 独立，显示 `pending_debit/refund_pending`，不自动 reversal。 | 四轴事件、审计、无跨轴副作用；P1-b 阻断。 |
| P-04 | 部分履约与退分 | Given 多条履约明细、现金部分、已 posted debit 和部分退分；When 记录；Then fulfilled/rejected 不超过 requested，退分累计不超过 debit，早于 debit 的 refund 被拒绝并可复核。 | line-level facts、金额守恒、幂等业务键；P1-b 阻断。 |

### 3.5 P2 与横切回归

| 编号 | 场景 | Given / When / Then | 证据与阻断 |
| --- | --- | --- | --- |
| X-01 | 导入/附件 | Given 恶意文件、CSV 公式、重复行或包含敏感号；When 上传；Then 进入 quarantine/错误行预览，不写事实，扫描和删除可审计。 | 沙箱、魔数/MIME、导入回滚；P2。 |
| X-02 | URL/连接器 | Given 私网/metadata/重定向 URL 或未授权连接器；When 触发；Then P0/P1 拒绝自动抓取/同步；P2 需独立 SSRF、授权、签名和重放测试。 | 网络隔离、token scope、关闭开关；P2 阻断。 |
| X-03 | 删除/恢复 | Given 用户删除并在 PITR 隔离环境恢复；When 校验；Then online 访问撤销，业务/对象/缓存/队列清理注册表完整，恢复副本不回灌已删除用户。 | E2E、恢复报告、审计；所有 Gate 阻断。 |
| X-04 | 年费回归 | Given 现有卡片、年费周期、进度、提醒、导出和账户删除用例；When 扩展迁移或 feature flag 开关；Then 原有 45 个基线测试和 2 条 E2E 不回归，旧写路径按 adapter 规则处理。 | `npm test -- --run`、typecheck、build、E2E；P0/P1 阻断。 |

## 4. 发布门与证据顺序

- **Gate 0：** 产品/架构/DBA/安全/QA 对 canonical 状态、来源快照、四元 participation、SpendMilestone、`snapshot/entries` 互斥、幂等、404/409、Reminder lease 和旧 adapter 签收；无代码时只能记录规划。
- **Gate 1/P0：** 真实 PostgreSQL 迁移、复合 ownership/RLS、P0 A-01..A-09/S-01..S-07、审计/outbox/inbox、worker、移动端状态和年费回归全部有证据。
- **Gate 2/P1-a：** B-01..B-04 通过并发、重放、恢复、凭证脱敏和删除清理后才开启权益入口。
- **Gate 3/P1-b：** P-01..P-04 通过双差额、scope、部分履约、debit/refund 幂等和恢复后才开启积分/兑换入口。
- **P2：** X-01..X-03 需单独安全/合规/运维评审；不得因 P0/P1 通过而自动开启导入、抓取、同步或自动兑换。

通过条件是“数据库事实/约束 + API 响应 + 读模型 + 审计/事件 + UI 状态 + 回归/恢复证据”同时存在；当前只有年费 MVP 满足可执行基线，Round9 研究稿不构成工作台部署许可。

## 5. 验证记录

- 本文件由 QA 角色交付 P0 夹具与矩阵，主会话接管并补齐 P1/P2/Gate 收尾；未修改业务代码、schema、migration 或测试实现。
- `git diff --check -- docs/research/CARD-DOMAIN-ROUND9-QA.md` 需在集成前执行并通过。
- 真实 PostgreSQL、RLS、worker、并发、迁移回滚、PITR、渗透和扩展领域 E2E 尚未执行；当前可部署范围仍只有年费 MVP。

### 3.3 P1-a：权益与使用

| 编号 | 场景 | Given / When / Then | 证据与阻断 |
| --- | --- | --- | --- |
| B-01 | 发放 happy path | Given `consumable_quota` entitlement period instance；When 用户确认 grant/delivery；Then delivery、quota projection 和 usage 独立，额度从 grant ledger 重放，来源/周期固定。 | grant business key、period_instance_key、quota sequence；P1-a。 |
| B-02 | 预约改期/取消 | Given预约已 confirmed、quota 2；When reschedule/cancel 未核销使用；Then只追加 usage event，quota 仍为 2，不写 consume。 | planned/booked/rescheduled/cancelled 事件、无 consume entry；P1-a 阻断。 |
| B-03 | 现场拒绝/争议 | Given 已出示但服务商因地区/容量拒绝；When 记录；Then usage 为 rejected/disputed，保留 provider、地区、原因和下一步，额度不变。 | usage event、争议审计、无 consume/restore 猜测；P1-a 阻断。 |
| B-04 | 首次核销与重试 | Given quota 剩余 2；When 首次 `redeemed/used`，再并发重复提交；Then 只追加一次 consume，剩余为 1；并发失败返回余额/版本冲突或 `needs_review`，不截断为 0。 | `benefit-usage:{entitlement}:{request}`、ledger sequence、幂等响应；P1-a 阻断。 |
| B-05 | 凭证轮换/未知有效期 | Given credential 过期或 provider 要求新凭证，`valid_to` unknown；When 更新；Then 追加 credential version/rotation event，entitlement 为 needs_review，不自动 expire 或扣额度，不生成到期提醒。 | masked/hash credential、rotation_reason、unknown validity；P1-a。 |
| B-06 | 非次数权益 | Given `fee_credit/coverage_claim/service_record`；When 记录费用抵扣、理赔或服务完成；Then 不显示剩余次数，不写 quota consume；估算价值和实际金额分开。 | 专属 result/amount/currency/evidence、价值汇总过滤；P1-a 阻断。 |

### 3.4 P1-b：积分账户、批次与到期

| 编号 | 场景 | Given / When / Then | 证据与阻断 |
| --- | --- | --- | --- |
| P-01 | 观察余额与流水 | Given confirmed observation、ledger entries 和 lots；When 打开账户；Then 并列 `confirmed_balance`、`ledger_balance`、`lots_remaining_total`、两个差额及各自 `as_of/source/freshness`，不称实时余额。 | observation 非账本事实、sequence replay、read model `as_of`；P1-b。 |
| P-02 | pending earn | Given一笔待入账奖励与已确认余额；When 查看或重放；Then pending 单独展示，不进入 confirmed/ledger 可兑换余额，不创建 lot 或 expiry。 | `pending_earn`/pending projection、entry type、无 lot/expire；P1-b 阻断。 |
| P-03 | 负余额与差额 | Given退款扣回后 ledger 为 -20，或 confirmed-ledger/ledger-lots 任一差额非零；When 查看/尝试兑换；Then保留 -20，账户和相关兑换 `mismatch/needs_review`，暂停建议，不截断/自动补 adjustment。 | signed decimal、两个公式、阻止新建议、审计；P1-b 阻断。 |
| P-04 | lot 到期 | Given lot 的 `expires_on` 已被官方/用户确认；When 到期 worker 执行；Then 只生成 points_expiry Reminder/用户确认的 expire 事实；未知 expiry 不生成日期、expire 或提醒。 | lot expiry status、IANA/UTC、dedupe/lease；P1-b。 |
| P-05 | lot allocation 与限制 | Given redemption 有用途限制或用户选择顺序；When 分配；Then P1 仅展示/保存用户确认的 allocation，数量不超 lot，不能自动 FIFO、跨账户或用正差额造 lot。 | lot allocation 复合 FK、跨行守恒、scope trigger、P2 auto-lot 明确关闭；P1-b 阻断。 |
| P-06 | 账户冻结/关闭 | Given account frozen/closed；When 尝试新 debit/调整/到期提醒；Then按策略拒绝新兑换写入，历史和对账可读，关闭账户停止未来 expiry Reminder，不删除流水。 | account status、404/409 语义、Reminder cancel、历史重放；P1-b。 |

### 3.5 P1-b：积分兑换

| 编号 | 场景 | Given / When / Then | 证据与阻断 |
| --- | --- | --- | --- |
| R-01 | 兑换预检 unknown | Given 资格、库存、卡种上限或渠道未知；When 保存；Then 允许 planned/needs_review，但不能显示“可兑换”、扣分成功或创建 debit。 | source/rule snapshot、eligibility/quota evidence、无 PointsEntry；P1-b 阻断。 |
| R-02 | 四轴 happy path | Given外部订单已确认、现金补差合法、用户确认官方扣分；When 依次记录订单/履约/debit；Then order、fulfillment、debit、refund 独立，只有 debit 命令写一次 `redeem_debit`。 | 四轴事件、cash numeric/currency、`redemption:{id}:debit`、PointsEntry link；P1-b。 |
| R-03 | 部分履约 | Given两项商品只履约一项，积分已部分扣减；When记录；Then按 fulfillment item/event 记录 requested/fulfilled/rejected，不把整单标成功，不自动改变 debit/refund。 | item 数量守恒、四轴读模型、部分状态 UX；P1-b 阻断。 |
| R-04 | 失败/取消在扣分前 | Given order failed/cancelled，尚无 posted debit；When 重试或记录结果；Then保留失败历史，可重试，不写 debit/reversal，不把失败当退分。 | order event、无 ledger effect、retry idempotency；P1-b。 |
| R-05 | 扣分后待退分 | Given debit posted，履约失败，官方退分尚未确认；When记录；Then fulfillment=failed、refund=pending_external_confirmation，不能生成 reversal。 | debit link、refund evidence status、审计；P1-b 阻断。 |
| R-06 | 等额/部分退分 | Given官方确认退回等额或部分积分；When追加 refund；Then锁 redemption/debit，累计 reversal 不超过已扣，按 refund key 幂等，余额可重放；退款先于 debit或跨账户必须冲突。 | `redemption:{id}:refund:{key}`、posted debit FK、amount limit、negative balance rule；P1-b 阻断。 |

### 3.6 横切：ownership、幂等、提醒、隐私和回归

| 编号 | 场景 | Given / When / Then | 证据与阻断 |
| --- | --- | --- | --- |
| X-01 | 跨用户/跨卡 | Given用户 B 使用 A 的 card/rule/source/participation/benefit/account/lot/redemption ID，或固定卡账户绑定另一张卡；When读写、下载或 worker 执行；Then统一 `404`，无存在性泄漏、业务事实或额外审计副作用。 | API user filter、复合 FK、RLS `set local app.user_id`、scope trigger；所有版本阻断。 |
| X-02 | 幂等与并发 | Given 同一命令重试、双标签页、两个 worker 和乱序事件；When处理报名、entry、consume、debit/refund、Reminder；Then同键同 hash 一次效果，同键异 hash 409，inbox/dedupe/sequence 不重复。 | request_idempotencies、outbox/inbox、锁/乐观版本、原响应；P0/P1 阻断。 |
| X-03 | 时间窗口 | Given用户 `Asia/Shanghai` 与 `America/Los_Angeles`，UTC 跨日、DST、闰日、截止 00:00/23:59；When计算报名、任务、权益/lot expiry、Reminder；Then按冻结对象 IANA 的 local date，UTC trigger 可重排，历史窗口不随用户改时区变化。 | `date`/`timestamptz` 类型、timezone 校验、DST 固定时钟；P0/P1 阻断。 |
| X-04 | Reminder lease | Given活动截止/奖励 expected_on/权益或 lot 明确到期；When并发生成、租约过期、发送失败、死信重放或业务取消；Then dedupe 一条，lease token 防旧 worker 覆盖，重放同 reminder/event id；unknown 日期只生成复核行动。 | `dedupe_key`、`lease_until`、attempt/dead-letter、delivery attempt append-only；P0/P1 阻断。 |
| X-05 | 安全与审计 | Given输入完整卡号/CVV/银行凭据/订单原号/二维码；When提交、日志、导出或错误；Then阻断或掩码，审计只写 actor、版本、证据摘要、request/correlation，不写秘密。 | secret scanner、脱敏导出、日志 allowlist、再认证；所有版本阻断。 |
| X-06 | 旧年费 adapter 回归 | Given旧 `fee_cycles/progress_entries/fee_events/reminders`；When shadow replay/backfill/归档/删除；Then adapter 单向读映射、稳定 legacy business key、无法还原行标 `needs_review`，旧进度/提醒结果与原读模型一致，不双写或删除历史。 | old/new counts/hash、sum(progress)、selector/API 兼容、PITR；Gate 0/1 阻断。 |
| X-07 | 缓存与恢复 | Given人为损坏 progress/quota/points/lot/redemption/reminder cache，或从备份+WAL PITR恢复；When重建/重放；Then事实、sequence、两差额、履约/扣分/退分链接和 Reminder 水位一致，不重复业务效果。 | replay checksum、RLS/permission snapshot、outbox lag/dead-letter、恢复报告；Gate 4/5 阻断。 |
