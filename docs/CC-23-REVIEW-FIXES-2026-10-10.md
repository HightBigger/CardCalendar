# CC-23 review 修复交付（2026-10-10）

修复原 review 五项后，继续修复复审发现的手动行动状态覆盖、跨周期投影、目录夹具污染和归档编辑兼容回归；归档入口和前端编辑由切图仔1负责。本次没有提交、推送或部署，没有修改共享 `.env`、重启共享服务或执行 production build。目录与私人最小闭环的原有门控保持不变。

## 逐项结果

| Review | 修复行为 | 文件和持久验证 |
| --- | --- | --- |
| 1 · 消费阶段丢失 | 新观察明确保存 `occurred/posted/settled`。确定值按周期冻结规则的口径计算，早于口径的累计值只形成预计差额；快照按覆盖处理，阶段和历史快照不相加。历史无阶段数据升级为 `unknown`，显示待核对，不能推断入账或目标达到。活动详情及周期摘要读取同一真实任务投影。 | [追加迁移](../db/migrations/0006_catalog_review_fixes.sql)、[阶段计算](../src/modules/participation/catalog-progress.ts)、[事实命令](../src/modules/participation/catalog-commands.ts)、[任务/详情查询](../src/modules/participation/catalog-queries.ts)、兼容扩充 `SpendTask.observations[].stage`。数据库回归验证 posted 口径下 occurred 5 笔/2000 的 confirmed=0、pending=5/2000；随后 posted 快照与更正不会重复累计。settled/occurred 口径及采用未来版本后当前期冻结口径也有验证。 |
| 2 · 业务事实未联动行动 | 资格与必要报名确认后关闭资格行动；确定目标达到后完成消费行动并取消继续刷卡通知，保留独立官方达标核对行动；官方 `qualification=met` 关闭本期核对。事实更正同步重新投影；确定累计更正跌破目标时把原达标转为待核对并留历史。领取确认及全部到账也使用同一行动历史/通知联动方法。 | [同事务投影](../src/modules/participation/catalog-action-projection.ts)、[Todo 持久转换](../src/modules/todos/catalog-todos.ts)、[事实命令](../src/modules/participation/catalog-commands.ts)。升级同时修复旧数据中已经确认、但仍 pending 的行动。测试读取真实 action status/version/history 和 pending schedule 数量；投影失败注入验证事实、历史和命令事务一并回滚。 |
| 3 · 归档断开 | 沿用 `POST /api/v1/cards/{id}` 的 `{action:'archive',rewardReminderPolicy:'keep'|'stop',note?}`。`keep` 归一为领域 `continue`。同事务归档卡、取消原年费未投递提醒、停止相关周期及消费行动、更新任务/参与版本、保存奖励提醒策略/历史/审计/稳定键回执。归档后拒绝新观察，仍可读历史、记录官方核对和实际到账。dispatcher 允许归档卡的 `continue` 奖励节点，`stop` 则停止奖励通知。 | [原卡片 route](../app/api/v1/cards/[cardId]/route.ts)、[卡片服务](../src/modules/cards/service.ts)、[PostgreSQL 归档事务](../src/modules/cards/catalog-archive.ts)、[投递消费者](../src/modules/todos/notification-dispatch.ts)。owner 校验、同键重放/改参数409、失败回滚、归档/观察并发围栏及原年费数据库兼容均有测试。切图仔1的真实 handler + PostgreSQL 浏览器验收通过 keep/stop 两项。 |
| 4 · 默认套用年费通知 | 缺省 `nodePreferences` 或缺省天数均不排活动通知；恢复/延期也只使用本人已选择的天数。加入弹窗通知默认全未选，提供 1/3/7/14/30 天的明确选择；与创建待办、日历显示独立。周期消费和官方达标核对是不同节点。 | [Todo 服务](../src/modules/todos/catalog-todos.ts)、[加入 controller](../src/frontend/features/activity-catalog/application/useCatalogJoinController.ts)、[加入 UI](../src/frontend/features/activity-catalog/ui/JoinActivityDialog.tsx)。升级取消未选择的未投递通知，保留通知历史。数据库/浏览器覆盖默认零调度，以及隐藏待办和日历后仍只排明确选定的 3 天通知。原通知去重测试现在明确选择 30/7/1，继续验证原业务去重。 |
| 5 · 精确截止分组 | `instant` 比较真实时刻判断逾期，按账户时区计算展示日期、筛选与日历日期；`date` 按其业务时区当日结束后逾期。稍后提示不修改硬截止，也不掩盖逾期文字。 | [Todo DTO/筛选/日历](../src/modules/todos/catalog-todos.ts)。真实数据库验证已过一分钟的 instant 为 overdue；另有账户时区与来源时区不同、业务日期午夜边界，以及逾期且仍稍后提示的回归。 |

阶段累计语义：满足冻结口径的最新累计快照是确定值；更早阶段的最新累计快照描述预计总量，待确认部分是其超过确定值的差额。例如 occurred 总量 5 笔、posted 总量 3 笔，确定 3 笔、待确认 2 笔；两者不会显示为 8 笔。累计观察模式仍不与逐笔模式相加。完整逐笔消费/退款账本继续在原分阶段门控之外。

## 后续复审回归修复

手动行动决定与银行事实分开保存和解释。`businessState` 从已有持久化历史中读取最后一次 `complete/ignore/restore`，业务投影和仅更新标题/按钮的历史不会清除手动来源。当事实仍要求 pending 时，保留本人已完成或已忽略的决定及通知抑制；只有显式 restore 清除该决定。真实目标达到、官方确认或来源停止仍可关闭行动；自动关闭、没有手动抑制的行动在真实更正后重新打开。独立官方核对行动仍按本期事实创建、关闭或重开，手动 Todo 完成不推断官方达标。

`taskWrite` 只同步所写任务对应周期的消费/官方核对行动，不再遍历其他周期或资格行动。资格/报名事实实际变化时才执行参与级投影，相同值的再次核对只保留事实命令历史。真实 PostgreSQL 新增六项回归，覆盖本期 complete/ignore 后部分累计更新、未来期行动/版本/历史/通知隔离、资格变化产生的 metadata-only 投影、显式恢复、自动官方核对重开，以及业务更正后的手动通知抑制；原自动关闭/更正回归继续保留。

已归档卡的普通 PATCH（包括旧表单再次发送 `status:'archived'`）正常保存名称、备注、金额、日期等字段，不调用归档命令，不重置 keep/stop，不增加归档回执或业务行动历史。旧客户端同一次 PATCH 修改元数据并从 active/suspended 转为 archived 时，在同一 PostgreSQL 事务保存元数据、同步原年费周期/事件，再执行既有归档联动；缺省奖励选择仍为 needs_confirmation。故障注入验证全部编辑、提醒、行动和历史共同回滚。

归档编辑继续同步年费金额/日期，保留周期身份、进度和状态，同时跳过年费提醒重排和 `ensureFeeEventReminders`，避免 cancelled 提醒重新生成 pending/snoozed。数据库 repository 在生命周期未变化时不写 `archived_at`，原始 PostgreSQL 微秒精度也完整保留。新增五项 PostgreSQL、两项内存服务回归覆盖以上兼容路径；切图仔1的 keep/stop 浏览器用例比较归档后完整事实快照，包括奖励/到账、周期、进度、行动、通知、策略、归档时间和回执。

目录加入的计数、资格/报名及零通知断言限定 owner/card/catalog instance，再用得到的 participation ID 查询通知；待办列表与日历也验证本次参与的具体 action ID。默认资格/报名 unknown、默认通知全关闭等断言保持严格，不再依赖全表的第一行或全表通知数量。

合并浏览器清理曾发现 `Pool.end()` 在 idle client socket 真正断开之前返回，立即停止临时 PostgreSQL 会产生 57P01。`e2e/support/catalog-postgres.ts` 从两个 pool 初始化起追踪客户端，关闭时等待每个 client 的 end 事件，再停临时库；没有吞掉 error、加入固定 sleep 或放宽业务快照。临时诊断和复现副本已删除，最终验收要求命令退出码为 0。

## 迁移与旧数据

只追加 `0006_catalog_review_fixes.sql`，没有改写已经交付的 0004/0005。迁移在一个事务中：

1. 将旧观察阶段明确补为 `unknown`，随后去掉 stage 默认值，要求新业务写入明确阶段。
2. 修复已确认资格/报名及官方达标的行动，追加处理历史并取消无效未投递通知。
3. 对旧归档卡停止消费投影。旧 endpoint 没有保存奖励选择，因此将该缺失证据标为 `needs_confirmation`；不猜测用户曾选择 keep 或 stop。本人再次明确 keep 后，只恢复其已选、未投递且仍 pending 的奖励通知。
4. 为真实卡片归档保存幂等命令回执；修改同一键的归档选择返回 409。回执与卡片外键绑定 owner，清理卡片时级联清理。

集成测试先在 0005 结构下创建真实旧观察、旧确认和旧归档记录，再应用 0006 验证升级效果；也验证从空库执行 0000—0006 的路径。共享数据库未执行迁移，受控联调时仍需在专用库运行 `npm run db:migrate`。

## 归档前端衔接与复核入口

请求沿用既有接口并带稳定 `Idempotency-Key`。可选说明为空时省略 `note`，后端使用默认说明。正常响应继续为 `{data: Card}`，保留原 Card 字段并追加：

```json
{
  "rewardReminderPolicy": "continue",
  "invalidated": ["cards", "annual-fees", "activities", "spend-tasks", "rewards", "todos", "notifications"]
}
```

上述字段属于 `data`；`keep` 返回 `continue`，`stop` 返回 `stop`。旧客户端未提供选择时返回 `needs_confirmation`，不替用户开启奖励通知。切图仔1已按该契约完成归档失败草稿保留、同键重试、成功关闭相关弹窗、刷新及只读历史入口。

在专用联调数据库中，按归档卡 UUID/参与 UUID 检查下列事实即可复核：

- `cards.status/archived_at`；`activity_participations.reward_reminder_policy/version`。
- `activity_periods.stopped`；`spend_tasks.version`；重新 GET 任务的 observation command 为 disabled，新观察 POST 返回 422。
- `todo_actions` 中 `spend_period` 的 status、primary_action.enabled、version 和 history；未领取奖励 action 保留。
- `todo_notification_schedules.status`；keep 的已选奖励节点可投递，stop 没有 pending 奖励通知。
- `catalog_personal_history.action='card.archived'` 的 note/payload；`audit_logs.action='card.archived'`；`card_archive_commands` 的单份回执。

集成测试可直接以临时库调用 `archiveCard(owner,cardId,undefined,undefined,options,pool)`；生产默认 PostgreSQL 分支从现有数据库 runtime 取得同一事务连接。浏览器 fixture 会创建有效 cookie 会话、完整迁移及真实 handler 转发，无需修改共享 `.env`。

## 验证与重复命令

| 验证 | 本轮结果 |
| --- | --- |
| `npm run typecheck` | 通过。 |
| `npm test` | 23 个文件、112 项通过，其中目录真实 PostgreSQL 集成测试 50 项；卡片服务 6 项。原五项修复时为 99 项/PG 39 项。 |
| `npm run db:verify` | 通过，包含 0000—0006、年费 smoke 和审计持久化。 |
| 合并浏览器验收 | `E2E_ISOLATED_MVP_ROUTES=true FRONTEND_REVIEW_ARTIFACTS=artifacts/frontend-review-2026-10-10 npx playwright test e2e/workbench-frontend.spec.ts e2e/catalog.spec.ts e2e/card-archive.spec.ts e2e/mvp-flow.spec.ts --workers=1 --output=/tmp/cardcalendar-cut2-recheck-20261010-final2` 通过，27/27，约 1.2 分钟；临时 PostgreSQL fixture teardown 等待连接断开后正常退出。 |
| 架构师原复现 | 后续 7 项原复现未改动复跑 7/7；临时副本已删除，原 `/tmp/cardcalendar-architect-recheck-repro-20261010.test.ts` 未修改。原五项与新增手动状态两项均覆盖，归档新观察断言为 422。架构师另报告独立 10 项复现、112 项、typecheck 和 db:verify 通过。 |
| 目录浏览器 | 7 项通过：原目录六项加通知选择与显示独立，并强化默认关闭断言。 |
| 切图仔1协同回归 | 合并套件最终 27/27：前端 16 项、目录 7 项、真实 PostgreSQL keep/stop 归档 2 项和隔离原 MVP 2 项。keep/stop 用例已扩展普通编辑无归档入口、active/suspended 切换、归档后名称/备注持久保存及完整业务快照不变。 |
| `git diff --check` | 通过。 |

```sh
npm run typecheck
npm test
npm run db:verify
npx playwright test e2e/catalog.spec.ts --output=test-results/catalog-review-20261010
npx playwright test e2e/card-archive.spec.ts --output=test-results/card-archive-review-20261010
E2E_ISOLATED_MVP_ROUTES=true npx playwright test e2e/mvp-flow.spec.ts --output=test-results/mvp-review-20261010
E2E_ISOLATED_MVP_ROUTES=true FRONTEND_REVIEW_ARTIFACTS=artifacts/frontend-review-2026-10-10 npx playwright test e2e/workbench-frontend.spec.ts e2e/catalog.spec.ts e2e/card-archive.spec.ts e2e/mvp-flow.spec.ts --workers=1 --output=/tmp/cardcalendar-cut2-recheck-20261010-final2
git diff --check
```

浏览器命令应顺序执行，复用当前 3001 服务；不要与其他聊天同时重新生成 `.next` 或启动另一份服务。目录/归档浏览器测试使用真实 Request/Response handler + 临时 PostgreSQL，转发请求以隔离共享数据库；它们不替代 Next HTTP middleware、真实反向代理或部署链路验收。没有新增生产负载、队列故障恢复或整库恢复验收声明。

归档桌面/360px 截图和检查指标由切图仔1保存在 `artifacts/frontend-review-2026-10-10/`；截图已按 reduced-motion 稳定重拍，最终只读视觉检查结果以其前端交付记录为准。已报告的浏览器指标无横向溢出、React key 或页面错误。目录截图仍保存在 `design-prototypes/screenshots/cc23-member-360.png` 和 `cc23-admin-preview-1440.png`。

## 共享边界和剩余范围

本轮改动仅限 participation/todos、目录后端及私人投影、原归档 route 和 cards 必要追加、database repository 的归档时间保留、0006、目录 contract/UI/controller、我方目录 PostgreSQL fixture、测试和交付记录；未编辑切图仔1的 cards 前端、Workbench、ActivitiesPage 或其前端测试文件。双方通过既有 body/response 契约和真实 PostgreSQL fixture 衔接，浏览器验证按顺序使用现有 3001。

完整年费/自定义 Todo 合并、私人完整计划/逐期报名/独立全期目标/逐笔退款账本、bulk queued/job 及其恢复仍是原分阶段未交付范围。卡片恢复使用只恢复原年费流程，不自动撤销活动停止跟踪和奖励提醒选择，也不重新生成消费计划。本轮五项修复没有通过放宽门控或前端隐藏替代后端持久化。
