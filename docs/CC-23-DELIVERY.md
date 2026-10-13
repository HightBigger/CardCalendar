# CC-23 交付记录：银行活动目录、发布与个人加入

日期：2026-10-09。实现依据：[PRD §23](./PRD-WORKBENCH.md)、[目录架构](./ARCHITECTURE-ACTIVITY-CATALOG.md)、[活动与待办架构](./ARCHITECTURE-ACTIVITIES-TODOS.md)、[前端架构](./FRONTEND-ARCHITECTURE.md)。

本次完成管理员草稿、校验预览、显式发布、修订及下架，成员目录与官方来源阅读，以及目录加入所需的真实 PostgreSQL 私人最小闭环。加入、未来版本采用、下架跟踪决定、累计观察、人工核对、领取和实际到账有持久化、事务及所有权校验。

这是供用户和架构师审阅的分阶段交付。第 21、22 节完整私人后端及批量任务尚未具备，三个目录开关仍默认关闭；不能据此宣称九项完整上线验收或生产负载、恢复验收已经完成。未执行提交、推送或部署，未修改当前 `.env`，未重启共享 3001 服务。

## 1. 文件与职责

| 文件/目录 | 本次实现 |
| --- | --- |
| `db/migrations/0004_activity_catalog.sql` | 稳定银行标识、官方域名、当前管理员授权、卡片明确银行关联；目录、草稿、不可变发布版本、历史、幂等结果和 outbox。 |
| `db/migrations/0005_catalog_personal_import.sql` | 私人活动和冻结规则、每卡参与及周期、修订、任务与累计观察、奖励与结果事件、TodoAction、通知调度/记录、个人历史及 inbox/outbox；组合外键绑定 owner/card/campaign/rule。 |
| `src/modules/activity-catalog/` | 会话/当前授权围栏、目录查询、发布校验、版本/hash 冲突和原子命令。沿用架构师提供的公开端口。 |
| `src/modules/participation/catalog-{import,lifecycle,queries,commands,export}.ts` | 最小私人导入、查询和事实命令；仅更新明确选择的未启动未来期，当前期通过冻结或追加核对修订保留事实。 |
| `src/modules/todos/{catalog-todos,notification-dispatch}.ts` | 单一行动及列表/日历投影、行动历史、通知版本围栏、具体时刻和延期调度、停机后节点去重。 |
| `src/server/catalog/`、`src/server/workflows/catalog-participation.ts` | Request/Response 适配与跨模块编排；私人表写入由私人模块的公开方法负责。 |
| `app/api/v1/bank-activities/`、`admin/bank-activities/`、`me/capabilities/`、`banks/` | 成员和管理员目录 API。 |
| `app/api/v1/catalog-cards/`、`activity-participations/`、`spend-tasks/`、`activity-rewards/`、`reward-claim-attempts/`、`todos/`、`calendar-entries/`、`todo-notifications/`、`workbench/` | 本人选卡、明确银行关联及目录私人闭环 API。 |
| `src/frontend/features/activity-catalog/`、`catalog-admin/`、`activity-rules/` | 各自的 API/application/UI；规则展示和字段为纯共享组件，UI 不直接请求网络。 |
| `src/frontend/pages/bank-activities/`、`catalog-admin/` 与对应 `app/` 路由 | 成员、管理员页面组合和会话能力控制。 |
| `app/dev/catalog/` | 开发环境的隔离浏览器验收入口，渲染上述真实组件和 adapter；生产环境返回 404。 |
| `scripts/catalog-role.ts`、`catalog-dispatch.ts`、`src/workers/catalog.ts` | 可信部署授权/撤权命令、目录事件手动派发及 worker 入口。 |
| `tests/catalog/`、`e2e/catalog.spec.ts`、`e2e/support/catalog-postgres.ts` | 临时真实 PostgreSQL、业务/事务/并发测试和浏览器验收。 |

共享文件只做兼容追加：AppShell/Workbench 导航和当前会话能力、Resource 类型、ActivityDetail 的可选 `catalogSource` 和周期版本、个人详情的来源控制与限制说明、Todo 的 `catalog_only` 覆盖声明。未替换切图仔1正在实现的私人活动、待办和共享查询层。

其他最小共享改动为 `.env.example` 的三个默认关闭开关，`scripts/migrate.ts` 忽略 AppleDouble `._*.sql`，账户清理删除私人目录事实而保留平台发布版本，导出纳入本人的目录事实，以及 worker 在 JOIN 开关启用时注册 `catalog.dispatch`。原年费 E2E 仅把本次涉及的提示定位限定到 `.toast[role=status]`；隔离测试支持和其他共享改动保留原工作区内容。

## 2. 权限和事务边界

- HTTP 目录身份来自真实 `cardcalendar_session` cookie；`x-user-id` 不能取得目录管理身份。注册和个人资料没有自助管理员授权入口。
- 每次查询/命令检查有效账号、会话和当前授权。管理命令先校验当前权限，再读取幂等结果；撤权后旧会话及同键重试也失权。授权行锁与发布、撤权形成围栏。
- 发布要求明确名称、银行、活动日期和已核对的官方银行域名来源。发布再次核对目录版本、草稿版本及规范化内容 hash；release、目录指针、历史、审计、幂等结果和 outbox 一起提交或回滚。
- 关键未知条件保留未知，阻止相应执行；读取和加入预览不写入个人事实。正式加入先校验全部卡片的所有权，再原子创建私人快照、参与、周期、奖励和行动。重复及并发加入复用现有参与。
- 管理员仅拥有目录内容权限，无法因此读取其他成员的私人数据。组合外键进一步阻止跨 owner/card/rule 的记录关联。
- 采用新版本只调整用户明确选择的未启动且无事实未来期，保持稳定 ID 和规则来源；当前期及已有观察、领取、到账事实保留。发布事件通过 inbox 去重，不代替用户采用。
- 目录下架与银行确认取消分别处理。下架阻止新加入，保留原版本与原因，成员决定未来跟踪和奖励提醒；银行取消需要官方证据并停止消费行动。自然结束保留领取窗口内奖励处理。

## 3. 当前 3001 的可重复验收

3000 属于另一个项目；3001 已有共享开发服务。以下命令复用 3001，临时数据库由测试创建和销毁，不修改共享服务的数据库或功能开关：

```sh
npm run typecheck
npm test
npm run db:verify
npx playwright test e2e/catalog.spec.ts --output=test-results/catalog
E2E_ISOLATED_MVP_ROUTES=true npx playwright test e2e/mvp-flow.spec.ts --output=test-results/mvp
git diff --check
```

观察浏览器步骤可给目录命令增加 `--headed`；需要逐步检查时使用 `PWDEBUG=1`。目录 E2E 在真实浏览器中渲染 `/dev/catalog`，请求被转给当前代码的真实 Request/Response handler，并连接临时 PostgreSQL。管理员与成员使用分别创建的真实会话。它验证业务和适配器，不验证 Next HTTP 路由分发、middleware 或实际网络部署。

验收入口参数如下，只有上述隔离测试会准备相应会话、数据及请求转发；单独打开共享服务上的 URL 不会自动获得测试账号或数据：

| 入口 | 观察流程 |
| --- | --- |
| `/dev/catalog`、`?id=<目录 UUID>` | 成员筛选、规则及官方来源、选卡、只读加入预览、明确确认加入。 |
| `/dev/catalog?manage=true&id=<目录 UUID>` | 新版草稿、成员预览和发布校验、确认发布、下架原因和历史；普通成员不能进入。 |
| `/dev/catalog?section=personal&id=<参与 UUID>` | 原始/采用/最新发布来源、规则差异、明确采用未来期或处理下架跟踪。 |
| `/dev/catalog?section=todos&view=list`、`view=calendar` | 同一 action ID/version 的两视图及筛选保持。`section` 和 `view` 分别控制页面与待办视图。 |

测试数据名称明确标记“验收用活动（非真实银行活动）”。夹具链接和摘录不能用于真实活动发布。

本次生成并检查的截图：

- [成员目录 360px](../design-prototypes/screenshots/cc23-member-360.png)
- [管理员表单和发布预览 1440px](../design-prototypes/screenshots/cc23-admin-preview-1440.png)

## 4. 真实接口的手动复现前提和步骤

此部分供后续受控本地联调使用，未在共享服务上自动执行。当前 `.env` 保持 `USE_DATABASE=false`，目录开关关闭，正式路由预期不可用。不能向正在运行的进程补设环境变量来开启它；需要由工作区负责人安排联调服务启动，避免与共享 `.next` 或 3001 服务冲突。

使用专用本地联调 PostgreSQL，并在启动 Web/worker 的环境中设置：

```text
DATABASE_URL=<专用本地联调库连接串>
USE_DATABASE=true
FEATURE_CATALOG_READ=true
FEATURE_CATALOG_MANAGE=true
FEATURE_CATALOG_JOIN=true
FEATURE_TODOS=true
FEATURE_ACTIVITIES=true
FEATURE_ACTIVITY_PERIODS=false
```

先执行 `npm run db:migrate`。注册两个成员账号和一个管理内容账号，使用数据库中的稳定 user UUID。可信终端授权命令如下，`CC23_ADMIN_USER_ID` 需由联调负责人设为已存在账号的 UUID，不能来自成员请求。脚本读取当前进程的 `DATABASE_URL`，不会自动加载 `.env`：

```sh
npx tsx scripts/catalog-role.ts grant "$CC23_ADMIN_USER_ID"
npx tsx scripts/catalog-role.ts revoke "$CC23_ADMIN_USER_ID"
```

在受控 3001 联调服务中按以下顺序复现：

1. 管理账号访问 `/admin/bank-activities/new`。缺少来源时保存草稿，预览应阻止发布；补齐官方来源、明确活动期和目标/奖励规则后预览，核对内容并填写变更说明，再明确发布。
2. 两个成员分别访问 `/bank-activities` 和详情。只读浏览不生成参与；管理员保存下一版草稿时，成员仍读取旧 release。可切换不同银行筛选，并查看官方出处。
3. 成员先在 `/cards` 建卡，再回活动详情选择本人卡。如果卡只有银行名称文字，在加入弹窗明确确认统一银行关联；系统不自动猜银行，也不据此承诺资格。先预览，再确认待核对项和周期边界，最后加入。
4. 进入返回的 `/activities/<参与 UUID>`，分别记录资格、报名、累计观察、官方达标、领取提交/确认和实际到账。加入不会自动写银行确认；部分到账不会显示全部到账，领取提交不会显示官方确认。
5. 管理员发布下一版；运行 `npx tsx scripts/catalog-dispatch.ts` 派发目录事件，或在 JOIN 开关启用的 worker 中等待派发。成员查看差异后，明确选择未来期及当前期处理方式；已有观察和历史目标保留。
6. 管理员填写原因下架。新成员无法加入；已加入成员通过个人来源继续读取原版本和原因，并决定继续/停止未来跟踪及奖励通知。随后修改草稿不会使原下架通知消失。
7. 撤销管理账号授权。原 cookie 不变时管理请求仍应返回 403；成员个人能力按自己的权限继续生效。

`catalog-dispatch.ts` 仅派发目录事件。通知投递由 `src/workers/catalog.ts` 的 `runCatalogDispatch` 调用；`npm run worker` 在 JOIN 开关为真时注册每分钟的 `catalog.dispatch`。当前测试直接验证消费者和通知投递事务，尚未验证真实 pg-boss 进程的停机、恢复和长期运行。

## 5. 验证结果

| 检查 | 结果与范围 |
| --- | --- |
| `npm run typecheck` | 通过；包含 Next 路由类型和 TypeScript。 |
| `npm test` | 23 个文件、88 项通过，其中目录真实 PostgreSQL 集成测试 28 项；包含前端依赖边界检查。 |
| `npm run db:verify` | 通过；隔离库执行 0000—0005 migration、原年费表 smoke 和审计持久化检查。 |
| 目录 Playwright | 6 项通过；360px/桌面、键盘/焦点恢复、预览无写入、发布/下架、冲突保留输入、旧会话撤权、未来规则采用、两视图 action 一致、银行明确关联与所有权。 |
| 年费 Playwright | 2 项通过；以隔离 MVP handler 支持复现移动端主流程、V1.1 卡片字段、累计进度和提醒时间线。 |
| `git diff --check` | 通过。 |

数据库集成覆盖草稿隔离、不同银行、不可变发布/私人规则、缺失/未知、版本/hash、幂等、并发发布/撤权/下架加入、失败回滚、多卡所有权、重复加入、同一行动两视图、未来采用与当前历史保留、下架/取消区分、结束后领奖、提交/确认/部分到账区分、个人导出隔离、通知去重、具体时刻和延期。并发围栏测试等待 PostgreSQL 实际锁等待，避免仅凭 Promise 启动顺序判断结果。

没有运行会写共享 `.next` 的 production build。没有做真实部署路由/反向代理、整库升级回滚、全量备份恢复、生产负载或跨进程队列故障恢复验收。测试成功不代表这些范围已完成。

## 6. PRD §23.7 九项映射

“已验证”均限定为本次目录及私人最小闭环；下表不替代完整产品上线验收。

| 项 | 已实现与证据 | 完整验收剩余边界 |
| --- | --- | --- |
| 1 管理权限与草稿隔离 | 成员服务端 403、header 身份不能管理、草稿不入成员 DTO；DB/E2E 已验证。 | 真实部署的 HTTP 链路和注册/资料入口综合验收。 |
| 2 多银行发布与成员来源 | 不同银行独立发布，两个成员读同一 release，银行筛选和官方域名校验；DB/E2E 已验证。 | 官方内容运营核对、外链实际可达性和目录规模性能。 |
| 3 发布必需项与未知条件 | 必需项阻止发布；未知项醒目标记，保留待核对且阻止相应执行；DB/E2E 已验证。 | 第 21 节更完整的资格、复杂目标及执行激活状态。 |
| 4 个人隔离 | 多 owner/card 组合外键、所有卡片先校验、管理员不越权，导出仅本人事实；DB 已验证。 | 与完整私人 campaign/消费事实服务整合。 |
| 5 只读、显式加入及去重 | 浏览/预览无写入；每卡参与及周期/奖励/action 原子生成；同键、新键和并发重复不双建；DB/E2E 已验证。 | 大批量 queued/job、失败重试和进度展示。 |
| 6 不自动确认和未知日期 | 加入保留未知资格/报名；未知目标不建确定任务，未知日期不进入日历；业务事实分别提交；DB/E2E 已验证。 | 逐期报名、逐笔/退款关联和完整第 21 节模型。 |
| 7 差异采用与历史 | diff、用户选择未来范围、当前期冻结/修订、稳定 ID 和冻结来源；历史观察保留，版本核对行动去重；DB/E2E 已验证。 | 当前期核对修订的后续完整应用流程、完整逐笔消费历史和 bulk 改期恢复。 |
| 8 下架、结束与奖励 | 下架/加入并发围栏；原版本/原因保留；下架后草稿不吞通知；银行取消独立停止消费；结束后窗口内奖励仍能提交/确认/到账；DB/E2E 已验证。 | 与完整私人人工取消/卡片归档策略和全部奖励机制联调。 |
| 9 撤权与审计 | 旧会话和幂等管理重试立即失权；撤权/发布围栏；发布、修订、下架的 actor/版本/时间/说明持久化；DB/E2E 已验证。 | 部署层日志/监控及授权运维流程验收。 |

## 7. 与切图仔1接口兼容和继续门控

- 使用既有 contracts、共享 query 的失效信号和 ActionDispatcher，不把全部私人实体搬进根壳层。跨 feature 通过公开 index 引用；静态边界检查通过。
- 个人详情只对目录来源参与显示来源/差异/采用/下架控制。目录来源的完整计划及偏好编辑暂不开放，避免把尚未支持的命令显示为成功。
- 本次真实 Todo 后端明确返回 `coverage: "catalog_only"`、`canCreateCustom: false`。UI 显示覆盖范围并禁用自定义创建。年费原路径仍可用，但尚未与本次目录行动合并成完整同一 Todo 后端；不能把 §22 全量验收记为通过。
- 私人最小闭环采用累计观察，资格、报名、官方达标分别核对；支持手动领取提交/确认和实际部分到账。完整私人创建/计划、逐期报名、独立全期消费目标、消费/退款逐笔关联尚未实现；相应功能保留明确限制。
- 单次最多 5 张卡、每卡最多 24 期。超出请求结构限制会校验失败；自动展开超过 24 期返回明确 422 批量计划依赖提示。未实现 bulk `202` job，不会将排队或拒绝显示为完整生成成功。
- 目录消费者按每事件每次最多 100 个参与分片，使用 outbox/inbox 去重；通知只关联原 TodoAction，不按提前节点复制行动。生产 fanout、锁竞争与队列恢复仍需专项验证。

建议后续由第 21、22 节负责人接手统一私人事实端口和 Todo 覆盖，再补 bulk job、真实 HTTP/worker 故障恢复及性能验收，按范围开放 READ、MANAGE、JOIN。当前保持默认关闭，交付代码和上述可重复证据供审阅。
