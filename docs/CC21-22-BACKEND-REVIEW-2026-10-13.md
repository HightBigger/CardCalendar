# 第 21、22 节后端独立验收

日期：2026-10-13。验收人：架构师。实施负责人：后端仔。

**当前结论：R1—R10 后端返工复验通过；第 21、22 节完整产品验收仍待前端真实接入和未覆盖场景验证。**

## 返工后独立复验（2026-10-13）

后端完成 R1—R9 返工后，架构师用专用临时 PostgreSQL 18、独立 Next HTTP 服务和普通成员真实 Cookie 重新运行验收。原 17 项场景全部通过；扩展独立整体目标场景时发现 R10，首次结果为 **17 PASS、1 FAIL**。R10 修复后，架构师再次直接执行脚本，**18/18 PASS，进程退出码 0**。`npm test` 为 25 文件、123 项通过；目录集成测试 55/55 通过；`npm run db:verify` 验证迁移 0000—0011，`npm run typecheck` 和 `git diff --check` 均通过。逐项结果见 `artifacts/cc21-22-backend-acceptance/results.json`。另用进程内请求替身故意制造 1 项 FAIL，确认脚本失败退出码为 1；随后正常重跑并恢复正式结果文件。

### R10 / P1：整体目标修订沿用旧官方达标结论

普通成员创建 `targetCount=1` 的独立整体目标，并通过正式接口将资格确认设为 `met`；随后 PATCH `/spend-tasks/{id}/overall-target` 把目标改成 2 笔，接口返回 200。再次 GET 显示 `targetText=2 笔`，但 `qualificationStatus` 仍为 `met`。修订逻辑在 `src/modules/spend-task/overall.ts` 只将消费评估和累计观察视为冻结证据，漏掉官方核对结论，导致新目标可能继承旧目标的达标状态，并影响奖励条件。

修复结果：整体目标已有消费评估、累计观察或官方核对历史时，普通修订返回 422；过期任务版本仍先返回 409。即使官方结论后来撤回为 `unknown`，已有核对历史也继续冻结目标。新增 PostgreSQL 集成回归覆盖修订拒绝、旧目标/资格保持、依赖奖励和结论撤回。独立 HTTP 场景复验返回 422，再次读取仍为原目标 1 笔、原 `met` 结论，依赖奖励也保持与原目标一致。

本轮 18 项是回归脚本中的场景数，不等于架构合同 21.6/22.6 的全部验收项。正式页面桌面/移动接入、三期缺一期的固定奖励依赖、多卡/每期报名、更完整的时区和筛选组合，以及 worker 强杀恢复与新旧通知并跑，仍需要专项联调或演练；不能据此宣称完整产品发布门已通过。

以下 R1—R9 内容保留首次验收记录；其失败描述是返工前的历史结果，均已在本轮复验通过。

验收依据是 `PRD-WORKBENCH.md` 第 21、22 节及 `ARCHITECTURE-CC21-22-BACKEND.md` 的 B1—B5 合同。交付报告中的“主要模型”“基础设施”不能替代剩余业务能力和恢复证据。以下问题来自真实 HTTP 和实际 worker/cleanup 函数复现，责任在后端实现或后端接口合同；前端接入不能解决清理残留、任务错误激活和事务故障。

## 环境和证据

- 专用临时 PostgreSQL 18，顺序应用迁移 0000—0009。
- 独立 Next HTTP 服务、独立构建目录；账户通过注册和密码登录取得真实 Cookie，卡片通过正式建卡 API 创建，普通成员无管理员 grant。
- 单独启动关闭私人功能开关的进程验证 gate；业务流程使用重新启动的开关开启进程。目录 READ/MANAGE/JOIN 全程关闭。
- Cookie、Origin、幂等键和 owner 检查均经过实际路由。worker 和 cleanup 使用真实实现及同一专用数据库；SQL 故障只注入验收库。
- 共享 3001、`.env`、原业务代码和既有开发成果保留。测试结束清理临时服务/数据库，恢复独立 Next 产生的配置变更。
- 可复现脚本：`artifacts/cc21-22-backend-acceptance/http-acceptance.ts`；请求结果：同目录 `results.json`；独立服务日志：同目录 `server.log`。
- 独立场景共 17 项：8 项 PASS、9 项 FAIL；末次结果记录于 2026-10-13 13:58（Asia/Shanghai）。

复现命令：

```sh
npx tsx artifacts/cc21-22-backend-acceptance/http-acceptance.ts
```

脚本收集每个场景的 PASS/FAIL，以 `results.json` 的逐项结果为准。它是本次验收的回归入口，不代表覆盖了全部需求矩阵。

## 已验证通过

| 验证 | 结果及边界 |
| --- | --- |
| `npm run typecheck` | 后端交付基线通过。 |
| `npm test` | 23 文件、112 测试通过。 |
| `npx vitest run tests/catalog/catalog.integration.test.ts` | 50/50 通过，属于上述测试集合，不能算成额外 50 项新功能覆盖。 |
| `npm run db:verify` | 0000—0009 全新数据库迁移、基础表 smoke 和审计持久化通过。未证明已有 0006 业务数据升级保持全部身份/内容。 |
| `git diff --check` | 通过。 |
| 真实 HTTP 普通成员流程 | 注册 → 密码登录 → 建卡 → 自建定义/参与 → 一次性周期 → 资格核对。 |
| 消费和幂等 | 两笔各 50 元形成 2 笔、100 元；相同键重放不重复创建，不同内容复用同一键返回 409。比较响应按 JSON 结构，不依赖数据库 JSONB 字段顺序。 |
| 奖励事实轴 | 官方达标 → 领取 submitted → confirmed → 分次到账 5+15 元；确认领取不会直接变成 received。 |
| 退款 | 已消费退款后进度降为 50 元、达标和奖励条件重新待核对，先前已到账事实保留。 |
| 两视图 | 本次有日期已完成行动在列表/日历读取相同 ID 和状态。只证明这一条路径，不代表全部筛选/时区组合通过。 |
| 简单 custom | 无卡、无日期待办存在于 undated；create/complete/restore/ignore 历史均保留。 |
| HTTP 访问控制 | 缺会话 401、写请求缺 Origin 403、跨用户卡引用 404。 |

## 必须修复的问题

### R1 / P1：关闭功能开关仍允许写入

位置：`src/server/catalog/private-http.ts:32`，各私人写路由。

将 `FEATURE_TODOS`、`FEATURE_ACTIVITIES`、`FEATURE_ACTIVITY_PERIODS` 全设为 false，真实普通成员 POST `/campaigns` 仍返回 200，并持久化新定义。`privateRoute` 只有鉴权和 runtime，没有按用例检查产品写入能力；worker 也没有相应生成/投递围栏。

修复要求：根据用例实施后端 gate 及依赖关系，能力返回与实际写入一致；关闭新写时保留合法历史读取，控制生成/投递。目录关闭与私人功能关闭分别验证，不能把目录 JOIN 当作私人 gate。

### R2 / P1：现有活动表单空值导致 HTTP 500

位置：`src/modules/campaign/service.ts:16`、`:17`。

现有 `ActivityEditor` 默认 `startOn/endOn/sourceUrl` 为 `""`，API 直接发送 ActivityDraft。相同草稿省略这些字段可以创建；带空字符串则返回 500。`sourceUrl` 的 refine 在无效 URL 上直接调用 `new URL()`，异常绕过可修复的输入错误。

修复要求：在兼容 facade 归一化可选空值为 unknown/未设置；非空非法输入返回明确 4xx。日期未知允许保存线索，来源 URL 保持合法 HTTPS 约束。创建和规则修订都要验证。

### R3 / P1：逐条模式的待办主操作被禁用

位置：`src/modules/participation/catalog-action-projection.ts:42`。

生成 entries 任务并确认资格后，任务 DTO 的 `create_entry/evaluate` 为 true，但关联待办 `primaryAction.enabled=false`。投影只查 `observation` 权限，该权限在 entries 模式必为 false。用户从待办/日历无法进入正常更新进度操作。

修复要求：按任务模式使用对应公开能力；列表、日历和任务详情读取一致的操作权限，保留行动 ID、历史与正常通知。

### R4 / P2：成功保存的消费阶段与读取结果不一致

位置：`src/modules/spend-task/service.ts:31`、`:32`；`src/modules/participation/catalog-queries.ts:135`。

当前前端消费表单发送 `stage:"posted"`、发生日期和金额，不发送 `postedOn`。POST 返回 200，但再次读取该条消费的 `stage` 为 `occurred`；声明仅留在事件 payload，事实 DTO 只按日期推断。对 posted 口径，该记录一直处于 pending。settled 有同类问题。

修复要求：明确声明阶段与真实里程碑日期的兼容合同，不能成功保存后在 DTO 中静默降级。缺里程碑日期不能拿发生日期冒充；应明确返回待补日期/待核对或可修复 422，并提供必要字段及前端 adapter 说明。用真实有日期的 occurred/posted/settled 记录证明确定与预计计算正确。

### R5 / P1：完整数据导出遗漏新事实

位置：`src/modules/participation/catalog-export.ts:18`。

实际 GET `/me/export` 的 `catalogParticipation` 中没有 `period_plan_revisions`、`participation_checks`、`spend_facts`、`spend_fact_events`、`task_evaluations`、`business_date_nodes`、`activity_reward_dependencies`、`workbench_jobs`。本次已存在真实消费/评估和生效计划，其关键事实却无法导出。

修复要求：更新导出版本与完整私人 DTO，覆盖计划、核对、事实/修订、奖励依赖、节点、通知、job/结果及必要候选信息，只读取本用户数据；补完整性测试。不能仅导出 task 表而遗漏其事实来源。

### R6 / P1：异步激活绕过重新校验

位置：`src/modules/participation/workbench-jobs.ts:16`—`:21`。

创建 2027-02 至 2031-02 的 49 期月计划获得 202 job；通过正式 PATCH 卡片接口改为 suspended 后执行 worker，job 返回 succeeded，参与出现 49 个周期。worker 只检查参与 version，未调用计划 validate，暂停卡片没有改变参与 version。交付报告说“worker 再次 validate”，代码和实测均不支持此结论。

修复要求：激活前重新校验用户/卡片/参与/基础版本、规则归属、当前日期、冻结证据及范围；校验失败持久记录 job 失败原因并保留旧计划。同时检查 input hash、attempt/lease fence，不允许晚到 attempt 激活。

### R7 / P1：SQL 失败无法持久记录 job failed

位置：`src/modules/participation/workbench-jobs.ts:8`、`:24`—`:25`。

在验收库给 spend_tasks 插入注入 SQL 故障，实际 worker 抛 `current transaction is aborted`。正常周期写入确实整体回滚，但 job 也回滚到 queued、progress=0、message=null，没有持久失败结果。原因是在同一个已 abort 的事务里 catch 后继续 UPDATE；多个 job 也共用此事务，单项 SQL 故障会中断整批。

修复要求：候选/激活事务回滚后用有效事务记录失败，或正确使用 savepoint 且保证完整业务回滚；按 job 隔离失败、lease/attempt 持久化，避免无限 queued 重试和同批任务互相影响。需要真实 SQL 故障、断电续跑、失败重试与双 worker 证据。

### R8 / P1：删除账户成功但无卡 custom 和节点残留

位置：`src/modules/account/cleanup.ts:65`—`:79`。

真实注册新账户 → 创建无卡 custom → POST `/me/delete-request` → 调用实际 `runAccountCleanup()`。结果是 `anonymizedUsers=1/status=completed`，数据库却还留有 1 条该 owner 的 todo_actions 和 1 条 business_date_nodes。账户只是匿名化，没有物理删除 users；这两条记录没有卡/参与，因此级联删除无法清理。

修复要求：按 owner 显式清理新模型全部数据及无卡 custom/未加入定义/节点通知，再标记 cleanup completed。补完整私人账户、只有 custom 的账户、未加入草稿和失败恢复测试，确认重放不能复活。

### R9 / P1：响应时间基准与分页游标不一致

位置：`src/modules/todos/catalog-todos.ts:334`、`:374`、`:382`；`src/shared/db/unit-of-work.ts:77`。

实际 GET `/todos?limit=1` 返回非空 nextCursor；将该游标和同一次响应的 `meta.asOf` 传给下一页，返回 400“分页游标或 asOf 无效”。本次响应 `meta.asOf=2026-10-13T05:58:00.919Z`，游标内部 asOf 却为 `2026-10-13T05:58:00.921Z`。query 单独生成时间，envelope 使用事务时间，二者没有共享基准；后续 DTO 分组还按当前时间计算，没有采用固定 asOf。

修复要求：一次查询的 envelope、分组和游标共用服务端时间基准；校验游标 owner/筛选和稳定位置，不能要求前端解码不透明游标取得隐藏时间。补至少两页、本地跨日、筛选变化及跨用户复用的实际 HTTP 验证。

## 仍未交付或缺少证明的合同能力

- **overall 独立任务缺少创建/修订用例。** 当前只有 nullable period/overall_target 模型和读取分支；业务代码的 spend_tasks INSERT 均带 period_id。奖励 overall 创建要求 existing overallTaskId，但普通用户没有建立此任务的命令；目录旧导入还显式拒绝 overall 模板。需要真正的全期目标、冻结规则和同源消费多任务验证，不能归类成“只缺前端展示”。
- **候选分批、持久 lease 和恢复未实现合同流程。** period_plan_candidates 只有建表，没有业务写入；worker 一次事务全量 activate，running/lease 与最终结果在同一提交中，不能据此宣称已分批续跑。补明确实现及恢复证据。
- **验收矩阵没有完整证据。** 仍需已有 0006 有数据升级、四种周期/闰日/DST/精确截止、AND/OR 与精度、显式未来采用和冻结历史、多卡/多奖励/每期报名/固定三期依赖、通知并跑/旧事件、全部分页筛选和归档 keep/stop 的实际新功能回归。
- **前端接口差异由后端列出稳定合同。** milestone/reversal 实际使用 `/spend-facts/{id}`，原架构表为 `/spend-entries/{id}`；需要明确兼容入口或最终命名及 adapter 变更。正式 UI 接入由前端后续实施，后端事实能力仍需先具备。

## 返工与复验

优先修复 R1、R6、R7、R8 的写围栏、激活、回滚和清理，然后修复 R2、R3、R4、R5、R9 并完成 overall/候选能力。保持追加迁移、原目录发布/导入和年费历史兼容，不覆盖前端页面、不改共享 `.env` 和 3001。

后端交付报告应逐条回应本报告并引用真实回归名称/结果，修正“worker 已重新 validate”等与代码不符的陈述。架构师收到返工完成后重新验收；此次基本测试通过不等于第 21、22 节正式放行。
