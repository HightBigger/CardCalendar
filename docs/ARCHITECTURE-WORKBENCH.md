# Cardfolio 信用卡工作台领域架构

文档版本：v0.11（PRD 第 23 节目录授权与版本引用）
基线：`main@e756538`
复核日期：2026-10-09（第 21—23 节增量；此前领域复核为 2026-08-15）
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

同一模块内命令使用一个数据库事务和乐观版本号；跨模块后台协作采用 **outbox + inbox** 的本地可靠事件。第 21、22 节新增的交互链路允许服务端 workflow 通过公共端口共享 UnitOfWork，把此次业务结果、必要条件投影、关联待办及通知调度一起提交，详见第 24 节及增量设计第 7 节。其他独立领域事实仍由所属模块显式确认；积分余额、通知实际投递和首页汇总允许最终一致，并展示处理中/最后更新时间。

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
Participation (legacy summary only):
  eligibility: unknown -> potentially_eligible -> user_confirmed_eligible|user_confirmed_ineligible|needs_review
  enrollment:  not_started -> submitted -> confirmed|rejected|expired|cancelled|unknown
  quota:      unknown -> available|full|waitlisted|allocated|not_allocated|needs_review
  outcome:     not_started -> in_progress -> target_reached|needs_review
```

报名必须引用发布时 `rule_version`；活动过期后仍可补录历史结果，但不能新报名。

本节状态图是兼容摘要；实际实现以第 14.9 节的资格、报名、名额、结果和奖励正交状态为准。旧版 enrolled、qualified 和 reward_received 不得作为新 API 的单一状态。

### 5.3 BenefitEntitlement

```text
delivery: pending_delivery -> available | delivery_failed
          available -> suspended | expired | revoked
          suspended -> available | expired | revoked
quota projection: available -> partially_used -> exhausted
```

`delivery` 是下发事实，`quota projection` 是额度派生状态；`exhausted` 不得作为下发状态写入。领取、使用、撤销分别生成不可变 entitlement ledger；余额由流水重算，不能直接 PATCH 成任意数字。

### 5.4 SpendTask

```text
draft -> active -> ended
                  \-> cancelled
active -> paused -> active
active/paused -> cancelled
```

`SpendTaskEntry` 支持 `recorded -> reversed`。任务完成度由目标快照 + 未撤销 entries 重算；导入或手工修正必须标记 `provenance`。

### 5.5 PointsAccount / PointsLedger

账户：`open -> frozen -> closed`；P0/P1 canonical 流水类型为 `earn`、`adjustment`、`expire`、`redeem_debit`、`reversal`。`transfer`、`redeem_hold` 和 `redeem_release` 仅保留为 P2 设计，不得进入 P1 手工账本；对账调整使用 `adjustment` 加 `adjustment_reason=reconciliation`。

本节的 `redeem_hold`/`redeem_release` 仅是 P2 预留术语；P0/P1 不创建积分预占，实际兑换按第 14.12 节的“外部订单轴 + 本地扣减轴”实现。

### 5.6 Redemption

```text
order: planned -> submitted -> processing -> success
                    \-> failed/cancelled/unknown
       success -> (refund_status=pending_external_confirmation) -> posted
debit: not_debited -> pending_debit -> posted | needs_review
refund: not_applicable -> not_requested -> pending_external_confirmation
        -> confirmed_external -> posted | needs_review
```

订单履约、本地积分扣减和退分必须独立显示；`success` 不等于 `posted`，失败/取消不推断退分。只有 redemption 模块能推进订单/履约/退分事实，积分扣减必须调用 points-ledger 的幂等 command，并以 `redemption_id` 作为业务键。`points_held`/reservation 仅在 P2 获批后启用。

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
| `POST` | `/activity-participations/{participationId}/actions` | 记录用户在外部渠道完成的资格/报名/名额结果；不代报名 |
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
{"data":{"entry_id":"entry_01J","task_id":"task_01J","status":"active","progress":{"amount":4200,"target_amount":5000,"remaining_amount":800,"progress_status":"in_progress","qualification_status":"unconfirmed"},"version":3}}
```

错误沿用当前 `{ error: { code, message, details, request_id } }`；并发版本冲突使用 `409`，重复幂等键若 payload 不同使用 `409 IDEMPOTENCY_KEY_REUSED`。

### 6.2 领域事件

第一批稳定事件（均带 `.v1` 版本）包括：

- `CardCreated.v1`、`CardProfileChanged.v1`、`CardArchived.v1`、`CardRestored.v1`
- `FeeCycleOpened.v1`、`FeeEventStatusChanged.v1`
- `CampaignPublished.v1`、`ParticipationEligibilityRecorded.v1`、`EnrollmentResultRecorded.v1`、`QuotaResultRecorded.v1`、`ActivityTargetReached.v1`、`RewardStatusChanged.v1`
- `BenefitEntitlementGranted.v1`、`BenefitUsed.v1`、`BenefitExpired.v1`
- `SpendTaskCreated.v1`、`SpendTaskProgressRecorded.v1`、`SpendTaskTargetReached.v1`、`SpendTaskQualificationNeedsReview.v1`、`SpendTaskEntryReversed.v1`
- `PointsLedgerEntryPosted.v1`、`RedemptionDebitRequested.v1`、`RedemptionDebitPosted.v1`、`RedemptionRefundRequested.v1`、`RedemptionRefundPosted.v1`
- `RedemptionSubmitted.v1`、`RedemptionStatusChanged.v1`、`RedemptionFailed.v1`
- `SourceSnapshotCaptured.v1`、`RuleVersionVerifiedByUser.v1`
- `NotificationScheduled.v1`、`NotificationDelivered.v1`、`NotificationFailed.v1`
- `ValueAssessmentConfirmed.v1`

订阅关系示例：`CardArchived` -> campaign participation 停止新动作、spend task 暂停、notification 取消未来发送、points account 可选冻结；`SpendTaskTargetReached` 只能生成奖励/权益待核对提醒，不能直接改奖励到账或发放权益；`RedemptionDebitPosted` 只刷新 points read model，不能反推外部订单已履约；任何规则变更只影响未来实例，不回写历史事实。

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

P1 CSV/PDF：文件先进入 `SourceSnapshot(captured)`，只输出脱敏候选变更和错误行预览，不写入目标聚合；完整逐条确认写入、`import_batch_id`、原始行号和 parser version 属于 P2 受控导入。重复导入用文件哈希 + 行指纹检测，绝不静默覆盖人工记录。

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

- redemption 的手工结果记录与幂等扣减；系统内积分 reservation/扣减状态机与可重试履约后置到 P2，不接银行/兑换商自动 API。
- value-assessment 展示年费、已确认权益价值、积分兑换价值和来源/估值日期；支持多次快照比较。
- CSV/PDF 在 P1 只做 preview/annotate；P2 才允许 preview/confirm 后按幂等命令写入，PDF/OCR 仍不得直接落账。

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

## 14. 第二轮复核（基于 `PRD-WORKBENCH.md` v0.4）

本轮收敛活动/参与/奖励、权益定义/发放/使用、任务事实口径、积分账本/批次、兑换、规则版本和来源快照的边界。前述模块划分继续有效；第 14 节在有冲突时优先于第 3--8 节，其中第 14.8 节起的决定性契约又优先于第 14.1--14.7 节的首轮复核描述。

### 14.1 发现的缺口与边界修订

| 领域 | PRD 与首轮架构的缺口 | 最小修订 |
| --- | --- | --- |
| 活动报名/资格 | PRD 的 `CardActivity` 同时包含活动定义、适用卡集合和某个用户的报名状态；`eligible` 容易被误解为系统已确认个人资格 | `Campaign` 只拥有公共/用户自录规则；每个 `(campaign_id, card_id)` 建一个 `ActivityParticipation`，分别记录 `eligibility_status` 与 `enrollment_status`。系统只能算 `potentially_eligible`，只有用户核对后才能记 `user_confirmed_eligible/ineligible` |
| 刷卡方式规则 | `SpendMethod` 既像可复用字典，又被任务以 ID 引用；若原对象被编辑，历史任务口径会漂移 | `SpendMethod` 是用户词典；任务激活时复制不可变 `SpendMethodSnapshot`（渠道、地区、币种、商户范围、排除项）。entry 引用任务内 snapshot，不直接引用当前词典 |
| 任务进度与资格 | 首轮把 `qualified` 当作近似终态，不能表达退款后回退，也混淆“达到数值目标”和“银行确认达标” | 拆为 `lifecycle_status`、可重算 `progress_status`、用户确认的 `qualification_status`。冲正后允许从 `target_reached` 回到 `in_progress`，并把已确认资格置为 `needs_review` |
| SpendEntry 冲正 | PRD 允许负向流水，首轮只描述 `recorded -> reversed`；任意负数会导致无法解释或重复冲正 | entry 永不编辑，类型限定为 `contribution/refund/correction/reversal`。`refund/reversal` 必须引用原 entry 或提供明确来源；同一原 entry 同一冲正原因只允许一条有效记录 |
| 积分余额 | PRD 同时有 `PointsAccount.balance` 和流水，存在 PATCH 余额绕过账本的风险 | `balance`、lot remaining 都是流水投影。用户“录入当前余额”转成 `adjustment`（`adjustment_reason=reconciliation`）entry，并记录调整前后值、`balance_as_of` 与来源 |
| 兑换幂等 | 首轮 reservation 状态机适合未来自动兑换，但 P1-b 是用户在外部渠道操作后手工记录；状态名与 PRD 不完全一致 | P1-b 不预占积分。兑换进入 `success` 时向账本发送一次 `PostRedemptionDebit(redemption_id)`；退款发送一次 `PostRedemptionRefund(redemption_id)`。每种作用在账户内使用唯一业务键去重 |
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
not_started -> submitted -> confirmed
submitted -> rejected | expired | cancelled | unknown
```

`potentially_eligible` 只表示结构化条件没有发现冲突，不得展示为“已符合资格”。活动参与结果单独使用 `outcome_status = not_started/in_progress/target_reached/failed/expired/needs_review`；数值目标达到只推进到 `target_reached`，奖励到账由独立 reward_status 记录并仍需用户确认。规则变更、卡片归档或任务冲正发布 review 事件，而不是静默把参与结果改成失败。

最小接口：

注意：上方 `reward_received` 仅是旧兼容投影字段，不再作为 outcome 的规范状态；新实现必须使用独立 reward 轴，并采用 `expected_pending/received/reversed/disputed`。

```http
POST /api/v1/campaigns/{campaignId}/participations
Idempotency-Key: {client-command-id}

{"card_id":"card_01J...","rule_version_id":"rulev_01J..."}
```

```http
POST /api/v1/activity-participations/{participationId}/actions
Idempotency-Key: {client-command-id}

{"action":"record_eligibility|record_enrollment_result|record_quota_result|record_reward_result|cancel|mark_reward_disputed","note":"..."}
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

服务端按账本余额计算差额并追加 `adjustment`（`adjustment_reason=reconciliation`），禁止 `PATCH balance`。积分流水通用录入使用 `/points-accounts/{accountId}/entries`，必须提供幂等键；reversal 通过新 entry 引用原 entry，原记录不删除。

P1-b 兑换状态采用 PRD 词汇并补足退款（旧 success/processing 示例仅为兼容读，不是新写入）：

```text
order_status: planned -> submitted -> accepted | rejected | cancelled | unknown
fulfillment_status: not_started -> processing -> fulfilled | failed | cancelled | unknown
points_debit_status: not_debited -> pending_debit -> posted | needs_review
refund_status: not_applicable -> not_requested -> pending_external_confirmation
               -> confirmed_external -> posted | needs_review
```

订单/履约转换与 outbox 在 redemption 事务内提交；points consumer 执行 `PostRedemptionDebit`，业务键固定为 `redemption:{id}:debit`。退分以 `redemption:{id}:refund` 关联 reversal。重复 HTTP 命令、worker 重试或事件重放只能命中同一账本 entry；相同 key 但积分数/账户不同必须报 `409 IDEMPOTENCY_CONFLICT`。扣减处理前状态为 `points_debit_status=pending_debit`，完成后为 `posted`，失败为 `needs_review`，页面不得提前展示已对账余额。

若账户余额不足，P1-b 仍允许记录用户已经在外部完成的兑换，但账本进入 `needs_review`，不能伪造余额为零。首轮的 `redeem_hold/release` 保留为未来“系统内发起兑换”能力，不在手工 MVP 实现。

最小兑换命令：`POST /redemptions` 创建记录，`POST /redemptions/{id}/order-result`、`/fulfillment`、`/points-debit`、`/refund-result` 分别写四条轴；旧 `/actions` 只允许兼容读/迁移，禁止新客户端继续生成单一 success 状态。事件为 `RedemptionOrderResultRecorded.v1`、`RedemptionFulfillmentRecorded.v1`、`RedemptionDebitRequested.v1`、`RedemptionRefundRequested.v1`、`PointsLedgerEntryPosted.v1`、`PointsLedgerPostingRejected.v1`。

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

激活使用 `POST /api/v1/rule-versions/{id}/actions` 的 `activate/mark_needs_review/expire`；激活新版本发布 `RuleVersionActivated.v1`，事件包含被替代版本 ID。消费者只标记未开始对象“可迁移”，进行中/已结束对象继续引用原版本。来源事件只发布 `SourceSnapshotCaptured.v1`，不因抓取成功自动发布 `SourceSnapshotConfirmed`（deprecated）；用户核对通过 `RuleVersionVerifiedByUser.v1` 表达。

### 14.7 第二轮最小实施顺序与剩余风险

1. 先落 `SourceReference/SourceSnapshot/RuleVersion`、所有权、幂等和引用约束，否则活动、任务和积分规则无法稳定追溯。
2. 再落 ActivityParticipation 五轴与 SpendTask 三轴状态、immutable entries 和冲正重放；现有 `progress_entries` 通过 adapter 映射为 contribution/correction/reversal。
3. 再落 Benefit ledger；预约、拒绝和争议不得写 use，只有用户确认核销才消费额度。
4. 再落 append-only PointsLedger、lot/reconciliation 和外部手工 Redemption 双状态；禁止任何新接口直接写 balance，兑换退款必须引用已 posted debit。

剩余高风险：早期 PRD 草案曾将多银行规则、活动、权益、任务、积分批次和兑换同时放入 P0，实际范围过大。当前首个实现纵切按第 14.11 节只收窄到活动/单卡任务/奖励核对；`custom` 条件、自动 lot 分摊、多卡联合活动、积分转移和系统内 reservation 延后。

### 14.8 决定性所有权与状态/接口责任表

以下表格是 P0 写模型契约。状态只能由拥有模块的命令改变，跨模块只能调用公开 command 或消费 outbox 事件。

| 对象/状态轴 | 拥有模块 | 写命令 API | 可改变的事实 | 明确不能做 |
| --- | --- | --- | --- | --- |
| `Campaign.lifecycle_status`、`CampaignRuleVersion` | campaign | `POST /campaigns`、`POST /rules/{id}/versions`、`POST /rule-versions/{id}/actions` | 活动身份、发布/结束/取消、不可变适用范围与规则版本 | 保存个人报名、任务进度或奖励到账 |
| `ActivityParticipation` 的资格/报名/名额/结果/奖励五轴 | participation | `POST /campaigns/{id}/participations`、`POST /activity-participations/{id}/actions` | 用户与卡的参与事实、用户确认和奖励记录 | 写 SpendEntry、BenefitUsage 或 PointsEntry |
| `Benefit`、`Entitlement`、`BenefitUsage` | benefit | `POST /benefits/{id}/entitlements`、`POST /entitlements/{id}/usages`、`POST /benefit-usages/{id}/actions` | 权益定义版本、实际下发、预约/使用事实、额度流水 | 活动达标即自动下发；预约即扣额度 |
| `SpendTask` 三轴、`SpendEntry`/milestone | spend-task | `POST /spend-tasks/{id}/entries`、`POST /spend-task-entries/{id}/milestones`、`POST /spend-task-entries/{id}/reverse`、`POST /spend-tasks/{id}/actions` | 发生/入账/清算事实、预计/确定进度、用户资格确认 | 修改历史 entry；把目标达到当银行确认 |
| `PointsAccount`、不可变 `PointsEntry`、lot allocation | points-ledger | `POST /points-accounts/{id}/entries`、`POST /points-accounts/{id}/reconciliations`、`POST /points-entries/{id}/lot-allocations` | 账本流水、余额投影、用户确认的批次分配和差额 | PATCH balance；自动 FIFO；虚构到期日 |
| `Redemption.order_status/fulfillment_status/points_debit_status/refund_status` | redemption | `POST /redemptions`、`POST /redemptions/{id}/order-result`、`POST /redemptions/{id}/fulfillment`、`POST /redemptions/{id}/points-debit`、`POST /redemptions/{id}/refund-result` | 外部订单受理、履约、本地扣分和退分四条底层事实轴 | P0/P1 不预占；成功确认后幂等记账；失败不假定退分 |
| `SourceSnapshot`、`RuleVersion` | source/rule | `POST /source-snapshots`、规则版本接口 | 当时看到的脱敏证据、不可变业务解释 | 抓取成功即确认正确；原地改已引用版本 |

所有 action 命令要求 `Idempotency-Key` 和 `expected_version`。非法转换、版本冲突或同 key 不同 payload 返回 `409`；同 key 同 payload 返回首次响应；跨用户资源统一返回 `404`。

### 14.9 Campaign / Participation / Reward 与 Benefit / Entitlement / Usage

Campaign 只拥有活动身份和生命周期：`draft -> published -> ended`，`draft/published -> cancelled`，可进入 `needs_review`。结束活动只停止新参与，不推导个人失败、达标或奖励结果。适用卡、报名条件、奖励规则、`cutoff_basis` 和时区属于不可变 CampaignRuleVersion。

ActivityParticipation 以 `(owner_user_id, campaign_id, card_id)` 唯一，并维护五条正交轴：

```text
eligibility: unknown -> potentially_eligible -> user_confirmed_eligible/ineligible
             any -> needs_review
enrollment:  not_required | not_started -> submitted -> confirmed
             submitted -> rejected | expired | cancelled | unknown
quota:      unknown -> available | full | waitlisted | allocated | not_allocated
            any -> needs_review
outcome:     not_started <-> in_progress <-> target_reached
             any -> needs_review
reward:      not_expected -> expected_pending -> received -> reversed
             expected_pending/received -> disputed/needs_review
```

`potentially_eligible` 只能展示为“可能适用”。报名、名额和资格均只能记录用户在外部官方渠道核对的结果；`submitted` 只表示用户已提交，不代表确认。任务达到目标只投影 `target_reached`；奖励由 ParticipationReward 保存预期日、类型、上限解释、实际确认、来源和状态历史。即使奖励类型是积分，P0 也不自动生成 PointsEntry。

Benefit 是规则身份，BenefitRuleVersion 冻结周期、额度单位、下发条件、凭证、服务商、预约渠道、本人/附属卡/携伴范围、地区、收费与来源。Entitlement 是某周期实际发放实例，以 `(owner_user_id, benefit_id, grant_key)` 唯一；BenefitUsage 是一次计划、预约、拒绝或实际使用。

```text
entitlement delivery: pending_delivery -> available | delivery_failed
                      available/suspended -> expired | revoked
quota projection: available -> partially_used -> exhausted
usage:       planned -> booked -> used
             planned/booked -> cancelled/rejected/disputed
             used -> disputed
```

只有 usage 首次进入 `used` 才在同一 benefit 事务追加不可变 `EntitlementQuotaEntry(consume)`；业务键为 `usage:{id}:consume`。`booked/rejected/cancelled/disputed` 不扣额度。已用后恢复追加 `restore`，不删除 consume。`remaining = grant + adjustment - consume + restore` 可重放；负数、单位不符或重复恢复进入 `needs_review`，不得截断为零。活动/任务至多发布 `EntitlementGrantSuggested.v1`，P0 必须由用户确认实际下发。

### 14.10 SpendTask 口径、不可变事实与暂时达标

SpendTaskRuleSnapshot 在激活时冻结 `cutoff_basis=occurred|posted|settled|unknown`、包含端点的业务日期窗、IANA 时区、指标与 `all/any` 关系、币种、SpendMethodSnapshot、商户/渠道/地区/附属卡和退款口径，以及 rule/source 版本。模板修改不影响进行中任务；迁移必须生成新 snapshot 并置资格为 `needs_review`。

一笔逻辑消费由不可变 SpendEntry 保存金额、次数、method snapshot 和 `occurred_on`；后续以不可变 milestone 追加 `posted_on`、`settled_on` 或 `rejected_on`，不得 PATCH 日期。录错使用 correction/reversal；refund/reversal 优先引用原 entry，同一原 entry 只能有一条有效 reversal。

| `cutoff_basis` | 确定进度所需事实 | 缺失时 | 窗口判定 |
| --- | --- | --- | --- |
| `occurred` | `occurred_on` | 无合法 entry | 按冻结时区的本地发生日 |
| `posted` | posted milestone | 只计预计进度 | 按冻结时区的本地入账日 |
| `settled` | settled milestone | 只计预计进度 | 按冻结时区的本地清算日 |
| `unknown` | 用户选择口径并创建新 snapshot | 全部待核对 | 不自动判定达标/失败 |

```text
lifecycle_status: draft -> active -> ended | cancelled
progress_status:  not_started <-> in_progress <-> provisionally_qualified
                                 <-> target_reached
                  any -> needs_review
qualification_status: unconfirmed -> user_confirmed | rejected
                      user_confirmed/rejected -> needs_review
```

预计总量可包含尚缺 required milestone 的 entry；确定总量只含满足 cutoff basis 且在窗口内的 entry。预计满足全部目标而确定总量未满足时为 `provisionally_qualified`；确定总量满足时为 `target_reached`，仍不代表银行确认。到期只转 `ended` 并展示 `shortfall/target_reached/needs_review`，不得自动失败。退款、冲正和新 milestone 可使进度双向变化；影响既有用户确认时，同一 task 事务把 qualification 置 `needs_review` 并保留原确认快照。

累计录入转为差额 correction，并保存 observed total 与调整前投影。重放为负、币种不符或 milestone 互斥时保留原事实并进入 `needs_review`。

### 14.11 首个手工纵切 API 与禁止自动化

首个纵切严格限定为“用户自录活动 -> 单卡 participation -> 单一 SpendTask -> 手工记录发生/入账/清算 -> 用户确认资格与奖励”。它覆盖 API、事务、审计、outbox、读模型和时区测试，但暂不接 Benefit、PointsAccount、lot 或 Redemption，避免第一条链路同时引入两个账本。

1. `POST /api/v1/source-snapshots` 保存用户粘贴的脱敏规则证据。
2. `POST /api/v1/campaigns` 创建 draft；`POST /api/v1/rules/{ruleId}/versions` 创建并激活单卡、单币种、`all|any` 版本。
3. `POST /api/v1/campaigns/{campaignId}/participations` 创建参与；`POST /api/v1/activity-participations/{id}/actions` 由用户确认资格和报名。
4. `POST /api/v1/cards/{cardId}/spend-tasks` 冻结规则/方法 snapshot 并激活任务。
5. `POST /api/v1/spend-tasks/{id}/entries` 录入发生事实；`POST /api/v1/spend-task-entries/{id}/milestones` 追加入账/清算，响应同时返回预计和确定进度。
6. `POST /api/v1/spend-tasks/{id}/actions` 执行 `record_qualification_result`；participation action 只记录 `record_eligibility`、`record_enrollment_result`、`record_quota_result`、`record_reward_result` 或 `mark_reward_disputed`。旧 `enroll`、`confirm_reward` 仅允许兼容读映射，不得作为新写入 action。

该纵切禁止自动抓取规则、自动判断个人资格、代报名、导入交易、识别 MCC、把预计进度当达标、确认银行资格、发放权益、记积分、确认奖励到账、迁移历史规则或修改历史 entry。`custom` 条件只保存说明并标记待用户确认，不执行表达式。

### 14.12 PointsEntry、lot/unallocated mismatch 与 Redemption 解耦

PointsEntry 是账面余额唯一事实，只追加且数据库业务角色不授予 UPDATE/DELETE。每条 entry 有账户内单调 `sequence`、带符号 amount、entry_type、business_key、occurred/posted date、可选 reversal/origin/source/rule 引用；唯一约束 `(account_id, business_key)`。账户行锁事务分配 sequence、追加 entry、刷新投影、写审计和 outbox。余额录入通过 reconciliation 保存 observed balance/source/as-of，再追加差额 adjustment，禁止 PATCH balance。

PointsLot 只描述已知来源/到期口径；增加、扣减、恢复都由不可变 PointsLotAllocation 关联 PointsEntry：

```text
ledger_balance       = sum(PointsEntry.amount)
lot_remaining_total  = sum(各 lot 的有效 allocation)
lot_gap              = ledger_balance - lot_remaining_total
unallocated_balance  = max(lot_gap, 0)
overallocated        = max(-lot_gap, 0)
```

`lot_gap != 0` 时 reconciliation 为 `mismatch`。正差不设到期日、不触发到期提醒；负差阻止新 lot 扣减建议。P1 由用户选 lot 或保持未分配；即使规则写明最早到期优先，也只生成建议，遇用途限制立即停止，不能自动跳过。到期日只触发提醒，P1 不自动写 expire entry。

Redemption 的旧两轴读模型已废弃；新写入必须使用订单受理、履约、积分扣分和退分四个底层事实轴（产品界面可将前两项合并为订单进展）：

```text
order_status: planned -> submitted -> accepted | rejected | cancelled | unknown
fulfillment_status: not_started -> processing -> fulfilled | failed | cancelled | unknown
points_debit_status: not_debited -> pending_debit -> posted | needs_review
refund_status: not_applicable -> not_requested -> pending_external_confirmation
               -> confirmed_external -> posted | needs_review
```

`confirm_success` 在 redemption 事务写 `RedemptionDebitRequested.v1`，points consumer 以 `redemption:{id}:debit` 幂等记账；`confirm_refund` 只能在已有 `posted` debit link 且用户提供官方退分证据时，以 `redemption:{id}:refund` 请求引用原 debit 的反向流水。订单受理不保证履约完成，订单成功不保证扣分 posted，订单退款也不保证积分已退，页面必须并列显示四个轴。余额不足、账户冻结、单位或 lot 不清不回滚外部订单事实，只把 debit 状态置 `needs_review`。P1 不 hold/reserve、不访问外部渠道、不因失败/取消猜测退分。

### 14.13 来源快照、规则版本与横切约束

- SourceReference 是可更新的 URL/publisher/title 目录；SourceSnapshot 是不可变的 accessed/captured time、published time、content hash、脱敏 excerpt/object key、capture method、parser version、confidence 和 actor；RuleVersion 是不可变业务解释，并通过 citation 引用一个 primary 和可选 supporting snapshots。
- 链接内容变化、重新核对或人工修订都创建新 snapshot/version。用户核对只记录 `verified_by_user_at`，不提高 source confidence。激活区间不得重叠；进行中和已结束对象不自动迁移。
- 每个 command 从会话取得 owner，先按 `(id, owner_user_id)` 查/锁根聚合，再校验所有父子引用；推荐用复合外键兜底。同步跨模块调用只做授权/存在性检查，不持锁写对方表。
- 状态命令用 optimistic version；PointsAccount/lot 和 Entitlement quota 用 `SELECT ... FOR UPDATE`。固定锁顺序为根行 -> entry/allocation -> audit/outbox，禁止跨模块持锁调用。
- 领域事实、审计、幂等结果和 outbox 同事务；publisher 使用 `FOR UPDATE SKIP LOCKED`。consumer 以 `(consumer_name,event_id)` inbox 去重并调用公开 command；死信告警和人工重放，不回滚已提交事实。
- 瞬时点存 UTC `timestamptz`；业务窗口存 `date + IANA timezone` 并冻结于 snapshot，端点包含。默认时区变更只影响未来对象/提醒，不重算历史发生、入账、清算归属。

### 14.14 验证、风险与依赖

实施顺序为：source/rule + ownership/idempotency/outbox 基础 -> 第 14.11 手工纵切 -> benefit quota ledger -> points/lot/reconciliation -> redemption 双状态 consumer。自动导入、lot 建议和外部 connector 的 feature flag 保持关闭。

必须验证：资格/报名/名额/结果/奖励五轴；发生/入账/清算边界和暂时达标回退；累计 correction 重放与双重 reversal；预约/拒绝不扣权益、usage 重复确认；PointsEntry 禁止更新删除、并发 sequence、lot 正负 gap；余额不足但订单成功、重复 debit/refund 事件；规则区间重叠、snapshot 不可变；跨用户父子引用；outbox 重复/乱序/死信；DST、闰日和用户改时区。

剩余依赖：`DATABASE-WORKBENCH.md` 已按第二轮契约拆分活动参与、权益使用、积分 lot 和 P1 手工兑换；这些约束尚未落入真实迁移，现有 `progress_entries` 是否包含无损的 posted/settled 来源仍需数据盘点。`custom`、多卡联合活动、自动 lot 分配、积分转移、系统内兑换和外部同步继续排除。

### 14.15 决定性规范来源

- [PostgreSQL Explicit Locking](https://www.postgresql.org/docs/15/explicit-locking.html) 与 [Transaction Isolation](https://www.postgresql.org/docs/15/transaction-iso.html)：行锁、`SKIP LOCKED`、并发异常和重试边界。
- [RFC 9110: HTTP Semantics](https://www.rfc-editor.org/rfc/rfc9110)：方法、条件请求和 404/409 状态码基线；`Idempotency-Key` 是 Cardfolio 自有命令契约，不宣称为已发布 HTTP 标准。
- [OWASP Authorization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html)：默认拒绝、每请求校验和对象级所有权控制。
- [IANA Time Zone Database](https://www.iana.org/time-zones)：IANA 时区标识与历史偏移数据。

本文件只描述架构演进，不创建迁移、不修改代码、不启用任何自动化能力。

## 15. 实施分期摘要

第 14 节是当前唯一的第二轮状态与 API 契约。本节只摘要实施门槛，不另定义资源名或状态：

1. **首个纵切**：只交付第 14.11 节的来源/规则、活动参与、单卡任务、手工 milestone、资格与奖励核对；读模型返回 `as_of`、`source_confidence` 和 `stale`。
2. **后续 P1 纵切**：按独立迁移依次交付权益额度流水、积分账本/lot mismatch、手工兑换双状态；每条链路分别通过并发、冲正、重放和跨用户测试后才接入工作台。
3. **P1/P2**：导入预览、附件、自动 lot 建议、系统内 reservation、外部 connector 和外部通知渠道；每项单独通过安全、可撤销、恢复和隐私评审。

通知、首页汇总和余额缓存只能消费 outbox 或调用只读 port，不能反向修改聚合。账户导出与删除继续作为高影响命令，要求新鲜再认证、短时令牌和可审计清理注册表；所有新增表必须注册现有 export/cleanup handler。

## 16. 第三轮角色调研整合

本轮产品、架构和 DBA 研究稿已独立完成，主会话将以下内容作为当前架构的权威修订：

1. 订单履约与积分扣减是两条状态轴；`points_held`、`redeem_hold` 和自动履约仅为 P2 预留，P0/P1 不得实现为“已扣分”。
2. 活动报名动作只记录用户在外部渠道完成的结果；资格、报名、名额、任务结果和奖励分别审计，不能提供语义为“代报名”的 API。
3. 预约、出示和权益核销分离，只有 `used/redeemed` 写额度消费流水；任务的 `occurred/posted/settled` 和预计/确定进度分离。
4. 数据库必须用复合所有权、usage-entitlement 复合引用、可拆分 lot allocation、兑换退款前置条件和幂等业务键承载上述事实；具体迁移前置见 [CARD-DOMAIN-DATA-REVIEW.md](research/CARD-DOMAIN-DATA-REVIEW.md)。

## 17. 第四轮领域对齐（P0/P1-a/P1-b/P2）

对齐稿将本文件的写入契约进一步收敛为以下唯一分期，优先级高于前文历史摘要：

1. **P0**：活动规则可关联多张卡，但每张卡独立创建 participation、名额结果、单卡 SpendTask 和 ActivityReward；不跨卡合并消费，不创建权益/积分/兑换可用写入口。
2. **P1-a**：权益下发、预约、出示、核销和争议；预约或拒绝不扣额度，只有 redemption_status=redeemed 追加 consume，恢复只能追加一次 restore。
3. **P1-b**：积分账户、lot、allocation、对账和外部手工兑换；订单 success 与积分 posted 分开，失败/取消不猜测退分，只有已 posted debit + 官方退回证据才追加 reversal；真实负余额保留并标记 needs_review。
4. **P2**：导入、自动 lot 建议/分配、系统内 reservation/hold、连接器和外部推送，必须单独授权、审计、限流、恢复和安全评审。

活动写 API 只能使用资格、报名、名额、进度和奖励五轴；旧 qualified、enrolled、reward_received、fulfilled 只允许在兼容读层映射，不得作为新写入状态。所有命令都要求 Idempotency-Key、request hash 和 expected_version；同 key 异 payload 返回 409，跨用户/跨卡引用返回 404。来源捕获事件不等于规则确认，只有用户核对事件才能提升确认状态。

本轮对齐证据：[产品决策稿](research/CARD-DOMAIN-ALIGNMENT-PRODUCT.md)、[架构对齐稿](research/CARD-DOMAIN-ALIGNMENT-ARCHITECTURE.md)、[数据约束稿](research/CARD-DOMAIN-ALIGNMENT-DATA.md)、[QA 对齐稿](research/CARD-DOMAIN-ALIGNMENT-QA.md)。

研究稿索引：

- [产品研究](research/CARD-DOMAIN-PRODUCT-RESEARCH.md)
- [架构复核](research/CARD-DOMAIN-ARCHITECTURE-REVIEW.md)
- [数据复核](research/CARD-DOMAIN-DATA-REVIEW.md)

## 18. 第四轮角色复核收敛

本轮将产品、QA、DBA 和安全复核转为实现时的唯一边界：P0 只做活动/单卡刷卡任务/奖励人工核对；P1-a 做权益额度账本；P1-b 做积分 lot/对账和外部手工兑换；系统内 reservation、导入写入、同步和自动化全部后置到 P2。

- 活动五轴（资格、报名、名额、任务结果、奖励）和权益双轴（预约、核销）不得由跨模块订阅直接改写；跨模块事件只能生成提醒或建议。
- SpendTask 必须冻结 SpendMethod/规则快照，维护发生、入账、清算 milestone 及预计/确定进度；退款/冲正通过新事实回放，不能覆盖历史 entry。
- PointsLedger 是余额唯一事实；Redemption 的订单履约和 debit/refund 处理独立，任何失败、取消或超时都不能猜测退分。
- 所有命令、worker 和读模型都遵守会话派生所有权、复合父子引用、幂等 request hash、outbox/inbox 和 404/409 语义；旧状态仅能在兼容读层映射。

在真实 PostgreSQL 迁移、RLS/IDOR、并发重放、敏感扫描、删除/备份恢复和跨时区测试完成前，架构文档不得被解释为工作台已可部署。

## 19. 第五轮状态与接口契约收敛

本轮 follow-up 架构稿解决四处会破坏可重放性的漂移，作为本文件的最新补充：

1. `SpendEntry` 只保存不可变发生事实；`posted`、`settled`、`rejected` 通过唯一的 append-only `SpendMilestone` 追加。entry 上的日期和处理状态只能是重放缓存，普通业务角色不得直接更新。
2. P1 积分到期 worker 只创建提醒；只有用户基于明确来源确认后才写 `expire` entry。自动记过期属于 P2，不能与手工账本混用。
3. `reconciliation_difference = confirmed_balance - ledger_balance`，`unallocated_difference = ledger_balance - lot_remaining_total`；两者不能合并，也不能用确认余额替代账面余额计算批次差额。
4. 兑换在产品上是三类轴、写模型是四个底层事实轴：`order_status`、`fulfillment_status`、`points_debit_status` 和 `refund_status`。订单 accepted 不代表履约 fulfilled，也不代表积分 posted；失败、取消、超时不推断退分。
5. 所有聚合保留独立 `review_status = clear | needs_review | disputed`。待核对/争议不覆盖生命周期、进度或账本轴；旧 `failed/expired/disputed` 混入进度的枚举只允许兼容读映射。

通用写命令继续要求会话派生 ownership、`Idempotency-Key` + request hash + expected version、同键异参数 `409`、越权 `404`，并在一个事务内提交事实、投影、审计和 outbox。具体资源/事件以 [第五轮架构复核](research/CARD-DOMAIN-FOLLOWUP-ARCHITECTURE.md) 为准。

## 20. 第六轮扩展状态与契约收敛（2026-08-14）

第六轮产品、架构和 DBA 研究稿已完成，以下规则覆盖前文同名历史摘要；它们仍是实现前契约，当前代码、API 和迁移尚未实现。

1. **活动参与实例**的唯一范围固定为 `(owner_user_id, campaign_id, card_id, activity_instance_key)`；资格、报名、名额、任务和每个 `reward_key` 组件分别写入，线索不得触发任务或奖励事件。
2. **SpendTask** 在激活时冻结 `SpendMethodSnapshot`、规则版本、周期和 IANA 时区；`SpendEntry` 只保存 occurred 事实，posted/settled/rejected 追加为 `SpendMilestone`，`snapshot` 与 `entries` 互斥，退款只能追加关联反向事实。
3. **权益**必须先声明 `usage_model`；只有 `consumable_quota` 的首次 `redeemed` 写 consume，预约、出示、拒绝和争议不扣额度，`coverage_claim`/`fee_credit` 不进入次数账本。
4. **积分**固定 `reconciliation_difference = confirmed_balance - ledger_balance` 与 `unallocated_difference = ledger_balance - lot_remaining_total`；未知批次不生成到期事件或自动 lot，两个差额分别投影并带水位。
5. **兑换**写模型保留 `order_status`、`fulfillment_status`、`points_debit_status` 和 `refund_status`；外部成功不直接触发 debit，失败/取消不自动退分，只有已 posted debit + 官方退回证据才允许幂等 reversal。
6. 所有未知/待核对/争议状态都要求 `reason_code`、`evidence_note`、`last_verified_at`、`next_action`；同键同 hash 重放原响应，同键异 hash 返回 409，越权/不兼容跨卡引用返回 404。

详细状态、不变量、命令/API、事件、兼容 adapter 和 Gate 0--2 见 [第六轮架构复核](research/CARD-DOMAIN-ROUND6-ARCHITECTURE.md)。在真实迁移、RLS/所有权、并发重放、备份恢复和跨时区测试完成前，不得宣称工作台模块可部署。

## 21. 第七轮 API 与发布门硬化（2026-08-14）

第七轮架构/DBA 复核进一步冻结以下实现边界：

- 参与实例必须使用 `(owner_user_id, campaign_id, card_id, activity_instance_key)`；`rule_id/rule_version_id` 仅表达规则引用，不能替代周期实例键。
- `SpendMilestone` 的 canonical 写入口是 `/api/v1/spend-entries/{entryId}/milestones`；旧 task-entry 路径仅在迁移期兼容并标 `Deprecation`，不能产生新字段或第二套事实。
- 奖励组件主表只做投影，奖励状态由 append-only event sequence/business_key/request_hash 重放；`target_reached` 不自动生成 reward received、积分流水或权益下发。
- Reminder 是持久化事实，worker 必须使用 IANA/UTC、dedupe、lease、attempt、last error 和 dead-letter；租约回收/死信重放沿原 reminder/event id，不创建新业务事实。
- 权益新写入使用 `grant/consume/restore/expire`，`reversal` 仅为受控技术反向事实；旧 `use/adjustment` 只能兼容读映射。兑换四轴和固定卡/合并池 scope trigger 必须进入 Gate 0 集成测试。

第七轮研究稿见 [架构复核](research/CARD-DOMAIN-ROUND7-ARCHITECTURE.md) 和 [DBA 复核](research/CARD-DOMAIN-ROUND7-DATA.md)。Gate 0--3、真实 PostgreSQL/RLS、并发幂等、worker、恢复和 E2E 未通过前，架构建议不能被解释为工作台已部署。

## 22. 第九轮卡领域架构整合（2026-08-15）

本轮将用户提出的卡活动、卡权益、刷卡方式、积分兑换需求映射为五个独立事实边界。以下条款覆盖前文同名摘要，当前只作为实现前契约。

### 22.1 Canonical 聚合边界

| 领域 | Canonical 写模型 | 关键不变量 |
| --- | --- | --- |
| 活动 | `Campaign` + `ActivityParticipation` + `ActivityRewardComponent` | `(owner_user_id, campaign_id, card_id, activity_instance_key)` 唯一；资格、报名、名额、结果、奖励分轴；奖励组件不得直接写积分/权益 |
| 刷卡 | `SpendMethodSnapshot` + `SpendTask` + `SpendEntry` + `SpendMilestone` | 激活时冻结支付路由/商户/MCC/地区/币种/排除项；`snapshot` 与 `entries` 互斥；退款只追加 reversal |
| 权益 | `BenefitEntitlement` + `BenefitUsage` + usage ledger | 预约、出示、拒绝、争议不扣额度；仅次数型首次 `redeemed` 写 `consume`；保险/费用抵扣不走次数账本 |
| 积分 | `PointsAccount` + `PointsObservation` + `PointsEntry` + `PointsLot` + `LotAllocation` | 观察余额、流水余额、批次余额和两个有符号差额可重算；未知批次不自动 lot/FIFO/提醒 |
| 兑换 | `Redemption` + order/fulfillment/debit/refund facts | 订单、履约、扣分、退分四轴独立；只有 `posted` debit + 官方退回证据才允许 reversal；P1 不做 hold/reservation |

### 22.2 命令和事件约束

- 所有写命令从会话派生 `owner_user_id`，锁定完整父链并验证卡片/账户兼容；跨用户或不兼容跨卡引用返回 `404`。
- 活动只能通过参与实例创建任务；`target_reached` 是本地投影，不能发布奖励到账、积分扣减或权益下发事件。
- `SpendEntry` 只追加发生事实；posted/settled/rejected 通过 `SpendMilestone` 追加，预计进度与确定进度分离。
- 权益 `ConfirmRedeemed`、积分 debit/reversal 和提醒投递均使用永久业务键与 `Idempotency-Key`；同键异参数返回 `409`，consumer 以 inbox 去重。
- Dashboard 只能消费 read model；不能在查询时补写积分批次、权益额度、活动资格或提醒事实。

### 22.3 发布顺序

1. Gate 0 冻结上述聚合、状态、事件和兼容 adapter；禁止旧模型与 canonical 双写。
2. Gate 1 先交付活动 + 单卡刷卡任务 + 奖励人工核对，完成迁移、RLS/ownership、outbox/inbox、重放和 E2E。
3. Gate 2 分别开启权益和积分/兑换 feature flag；每个模块独立通过并发、恢复、移动端和删除清理验收。

详细数据约束、QA 矩阵和安全门槛见 [Round9 数据复核](research/CARD-DOMAIN-ROUND9-DATA.md)、[Round9 QA 复核](research/CARD-DOMAIN-ROUND9-QA.md) 和 [Round9 安全复核](research/CARD-DOMAIN-ROUND9-SECURITY.md)。在真实迁移、API、worker 和恢复证据完成前，本架构不构成部署许可。

## 23. 第十轮行动依赖与实现围栏（2026-08-15）

第十轮架构核验见 [CARD-FEATURE-ROUND10-ARCHITECTURE.md](research/CARD-FEATURE-ROUND10-ARCHITECTURE.md)。本节是对第九轮 canonical 契约的实现增量，不改变模块化单体、事件重放和年费 MVP 隔离原则。

### 23.1 依赖方向

```text
SourceSnapshot -> RuleVersion -> Campaign
  -> ActivityParticipation(card, instance)
     -> SpendTask -> SpendEntry -> SpendMilestone -> progress projection
     -> ActivityRewardComponent(reward_key)
CardProfile -> BenefitEntitlement(period) -> BenefitUsage -> quota ledger
PointsAccount(scope) -> Observation/Entry/Lot/Allocation
Redemption(order) -> FulfillmentLine -> debit -> refund
```

这些连线只表达稳定引用、只读端口或 outbox/inbox 事件，不表示跨聚合事务。`target_reached`、奖励到账、权益下发和积分记账不能通过订阅自动产生副作用；每个事实都由所属聚合的显式命令写入，并保留原奖励/任务 ID 和证据。

### 23.2 第十轮新增边界

1. **报名尝试独立成事实。** `ActivityEnrollmentAttempt` 作为 participation 的 append-only 子事实，保存 attempt 序号、外部渠道、提交时间、掩码回执/哈希、结果、失败原因和重试资格；同一幂等键只返回首次结果，重试必须是新 attempt。它不改变资格、名额或任务结果轴。
2. **规则新鲜度是命令前置条件。** 报名、任务激活和兑换预检命令检查 `last_verified_at`、规则有效区间和用户 freshness policy；过期或关键字段缺失只允许保存计划/线索，不能产生确定达标、可兑换或开始刷卡提醒。
3. **消费事实不得双算。** P0 纵切保持单任务 `SpendEntry`；若同一笔消费需要服务多个任务，Gate 0 必须先落地 `SpendFact`（原始事实）与 `SpendTaskEvaluation`（按任务冻结规则评估）的一对多关联。该关联未通过迁移/回放验收前，UI 必须阻止复制金额到第二任务。
4. **部分履约按 item 记录。** `RedemptionFulfillmentLine` 保存 requested/fulfilled/rejected/cancelled 数量与证据；订单履约、points debit 和 refund 仍是四条状态轴，不能按比例自动退分。
5. **固定卡/合并池不可绕过。** `PointsAccount.scope_type` 和允许卡集合是不可变边界；`card_id=NULL` 不是合并池证明。跨卡/跨账户不兼容引用统一 `404`，合法合并池也不能改变活动/刷卡任务按卡隔离。

### 23.3 API、事件与发布开关

新增命令/事件的最小契约如下：

| 动作 | Canonical 命令 | 事实/事件 | 说明 |
| --- | --- | --- | --- |
| 报名尝试 | `POST /api/v1/activity-participations/{id}/enrollment-attempts` | `ActivityEnrollmentAttemptRecorded.v1` | 外部提交记录，不代报名；同键幂等，重试新序号 |
| 任务资格 | `POST /api/v1/spend-tasks/{id}/qualification` | `SpendTaskQualificationRecorded.v1` | 只记录用户核对，不代表银行最终认定 |
| 分项履约 | `POST /api/v1/redemptions/{id}/fulfillment-lines` | `RedemptionFulfillmentLineRecorded.v1` | 数量守恒，支持部分履约 |
| 兑换扣分/退分 | `POST /api/v1/redemptions/{id}/points-debit`、`/refund-result` | `RedemptionDebitRequested.v1`、`RedemptionRefundRequested.v1` | P1 不 hold/reserve；退分必须引用已入账 debit 和官方证据 |

P0 活动/任务、P1-a 权益、P1-b 积分/兑换继续使用独立 feature flag。发生数据差异时按 `p1b -> p1a -> p0 -> canonical_read_model` 逆序停写，保留 canonical 事实、审计和 outbox，禁止旧模型与 canonical 双向写入；年费 MVP 的旧路由不受新 flag 影响。

### 23.4 依赖验收

Gate 0 必须证明报名 attempt、规则新鲜度、消费关联或复制阻断、投影水位、四轴兑换和 unknown 行动契约；Gate 1/P0 证明活动/任务/奖励手工纵切；Gate 2/P1-a 证明权益周期/核销/恢复；Gate 3/P1-b 证明积分双差额、分项履约、扣分/退分幂等和 PITR。第十轮完整接口/状态验收见研究稿第 8 节；真实 PostgreSQL、RLS、并发、worker 和恢复未执行前，本架构仍不是部署许可。

## 24. PRD 第 21、22 节架构设计（2026-10-09）

本次根据按卡活动、周期目标、奖励领取、待办日历和待办列表需求补充目标架构，设计核对代码为 `8177312`。完整合同见 [活动、周期奖励与待办架构](./ARCHITECTURE-ACTIVITIES-TODOS.md)；前端模块、组件、状态归属、依赖方向和迁移见 [前端架构](./FRONTEND-ARCHITECTURE.md)。本节覆盖早期摘要中与这些新增能力冲突的描述，当前业务实现仍为年费 MVP。

本次确定以下边界：

1. 在既有 Campaign / ActivityParticipation / SpendTask / ActivityRewardComponent 上增加有限周期计划及稳定 period 身份。计划与周期实例归 participation 模块，Campaign 保存共享规则模板；任务和奖励通过稳定周期 ID 绑定。参与实例继续使用四元业务键；资格/报名/名额显式声明全期或每期范围，未来改期不覆盖已启动周期的冻结规则及历史。
2. 奖励支持周期独立、全部指定周期确认和全期独立目标三类条件。领取尝试、领取结果和实际到账分别保存；窗口状态由时间派生，不能用窗口关闭推断银行拒绝，也不能用领取确认推断到账。
3. 为月度与全期目标选择 `SpendFact + SpendTaskEvaluation` 同源关联方案。对外里程碑仍使用 `/spend-entries/{entryId}/milestones`，entry ID 指向原始消费事实；任务评估不复制原始金额。此方案验证前禁止跨任务复制录入。
4. 增加独立 `TodoAction`。完成、忽略、恢复和稍后处理是行动状态，报名/达标/领奖/到账仍由对应领域命令维护；逾期与可操作窗口独立派生。通知的多个提前节点只能关联一条同类行动。
5. 日历读取同一 TodoAction，额外展示不能勾选完成的业务日期 marker。节点的日历展示、待办生成和通知偏好独立；无日期行动只进入列表，预计到账日期不能被转成硬性截止。
6. 对普通交互，通过拥有模块公开端口共享事务，提交事实、必要条件投影、待办、未投递调度、审计和 outbox；后台负责投递、汇总及修复。批量计划生成/改期采用可恢复 job，候选版本完整后统一激活。v0.2 修订了 v0.1 的通用 operation 回执链，首版不要求普通保存等待异步回执。年费 adapter 保留原事实写入口，旧已完成通知不推断新待办或业务已完成。
7. 前端采用按业务模块组织、模块内分层的架构，页面组装、用例 controller、纯视图模型、API 适配和共享 UI 有明确依赖边界。远端结果归 feature controller，列表/日历共享待办工作区，跨页面只传资源失效通知；全局 provider 保留会话与偏好。

实施顺序为前端与契约边界 → 年费/自定义待办 → 单周期活动与奖励闭环 → 有限多周期和最终/全期奖励。详细需求追踪矩阵包含 PRD 21.6 的十项、22.6 的八项验收；DDL、数据库/worker/恢复验证和功能代码均待实施。

### 24.1 首版复核结论

增量设计及前端设计均更新至 v0.2。重点修订周期所有权与每期报名、交互关键状态的事务边界、批量计划统一激活、前端局部状态管理。复核依据为现有单体/同数据库部署、PRD 的按卡隔离和两视图同步要求；模块依赖约束及各领域事实确认边界继续成立。

## 25. PRD 第 23 节平台活动目录与管理框架（2026-10-09）

新增全站登录成员可见的银行活动目录。完整合同见 [目录发布与个人加入架构](./ARCHITECTURE-ACTIVITY-CATALOG.md)；现有活动/待办及前端设计更新至 v0.3。平台共享的是已发布规则，用户卡片、消费、参与、奖励和待办仍为个人所有。首版不引入 workspace 或组成员模型。

1. 独立 `activity-catalog` 管理 CatalogActivity、可编辑 CatalogDraft、不可变 CatalogRelease、发布历史与银行统一标识。管理草稿、新版编辑和日志不进入成员 DTO；发布可见性与活动日期阶段独立。
2. 角色服务管理 member/admin 授权，注册默认 member，初始管理员由可信部署配置指定稳定用户。每次管理请求及提交事务核对当前账号/会话/权限；撤权作用于既有会话。管理员只维护目录，不豁免个人 owner/card 校验。
3. 加入采用目录来源引用和个人规则快照，经私有 Campaign/rule/participation 端口导入，保留数据库 user_id 复合外键。原始目录 release 和采用历史可追溯；目录更新不覆盖当前/历史周期，也不通过再次 join 自动升级参与。
4. 显式多卡 join 使用同库 UnitOfWork、幂等与发布状态围栏；查看/预览不写入。关键条件未知保存计划和核对行动，必要条件明确才生成可执行任务。大规模生成依既有 job/candidate 统一激活合同处理。
5. 平台新版/下架事件通过 outbox/inbox 分 owner 生成核对行动，不能在发布事务中访问或改写所有成员事实。用户 diff/adopt 明确未来期范围，当前期追加审查修订；下架保留历史并由成员决定继续跟踪，确认银行取消需独立官方证据。
6. 前端增加 activity-catalog、catalog-admin 以及纯 activity-rules 模板模块；路由、adapter、query 身份和权限状态分离，复用既有待办与个人表单公开出口。架构师先提供共享合同与服务端端口，切图仔实施组件、controller 和交互。

代码骨架见 [catalog DTO](../src/contracts/activity-catalog.ts)、[目录端口](../src/modules/activity-catalog/ports.ts)、[个人 workflow 端口](../src/server/workflows/catalog-participation.ports.ts)。本轮没有提供实际鉴权/仓储/路由实现或执行迁移；开放新入口仍需通过 PRD 23.7 的九项及既有个人功能联动验收。
