# Cardfolio 卡领域 QA 跨域边界复核

| 项目 | 内容 |
| --- | --- |
| 文档版本 | v0.1 follow-up |
| 角色 | QA / 发布审查 |
| 复核日期 | 2026-08-14 |
| 复核基线 | 当前 working tree（保留既有未提交变更） |
| 复核输入 | `PRD-WORKBENCH.md`、`ARCHITECTURE-WORKBENCH.md`、`DATABASE-WORKBENCH.md`、`SECURITY-WORKBENCH.md`、`QA-WORKBENCH.md`、`UX-WORKBENCH.md` 及 `docs/research/CARD-DOMAIN-*` |
| 交付性质 | 只读研究/审查；不代表规划能力已经实现 |

## 1. 结论与适用边界

当前代码仍是年费 MVP。现有实现可以回归年费事件、年费进度、提醒、卡片档案和账户清理；活动、权益、积分批次、兑换、来源快照和工作台新提醒尚无可执行领域实现。因此本稿的扩展矩阵是实现后的验收契约，不是当前功能清单。

本稿采用以下发布分期：

| 版本 | 可验收范围 | 不得暗示已实现的能力 |
| --- | --- | --- |
| P0 | 活动规则可关联多卡；每卡独立 participation、名额、单卡 SpendTask、奖励事实；发生/入账/清算、退款冲正、奖励人工核对、站内提醒；来源/规则版本 | 权益额度账本、积分账本、兑换、自动报名或自动发奖 |
| P1-a | 权益下发、预约、出示、核销、取消/拒绝/争议和额度流水 | 预约成功等于使用、自动向服务商预约、把争议当作扣减 |
| P1-b | 积分账户、PointsEntry、PointsLot、对账/到期和外部手工兑换双状态 | 系统内积分预占、自动 lot 分配、自动兑换、失败即自动退分 |
| P2 | 导入确认写入、自动 lot 建议/执行、reservation/hold、第三方连接器和外部推送 | 任何 P2 能力提前进入 P0/P1 发布承诺 |

测试结果使用四种证据标记：`D` 领域/状态机，`I` 数据库/事务/事件集成，`A` API/权限契约，`E` Playwright/移动端。只有对应实现、迁移和证据都存在，矩阵项才可标记通过。

## 2. 统一测试夹具与判定规则

固定夹具至少包含：用户 U1、用户 U2；同一活动 C；U1 的卡 A、卡 B；规则版本 RV1/RV2；一个发生日跨截止日的消费；一笔部分退款和一笔全额冲正；一个明确奖励发放日；权益 E 及一次预约/一次争议；积分账户 PA、两个 lot（一个明确到期、一个到期未知）；兑换订单 R。

所有写命令必须同时测试：

1. 同一 aggregate、同一命令、相同 `Idempotency-Key` 和相同 request hash 重放时只产生一次业务效果并返回原响应。
2. 相同 key 搭配不同 payload 返回 `409 IDEMPOTENCY_KEY_REUSED`，不产生新事实。
3. key 至少包含 aggregate 和命令作用域；同一 key 在卡 A 与卡 B 之间不得把 A 的响应重放给 B，未允许复用时应返回冲突。
4. 版本冲突返回 `409` 并保留已提交事实；跨用户或已归档无权对象统一 `404`，不泄露标题、余额、来源或 ID 存在性。
5. 事实 append-only；修正使用 reversal/correction 关联原事实，不能 PATCH 或删除原流水。

日期规则：业务日使用 `date`，事件瞬时使用 `timestamptz`；提醒保存冻结的 IANA 时区和 UTC 触发时间。至少用 `Asia/Shanghai`、`America/Los_Angeles`，覆盖本地截止日 00:00/23:59、月末、闰日和 DST 前后。改时区只重排未来提醒，历史发生时间与原时区不变。

## 3. P0 可执行测试矩阵

### 3.1 活动、多卡和奖励

| 编号 | 前置/动作 | 通过断言 | 证据 |
| --- | --- | --- | --- |
| P0-ACT-01 | C 关联卡 A/B；分别创建参与实例 | 仅有 `(U1,C,A)`、`(U1,C,B)` 两条实例；复合唯一约束阻止第三条同键实例；卡 A/B 的 task、reward 引用各自实例 | D/I/A |
| P0-ACT-02 | 修改 A 的资格、报名、名额、任务或奖励状态 | B 的五轴状态、流水、提醒和时间线完全不变；详情不出现跨卡汇总 | D/E |
| P0-ACT-03 | 以同一幂等 key 重复记录 A 报名结果，再用同 key 记录 B | A 重放原参与结果；B 不复用 A；错误 payload 为 409；不重复创建任务、事件或提醒 | A/I |
| P0-ACT-04 | A、B 各录入目标一半的消费 | 不合并计数/金额，不生成跨卡达标；首页可汇总数量但不能把合计作为任一卡进度 | D/E |
| P0-ACT-05 | 依次写入资格、报名、名额 `unknown/full/not_allocated`、任务达标 | 五轴独立；任一必需轴未知/失败都不能产生最终确认；`available` 不自动转 `allocated` | D/A |
| P0-ACT-06 | RV1 下创建进行中任务；RV2 覆盖后创建新任务 | 旧任务/流水仍引用 RV1；新对象引用 RV2；生效区间重叠被拒绝；历史不会被静默重算 | I/A |
| P0-REWARD-01 | task 进入 `target_reached`，未有官方奖励证据 | 不创建积分/权益/奖励到账事实；UI 显示“已达标/奖励待发”而非已获得价值 | D/E |
| P0-REWARD-02 | 有 `expected_on`，时钟越过发放日且未记录到账 | reward 转 `delayed`，只生成一条 `reward_verification` 提醒；未定义发放日时不自动计算逾期 | D/I/E |
| P0-REWARD-03 | 先记到账，再记撤回或争议 | 追加独立撤回/争议事实，保留原达标和到账历史；不删除、不改写 participation；重复撤回幂等 | D/I |

### 3.2 单卡消费、冲正和提醒

| 编号 | 前置/动作 | 通过断言 | 证据 |
| --- | --- | --- | --- |
| P0-SPEND-01 | 任务选择 `snapshot` 后追加 entry；选择 `entries` 后设置累计值 | 两种输入模式互斥；非法动作返回业务错误；确认进度可从事实重放，不能双计 | D/A/I |
| P0-SPEND-02 | 分别写 `occurred`、`posted`、`settled`，切换 `cutoff_basis` | 只满足所选口径和日期窗口的记录进入 confirmed；其他仅进 pending/预计；里程碑只允许单向追加 | D/I |
| P0-SPEND-03 | 对已计入的消费写部分退款，再写全额冲正 | 原 entry 只读；反向 entry 关联 `reversal_of_entry_id`；累计反向金额不超过原值；进度下降可重算 | D/I/A |
| P0-SPEND-04 | 对已关闭/已确认任务写跨周期退款 | 保留原达标快照，当前状态变 `disputed/needs_review`；产生一条待核对提醒；不自动撤回奖励或推断银行结论 | D/I/E |
| P0-SPEND-05 | 两个并发请求追加同一业务 entry；worker 重投同一事件 | 至多一条 entry 和一次进度变化；同 key 原响应重放；inbox `(consumer,event_id)` 去重 | I/A |
| P0-SPEND-06 | 输入负数普通进度、非法币种/精度、`occurred > posted > settled` | 被拒绝并保留表单；退款只能走明确冲正入口；错误响应说明字段原因，不写部分事实 | D/A/E |
| P0-REM-01 | 活动截止、任务截止、奖励核对各生成节点；worker 重跑/归档卡 | 每个对象+节点+类型只有一个 dedupe key；完成/忽略/稍后处理只改变提醒，不改变业务状态；归档取消未来提醒但保留历史 | I/E |
| P0-TIME-01 | 在两时区、DST 切换、闰日和截止日边界运行提醒 | 本地日期计算正确，UTC 触发不重复/不跳过；改时区只影响未来节点，历史显示原时区和时间 | D/I/E |

### 3.3 P0 来源、权限和移动状态

| 编号 | 前置/动作 | 通过断言 | 证据 |
| --- | --- | --- | --- |
| P0-SRC-01 | 抓取/粘贴来源，内容 hash 变化，再由用户核对 | 抓取只记录 `Captured`；只有用户核对产生 verified 事件；hash 变化进入 `needs_review`，不覆盖原快照 | D/I/A |
| P0-SRC-02 | 新 RV 生效后查看旧任务和列表 | 所有历史对象可见原 `rule_version_id`、来源和访问日期；列表/详情不把新规则套到旧流水 | I/E |
| P0-AUTH-01 | U2 读取/修改 U1 的 activity、entry、source、reminder；使用猜测 ID | 统一 404；响应、日志和审计不泄露对象存在性或敏感字段 | A/I |
| P0-MOBILE-01 | 360、390、768 px 查看五轴活动、退款重开、奖励延迟、来源存疑和提醒 | 状态同时有中文文字与非颜色图形/图标；关键日期、当前/目标/剩余、原因不裁切；无横向滚动 | E |
| P0-MOBILE-02 | 390 px 打开记录/核对底部抽屉，键盘、Escape、网络失败和重复点击 | 主操作在安全区可见；焦点打开后进入抽屉、关闭后回触发器；草稿保留；未知写入结果不重复提交 | E/A |

## 4. P1 可执行测试矩阵

### 4.1 P1-a 权益取消与争议

| 编号 | 前置/动作 | 通过断言 | 证据 |
| --- | --- | --- | --- |
| P1-BEN-01 | entitlement `pending_delivery` 无凭证；记录下发失败/补充凭证 | 无凭证不能显示 `available`；下发事实、来源、核对时间可审计；失败不扣额度 | D/I/E |
| P1-BEN-02 | 创建预约，随后取消；现场拒绝；打开争议 | `confirmed/cancelled/rejected/disputed` 只改变预约或结果轴；不写 consume、不减少 remaining | D/I |
| P1-BEN-03 | 两个并发 `redeemed`，再重复同一请求 | 只有一次 consume；第二请求返回原结果或版本冲突；额度不会负数或静默截断 | I/A |
| P1-BEN-04 | 已 redeemed 后 `reverse_usage`，重复 restore 或超用 | 原 usage/consume 保留；只追加一次 restore；重复恢复、真实负剩余进入 `needs_review` | D/I |
| P1-BEN-05 | 归档卡、权益到期后补记实际使用/争议 | 停止未来权益提醒；历史可读；补记带实际发生时间和补记时间，不重开旧周期 | I/E |
| P1-BEN-06 | 预约要求、地区、渠道、附属卡和同行人限制分别 unknown/不满足 | 列表和详情显示限制；未知不得显示“可用”；取消/拒绝/争议文案不暗示扣减 | D/E |

### 4.2 P1-b 积分 lot、对账和到期

| 编号 | 前置/动作 | 通过断言 | 证据 |
| --- | --- | --- | --- |
| P1-PTS-01 | 从零重放 earn/adjustment/expire/redeem_debit/reversal | `ledger_balance = sum(entries)`；entry 追加不可编辑；余额序列唯一、可重建 | D/I |
| P1-PTS-02 | 两个 lot：一个明确 `expires_on`，一个 expiry unknown；部分使用、用尽、作废 | lot 状态与分配流水一致；unknown 不生成日期/提醒；明确日期才进入到期队列 | D/I/E |
| P1-PTS-03 | `ledger_balance` 与 lot 合计产生正、负差额 | 分开显示 `reconciliation_difference` 与 `unallocated_difference`；正差额不虚构 lot/到期日，负差额进入 `mismatch/needs_review`，不自动调账 | D/I/E |
| P1-PTS-04 | 最早到期 lot 有用途限制，用户尝试兑换 | 仅生成建议并要求用户确认；不能静默跳过受限 lot 或改变用户选择；单位/精度不混算 | D/A/E |
| P1-PTS-05 | 账户冻结/关闭、跨卡合并池与单卡账户混用 | 冻结禁止新兑换但可按策略查看/对账；关闭停止提醒并保留历史；单位和 card/account 归属不串 | D/I/A |
| P1-PTS-06 | 到期日临界时刻、改时区、DST 后运行 expiry worker | lot 以业务日到期；只对明确证据生成一次提醒；历史到期日不随用户改时区改写 | D/I/E |

### 4.3 P1-b 兑换失败、退款和重复请求

| 编号 | 前置/动作 | 通过断言 | 证据 |
| --- | --- | --- | --- |
| P1-RED-01 | 创建 `planned/submitted/processing`，外部结果 `success` 但本地未扣分 | 订单轴和积分轴独立；显示“订单成功，积分扣减处理中”；success 不等 `posted` | D/E |
| P1-RED-02 | 外部订单 `failed/cancelled/unknown`，重复记录失败 | 保留订单和失败证据；不写 reversal、不猜测积分退回；重试只更新允许的状态轴且幂等 | D/A/I |
| P1-RED-03 | `success` 后用户确认官方已扣分 | 以 `redemption:{id}:debit` 只写一次 `redeem_debit`；批次选择和金额可追溯；余额不足时保留真实负账面并标 `needs_review` | I/A |
| P1-RED-04 | 已 posted debit 后订单退款，先重复/乱序 worker，再确认官方积分退回 | 没有官方退回证据前为 `refund_pending`；仅一次等额关联 reversal；乱序/重复事件不重复记账 | D/I |
| P1-RED-05 | 退款无原 posted debit、不同账户/卡或不同 request hash | 返回业务冲突或 404，不创建孤立 reversal；跨账户不可借用余额 | A/I |
| P1-RED-06 | 360/390 px 查看处理中、失败、退款待核对、已退款 | 订单状态、积分扣减状态和下一步动作并列为文字；不以绿色成功色表达处理中或“已退款”无流水 | E |

## 5. P2 可执行测试矩阵

| 编号 | 前置/动作 | 通过断言 | 证据 |
| --- | --- | --- | --- |
| P2-IMP-01 | 重复 CSV/PDF、重复行、错误行和恶意附件进入导入 | 首先生成隔离的 source snapshot/预览；不覆盖人工事实；错误行可下载，附件扫描/清理/权限可审计 | I/A |
| P2-IMP-02 | 用户逐行确认、撤销和重放导入 | 只有明确确认才写入 canonical entry；每行有来源、版本、幂等键；撤销追加 correction，不删除原事实 | D/I |
| P2-LOT-01 | 自动 lot 建议遇到未分配差额、用途限制、到期 unknown | 建议可解释且可拒绝；不虚构 expiry、不静默分配、不把 suggestion 当事实；失败进死信/告警 | D/I/E |
| P2-HOLD-01 | 并发兑换使用系统内 reservation/hold，随后取消、超时、释放 | hold/release 是独立流水；过期可回收；不能复用 P1 `pending`，并发不超扣 | D/I |
| P2-CON-01 | 第三方同步 token 撤销、权限不足、超时和重复回调 | 最小权限、撤销和删除生效；重试有退避/死信；未经用户确认不写入活动、权益或积分事实 | I/A |
| P2-REC-01 | 备份恢复、outbox/inbox 重放、缓存损坏和 worker 宕机 | 事实可从零重建；投影标 `as_of/stale`；不会因恢复重复扣分、发提醒或覆盖 rule version | I |

## 6. 发布门与阻断项

### Gate 0：契约冻结（实现前）

- [ ] 活动五轴（资格、报名、名额、任务进度、奖励）和独立 reward fact 在 PRD/架构/DB/QA/UX 中同名；旧枚举只允许兼容读。
- [ ] `snapshot/entries`、`occurred/posted/settled`、退款 reversal、`needs_review` 和旧年费 progress adapter 的写入边界已冻结。
- [ ] Reminder 表/索引包含对象类型、节点类型、冻结 IANA 时区、UTC 触发、dedupe key 和归档取消语义。
- [ ] 来源捕获与用户确认事件分离；RuleVersion 生效区间、content hash 和历史引用不可覆盖。
- [ ] 所有命令的 key 作用域、request hash、expected version、409/404 错误和审计字段已有契约测试。
- [ ] 兑换采用 `status=success` + `ledger_status` 双轴；`fulfilled/debited/returned` 不进入新写入；权益预约/核销双轴与额度流水分离。

### Gate 1：P0 发布

- [ ] P0 矩阵通过，且有真实 PostgreSQL 迁移、复合 FK/唯一约束、RLS/所有权、append-only 约束、outbox/inbox 去重和回滚/恢复证据。
- [ ] P0 Playwright 覆盖双卡隔离、退款重开、奖励延迟、来源版本、空/处理中/失败/逾期和 360/390 px；失败状态不是只读 UI 文案。
- [ ] 金额/日期精度、Asia/Shanghai 与 America/Los_Angeles、DST/闰日、重复请求、并发和 worker 重试均通过。
- [ ] 既有年费 MVP 基线保持通过；任何扩展模块缺表/路由/事实时不得以年费 E2E 通过替代。

### Gate 2：P1-a/P1-b 发布

- [ ] 权益预约、取消、拒绝、争议不扣减；只有首次 redeemed consume；restore 和超用可重放。
- [ ] PointsEntry/PointsLot/对账恒等式可从零重建；到期 unknown 不提醒，差额不静默造 lot/调账。
- [ ] 兑换 success 与 ledger posted 可分离；失败/取消不退分；posted debit + 官方退回证据才允许一次 reversal；真实负差额保留并标 `needs_review`。
- [ ] P1 移动端同时表达业务状态、账本状态、来源和下一步动作；导入仅预览/待确认，不绕过权限、来源和审计。

### Gate 3：P2 发布

- [ ] 导入确认写入、附件隔离、自动 lot、reservation、连接器、回调、死信和恢复演练分别通过安全/权限/数据删除评审。
- [ ] P2 不得改变既有 P0/P1 事实语义或把自动化失败解释为外部成功/退分。

### 当前阻断项

1. 扩展领域表、迁移、API、RLS、outbox/inbox 和 worker 尚未落地；P0/P1 矩阵当前不可执行，不能发布工作台版本。
2. 正式架构、PRD、DB 和 UX 仍存在 canonical 状态/API/事件漂移风险，尤其是 quota/reward、Reminder DDL、权益投影和兑换字段双轨；Gate 0 未关闭前不得开工实现。
3. 当前代码只有年费进度撤销，不能替代活动消费退款关联、奖励撤回、权益 restore 或积分 reversal 的领域证据。
4. 当前实现只支持年费/进度提醒，不能宣称活动截止、奖励延迟、权益到期或积分 lot 到期提醒已经可靠。
5. 当前 E2E 复跑环境被 3000 端口复用的开发服务器与生产构建争用破坏，需在干净、单独端口的服务器上重跑后才能作为 MVP 浏览器回归签收。

## 7. 当前 MVP 回归基线（实测）

### 已通过

- `npm test`：17 个测试文件、45 个测试通过。覆盖年费规则（月末/闰日）、进度计算/累计/撤销、提醒状态/去重/Asia/Shanghai 09:00、卡片服务、认证/安全、账户清理和 worker heartbeat。
- `npm run typecheck`：通过，`next typegen` 成功。
- `npm run build`：通过；构建路由只有年费、卡片、进度、fee-events、reminders、auth、dashboard 等现有 MVP 路由，没有活动/权益/积分/兑换领域路由。

### 未通过或未验证

- `npm run test:e2e`：2 条用例均失败，未进入业务断言。第一条在登录注册表单等待“称呼”控件超时，第二条看到 404；诊断显示 3000 端口已有同一工作树的开发服务器，但生产构建期间 `.next` 文件被复用服务读取不一致，`/login` 返回 `_document.js` 缺失。该结果不能解释为扩展领域回归通过或失败。
- 未运行数据库迁移/回滚、临时 PostgreSQL、扩展领域 API、P0/P1 Playwright、`npm audit` 或备份恢复；当前 package scripts 也没有活动/权益/积分/兑换测试入口。

### MVP 允许的回归声明

只有上述年费范围可称为“当前 MVP 回归基线”。必须先在干净端口/干净开发缓存重跑两条现有 E2E，再把浏览器状态、无溢出和提醒时间线作为 MVP 证据签收。不得用这组基线声明工作台 P0、P1-a、P1-b 或 P2 已实现。

## 8. 交付说明

- **Changed files**: 仅新增 `docs/research/CARD-DOMAIN-FOLLOWUP-QA.md`；未修改代码、迁移、package、正式契约文档、ledger 或其他角色文件。
- **Decisions**: 以“多卡规则 + 每卡独立事实”、活动五轴/独立奖励、发生/入账/清算与冲正、权益预约/核销双轴、积分 lot 恒等式、兑换订单/扣减双状态、来源捕获/用户确认分离、UTC/IANA/dedupe 和 360/390 px 文字状态表达作为唯一 follow-up 测试口径；P0/P1/P2 按本稿分期。
- **Validation**: 已完成静态交叉审查；`npm test` 17/17 文件、45/45 用例通过；`npm run typecheck` 和 `npm run build` 通过；`npm run test:e2e` 2/2 失败于复用开发服务器/构建缓存环境，未进入扩展领域断言；最终执行 `git diff --check`。
- **Risks/open questions**: Gate 0 的 canonical 文档漂移、P0 Reminder DDL、历史 progress adapter、活动名额/奖励事实、积分最小单位与 lot 分配策略、来源附件留存/SSRF、未来 workspace 隔离仍需责任角色签收；当前 E2E 需干净端口重跑。
- **Ready for integration**: yes（本研究稿可供主会话整合）；对应工作台功能 release readiness 为 no，直至 Gate 0/1/2/3 中适用项和阻断项关闭。
