# Cardfolio 卡领域第八轮 QA 跨文档验收复核

| 项目 | 内容 |
| --- | --- |
| 文档版本 | v0.1 |
| 复核日期 | 2026-08-15 |
| 角色 | QA｜Cardfolio｜跨文档验收复核 |
| 输入 | `docs/PRD-WORKBENCH.md` v0.8、`docs/ARCHITECTURE-WORKBENCH.md` v0.6、`docs/DATABASE-WORKBENCH.md` 第四轮/第七轮补充、`docs/SECURITY-WORKBENCH.md` v0.4、`docs/UX-WORKBENCH.md`、`docs/QA-WORKBENCH.md`、Round8 产品/架构/DBA 研究稿 |
| 当前实现 | 仍为年费 MVP；活动、权益、刷卡任务、积分和兑换尚无迁移、API 或业务 E2E |
| DBA Round8 状态 | `CARD-DOMAIN-ROUND8-DATA.md` 已落盘；已纳入其 Stage 0--8、复合 ownership、append-only、积分/权益守恒和恢复门槛，但尚未完成正式签收或真实 PostgreSQL 演练 |
| 允许修改范围 | 仅本文件；不修改正式文档、代码、迁移、锁文件或其他角色文件 |

## 1. 结论

工作台 P0 仍不可发布。Round8 产品稿已经把活动预检、报名截止/回执、支付路由确认、规则版本影响、消费排除原因和可行动 `unknown` 补齐；Round8 架构稿已冻结单卡单周期 participation、独立 reward event、任务内规则快照、UTC/IANA、不可变事实和旧年费 adapter。跨文档复核后，仍有以下必须在 Gate 0 解决的契约风险：

1. 兼容投影 `CardActivity`、规范写模型 `Campaign/ActivityParticipation/ActivityReward` 与 P0 “单卡单周期”范围尚未在正式 PRD 中明确一一映射。
2. `reward_status=pending`、`expected_pending`、`blocked`、`expired/ended` 等旧/新状态仍同时出现在不同文档，必须定义 canonical 写入枚举和兼容读取映射。
3. PRD 的 `SpendEntry` 字段模型与架构第七轮的 `SpendMilestone` canonical 路由、DBA 的 append-only entry/milestone 表需要一套 API、事件和测试对象。
4. Round8 DBA 已补齐约束，但现有年费表的跨用户孤儿、可变进度、旧提醒键、币种/时区校验缺口，以及新表的复合 ownership、RLS、append-only、fixed-card/merged-pool scope trigger 和 Stage 0--8 迁移尚未实现或演练。
5. 现有 `npm test`、typecheck、build 和年费 E2E 只能证明年费 MVP；它们不能替代 Gate 1 以后新领域的 PostgreSQL、状态、幂等、审计和跨时区证据。

发布原则：只有需求、写模型、迁移、API、测试和证据同时存在才算通过。任何界面空壳或状态标签不能被解释为活动、权益、积分或兑换已实现。

## 2. 跨文档验收用例

以下 15 条是跨 PRD、架构、DBA、安全、UX 和 Round8 研究稿的合并验收用例。每条必须在真实 PostgreSQL（迁移后）、API、读模型、审计和 UI 状态上留证；单元测试或静态文档不能单独通过。

| 编号 / 发布门 | Given / When / Then | 必须核验的跨文档证据 |
| --- | --- | --- |
| Q-01 P0 | Given 活动只有第三方线索且缺活动期或适用卡；When 保存活动；Then 只能保存 `needs_review/lead`，不能激活 SpendTask、奖励金额或“可参加”结论；补齐官方快照后才能进入预检。 | PRD 来源闸门、Round8 产品 U-01、架构 SourceSnapshot/RuleVersion、DBA citation primary、UX 待核对动作、无 `SpendTaskCreated` 事件。 |
| Q-02 P0 | Given 两张适用卡、同一活动周期；When 为每张卡创建参与实例；Then `(user, campaign, card, activity_instance_key)` 各自唯一，报名/名额/资格/结果互不串写；跨用户或不兼容卡引用统一 `404`。 | PRD CardActivity 兼容投影、架构 participation owner、DBA 复合外键/唯一键、安全 IDOR 负向测试、UI 分卡显示。 |
| Q-03 P0 | Given `enrollment_deadline` 在用户 IANA 时区的今天；When 截止前提交与截止后重复提交；Then 前者允许一次提交，后者返回业务 `409` 或只允许记录外部结果；相同幂等键同请求返回原响应，同键异请求返回 `409 IDEMPOTENCY_KEY_REUSED`。 | PRD 报名截止、Round8 产品 Q-02/Q-03、架构状态机、DBA business key/request hash、审计事件和提醒 dedupe。 |
| Q-04 P0 | Given 规则 v1 的参与实例已经有消费；When v2 修改门槛、排除项或发放口径并生效；Then 历史实例/流水仍引用 v1，新消费只能创建 v2 新实例或显式迁移；读模型显示差异和受影响对象，不静默重算历史。 | PRD RuleVersion、架构不可变引用、DBA active period/citation、Round8 产品 Q-05、UX 规则变更页面、migration/重放结果。 |
| Q-05 P0 | Given 任务只接受实体 POS，但刷卡方式路由、MCC 或币种未知；When 激活任务或录入消费；Then 可保存计划/待核对，但禁止确定性达标；每笔记录显示 `pending`/`excluded` 原因和下一步，不能把商户名称当路由。 | PRD SpendMethod/SpendTask、Round8 产品 U-04/Q-06/Q-07、架构 task snapshot、DBA method snapshot/币种约束、安全 `manual` provenance、UX 状态文字。 |
| Q-06 P0 | Given `cutoff_basis=posted`，发生日期在窗口内但 posted milestone 缺失；When 查看任务；Then 进入预计/待核对进度，不能进入确定达标；补录 milestone 后可重算且历史发生事实不改写。 | PRD occurred/posted/settled、架构 canonical `/spend-entries/{entryId}/milestones`、DBA entry/milestone append-only、Round8 产品 U-05、旧 task-entry 路由兼容测试。 |
| Q-07 P0 | Given 任务曾暂时达标；When 录入部分退款/冲正；Then 原贡献保留，新增关联反向流水，进度可回退到 `shortfall/needs_review`，受影响 reward 只进入待核对，不自动写积分退回；同一原 entry 不得产生重复 reversal。 | PRD 退款规则、Round8 产品 Q-10、架构 SpendTaskTargetNoLongerReached、DBA reversal 唯一键/重放恒等式、安全不可变事实、审计和 outbox。 |
| Q-08 P0 | Given 活动报名被拒、名额未分配或活动取消；When 保存外部结果；Then 停止未来刷卡/奖励提醒但保留 participation、历史流水和证据；不得把 `failed`、`blocked`、`cancelled` 混为一个新写状态。 | PRD 异常流程、Round8 产品 Q-04/Q-09、架构 Campaign/participation 状态、DBA status check、UX 操作/忽略提醒、状态兼容映射测试。 |
| Q-09 P1-a | Given 次数型权益剩余 2 次；When 预约确认后改期/取消、现场拒绝或争议；Then quota 仍为 2，usage 时间线保留原事实；仅首次 `redeemed/used` 追加 `consume`，恢复追加 `restore`，重复请求不重复扣减。 | PRD BenefitUsage、架构 entitlement delivery/quota/usage 三轴、DBA grant/consume/restore ledger、Round8 产品 Q-11/Q-13、安全幂等和 UX 不能把预约标为使用。 |
| Q-10 P1-a | Given 非次数型 `fee_credit/coverage_claim/service_record` 权益；When 记录费用抵扣、理赔或服务完成；Then 不显示剩余次数、不写 quota consume；估算价值与实际金额分开，现场拒绝有服务商/地区/原因和争议动作。 | PRD usage_model、Round8 产品 U-08、架构 BenefitEntitlement owner、DBA usage/result 字段、UX 专属结果状态、价值评估不混入已确认汇总。 |
| Q-11 P1-b | Given 积分有待入账、已确认余额、lot 和流水差额；When 查看账户或录入退款扣回；Then `confirmed_balance`、`ledger_balance`、`lots_remaining_total`、`reconciliation_difference`、`unallocated_difference` 分开显示；真实负余额保留并为 `needs_review`，不得截断或自动造 adjustment/lot。 | PRD PointsAccount/PointsLot、Round8 产品 Q-14/Q-15、架构 PointsLedger、DBA numeric scale/lot allocation、Security 负余额规则、UX as_of/新鲜度。 |
| Q-12 P1-b | Given 批次有用途限制且兑换资格/库存/上限未知；When 保存兑换计划或确认外部成功；Then 可保存 `planned/needs_review`，不能显示“可兑换”或写 debit；用户确认官方扣分后才写一次 `redeem_debit`，批次分配需显式确认。 | PRD 兑换预检、Round8 产品 U-10/Q-16、架构四轴和 P2 reservation 边界、DBA fixed-card/merged-pool scope trigger、Security 禁止客户端余额。 |
| Q-13 P1-b | Given 订单部分履约、部分扣分或合作方拒绝；When 更新结果；Then `order_status`、`fulfillment_status`、`points_debit_status`、`refund_status` 独立变化；失败/取消不自动退分，只有已有 posted debit 且具官方退回证据才能追加 reversal。 | PRD 四轴、架构 Redemption/PointsLedger port、DBA debit/refund link 与幂等、Round8 产品 Q-17/Q-18、UX 四轴状态和订单历史。 |
| Q-14 P0 横切 | Given Reminder/Notification 因重复投递、租约回收或用户改时区；When worker 重试或重新排程；Then `(object, node, type)` dedupe 不重复生成提醒，使用 UTC 持久化与对象冻结的 IANA 时区计算；通知失败不改变业务状态，忽略只停提醒不删证据。 | PRD Reminder 字段、架构 Notification/outbox/inbox、DBA lease/attempt/dead-letter、Round8 产品 U-12/Q-17、UX 提醒中心、DST/跨日测试。 |
| Q-15 P0/P1 | Given 用户 A 使用用户 B 的 card/rule/source/points/redemption ID，或固定卡账户与另一张卡兑换；When 读写/下载/worker 重试；Then 返回同构 `404`，不泄露存在性且不产生审计业务事实；合法同户引用通过复合 ownership，所有命令有 actor、request/correlation、版本和来源审计。 | PRD owner_user_id、架构 port/RLS、DBA composite FK/scope trigger、安全 IDOR 404/worker 身份、UX 无权限与空态、审计日志脱敏检查。 |

## 3. 发布门 Gate 0--5

“可执行”只表示当前阶段有真实实现和测试可以运行；“仅规划”表示文档有契约但当前代码没有能力，不能作为部署依据。

### Gate 0：契约冻结（当前：阻断）

必须串行签收：

- canonical 状态和兼容读映射：`expected_pending`、`needs_review`、`blocked`、`ended/expired`、`rejected/failed`；旧状态不得进入新写入。
- CardActivity 只是兼容投影，规范写模型必须是 `Campaign -> ActivityParticipation -> ActivityReward`；P0 只允许单卡单周期 SpendTask。
- 活动五轴、权益 delivery/quota/usage、任务 lifecycle/progress/qualification、积分流水和兑换四轴不可互相替代。
- `snapshot`/`entries` 互斥、任务内 SpendMethodSnapshot、SpendMilestone canonical 路由、退款反向流水、旧年费 progress adapter、UTC/IANA、`next_action` 与 dedupe 必须有一份签收表。
- Round8 DBA Stage 0--8 已作为实现顺序输入，但必须由产品/架构/DBA 签收表名、金额/积分精度、报名回执 hash、状态枚举、fixed-card/merged-pool scope trigger、Reminder lease 参数和回滚边界后才能进入 Gate 1。

**当前可执行**：年费 MVP 的已有状态/提示和文档静态一致性检查。  
**仅规划**：全部活动、权益、积分、兑换契约及跨模块事件。

### Gate 1：数据库与迁移（当前：阻断）

- 真实 PostgreSQL 临时库执行迁移、约束、append-only 触发器、RLS/复合外键和回滚；验证 `source_references/source_snapshots`、规则版本、participation/reward events、task snapshots/entries/milestones、权益 ledger、points lots/entries、redemption 四轴和 reminders。
- 负向测试覆盖跨用户/跨卡引用、重复 business key、同 key 异 payload、重复 reversal、非法币种/单位、越界日期、负数截断、活动参与唯一键和 snapshot/entries 混写。
- 证明从零重放可重建 progress、quota、points、redemption read model；故障中止不可留下半个事实。

**当前可执行**：现有年费表的迁移/约束回归（以当前 CI 和临时 DB 为准）。  
**仅规划**：新领域表尚未创建；必须先运行 Round8 DBA Stage 0 的跨用户孤儿/重复周期/异常金额预检、备份/PITR 恢复，再创建 Stage 1--7 表和 Stage 8 切换，Gate 1 仍不通过。

### Gate 2：领域 API、状态和幂等（当前：阻断）

- 每个写命令从会话取得 `user_id`，通过聚合 owner port；同键同请求返回原结果，同键异请求 `409`，并发版本冲突 `409 STATE_CONFLICT`，越权/不兼容引用 `404`。
- 报名截止、规则版本迁移、路由排除、退款回退、权益 consume/restore、负余额、四轴兑换和通知事件按 Q-01--Q-15 运行；状态变更追加审计、outbox 和不可变事件。
- 旧年费路由仍可读并转换为新 adapter，但新活动 API 不得写旧 `CardActivity` 单行或旧 progress 字段。

**当前可执行**：年费 cards/cycles/progress/fee-events/reminders 现有 API 及其所有权、重复提醒和撤销回归。  
**仅规划**：工作台新资源 API、事件和 worker。

### Gate 3：读模型、UX 和端到端（当前：阻断）

- 桌面/360/390 px 覆盖活动预检、报名截止、处理中/失败/待核对、任务 pending/excluded、权益拒绝、负余额和兑换四轴；不把未来功能渲染成已上线入口。
- 每个未知状态显示原因、来源时间、`as_of`、`next_action`、复核日期（如有）和可进入的深链；颜色之外同时使用文字和图形；表单错误不丢输入。
- Playwright 覆盖一张卡一个活动一个任务的 P0 闭环；P1-a、P1-b 使用独立 feature flag/测试夹具，不得在 P0 通过时默认为可用。

**当前可执行**：现有年费 MVP 的 1440/1280/390/360 px 页面、键盘/焦点、抽屉、中文化和无横向溢出回归。  
**仅规划**：扩展工作台页面、状态和 E2E。

### Gate 4：安全、恢复与运行（当前：阻断）

- 生产写入保留 Origin/HTTPS 防护、限流和会话；高影响导出/删除/兑换确认有再认证或近期登录；日志、审计、来源摘录、订单/凭证/回执均脱敏，不接收完整 PAN/CVV/凭据。
- worker 使用最小权限、lease/attempt/dead-letter/inbox 去重；通知失败不回滚事实，兑换失败不猜测退分；备份、恢复、删除和附件（P1）各有演练证据。
- 真实 PostgreSQL RLS/复合 ownership 和跨用户 404 必须通过集成测试；不能用当前 API 已鉴权证明新对象安全。

**当前可执行**：年费 MVP 的现有认证、Origin、审计、导出/删除和提醒回归，但备份保留与新鲜度二次认证仍需运维确认。  
**仅规划**：工作台新表、附件、导入、连接器、兑换和积分安全控制。

### Gate 5：发布签收与年费回归（当前：年费可执行，工作台阻断）

发布前必须提供：

1. Gate 0--4 的签收表、迁移版本和回滚演练编号。
2. Q-01--Q-15 的测试报告，包含数据库/审计/事件/读模型证据；P1-a 与 P1-b 不因 P0 通过而自动放行。
3. 年费回归：`npm run typecheck`、`npm test -- --run`、`npm run build`、`npm run test:e2e`、`npm audit --omit=optional`、`git diff --check`；金额、闰日/月末、提醒幂等、进度撤销、账户隔离和移动端回归必须保持通过。
4. 发布清单明确当前代码仍仅支持年费 MVP；活动、权益、积分、兑换入口受 feature flag 或未实现状态保护。

**当前可执行**：现有年费回归（以 CI/本地实际输出为准）。  
**仅规划**：工作台发布；在新迁移、API、E2E、恢复和安全证据齐全前禁止部署为工作台版本。

## 4. 年费 MVP 回归影响

扩展领域不能改变现有年费的事实解释：

- 旧 `fee_cycles` 规则快照、`progress_entries` 增量/撤销和 `fee_events` 年费事件仍是年费聚合的事实源；不得把活动 SpendTaskEntry 或 PointsEntry 直接写入旧表。
- 旧 `calculateProgress` 的非负/非有限校验、金额两位小数、`count_and_amount` 取较低进度以及累计/追加模式必须保持；工作台 `custom/any` 不得回填旧年费 adapter。
- 旧提醒自然键和用户 IANA 时区行为必须保持；新 Reminder/Notification 适配器只能通过事件/端口接入，不能改变旧提醒状态或重复发送。
- 卡片归档、账户删除、导出和所有权过滤必须同时覆盖旧年费表与新表；新复合外键不能导致旧数据孤儿或改变删除顺序。
- 旧 API 的响应形状和 E2E selector 作为兼容读契约保留；新路由不得复用旧字段写入不同语义。

## 5. 冲突条款与合并顺序

### 5.1 已识别冲突/漂移

| 编号 | 位置 | 漂移或冲突 | QA 决策（待 Gate 0 签收） |
| --- | --- | --- | --- |
| C-01 | PRD 4.3 vs 架构 4.2/14.9 vs Round8 产品 | PRD 同时列 `CardActivity.applicable_card_ids` 和规范 `Campaign/Participation`；架构要求用户 participation 绑定单卡/周期。 | 新写只允许 Campaign + per-card Participation；CardActivity 仅兼容读投影，P0 测试对象为单卡单周期。 |
| C-02 | PRD 4.3 vs 架构 5.2/14.9 vs DBA | PRD 允许 `reward_status=pending`；架构/产品要求 `expected_pending`；DBA reward event 状态集合不含旧 pending。 | canonical 写入 `expected_pending`；`pending -> expected_pending` 只做兼容读；奖励必须独立 event sequence。 |
| C-03 | Round8 产品 Q-04 vs 架构/DBA | 产品用 `blocked/needs_review` 描述报名失败后任务；规范任务/参与状态集合没有 canonical `blocked`。 | 不新增 `blocked`，用 `needs_review` + `reason_code=registration_failed/quota_not_allocated`，必要时任务 lifecycle `cancelled/ended`；需产品签收。 |
| C-04 | 架构 5.2 vs DBA 4 | 架构摘要使用 Campaign `expired`；DBA `campaigns.status` 使用 `ended`，且 PRD 活动 `status` 使用 `ended`. | canonical 统一 `ended`；`expired` 只作为旧读值或转换别名，截止/规则过期原因另存。 |
| C-05 | Security 5.2 vs PRD/DBA | Security 建议 enrollment `failed`；PRD/DBA 使用 `rejected`，另有 `needs_review/expired/cancelled`. | canonical 统一 `rejected`（外部拒绝）与 `needs_review`（证据不足/冲突）；`failed` 仅错误结果的原因码或兼容读。 |
| C-06 | PRD 4.5/8 vs 架构第七轮 vs DBA 5 | PRD 暴露 `SpendEntry.posted_on/settled_on`；架构要求 milestone canonical API，DBA 将事实拆为 append-only entry/milestone。 | 写入以 SpendEntry + milestone 事件为准；旧字段只读投影。测试必须覆盖旧 task-entry `Deprecation`，不得产生第二事实源。 |
| C-07 | PRD/UX vs 架构/DBA | PRD BenefitUsage 使用 `redemption_status=redeemed`；架构使用 `used`；DBA ledger 使用 `consume`。 | 用户语义可显示“已核销”；canonical 写事件为 `used`，仅 `used` 触发 `consume`；旧 redeemed/use 只做读映射。 |
| C-08 | PRD 4.6 vs DBA 2.2/7 vs Round8 产品 | PRD 倾向积分整数或最小单位、`earn` 单一入账类型；DBA 规定 `numeric(20,4)+points_scale` 并拆 `pending_earn`/`earn`；产品禁止自动 lot/FIFO。 | 以 DBA numeric/scale 与 pending/confirmed 投影为存储契约；产品展示按账户单位；P1 不自动分配 lot，精度/取整/入账状态未知即 needs_review。 |
| C-09 | PRD 4.7 vs 架构 5.6/14.12 vs DBA 8 | 旧 `status/ledger_status/pending_refund` 与新四轴并存；架构旧 success/fulfilled/debited/returned 仅兼容。 | 新写只接受四轴：order/fulfillment/debit/refund；旧字段仅兼容读取并有映射测试。 |
| C-10 | PRD Source vs 架构 8.1 vs DBA 3 | PRD 一个 Source 对象；DBA 分 `SourceReference`（可变目录）和不可变 `SourceSnapshot`，规则要求 primary citation。 | 规则/事实写入必须引用 snapshot；reference 只做目录；缺 primary snapshot 不能 active。 |
| C-11 | PRD Reminder vs 架构 Notification vs DBA 17 | PRD 以 `Reminder.status` 为主；架构拆 Notification/DeliveryAttempt；DBA 增加 lease/attempt/dead-letter，并要求 dedupe key 含对象版本/sequence/触发时点。 | 业务 Reminder/Notification 与投递尝试分离；同一 reminder/event id 重试，投递失败不改业务状态；旧 fee/progress key 通过 adapter 映射且不双发。 |
| C-12 | Round8 产品 vs Security/DBA | 产品允许记录报名回执、订单/预约/凭证掩码；安全禁止敏感原文；DBA 需长度/哈希/审计约束。 | 只保存掩码/哈希/短摘录，默认脱敏；任何完整 PAN、CVV、token、登录凭据和二维码原件阻断。 |
| C-13 | 架构 7.3 vs DBA 2.1/8 vs PRD | 架构以 user_id 端口隔离；DBA 加复合外键和 fixed-card/merged-pool scope trigger；PRD只声明 owner_user_id。 | API 会话过滤 + PostgreSQL 复合约束双层验收；固定卡兑换必须同卡，合并池才允许空 card_id。 |
| C-14 | Round8 product P0 vs PRD 5.1 | Round8 产品要求活动预检缺事实时不创建确定 SpendTask；PRD P0 流程允许活动后关联任务但边界描述较宽。 | 预检未完成可保存线索，禁止激活确定任务/消费提醒；正式 PRD 合并时补“激活闸门”。 |
| C-15 | PRD 金额/积分字段 vs Round8 DBA 3.2/7 | PRD 允许金额按 `numeric(14,2)`、积分按整数或最小单位；DBA 提出法币首版可 `numeric(14,2)` 但正式契约需冻结，积分统一 `numeric(20,4)+points_scale`。 | Gate 0 先冻结全局精度与币种代码表；Gate 1 用触发器拒绝超 scale/非法 ISO 币种，不能让各模块自行选择精度。 |
| C-16 | Round8 DBA 2.1/2.2 vs 现有年费 schema | 旧 `fee_cycles/fee_events/progress_entries/reminders` 只有单列 FK、可变进度和旧 Reminder 键，可能存在跨用户父子行；新领域不能在未清理时直接加复合 FK。 | Stage 0 先影子库扫描、人工签收和备份/PITR，再以 `NOT VALID` 复合 FK 过渡并验证；旧不可还原进度映射 `needs_review`，禁止删除或自动补齐。 |

### 5.2 串行合并顺序

1. **先由产品签收范围与用户文案**：把 C-01、C-03、C-04、C-05、C-14 定为 P0/P1-a/P1-b，确认 `unknown/needs_review` 的用户下一步；不得先改数据库枚举。
2. **再由架构冻结 canonical 写模型与端口**：按 C-02、C-06、C-07、C-09、C-11 定义状态、命令、事件、旧 adapter 和 canonical API；每个状态轴只由 owner 改写。
3. **DBA 以架构结果落约束**：按 Round8 DBA Stage 0--8 落实 C-08、C-10、C-12、C-13 的表、复合外键、scope trigger、append-only/幂等唯一键、迁移顺序和回滚；Stage 0 先修现有年费 ownership/孤儿和 Reminder 兼容键。
4. **安全复核数据最小化与授权**：确认 C-12 的掩码/保留期限、source/凭证访问、再认证、RLS/worker 最小权限和跨资源 404；安全未签收不得进真实迁移。
5. **QA 编排实现验收**：将 Q-01--Q-15 映射到 API/UI/数据库/审计/事件证据、固定夹具、错误码和跨时区/并发矩阵；旧状态仅兼容读测试。
6. **UX 最后对齐可见状态**：按 canonical 状态设计待核对、处理中、失败、负余额和四轴详情；功能尚未实现时隐藏入口或明确规划，不用未来文案伪装能力。
7. **Integrator 合并正式文档**：按 PRD -> 架构 -> DBA -> 安全 -> UX -> QA 的顺序更新正式文档和索引；每一步保留研究稿链接、签收人和变更摘要。

## 6. 当前可执行性、风险与未决问题

### 当前可执行

- 年费 MVP：卡片、年费周期/事件、进度追加与撤销、提醒、注册/登录、导出/删除的现有自动化回归。
- 研究阶段：文档静态一致性、`git diff --check`、Round8 产品/架构/DBA 与正式约束的只读比对；Round8 DBA Stage 0--8、年费 adapter 和 Gate 0--2 输入已纳入本稿。

### 仅规划/发布前不能宣称

- 活动报名/资格/名额/奖励事件、单卡单周期 SpendTask、消费 milestone/退款、来源快照和规则版本迁移。
- 权益额度账本、预约/拒绝/争议，积分账户/lot/负余额对账、兑换订单四轴和退分。
- 新领域 PostgreSQL 迁移、RLS、worker/inbox/outbox、跨模块 API、移动端扩展页面和导入/同步。

### 风险与未决问题

1. Round8 DBA 研究稿已提供设计约束，但仍无真实 PostgreSQL 15、RLS、append-only 触发器、并发、PITR 或 expand/contract 迁移证据；研究稿不能替代实现签收。
2. `blocked` 是否真的需要独立状态，或统一为 `needs_review + reason_code`，必须在 Gate 0 由产品/架构签收；QA 不允许自行新增枚举。
3. SpendMilestone 的 canonical 路由与 PRD 旧字段投影的兼容期限、错误码和 deprecation header 需定稿。
4. 部分履约/部分扣分是否按 redemption item 还是 order 级事实记录，决定 P1-b 的最小表面；没有 DBA 约束前不能验收“整单完成”。
5. 用户时区改变后只重排未来提醒，历史窗口和已冻结 task timezone 不变；需要固定跨 DST 的测试时钟和迁移策略。
6. 现有年费回归中的旧数据兼容、删除和导出必须在新复合外键上线前做影子库清理与恢复演练。

## 7. 交接

### Changed files

- `docs/research/CARD-DOMAIN-ROUND8-QA.md`（本文件，唯一修改）

### Key decisions

- 以单卡单周期 participation、独立奖励事件、任务内规则/方式快照、UTC/IANA、四轴兑换和真实负余额作为验收基线。
- 15 条 Q 用例覆盖报名截止、版本变更、路由排除、权益改期/拒绝、负余额、部分兑换、提醒、ownership、幂等和年费兼容。
- `expected_pending`、`ended`、`rejected`、`used` 和四轴状态作为待签收的 canonical 倾向；旧名称只允许兼容读取。
- Round8 DBA 已落盘但尚未签收/演练；其 Stage 0--8、现有年费 ownership 修复、复合 FK/RLS、append-only、积分/权益守恒、兑换部分退分上限、Reminder lease/dead-letter 和 PITR 已列为 Gate 0/1 阻断条件；当前代码只有年费 MVP 回归可执行。

### DBA handoff status

Round8 DBA 角色交付已收到并纳入本 QA 复核（`CARD-DOMAIN-ROUND8-DATA.md`）；“已签收”仅表示研究稿交接完成，Gate 0/1 的实现签收、真实 PostgreSQL/RLS、并发、迁移回滚和 PITR 证据仍未完成。

### Validation

- 只读复核 `docs/PRD-WORKBENCH.md`、`docs/ARCHITECTURE-WORKBENCH.md`、`docs/DATABASE-WORKBENCH.md`、`docs/SECURITY-WORKBENCH.md`、`docs/UX-WORKBENCH.md`、`docs/QA-WORKBENCH.md`、Round8 产品/架构/DBA 研究稿。
- 待写入后执行：`git diff --check -- docs/research/CARD-DOMAIN-ROUND8-QA.md`。
- 未运行新领域迁移/API/E2E；不以年费基线通过宣称工作台可部署。

### Risks / open questions

- 见第 6 节；首要风险是 Round8 DBA 约束尚未实现/演练、状态兼容未冻结、milestone 路由双写风险、旧年费 ownership/可变进度和部分兑换粒度。

### Ready for integration

yes。Round8 DBA 研究稿已落盘，主会话可按第 5.2 节串行合并产品、架构、DBA、安全、UX 与 QA；在 Gate 0--5 所需实现、迁移、真实 PostgreSQL/RLS/恢复演练和证据齐全前，活动、权益、刷卡任务、积分与兑换仍必须标为规划能力。
