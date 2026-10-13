# CC21-22 后端交付记录

日期：2026-10-13。范围：私人活动、周期/消费事实、奖励、统一待办、业务日期节点、通知和可恢复 worker 基础。本文记录当前仓库中的真实实现与验证边界，不代表前端已完成全部接入。

## 阶段状态

| 阶段 | 状态 | 证据 |
| --- | --- | --- |
| B1 基础与升级 | 已完成 | 独立 `workbenchRuntime`、共享 `UnitOfWork`/幂等 hash、来源分支迁移 0007-0011、0006 有数据升级回归。 |
| B2 统一待办 | 已完成后端基础 | custom POST/PATCH、同一 `todo_actions`、业务日期节点、年费旧 reminders 关联、节点通知 dispatcher。 |
| B3 私人活动 | 已完成最小闭环 | manual campaign/rule/participation 路由、真实 `editorDraft`、规则 revision、节点偏好、奖励创建。 |
| B4 完整周期事实 | 已完成主要后端命令 | 四类边界、snapshot/entries、spend facts、独立 overall 创建/修订与冻结、里程碑/冲正、奖励依赖。 |
| B5 恢复与联调 | 已完成后端恢复路径，完整产品验收待复验 | 候选分批持久化、lease/attempt/input hash、激活前重新校验、失败隔离、真实 HTTP 17 场景。 |

## 实现范围

私人 runtime 不依赖 `FEATURE_CATALOG_JOIN`。manual 活动不读取目录表；catalog 活动仍通过原目录来源和 release 约束。所有写命令通过真实 session Cookie、Origin、owner/card/participation 复合归属和幂等键校验。`ruleId` 仍为 `campaignId`，规则 revision 与 participation version 分开保存。

迁移 0007-0011 保留既有 UUID、action key、历史、release/content 和年费 reminders。`business_date_nodes` 允许只有日期节点的活动/自定义投影；已有 action 时列表与日历仍使用同一个 action。年费继续由原 `reminders` 调度所有者负责，新节点 dispatcher 会拒绝年费调度。

周期计划使用闭区间日期，月计划按本地自然月生成且不再静默截断；billing/custom 必须提供边界，once 必须覆盖完整活动期。当前/历史或已有证据的周期冻结，只有明确的未来 `affectedPeriodIds` 可修订。大计划进入 `workbench_jobs`，worker 以 lease、attempt、输入 hash 和 expected version 恢复。

消费事实独立于任务；同一事实可以分别评估到 period/overall 任务，但每个 `(task,fact)` 只有一个评估。posted/settled、退款、清算和 reversal 作为独立事件保存。奖励依赖保存固定周期集合，不因后续取消偷偷缩小分母。

## 架构验收 R1-R10 返工

针对 [2026-10-13 独立验收](./CC21-22-BACKEND-REVIEW-2026-10-13.md) 的 R1-R9 和追加的 R10，18 场景脚本重新运行结果为 **18/18 PASS**。脚本路径：`artifacts/cc21-22-backend-acceptance/http-acceptance.ts`，逐项输出见同目录 `results.json`。

| 编号 | 修复和可复验结果 |
| --- | --- |
| R1 | `privateRoute` 按 todos/activities/activityPeriods 依赖围栏写请求；三个 flag 全 false 时 POST campaign 为 404，历史 GET 仍可读。worker 停止领取关闭的计划任务，调度器取消被关闭来源的 pending 通知。 |
| R2 | ActivityDraft 的空 `startOn/endOn/sourceUrl` 归一化为未设置；非法非空 URL 返回 400，创建与规则修订共用 schema。真实表单空值 POST 为 200。 |
| R3 | spend action 按 snapshot/entries 分别读取 `observation`/`create_entry` 权限；真实 HTTP 任务和待办主操作同为 enabled。 |
| R4 | `spend_facts.declared_stage` 保留 posted/settled 声明；缺真实 postedOn/settledOn 时 DTO 不降级、评估保持 pending，不猜发生日期为入账日期。0010 回填旧事件声明。 |
| R5 | 私人导出 schemaVersion 2 包含计划、核对、事实/事件/评估、奖励依赖、日期节点、通知、job/候选/outbox/inbox，所有查询按 owner 或 owner 链限制。真实 `/me/export` 不再遗漏关键事实。 |
| R6 | worker 激活事务重新检查活动账户、卡、参与版本、规则归属、计划范围及冻结证据；暂停卡后的 49 期 job 持久 failed，活动周期仍为 0。 |
| R7 | claim/lease 先提交，候选每 48 期单独持久化；激活失败先 rollback，再以独立事务记录 failed/message。真实 SQL trigger 故障返回 failed，旧计划不变，同批任务互不共用故障事务。 |
| R8 | 账户清理显式删除无卡 custom action/node/调度，再清理参与、未加入定义和卡；真实删除流程 completed 后两张表残留均为 0。 |
| R9 | 查询、DTO 分组和首页游标使用同一 `transaction_timestamp`；游标绑定 owner、筛选与 asOf。真实 HTTP 把响应 `meta.asOf` 与 nextCursor 原样用于下一页返回 200。 |
| R10 | 整体目标已有任务评估、累计观察或官方核对历史时，普通修订返回 422；过期任务版本先返回 409。即使官方结论后来撤回为 `unknown`，核对历史仍冻结目标。真实 HTTP 确认 targetCount=1 的任务核对 `met` 后改为 2 被拒绝，GET 仍为 1 笔；依赖奖励读取的 `met` 仍对应未修改的旧目标。 |

新增 `POST/GET /activity-participations/{id}/overall-tasks` 和 `PATCH /spend-tasks/{id}/overall-target`。整体任务有独立键、有限区间、目标、模式和冻结规则；已有消费或官方核对证据时拒绝普通修订。同一消费事实关联 period 与 overall 后，数据库只有一笔 spend fact、两条独立任务评估。0011 为 overall 任务建立参与内稳定键约束。

## 21.6 映射

| 项目 | 后端落点/证据 | 当前边界 |
| --- | --- | --- |
| 21.6-1 | 复合 owner/card/participation/campaign 外键与 route ownership 查询。 | 需继续扩展更多跨账户 HTTP 场景矩阵。 |
| 21.6-2 | `planBoundaries()` 测试四种周期、闰日、DST 时区、闭区间重叠及 132 期不截断。 | 复杂账单周期仍要求用户明确边界。 |
| 21.6-3 | AND/OR 与 12 位整数、2 位小数采用整数分比较及差额计算。 | 复杂自然语言规则仍保留原文，不自动推断。 |
| 21.6-4 | `affectedPeriodIds` 和 evidence freeze 校验；未来修订保留 period ID。 | 有事实周期的显式修正命令仍需产品化。 |
| 21.6-5 | `required_period_ids`、reward dependencies、普通成员创建/修订 overall task 与同源双任务评估测试。 | 前端尚未接入 overall 控件。 |
| 21.6-6 | reward claim/receipt 状态轴与窗口判断。 | automatic 奖励的完整外部适配仍需前端/业务确认。 |
| 21.6-7 | reward reminder policy、归档 keep/stop、business projection 历史。 | 多组件 UI 验证尚未纳入真实 HTTP smoke。 |
| 21.6-8 | 稳定 action/node ID、偏好更新、marker 去重。 | 需要真实 `/calendar-entries` 全链路验证。 |
| 21.6-9 | manual history 与 business projection 分离，reconcile 不复活手动处理。 | 更完整的显式 restore 场景待补 HTTP 测试。 |
| 21.6-10 | unknown 不建日期调度；本地日跨 DST、instant 相等/后一毫秒单元测试。 | 仍需更多真实 HTTP 时区组合。 |

## 22.6 映射

| 项目 | 后端落点/证据 | 当前边界 |
| --- | --- | --- |
| 22.6-1 | 年费 action/node 与旧 reminders 关联；新 dispatcher 排除 annual fee。 | `/calendar` adapter 仍由前端接入。 |
| 22.6-2 | activity/custom/annual_fee 统一 `todo_actions`/nodes 查询模型。 | 前端过滤器需要接入通知历史和 marker DTO。 |
| 22.6-3 | DateValue 分组、无日期 custom LEFT JOIN、独立 count；真实 HTTP 两页成功，owner/筛选游标隔离集成测试。 | 更多筛选组合仍需 UI 联调。 |
| 22.6-4 | 30/7/1 schedule 使用同一 action/version fence，delivery key 唯一。 | 旧 worker 与新 worker 并跑的运维演练待补。 |
| 22.6-5 | snooze 只改 `snoozed_until`，硬截止和业务完成独立。 | 前端延期控件需消费真实字段。 |
| 22.6-6 | 日期、action、schedule 在同一事务投影。 | 领取确认与到账 UI adapter 尚未齐全。 |
| 22.6-7 | 18 场景真实 Next HTTP 验证普通成员从注册、建卡、活动、消费、奖励到待办/日历/导出，以及官方核对后的整体目标冻结。 | 前端实际页面仍待接入。 |
| 22.6-8 | 真实 HTTP 覆盖无卡无日期 custom、完成/恢复/忽略和历史持久化。 | 更多可选卡/日期组合仍需联调。 |

## 验证命令

已通过：

```text
npm run typecheck
npm test                         # 25 files / 123 tests
npx vitest run tests/catalog/catalog.integration.test.ts  # 55/55
npm run db:verify                # 0000 -> 0011 + db smoke + audit persistence
npm run test:http-workbench
npx tsx artifacts/cc21-22-backend-acceptance/http-acceptance.ts  # 18/18
```

HTTP smoke 使用临时 PostgreSQL 和独立 Next dev 进程；架构验收脚本还使用正式注册、密码登录、建卡和 worker/cleanup 路径。共享 3001、`.env` 和现有 `.next` 未作为测试数据库或 server 使用。目录集成测试在已有 0006 数据上应用后续迁移，并核对 rule content/release、task/action/participation 身份。

## 恢复、并发和回滚证据

每个命令在一个 PostgreSQL transaction 中完成，幂等回执按 owner/scope/key 和规范化输入 hash 唯一；重复请求返回已提交结果，换 payload 返回 409。锁顺序遵循 user/session、card、participation、period/task/reward、node/action/schedule。worker claim 先持久化 `running/attempt/lease_token/lease_until`，每 48 期提交候选和进度；激活事务再次调用 `PeriodPlanService.validate`，检查候选完整性和 lease/attempt fence。激活失败由新的事务记录 failed；候选不参与正常查询。集成测试验证过期 lease 重领、两个 worker 并发只成功一次、49 期候选完整；真实 SQL 故障和卡暂停分别保留 0 个新周期及失败原因。

事务失败会 rollback 业务事实、投影、调度、审计和 outbox；目录 0004-0006 不被修改，0007-0011 由迁移脚本按序执行。账户清理和 schemaVersion 2 导出已覆盖新的私人 owner 链；正式恢复演练仍应验证进程被强杀后 lease 到期重新领取。

## 前端 adapter 缺口

后端已提供但当前前端仍需适配的字段/路径包括：通知历史 `GET /todo-notifications`；实际里程碑/退款为 `POST /spend-facts/{id}/milestones`、`POST /spend-facts/{id}/reversals`（旧架构草案中的 `/spend-entries/{id}` 不是可用路由）；`GET /jobs/{id}`；manual plan 的 `ruleVersionId/participationVersion/affectedPeriodIds`；节点 marker、custom `business_date_nodes` 和真实 HTTP 错误/冲突详情。`SpendDraft.stage=posted/settled` 可先声明阶段，若无真实 `postedOn/settledOn`，DTO 保留声明但该口径进度为 pending；前端需提供日期输入与待补提示。

overall 任务创建使用 `POST /activity-participations/{id}/overall-tasks`，请求含 `key/startOn/endOn/timezone/targetKind/targetCount?/targetAmount?/currency/mode/ruleVersionId/participationVersion`；列表 GET 返回任务 DTO。无证据修订使用 `PATCH /spend-tasks/{id}/overall-target`，同字段外加 `expectedVersion`；已有任务评估、累计观察或官方核对历史时返回 422，过期版本返回 409。核对结论撤回为 `unknown` 后，原目标仍冻结。活动详情 `overallTasks` 提供 task ID，奖励创建的 `overallTaskId` 必须引用其中之一。前端仍需目标表单、同源多任务选择和只读冻结态。

仍待扩展的验收边界：正式页面桌面/移动接入；三期缺一期的固定奖励依赖、多卡/每期报名与更多时区筛选的真实 HTTP 组合；worker 进程强杀后恢复与旧年费/新通知 dispatcher 并行演练。现有 18 场景和新增单元/集成测试不代表整个 21.6/22.6 矩阵已经全覆盖。
