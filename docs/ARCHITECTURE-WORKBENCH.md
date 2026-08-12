# Cardfolio 信用卡工作台领域架构

文档版本：v0.1（架构建议）
基线：`main@c10bd5c`
适用范围：在现有 Next.js 模块化单体上，从年费管理扩展到个人信用卡工作台。

## 1. 结论先行

Cardfolio 应继续采用模块化单体和 PostgreSQL + pg-boss；“信用卡”是用户可见的核心身份聚合（卡片档案、生命周期和脱敏标识），但不是吞并所有业务的“大卡片聚合”。活动、权益、刷卡任务、积分账户/流水、兑换、来源快照、通知和价值评估各自拥有自己的聚合与写入规则，只通过稳定 ID、只读查询端口和领域事件协作。

推荐的第一版工作台拓扑如下：

```text
用户/权限
   |
卡片档案（Card Profile） ---- 来源快照（Source Snapshot）
   |          |       \
   |          |        +-- 活动/报名（Campaign & Activity）
   |          |        +-- 权益领取/使用（Benefit Entitlement）
   |          |        +-- 刷卡任务（Spend Task）
   |          +----------- 积分账户与流水（Points Account/Ledger）
   |                      +-- 兑换（Redemption）
   +-- 年费规则/周期/事件（现有模块）
              |
          通知（Notification）
              |
       价值评估（Value Assessment，只读/用户输入）
```

图中连线表示关联或事件触发，不表示跨模块共享表或级联事务。工作台页面可以由 dashboard 查询服务拼装，但 dashboard 不拥有任何业务状态。

## 2. 现状约束与演进原则

### 2.1 当前实现应被视为基线

当前 `src/modules` 已按 `presentation -> application -> domain -> infrastructure` 分层，`cards`、`fee-rules`、`cycles`、`progress`、`fee-events`、`reminders`、`auth`、`export`、`account` 通过 service/repository 协作；API 由 `app/api/v1/**/route.ts` 负责会话、输入解析和错误映射。数据库仓储与内存仓储并存，所有者过滤、UUID、UTC 时间、IANA 时区、审计日志和数据库唯一约束是既有约定。

当前卡片表仍承载年费规则字段，`fee_cycles` 承载规则快照和累计进度，`progress_entries` 是可撤销的手工流水，`fee_events` 与 `reminders` 通过唯一约束和 reconcile 保证幂等。该实现满足年费 MVP，但不能成为未来活动、积分或权益的写入入口。

### 2.2 不变的原则

1. **卡片是核心聚合，但只拥有档案和生命周期。** 其他领域保存 `card_id` 关联，不把其实体嵌入 Card 聚合；读取详情由 application-level composition 完成。
2. **事实和推断分离。** 用户输入、导入原始记录、银行规则快照是事实；完成度、预计价值、推荐排序是可重算的投影或评估结果。
3. **规则必须可追溯。** 活动、权益、积分和兑换规则都记录 `source_snapshot_id`、生效区间、地区/渠道限制、最后核对时间和规则版本；历史交易引用当时版本，不随模板编辑漂移。
4. **先模块化单体，后按证据拆分。** 模块只能依赖对方的公开端口/事件；禁止直接 import 另一个模块的 repository，禁止跨模块写表作为业务捷径。
5. **手动录入优先，导入是受控边界。** MVP 只接受用户输入；未来 CSV/PDF/第三方同步先进入 source snapshot 和待确认队列，不能直接改变已确认账本。
6. **所有用户数据按 user_id 隔离。** 所有命令从会话推导用户，资源路径中的 ID 只用于定位；跨用户资源统一返回 404，避免泄漏存在性。

## 3. 目标模块边界与聚合所有权

下表定义逻辑模块名。初期可在 `src/modules` 下按模块建立目录；在迁移完成前，旧模块继续提供兼容 facade。

| 模块 | 核心聚合/拥有状态 | 负责什么 | 明确不负责 |
| --- | --- | --- | --- |
| `card-profile`（现 `cards`） | `CardProfile`；可选 `CardLifecycle` 子实体 | 发卡行、卡名、级别、last4、币种、状态、开卡/归档、用户备注、默认时区引用；发布卡片生命周期事件 | 活动报名、权益余额、积分余额、消费流水、兑换结果、收益结论 |
| `fee-rules` / `cycles` / `fee-events`（现有） | `FeeRuleVersion`、`FeeCycle`、`FeeEvent` | 年费日期、免年费条件、周期快照、年费处理和历史；继续拥有现有 P0 工作流 | 把消费交易当作已验证银行事实；不读取积分或权益表计算状态 |
| `campaign-activity` | `Campaign`（规则快照）与 `ActivityEnrollment`/`ActivityProgress` | 活动定义、报名/取消、活动期间、渠道限制、活动目标、用户参与状态和达标判断 | 代替 Spend Task 记录消费；不直接增加积分余额 |
| `benefit-entitlement` | `BenefitEntitlement` | 权益领取、有效期、使用/核销、额度/次数、用户估值输入；按活动或卡片实例化 | 规则来源编辑、积分账本记账、发送通知 |
| `spend-task` | `SpendTask` 与不可变 `SpendTaskEntry` | 刷卡任务目标（金额/次数/类别/期间）、手工累计、修正/撤销、完成度和任务提醒触发条件 | 证明交易真实发生；不直接从银行读取，不修改积分账户 |
| `points-account-ledger` | `PointsAccount`、不可变 `PointsLedgerEntry` | 按卡/银行/计划建立积分账户，赚取、调整、过期、扣减流水，余额快照和对账状态 | 兑换渠道履约；不把余额作为可任意编辑字段 |
| `redemption` | `Redemption` 与 `RedemptionStatusHistory` | 兑换申请、锁定/扣减积分、履约/失败/撤销、兑换价值和关联权益 | 直接改 PointsLedger；通过 ledger command 记账 |
| `source-snapshot` | 不可变 `SourceSnapshot` | 保存用户粘贴/上传/导入的原始材料摘要、来源、抓取时间、解析器版本、哈希和脱敏内容；供规则和导入审计 | 自动宣称材料正确；不作为业务当前状态的唯一来源 |
| `notification`（现 `reminders` 的演进） | `NotificationRule`、`Notification`、`DeliveryAttempt` | 站内通知、未来邮件/Push 适配、计划/取消/完成/稍后处理和投递重试 | 推导业务截止日期或改变业务状态 |
| `value-assessment` | `ValueAssessment`、`AssessmentLine` | 用户输入的年费、权益使用价值、积分兑换价值、机会成本和净值快照；记录估值方法/币种/时间 | 金融建议、保证收益、自动替用户决定保留或销卡 |
| `dashboard/read-model` | 无业务聚合，仅投影 | 聚合卡片、任务、权益、积分、年费和通知用于首页/卡片工作台；可异步重建 | 写入上述任何事实或绕过权限 |

### 3.1 CardProfile 聚合边界

`CardProfile` 的命令仅包括 `CreateCard`、`EditProfile`、`SuspendCard`、`ArchiveCard`、`RestoreCard`。它可以调用 fee-rules 的端口校验当前年费配置，但提交后只发布 `CardCreated`、`CardProfileChanged`、`CardArchived` 等事件；不会在同一聚合中加载 campaign、benefit、task 或 points 子集合。卡片归档事件由订阅者分别停止未来任务/通知、冻结可用兑换，而历史事实保持可读。

卡片档案中的年费字段应采用兼容迁移：先保留旧字段并写入 `FeeRuleVersion`，双写并校验；确认新读路径稳定后再将旧字段标为 legacy。删除卡片仍是归档，不物理删除历史。

## 4. 聚合、引用与一致性

### 4.1 引用规则

- 跨模块只保存对方聚合 ID：`card_id`、`campaign_id`、`activity_enrollment_id`、`benefit_entitlement_id`、`spend_task_id`、`points_account_id`、`redemption_id`、`source_snapshot_id`。
- 业务命令必须通过拥有方 port 检查 ID 属于当前用户、状态允许且版本匹配；调用方不得通过数据库 join 绕过此检查。
- 读模型可做受控 join/批量查询，但结果带 `as_of`、来源版本和数据新鲜度；读模型缺失时不能回写默认值。
- 不保存跨模块可变冗余字段。展示名称、银行名等允许在投影中缓存，并以 `card_id` 为刷新依据。

### 4.2 一致性等级

同一模块内命令使用一个数据库事务和乐观版本号；跨模块采用 **outbox + inbox** 的本地可靠事件。需要用户即时反馈的操作（报名、记一笔任务、提交兑换）返回命令所属聚合的 committed 状态；积分余额、通知和首页汇总允许秒级最终一致，但必须显示处理中/最后更新时间。

推荐事件信封：

```json
{
  "event_id": "evt_01J...",
  "event_type": "SpendTaskProgressRecorded.v1",
  "aggregate_type": "spend_task",
  "aggregate_id": "task_01J...",
  "aggregate_version": 4,
  "occurred_at": "2026-08-12T10:00:00Z",
  "actor": { "type": "user", "id": "usr_01J..." },
  "correlation_id": "req_01J...",
  "causation_id": "cmd_01J...",
  "payload": { "card_id": "card_01J...", "entry_id": "entry_01J..." }
}
```

消费者以 `(consumer_name, event_id)` 去重；乱序或重复事件不得重复记账。不可变事实只追加，修正使用 reversal/adjustment 事件。

## 5. 关键状态机

状态只由所属模块改变。未列出的转换返回 `409 STATE_CONFLICT`；归档/删除等全局操作通过事件通知，而不是远程修改聚合内部状态。

### 5.1 CardProfile

```text
active <-> suspended
active -> archived
suspended -> archived
archived -> active   (restore，需保留历史)
```

### 5.2 Campaign / ActivityEnrollment

```text
Campaign: draft -> published -> expired
                    \-> cancelled
Enrollment: eligible -> enrolled -> in_progress -> qualified
                         \-> cancelled       \-> failed/expired
```

报名必须引用发布时 `rule_version`；活动过期后仍可补录历史结果，但不能新报名。

### 5.3 BenefitEntitlement

```text
pending -> available -> partially_used -> exhausted
available/partially_used -> expired
pending/available -> revoked
```

领取、使用、撤销分别生成不可变 entitlement ledger；余额由流水重算，不能直接 PATCH 成任意数字。

### 5.4 SpendTask

```text
draft -> active -> qualified
                  \-> failed/expired
active -> paused -> active
active/paused -> cancelled
```

`SpendTaskEntry` 支持 `recorded -> reversed`。任务完成度由目标快照 + 未撤销 entries 重算；导入或手工修正必须标记 `provenance`。

### 5.5 PointsAccount / PointsLedger

账户：`open -> frozen -> closed`；流水类型为 `earn`、`adjustment`、`expire`、`redeem_hold`、`redeem_debit`、`redeem_release`。余额只能由有序流水计算，`redeem_hold` 使用可过期 reservation，避免并发兑换超扣。

### 5.6 Redemption

```text
draft -> submitted -> points_held -> processing -> fulfilled
                                      \-> failed -> reversed
submitted -> cancelled
```

只有 redemption 模块能推进其状态；积分扣减必须调用 points ledger 的幂等 command，并以 `redemption_id` 作为外部幂等键。

### 5.7 Notification

```text
scheduled -> pending -> delivered
                    \-> failed -> retrying -> delivered/abandoned
pending/scheduled -> cancelled
pending -> snoozed -> pending
```

业务状态完成不等于通知投递成功；投递失败仅影响 `DeliveryAttempt`，不得回滚活动、任务或年费事件。

### 5.8 ValueAssessment

```text
draft -> calculated -> confirmed -> superseded
```

每次重算生成新快照，旧评估只读。`confirmed` 仍是用户判断，不是系统建议或保证。

## 6. API 资源与事件契约

### 6.1 HTTP 资源（建议增量加入 `/api/v1`）

现有资源继续兼容：`/cards`、`/cycles`、`/progress-entries`、`/fee-events`、`/reminders`。新资源建议如下：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET/PATCH` | `/cards/{cardId}/profile` | 档案与生命周期；也可由现有 `/cards/{cardId}` facade 提供 |
| `GET/POST` | `/cards/{cardId}/campaigns` | 查询/创建用户活动视图；活动规则定义由管理员/模板端口提供 |
| `POST` | `/campaigns/{campaignId}/enrollments` | 报名或取消报名（action 参数） |
| `GET/POST` | `/cards/{cardId}/benefit-entitlements` | 领取、登记使用、撤销 |
| `GET/POST` | `/cards/{cardId}/spend-tasks` | 创建/查询任务 |
| `POST` | `/spend-tasks/{taskId}/entries` | 记录累计或增量；支持 `Idempotency-Key` |
| `POST` | `/spend-task-entries/{entryId}/reverse` | 撤销错误录入 |
| `GET` | `/cards/{cardId}/points-accounts` | 账户与余额投影 |
| `GET` | `/points-accounts/{accountId}/ledger` | 分页流水/对账状态 |
| `POST` | `/points-accounts/{accountId}/adjustments` | 用户确认后的手工调整 |
| `GET/POST` | `/cards/{cardId}/redemptions` | 创建/查询兑换 |
| `POST` | `/redemptions/{redemptionId}/actions` | cancel/confirm/retry |
| `GET/POST` | `/source-snapshots` | 上传/登记来源材料，返回解析/确认状态 |
| `GET/PATCH` | `/notification-rules` | 用户/卡片/任务通知偏好 |
| `GET` | `/notifications` | 统一工作台通知中心 |
| `GET/POST` | `/cards/{cardId}/value-assessments` | 计算/确认估值快照 |
| `GET` | `/cards/{cardId}/workbench` | 只读聚合视图，标注 `as_of` 和 stale 状态 |

命令请求示例：

```http
POST /api/v1/spend-tasks/task_01J/entries
Idempotency-Key: 2026-08-12-statement-08
Content-Type: application/json

{"mode":"increment","occurred_on":"2026-08-10","amount":1200.00,"count":1,"note":"八月账单汇总","provenance":"manual"}
```

```json
{"data":{"entry_id":"entry_01J","task_id":"task_01J","status":"active","progress":{"amount":4200,"target_amount":5000,"remaining_amount":800,"qualified":false},"version":3}}
```

错误沿用当前 `{ error: { code, message, details, request_id } }`；并发版本冲突使用 `409`，重复幂等键若 payload 不同使用 `409 IDEMPOTENCY_KEY_REUSED`。

### 6.2 领域事件

第一批稳定事件（均带 `.v1` 版本）包括：

- `CardCreated.v1`、`CardProfileChanged.v1`、`CardArchived.v1`、`CardRestored.v1`
- `FeeCycleOpened.v1`、`FeeEventStatusChanged.v1`
- `CampaignPublished.v1`、`ActivityEnrolled.v1`、`ActivityQualified.v1`、`ActivityExpired.v1`
- `BenefitEntitlementGranted.v1`、`BenefitUsed.v1`、`BenefitExpired.v1`
- `SpendTaskCreated.v1`、`SpendTaskProgressRecorded.v1`、`SpendTaskQualified.v1`、`SpendTaskEntryReversed.v1`
- `PointsLedgerEntryPosted.v1`、`PointsReservationHeld.v1`、`PointsReservationReleased.v1`
- `RedemptionSubmitted.v1`、`RedemptionFulfilled.v1`、`RedemptionFailed.v1`
- `SourceSnapshotCaptured.v1`、`SourceSnapshotConfirmed.v1`
- `NotificationScheduled.v1`、`NotificationDelivered.v1`、`NotificationFailed.v1`
- `ValueAssessmentConfirmed.v1`

订阅关系示例：`CardArchived` -> campaign enrollment 标记不可进行、spend task 暂停、notification 取消未来发送、points account 可选冻结；`SpendTaskQualified` -> campaign/benefit 更新进度或发放资格（若规则声明）；`RedemptionFulfilled` -> points ledger 完成扣减、benefit entitlement 写入核销；任何规则变更只影响未来实例，不回写历史事实。

## 7. 幂等、审计与权限

### 7.1 幂等和并发

- 所有写命令接受 `Idempotency-Key`（至少覆盖 entry、报名、领取、兑换、人工调整）；服务端保存用户、命令类型、请求哈希、结果和过期时间。
- 聚合表使用 `version`/`updated_at` 乐观锁；同一 points account 的记账在事务中锁定余额投影或按序号写入，禁止客户端传入新余额。
- outbox 在业务事务内写入；worker 使用 inbox 去重、指数退避和死信告警。reconcile 任务允许重跑，唯一键按业务自然键防重复。
- 数额统一使用数据库 `numeric` 与 decimal 运算；积分数量使用整数或计划声明的最小单位。

### 7.2 审计

审计记录 `actor_type/id`、`user_id`、动作、资源类型/ID、旧/新状态、规则版本、source snapshot、request/correlation ID、结果和时间。日志与快照内容脱敏，不写完整卡号、凭据、原始银行登录响应或敏感附件；导入原件只存短期加密对象引用和哈希。状态历史和 reversal 永不覆盖原事件。

### 7.3 权限模型

MVP 只有个人租户：会话 -> `user_id` -> 所有资源 ownership 过滤。未来共享空间应新增 `workspace_id`、成员角色和 resource policy，不能把“共享”加成卡片字段。管理员发布活动模板与用户编辑个人报名/估值是两套权限；source snapshot 原件可按最小权限访问。跨用户 ID 不存在和无权限统一 `404`，敏感命令额外要求当前会话新鲜度/二次确认。

## 8. 规则版本化、来源与手动录入边界

### 8.1 RuleVersion

活动、权益、积分计划、兑换目录和年费规则统一采用不可变 `RuleVersion` 语义：`rule_id`、`version`、`effective_from/to`、`jurisdiction`、`channel`、条件 DSL/结构化参数、`source_snapshot_id`、`verified_at`、`verified_by`。编辑产生新版本；已实例化 enrollment/entitlement/task/redemption 固定引用版本。规则 DSL 必须有白名单、静态校验和解释文本，禁止直接执行用户上传代码。

### 8.2 Manual 与 Import

MVP：只允许表单手动录入卡片、年费、任务累计、权益使用、积分调整和兑换结果；每次写入 `provenance=manual`，要求发生日期/备注，必要时要求来源快照。

P1 CSV/PDF：文件先进入 `SourceSnapshot(captured)`，解析器输出候选变更和错误行；用户预览确认后，按逐条命令写入目标聚合，保留 `import_batch_id`、原始行号和 parser version。重复导入用文件哈希 + 行指纹检测，绝不静默覆盖人工记录。

未来第三方账单同步：单独 connector/授权模块负责 token、撤销、最小范围和同步游标；同步数据仍以 `external_transaction` 原始事实进入待匹配队列，由用户确认后生成 SpendTaskEntry/PointsLedgerEntry。不得让 connector 直接写业务聚合。

## 9. 与现有代码的迁移映射

| 当前 | 目标 | 迁移方式 |
| --- | --- | --- |
| `cards` | `card-profile` facade | 保留 `/cards`；先抽出 profile command/port，旧年费字段双写 `FeeRuleVersion` |
| `fee-rules` 字段 + `cycles` | `fee-rules` + `FeeCycle` | 规则快照先保持现有结构；新增版本表和 `rule_version_id`，旧字段只读兼容 |
| `progress` | `spend-task`（年费免除任务是一个 task type） | 以 adapter 将 `fee_cycle_id` 映射为 task；历史 `progress_entries` 不改写，新增统一 entry 视图 |
| `fee-events` | 保持独立 | 通过 `CardArchived`/`FeeEventStatusChanged` 触发通知和价值投影 |
| `reminders` | `notification` | 保留 fee-event API 和状态；抽象 `NotificationSource`，逐步加入 task/benefit/redemption |
| `export` / `account` | 工作台导出与删除编排 | 新模块注册 export/cleanup handler，仍由 account 统一授权、审计和异步清理 |
| `dashboard`/`cards/summary` | read model | 先在查询 service 中批量调用各 port，数据量增长后再物化投影；不迁移写规则 |

迁移顺序必须是“先端口和事件，再读模型，最后替换写路径”。每一步都保留旧 API 的响应字段和错误码，设置 feature flag 与双读对比；发现差异时回退到旧 service，不回滚已提交的事实事件。

## 10. 分阶段路线与 MVP 排除项

### Phase 0：契约和基础设施（当前文档后）

- 统一 ID、事件信封、`Idempotency-Key`、版本号、provenance、source snapshot 和审计 schema。
- 为现有 cards/cycles/progress/fee-events/reminders 加 adapter 与 contract tests；不改变用户流程。

### Phase 1：工作台可见的手动记录

- Card Profile 独立命令边界；引入 `source-snapshot` 基础表和规则版本。
- `spend-task` 先覆盖年费免除任务与通用消费目标；`campaign-activity` 只支持少量手工活动模板。
- `benefit-entitlement`、`points-account-ledger` 支持手工授予/使用/调整和余额重算；首页以最终一致读模型展示。
- notification 统一 fee-event、task、benefit 到站内通知。

### Phase 2：兑换和价值评估

- redemption 的手工结果记录与幂等扣减；系统内积分 reservation/扣减状态机与可重试履约后置到 P1/P2，不接银行/兑换商自动 API。
- value-assessment 展示年费、已确认权益价值、积分兑换价值和来源/估值日期；支持多次快照比较。
- CSV 导入先做 preview/confirm；PDF 仅保存 source snapshot，不自动落账。

### Phase 3：受控导入与运营化

- 外部账单 connector 作为独立 adapter，授权、撤销、游标、失败重试和隐私评审完成后再灰度。
- 物化 read model、队列告警、跨浏览器/灾备演练；有吞吐证据再考虑拆服务。

### 明确不应进入 MVP

- 银行登录/API、自动交易同步、自动兑换/自动取消卡片、完整卡号/CVV/凭据。
- 复杂活动规则引擎、跨卡智能归因、家庭/企业共享、多人实时协作。
- 机器学习收益预测、投资/授信建议、保证收益或自动“保留/降级/销卡”决策。
- 多币种实时汇率、税务/会计报表、短信/邮件/Push 投递保证、开放 webhook。
- PDF/OCR 直接写入积分或消费账本；任何未经用户确认的批量变更。

## 11. 测试策略

### 11.1 领域与契约

- 每个聚合的状态转换、边界日期、金额/积分精度、版本快照和 reversal 使用 Vitest 单元测试；属性测试覆盖“重放流水 = 当前余额”和任务完成度单调性（撤销除外）。
- API contract tests 验证 `/api/v1` 旧资源兼容、新资源错误码、ownership 过滤、幂等键重放和版本冲突。
- 事件 schema tests 验证必填 envelope、向后兼容和未知字段容忍；consumer inbox 测试重复、乱序、失败重试。

### 11.2 集成、任务与安全

- PostgreSQL 集成测试覆盖唯一约束、事务回滚、points reservation 并发、防止跨用户 IDOR、账户删除注册表和导出脱敏。
- pg-boss/worker 测试覆盖 outbox 发布、重试/死信、任务重复运行、通知失败不影响业务状态、时区切换只重排未来通知。
- Playwright 覆盖建卡 -> 活动报名 -> 记录任务 -> 权益使用 -> 积分调整 -> 兑换 -> 价值评估的主链路，以及移动端、空/错/处理中状态。
- 数据导入测试使用恶意/超大/重复 CSV、错误行下载和 source snapshot 访问控制；安全扫描阻止完整卡号、CVV、token 进入日志和导出。

### 11.3 可观测性验收

为每个命令记录 request/correlation ID、耗时、结果和聚合版本；监控 outbox 延迟、inbox 重复率、积分对账差异、通知失败率、读模型新鲜度。发布前必须通过迁移回滚演练、备份恢复和跨时区固定时钟测试。

## 12. 技术风险与缓解

| 风险 | 影响 | 缓解/触发器 |
| --- | --- | --- |
| 把 Card 变成大聚合 | 锁竞争、复杂事务、无法独立演进 | 只保留 profile/lifecycle；跨域走事件和 read model；代码依赖检查禁止跨 repository |
| 规则频繁变化且历史漂移 | 错误判断年费/活动资格 | 不可变 RuleVersion + source snapshot + verified_at；规则变更只影响未来实例 |
| 手工数据不完整/重复 | 余额和价值不可信 | provenance、幂等键、reversal、对账状态、用户确认和最后核对日期 |
| 积分并发超扣或负余额 | 用户损失、账务不可修复 | reservation + 事务锁/序列号 + 幂等 redemption_id；每日对账和异常冻结 |
| 最终一致读模型误导用户 | 页面显示过期状态 | 返回 `as_of`/stale 标记；关键命令响应读所属聚合；后台重建可追踪 |
| 导入/OCR 误写账本 | 大量错误历史 | SourceSnapshot -> preview -> confirm；解析器版本化；禁止 connector 直写聚合 |
| 通知任务失败 | 错过截止日期 | pg-boss 重试/死信/告警；通知失败不改变业务事实；站内中心保留逾期视图 |
| 过早拆微服务 | 运维和一致性成本上升 | 先模块化单体；只有队列积压、团队边界或独立扩缩容指标持续超阈值才拆分 |
| 隐私泄露 | 合规和信任损失 | 仅 last4、最小来源内容、加密短期原件、ownership/404、脱敏日志和导出审计 |

## 13. 评审清单

- [ ] 新模块没有直接读取其他模块 repository 或写其他模块表。
- [ ] 每个跨模块引用都有 owner port、用户权限检查和删除/归档语义。
- [ ] 每个规则实例固定 `rule_version_id` 与 `source_snapshot_id`。
- [ ] 每个可重试命令有幂等键；每个消费者有 inbox 去重；不可变流水可 reversal。
- [ ] API 保留现有 `/api/v1` 行为并通过 feature flag 逐步切换。
- [ ] 手动、导入、未来同步的 provenance 可追溯，导入必须 preview/confirm。
- [ ] MVP 排除项没有以“模板字段”或“后台任务”隐式实现。

本文件只描述架构演进，不改变当前代码、数据库、依赖或部署配置。

## 14. 第二轮复核（基于 `PRD-WORKBENCH.md` v0.2）

本轮只收敛活动报名/资格、刷卡方式、任务进度与冲正、积分账本与兑换、规则版本和来源快照的边界。前述模块划分继续有效，以下内容在有冲突时优先于第 3--8 节。

### 14.1 发现的缺口与边界修订

| 领域 | PRD 与首轮架构的缺口 | 最小修订 |
| --- | --- | --- |
| 活动报名/资格 | PRD 的 `CardActivity` 同时包含活动定义、适用卡集合和某个用户的报名状态；`eligible` 容易被误解为系统已确认个人资格 | `Campaign` 只拥有公共/用户自录规则；每个 `(campaign_id, card_id)` 建一个 `ActivityParticipation`，分别记录 `eligibility_status` 与 `enrollment_status`。系统只能算 `potentially_eligible`，只有用户核对后才能记 `user_confirmed_eligible/ineligible` |
| 刷卡方式规则 | `SpendMethod` 既像可复用字典，又被任务以 ID 引用；若原对象被编辑，历史任务口径会漂移 | `SpendMethod` 是用户词典；任务激活时复制不可变 `SpendMethodSnapshot`（渠道、地区、币种、商户范围、排除项）。entry 引用任务内 snapshot，不直接引用当前词典 |
| 任务进度与资格 | 首轮把 `qualified` 当作近似终态，不能表达退款后回退，也混淆“达到数值目标”和“银行确认达标” | 拆为 `lifecycle_status`、可重算 `progress_status`、用户确认的 `qualification_status`。冲正后允许从 `target_reached` 回到 `in_progress`，并把已确认资格置为 `needs_review` |
| SpendEntry 冲正 | PRD 允许负向流水，首轮只描述 `recorded -> reversed`；任意负数会导致无法解释或重复冲正 | entry 永不编辑，类型限定为 `contribution/refund/correction/reversal`。`refund/reversal` 必须引用原 entry 或提供明确来源；同一原 entry 同一冲正原因只允许一条有效记录 |
| 积分余额 | PRD 同时有 `PointsAccount.balance` 和流水，存在 PATCH 余额绕过账本的风险 | `balance`、lot remaining 都是流水投影。用户“录入当前余额”转成 `reconciliation_adjustment` entry，并记录调整前后值、`balance_as_of` 与来源 |
| 兑换幂等 | 首轮 reservation 状态机适合未来自动兑换，但 P0 是用户在外部渠道操作后手工记录；状态名与 PRD 不完全一致 | P0 不预占积分。兑换进入 `success` 时向账本发送一次 `PostRedemptionDebit(redemption_id)`；退款发送一次 `PostRedemptionRefund(redemption_id)`。每种作用在账户内使用唯一业务键去重 |
| RuleVersion / Source | PRD 的 `Source` 既像链接目录又像规则原文快照；只存可变 URL 和一个 `source_id` 不能证明当时看到了什么 | 分成可更新的 `SourceReference` 与不可变 `SourceSnapshot`。`RuleVersion` 至少引用一个 primary snapshot；链接内容变化、新核对或人工修订都产生新 snapshot/RuleVersion，不覆盖旧记录 |

### 14.2 活动报名与资格的最小模型

`Campaign` 的状态仍为 `draft/published/ended/cancelled/needs_review`，不保存用户报名状态，也不保存可变的 `applicable_card_ids` 数组。适用范围属于 `CampaignRuleVersion`；用户与卡片的关系由 `ActivityParticipation` 拥有，并以 `(owner_user_id, campaign_id, card_id)` 唯一。

```text
eligibility_status:
unknown -> potentially_eligible -> user_confirmed_eligible
   |                |            \-> user_confirmed_ineligible
   +----------------+-------------> needs_review

enrollment_status:
not_required
not_started -> enrolled
           \-> failed
enrolled -> cancelled
```

`potentially_eligible` 只表示结构化条件没有发现冲突，不得展示为“已符合资格”。活动参与结果单独使用 `outcome_status = not_started/in_progress/target_reached/reward_received/failed/expired/needs_review`；数值目标达到只推进到 `target_reached`，奖励到账仍需用户确认。规则变更、卡片归档或任务冲正发布 review 事件，而不是静默把参与结果改成失败。

最小接口：

```http
POST /api/v1/campaigns/{campaignId}/participations
Idempotency-Key: {client-command-id}

{"card_id":"card_01J...","rule_version_id":"rulev_01J..."}
```

```http
POST /api/v1/activity-participations/{participationId}/actions
Idempotency-Key: {client-command-id}

{"action":"confirm_eligibility|enroll|record_enrollment_failure|cancel|confirm_reward","note":"..."}
```

MVP 不实现自动个人资格判定、名额查询、代报名或奖励自动到账。最小事件为 `ActivityParticipationCreated.v1`、`ActivityEligibilityConfirmed.v1`、`ActivityEnrollmentRecorded.v1`、`ActivityParticipationNeedsReview.v1`、`ActivityRewardConfirmed.v1`。

### 14.3 刷卡方式规则与任务快照

`SpendMethod` 只作为用户维护的录入模板，不是银行认定事实。`SpendTaskRuleSnapshot` 在任务激活时冻结以下内容：指标与 `all/any` 关系、期间、币种、允许的 `SpendMethodSnapshot[]`、地区/商户范围、排除项、附属卡口径、退款口径、`rule_version_id` 和 `source_snapshot_id`。模板修改只影响未来任务；进行中任务如选择迁移，创建新 snapshot 并将任务标记 `needs_review`。

记录 entry 时，服务端只校验其 method snapshot 属于该任务、日期在任务口径允许范围、币种一致；无法判断商户/MCC 或银行最终认定时仍允许保存，但将 entry 标为 `evidence_status=user_asserted/needs_review`。`custom` 条件在 MVP 只保存解释文本并要求用户确认，不执行表达式。

最小接口保持 `/spend-tasks/{taskId}/entries`，请求补充 `method_snapshot_id`、`entry_type`、`evidence_status`。不为 SpendMethod 单独设计复杂规则引擎 API；任务创建/激活时由服务端返回被冻结的 `rule_snapshot`。

### 14.4 任务进度、累计录入与冲正

任务状态拆为三条正交轴：

```text
lifecycle_status: draft -> active -> ended
                         \-> cancelled

progress_status: not_started <-> in_progress <-> target_reached
                 任一非终态 -> needs_review

qualification_status: unconfirmed -> user_confirmed
                                  \-> rejected
                       user_confirmed/rejected -> needs_review
```

截止日到达后 `lifecycle_status=ended`，根据重放结果展示 `target_reached/shortfall/needs_review`；不自动声称银行资格失败。新增、退款或冲正后总量可双向变化；如果它改变已确认结果，事务内将 `qualification_status` 置为 `needs_review` 并写审计。

`SpendTaskEntry` 为不可变事实：

- `contribution`：正向次数/金额。
- `refund`：负向影响，优先引用 `related_entry_id`；无法匹配时必须有 note/source。
- `correction`：累计录入产生的差额，可正可负，保存 `observed_total` 与调整前投影。
- `reversal`：完全抵消一个指定 entry；唯一约束 `(task_id, related_entry_id, entry_type='reversal', active=true)` 防止重复撤销，撤销本身只能通过新的 reversal-of-reversal 恢复。

服务端重放所有有效 entry 得到 current/remaining；结果低于零时不静默截断，返回 `needs_review` 并保留原始合计。API 最小修订：

```http
POST /api/v1/spend-tasks/{taskId}/entries
Idempotency-Key: {client-command-id}

{"mode":"increment|cumulative","entry_type":"contribution|refund|correction","occurred_on":"2026-08-10","count":1,"amount":"1200.00","currency":"CNY","method_snapshot_id":"methodv_01J...","related_entry_id":null,"observed_total":null,"note":"..."}
```

```http
POST /api/v1/spend-task-entries/{entryId}/reverse
Idempotency-Key: {client-command-id}

{"reason":"duplicate|wrong_amount|wrong_method|other","note":"..."}
```

事件补充 `SpendTaskProgressRecalculated.v1`（包含 before/after 与 rule snapshot version）、`SpendTaskTargetReached.v1`、`SpendTaskTargetNoLongerReached.v1`、`SpendTaskQualificationNeedsReview.v1`。`SpendTaskProgressRecorded.v1` 仍只代表事实已记录，不代表达标或资格已确认。

### 14.5 积分账本与兑换幂等

Points ledger 是余额唯一事实来源。每条 entry 有账户内递增 `sequence`、`amount`（带正负号）、`entry_type`、`business_key`、`occurred_on/posted_on`、可选 lot/source/rule 引用；唯一约束 `(account_id, business_key)`。余额投影保存最后应用的 sequence，可从头重建。lot 分配在 MVP 由用户指定或标记 `needs_review`，不假设跨银行通用的 FIFO/最早到期规则。

用户覆盖余额的最小命令是：

```http
POST /api/v1/points-accounts/{accountId}/reconciliations
Idempotency-Key: {client-command-id}

{"observed_balance":"28600","balance_as_of":"2026-08-12","source_snapshot_id":"srcsnap_01J...","note":"银行 App 手工核对"}
```

服务端按账本余额计算差额并追加 `reconciliation_adjustment`，禁止 `PATCH balance`。积分流水通用录入使用 `/points-accounts/{accountId}/entries`，必须提供幂等键；reversal 通过新 entry 引用原 entry，原记录不删除。

P0 兑换状态采用 PRD 词汇并补足退款：

```text
planned -> submitted -> processing -> success
                   \-> failed/cancelled/unknown
success -> refunded
unknown -> processing/success/failed/cancelled
```

`success` 转换与 outbox 在 redemption 事务内提交；points consumer 执行 `PostRedemptionDebit`，业务键固定为 `redemption:{id}:debit`。`refunded` 对应 `redemption:{id}:refund`。重复 HTTP 命令、worker 重试或事件重放只能命中同一账本 entry；相同 key 但积分数/账户不同必须报 `409 IDEMPOTENCY_CONFLICT`。扣减处理前状态为 `success + ledger_status=pending`，完成后为 `posted`，失败为 `needs_review`，页面不得提前展示已对账余额。

若账户余额不足，P0 仍允许记录用户已经在外部完成的兑换，但账本进入 `needs_review`，不能伪造余额为零。首轮的 `redeem_hold/release` 保留为未来“系统内发起兑换”能力，不在手工 MVP 实现。

最小兑换命令：`POST /redemptions` 创建记录，`POST /redemptions/{id}/actions` 只接受 `submit/start_processing/confirm_success/record_failure/cancel/record_refund/resolve_unknown`。事件为 `RedemptionStatusChanged.v1`、`RedemptionDebitRequested.v1`、`RedemptionRefundRequested.v1`、`PointsLedgerEntryPosted.v1`、`PointsLedgerPostingRejected.v1`。

### 14.6 RuleVersion 与 SourceSnapshot

来源边界修订为：

- `SourceReference`：规范化 URL、publisher、title、source level；可更新展示元数据，不作为历史证据。
- `SourceSnapshot`：不可变的 `reference_id`、captured/accessed time、published time（可空）、content hash、脱敏 excerpt/object reference、capture method、parser version、confidence 和 actor。URL 内容变化或用户重新核对必须新建 snapshot。
- `RuleVersion`：不可变业务解释，包含结构化条件、原文解释、适用期、状态和唯一递增版本；通过 `RuleSourceCitation` 关联一个 primary 和零到多个 supporting snapshots。

`RuleVersion.status` 的最小状态机为 `draft -> active -> superseded/expired`，任一可用状态可进入 `needs_review`；`needs_review` 经用户核对后创建新版本，不能原地回到 active。相同 `(rule_id, version)` 唯一；同一 rule 的 active 生效区间不得重叠。`verified_by_user_at` 是用户核对声明，不提高或覆盖 source confidence。

最小接口：

```http
POST /api/v1/source-snapshots
Idempotency-Key: {content-or-client-key}

{"url":"https://...","title":"活动规则","accessed_on":"2026-08-12","excerpt":"...","source_level":"official_rule"}
```

```http
POST /api/v1/rules/{ruleId}/versions
Idempotency-Key: {client-command-id}

{"effective_from":"2026-08-01","effective_to":"2026-09-30","primary_source_snapshot_id":"srcsnap_01J...","conditions":{},"change_summary":"新增移动支付范围"}
```

激活使用 `POST /api/v1/rule-versions/{id}/actions` 的 `activate/mark_needs_review/expire`；激活新版本发布 `RuleVersionActivated.v1`，事件包含被替代版本 ID。消费者只标记未开始对象“可迁移”，进行中/已结束对象继续引用原版本。来源事件只发布 `SourceSnapshotCaptured.v1`，不因抓取成功自动发布 `SourceSnapshotConfirmed`；用户核对通过 `RuleVersionVerifiedByUser.v1` 表达。

### 14.7 第二轮最小实施顺序与剩余风险

1. 先落 `SourceReference/SourceSnapshot/RuleVersion` 及引用约束，否则活动、任务和积分规则无法稳定追溯。
2. 再落 SpendTask 三轴状态、immutable entries 和冲正重放；现有 `progress_entries` 通过 adapter 映射为 contribution/correction/reversal。
3. 再落 append-only PointsLedger 和 reconciliation；禁止任何新接口直接写 balance。
4. 最后接 ActivityParticipation 与 Redemption，二者只通过 task/ledger 公开命令和事件协作。

剩余高风险：PRD 的 P0 范围同时包含多银行规则、活动、权益、任务、积分批次和兑换，实际仍偏大；建议首个实现纵切仅支持“用户自录活动 + 单卡任务 + 单积分账户 + 手工兑换结果”，`custom` 条件、自动 lot 分摊、多卡联合活动、积分转移和系统内 reservation 延后。必须补充的验证包括：报名与资格正交状态测试、退款后达标回退、累计 correction 幂等、同 entry 双重 reversal、并发兑换重复事件、余额不足、RuleVersion 生效期重叠和 snapshot 不可变性。
