# 第 21、22 节前端实施与 review 交付

日期：2026-10-10。范围：年费 MVP 拆分、私人活动／周期／奖励前端、待办列表／日历，以及架构师 review 第 6 项与第 3 项的前端联调。第 23 节目录及配套后端由切图仔2负责，其实现与验证见 [CC-23-DELIVERY.md](./CC-23-DELIVERY.md)。

新增业务前端已实现，开发夹具验收与真实归档联调通过。生产新增入口仍受开关控制；尚缺的私人业务接口列于下文，不能据夹具结果开放全部功能。本轮没有修改 `.env`、生产 gate，也没有提交、推送或部署。

## 实现范围

| 类别 | 实现与边界 |
| --- | --- |
| 年费拆分 | `components/mvp-app.tsx` 委托 `pages/workbench/Workbench.tsx`；cards、annual-fees、notifications、settings 各自拥有 API 与 controller；既有年费输入、历史、提醒和两种旧日历视图保留。 |
| 应用与共享层 | AppShell、SessionBoundary、ActionDispatcher；会话只保留用户与偏好；HTTP、请求取消／序列、失效信号、稳定命令键、日期格式化和 Dialog 共用。 |
| 待办 | 同一工作区 controller 管列表／日历、URL 筛选、ID/version、详情、完成／忽略／恢复／延期、自定义表单、处理历史、日期标记、无日期计数和首页近期摘要。 |
| 私人活动 | 按卡列表与摘要、来源／规则表单、资格／报名／名额核对、有限周期与明确边界、节点偏好、queued/job/failed/retry 界面。 |
| 消费与奖励 | 累计观察与逐条模式界面、独立人工核对、已有事实关联；独立奖励组件、条件、窗口、官方入口、提交／确认领取／实际到账与历史。实际可操作性取自服务端 DTO。 |
| 故障与会话 | 区块独立失败；晚到响应不覆盖新筛选；账户切换卸载旧详情和草稿；失败保留输入，冲突重查最新版本；提交防重复。 |

前端不导入服务端仓储、鉴权或数据库模块。领域事实及目标计算由后端提供；视图只解释 DTO，不把完成待办当作确认达标、领取或到账。

## Review 修复

**第 6 项：重复计划表单。** `ActivitiesPage` 的兄弟表单分别使用 `period-plan:<participationId>`、`node-preferences:<participationId>`。版本更新不改变 key，保留未保存草稿。同步计划提交后 controller 等待参与详情重查完成，避免紧接着的节点偏好命令携带旧版本；真实 409 仍按冲突处理。新增两个可访问 region 名称；测试在初始、queued、failed、retry、succeeded、重新查询、同步 committed 保存和偏好保存后，断言计划／偏好各一份，job 状态零或一份，输入不丢失，console 无重复 key。没有用 `.first()` 回避重复实例。

**第 3 项：真实归档。** Workbench 的卡片归档始终要求选择 keep/stop，不依赖 activities gate。调用既有 `POST /api/v1/cards/{id}`，发送 action、rewardReminderPolicy、可选 note 和稳定 `Idempotency-Key`；空白说明省略，采用后端默认说明。失败保留选择及说明，同意图重试复用键。成功关闭归档、卡片详情、编辑及关联行动弹窗，失效 cards、annual-fees、activities、spend-tasks、rewards、todos、notifications。

归档卡行显示归档状态；重开详情时，年费消费进度只读，已有进度与年费处理历史保留。活动周期禁用新增消费操作，同时保留独立的“查看进度与核对历史”入口；消费输入与保存按钮一起禁用，人工达标核对使用独立的证据输入，权限取自 DTO。观察历史显示真实阶段，缺失阶段明确为未知。真实 PostgreSQL 验收还确认了后端拒绝归档后的新观察、保留 keep 奖励通知／取消 stop 通知，并允许历史达标及实际到账核对。

后端响应仍是 `{data: Card}`，兼容原字段，追加 `rewardReminderPolicy: continue | stop | needs_confirmation` 和 `invalidated`。keep 在后端归一为 continue；前端未制造 card.version 或其他数据库字段。

**归档编辑兼容补查。** 普通卡片编辑仅允许使用中／已停用，且只有状态实际变化时才发送 `status`。已归档卡片的状态只读，名称／备注通过不带 `status` 的普通 PATCH 保存；controller 与 Workbench 同时阻止普通保存触发生命周期切换。归档仍须从详情确认 keep/stop，恢复仍使用详情的独立命令。

真实归档的 keep/stop 两项已补入普通元数据编辑、active→suspended→active，以及归档后的名称／备注保存与重载断言。业务快照逐一限定当前 cardId／participationId，比较归档时间、策略与版本、周期停止、观察／达标、奖励／到账、行动／通知、处理历史、归档回执及年费事实；年费周期与事件仅忽略元数据保存会刷新的 `updated_at`。最终合并浏览器 27/27 通过，包含这两项完整快照。

首轮完整快照发现普通编辑将 `archived_at` 经 JavaScript Date 写回，截断 PostgreSQL 的微秒精度。后端已改为生命周期不变时保留数据库原值；浏览器继续按完整精度比较，未放宽断言。

## 第 21.6 节验收映射

“夹具”指 `/dev/workbench` 的隔离内存示例；“真实归档”指真实 Request/Response handler 与临时 PostgreSQL。前端验收不等价于所有领域规则已上线。

| 项 | 前端实现与证据 | 真实业务边界 |
| --- | --- | --- |
| 1 多活动与卡片隔离 | 卡片摘要复用 ActivitySummaryCard；首页／摘要测试确认同卡两活动、不混入另一卡；每期进度独立。 | 真实目录查询按用户与卡片隔离；私人自建写入接口待接入。 |
| 2 周期与边界 | once/month/billing/custom 表单；显式起止日期、有限范围、相邻周期不能共享日期、重叠校验。 | 私人 period-plans 接口待实现；不能声称账单／自定义计划数据库验收通过。 |
| 3 AND／OR 目标 | 表单支持关系选择；16 项中的进度测试确认仅达笔数不能将 AND 目标显示为全部达标。 | OR 展示依服务端结果，本轮未单独证明全部 OR 业务场景。 |
| 4 历史与未来修订 | 历史周期及明确选择未来期；bulk 测试在排队／失败／重试中保留原三期与草稿。 | 私人批量 worker 未接入；目录冻结版本及采用测试由切图仔2覆盖。 |
| 5 三期与独立奖励 | 奖励显示逐期条件及确认数量，单期核对不会确认全部三期；组件分别打开同一奖励面板。 | 条件事实来自服务端；夹具验证不能替代完整奖励规则数据库测试。 |
| 6 获取方式与事实区分 | 主动领取显示窗口／渠道／官方入口；自动发放不出现领取提交；提交、确认、到账分别操作。 | 目录领取／到账已有真实接口；本轮真实归档验证实际到账写入。 |
| 7 结束后奖励 | 已结束／待领取筛选保留奖励；测试覆盖部分到账与其他组件独立。 | 目录自然结束／窗口由后端检查；私人自建全链路待接入。 |
| 8 日期与同步 | 节点偏好分开选择日历、待办和通知；两视图使用同一 ID/version，保存后重查。 | 私人节点偏好、计划日期更新及去重持久化接口待接入。 |
| 9 行动与业务事实 | 完成／忽略／恢复与业务操作分开；延期保留硬截止；前端测试确认完成行动未改年费事实。 | 真实目录行动及业务事实联动见后端事务测试；年费→统一 Todo 投影待补。 |
| 10 未知日期与时区 | DateValue 保留 unknown/date/instant；无日期不制造日历条目；账户 IANA 时区输入及 DST 无效时间有单元验证。 | 本轮未做长期跨午夜自动刷新或全部性能场景压测。 |

## 第 22.6 节验收映射

| 项 | 前端实现与证据 | 当前边界 |
| --- | --- | --- |
| 1 年费入口 | gate 打开时 `/calendar` 重定向 `/todos?view=calendar&types=annual_fee`；原年费主流程回归通过。 | 默认 gate 关闭时保留旧年费日历。统一年费 Todo 后端生成未完成。 |
| 2 同一列表／日历 | 年费、活动、自定义类型共用 Todo DTO；列表／日历相同 ID/version，完成及恢复同步。 | 年费及自定义示例来自夹具；目录活动有真实查询及命令。 |
| 3 分组与未定日期 | 分组消费服务端 metadata；未定日期保持在列表并提示数量；时区／日期边界纯函数测试通过。 | 不在浏览器推算领域截止或未知日期。 |
| 4 多通知不重复行动 | 示例中一个年费 action 对应三次通知；前端列表只展示一个稳定行动。 | 真实年费去重投影尚未接入，不能视为数据库验证。 |
| 5 稍后处理 | 延期表单保留硬截止和逾期标签；完成行动不记录年费、领取或到账事实。 | 目录 Todo 命令已持久化；年费统一 Todo 仍待接入。 |
| 6 日期／业务联动 | 命令成功按资源重查；领取不自动到账；周期及奖励状态独立。 | 私人改日期接口尚缺；目录事实／行动／通知事务由切图仔2验收。 |
| 7 筛选与移动 | URL 保留搜索、卡片、类型、状态、月份；切换、刷新、后退及 360px 键盘流程通过。 | 浏览器结果覆盖示例及已有真实入口，不代表全部账户规模。 |
| 8 自定义与历史 | 有／无日期自定义表单、完成、忽略、恢复与历史在夹具中通过。 | 真实 POST /todos 与 PATCH /todos/{id} 当前未实现。 |

## 接口状态与开放条件

| 状态 | 接口／功能 |
| --- | --- |
| 既有真实 MVP | me、cards/list/summary/save/archive/restore、cycles、年费进度、fee-events/history/status、reminders/rules/actions。 |
| 目录最小闭环已有真实接口 | workbench 活动／参与查询、资格与报名、spend-tasks 观察／人工核对、参与 rewards 查询、领取提交／结果、到账事件、Todo 读取／行动命令、calendar、attention。受目录相关服务开关及真实鉴权约束。 |
| 已有前端 adapter，私人接口待实现 | POST /campaigns；POST /campaigns/{id}/participations；POST /rules/{id}/versions；POST /activity-participations/{id}/period-plans；PUT /activity-participations/{id}/action-node-preferences；GET /jobs/{id}。 |
| 尚未提供真实写入 | 自定义 Todo POST/PATCH；年费→统一 Todo 投影；逐条消费 spend-entries 与 evaluations。真实目录任务目前明确返回累计模式、canLinkFacts=false。 |

`src/contracts` 是前端传输与表单合同；存在 adapter 不代表端点已实现。新增 endpoint／字段需按真实领域协议补齐，不能把夹具行为当作后端事务、worker、授权或幂等证明。当前 `FEATURE_TODOS`、`FEATURE_ACTIVITIES`、`FEATURE_ACTIVITY_PERIODS` 不因本交付自动开放。

## 可重复验证

全部命令在项目根目录执行，使用 3001；不要启动 3000，也不要在共享 dev 服务运行时并行 build `.next`。

```sh
npm run typecheck
npm test
npm run db:verify
E2E_ISOLATED_MVP_ROUTES=true npx playwright test e2e/workbench-frontend.spec.ts e2e/mvp-flow.spec.ts --workers=1 --output=/tmp/cardcalendar-frontend-final-20261010
FRONTEND_REVIEW_ARTIFACTS=artifacts/frontend-review-2026-10-10 npx playwright test e2e/card-archive.spec.ts --workers=1 --output=/tmp/cardcalendar-card-archive-20261010
node scripts/frontend-visual-qa.cjs
```

| 验证 | 本轮结果与真实性 |
| --- | --- |
| typecheck | 通过；包括新路由、前端和测试类型。 |
| 前端浏览器 | 16/16，通过；夹具／受控 HTTP 账户覆盖状态、错误、会话隔离与 keyboard/focus。 |
| 原年费浏览器 | 2/2，通过；本轮 `E2E_ISOLATED_MVP_ROUTES=true` 调用真实 MVP handler + 独立 memory store，不经过实际 API HTTP 路由／Next middleware／PostgreSQL。纯拆分早期也曾以真实 HTTP 跑通 2/2，不能替代本轮数据库证据。 |
| 真实归档浏览器 | 2/2，通过；keep 为 1440×1000，stop 为 360×800；真实 handler + 自动创建／销毁的临时 PostgreSQL，执行到 0006 迁移。浏览器 route 转发绕开 Next HTTP middleware。仅 keep 的首次传输失败由测试注入，成功结果和数据库事实均为真实实现；新增归档后元数据编辑截图后，两个 QA JSON 各 7 个状态。 |
| 单元及数据库 | 最终 23 个文件／112 项通过，包含切图仔2增加的升级／并发用例及目录 PostgreSQL 50 项；归档时间精度、PG fixture teardown 和节点偏好版本刷新均已覆盖。 |
| db:verify | 本会话通过，全部 0000—0006 迁移、smoke 与审计持久化通过；使用临时数据库。 |

归档验收核对 `activity_participations.reward_reminder_policy`、`activity_periods.stopped`、`todo_actions` 消费状态、奖励通知 schedule、`catalog_personal_history` 和单份 `card_archive_commands` 回执；重放不增加版本；归档后新增观察返回 422；真实到账事件仍可写入。前端成功后 cards／summary／fee-events／reminders 重查，所有关联弹窗关闭。

## 预览与视觉产物

- [只读开发夹具](http://127.0.0.1:3001/dev/workbench?month=2026-10)：自建活动、计划、领取及故障场景不会写入真实账户。
- [活动与计划示例](http://127.0.0.1:3001/dev/workbench?screen=activities&participation=fixture-participation)。
- [卡片真实接口验收](http://127.0.0.1:3001/dev/cards-review)：仅开发环境，可写当前账户的数据源，须使用测试账户；E2E 中由临时 PostgreSQL route fixture 隔离。
- 当前截图及 layout/console 记录在 [frontend-review-2026-10-10](../artifacts/frontend-review-2026-10-10)。原 2026-10-09 截图保留作历史，不作为重复 key 修复后的证据。

最终产物为 36 张夹具页面／状态截图与 14 张真实归档截图，共 50 张。`visual-qa.json` 的 36 个采样状态均无横向溢出、pageerror 或 console error，包含 queued／failed／succeeded 的单份计划与偏好。归档两个 QA JSON 各有 7 个状态，含归档后元数据编辑；溢出及 React key／page 错误均为零。已人工查看桌面／移动列表、归档确认、历史、奖励提交、计划失败及归档后编辑的代表截图。严格 console 检查发现的默认 favicon 404 已通过 Next.js 文件约定的 `app/icon.svg` 消除，未在验收脚本中过滤该错误。

截图以初始 desktop/mobile viewport 创建独立 browser context；弹窗采用 reduced-motion 稳定状态，使用当前 viewport，并补内部滚动到提交／历史位置的证据。零横向溢出及 console 记录只能证明采样状态，不能替代屏幕阅读器验收或生产性能测试。
