# Cardfolio 卡领域第九轮架构整合复核

| 项目 | 内容 |
| --- | --- |
| 角色 | 架构师 / 主会话整合 |
| 复核日期 | 2026-08-15 |
| 输入 | PRD v1.0、ARCHITECTURE-WORKBENCH v0.7、DATABASE/SECURITY/QA Round9 研究稿 |
| 交付性质 | 实现前架构契约；不修改代码、API 路由、schema、migration 或配置 |

## 1. 结论

Cardfolio 继续使用模块化单体。卡片只拥有档案和生命周期；活动、权益、刷卡任务、积分和兑换各自拥有事实与写入规则。工作台首页是只读 read model，不拥有任何业务状态。

```text
Campaign -> ActivityParticipation -> SpendTask -> ActivityRewardComponent
Card -> BenefitEntitlement -> BenefitUsage -> quota ledger
Card -> SpendMethodSnapshot -> SpendEntry -> SpendMilestone
PointsAccount -> Observation / Entry / Lot / Allocation
Redemption -> Order / Fulfillment / PointsDebit / Refund
```

连线只表达稳定 ID、只读查询端口或可靠事件，不表示跨模块共享表或跨聚合事务。

## 2. Canonical 聚合与命令

| 领域 | Canonical 命令入口 | 禁止的隐式副作用 |
| --- | --- | --- |
| 活动 | `POST /api/v1/campaigns/{id}/participations`；资格/报名/名额/结果/奖励分别记录 | `target_reached` 不得自动发奖、写积分或下发权益 |
| 刷卡 | `POST /api/v1/cards/{id}/spend-tasks`；`POST /api/v1/spend-tasks/{id}/entries`；`POST /api/v1/spend-entries/{id}/milestones` | 不提交派生进度；不把 occurred 当 posted/settled |
| 权益 | `/api/v1/benefit-entitlements/{id}/usages` 及 reservation/presentation/redemption 子命令 | 预约、出示、拒绝、争议不扣次数；非次数权益不写 quota consume |
| 积分 | `/api/v1/points-accounts/{id}/observations|entries|lots`；lot allocation 由明确命令产生 | 不 PATCH 余额、不自动造 lot、不静默 FIFO |
| 兑换 | `/api/v1/redemptions/{id}/order-result|fulfillment|points-debit|refund-result` | 订单成功不自动 debit；失败/取消不自动 refund |

所有命令从会话派生 `owner_user_id`，要求 `Idempotency-Key`、规范 request hash 和（需要并发控制时）`expected_version`。同键同 hash 返回首次结果，同键异 hash 返回 `409 IDEMPOTENCY_KEY_REUSED`；跨用户或不兼容跨卡引用统一 `404`。

## 3. 事件和一致性

事件信封至少包含 `event_id`、`event_type`、`schema_version`、`aggregate_type/id/version`、`owner_user_id`、`occurred_at`、`actor`、`correlation_id`、`causation_id`、`business_key` 和 `source_snapshot_id`（适用时）。

- 事实、审计、幂等结果和 outbox 在同一事务提交；consumer 用 `(consumer_name,event_id)` inbox 去重。
- `SpendEntry` 只追加 occurred；posted/settled/rejected 通过 `SpendMilestone` 追加。退款/冲正只能追加关联反向事实。
- 权益核销、积分 debit/refund 和提醒投递使用永久业务键；租约过期重试沿原 event/reminder id，不生成新业务事实。
- read model 响应必须带 `as_of`、source sequence 和 `stale/rebuilding`；投影落后不回写事实、不用默认值掩盖。

## 4. 状态与兼容迁移

资格、报名、名额、任务结果、奖励、下发、预约、核销、交易里程碑、订单、履约、扣分和退分是独立状态轴。旧 `CardActivity`、`ActivityEnrollment`、`pending/success/fulfilled/used` 只保留兼容读映射，不创建第二事实源。

迁移顺序：`Stage 0` 修复年费表 ownership；`Stage 1` 来源/规则/活动；`Stage 2` SpendMethodSnapshot/Entry/Milestone；`Stage 3` 权益；`Stage 4` 积分/兑换；`Stage 5` 旧 adapter 只读切换与重建。任何阶段失败只回退读路由，不能让旧模型和 canonical 双向写入。

## 5. 发布门

- Gate 0：冻结 canonical 状态、四元 participation、来源快照、snapshot/entries 互斥、幂等、404/409 和旧 adapter。
- Gate 1/P0：真实迁移、ownership/RLS、活动五轴、消费 milestone、奖励、提醒、API/UI/E2E 和年费回归。
- Gate 2/P1-a：权益周期、凭证、usage ledger、并发/恢复/删除清理。
- Gate 3/P1-b：积分双差额、lot scope、兑换四轴、现金/部分履约、debit/refund 幂等和恢复。

当前只有年费 MVP 可部署；本稿不代表新领域已实现。

## 6. 验证记录

- 已与 PRD、DBA、QA、安全 Round9 研究稿完成静态对齐。
- `git diff --check -- docs/research/CARD-DOMAIN-ROUND9-ARCHITECTURE.md` 需在集成前执行并通过。
- 未运行真实 PostgreSQL、RLS、worker、迁移、并发、恢复或扩展领域 E2E。
