# Cardfolio 数据约束 follow-up 复核

| 项目 | 内容 |
| --- | --- |
| 角色 | DBA |
| 复核日期 | 2026-08-14 |
| 基线 | 当前 working tree；实际数据库仍为年费 MVP |
| 范围 | 活动参与、刷卡事实、权益使用、积分账户/lot/entry、兑换、提醒、迁移与恢复 |
| 交付边界 | 只读研究；只新增本文件，不修改代码、迁移、package、正式契约或其他角色文件 |

## 1. 结论

当前产品代码和迁移仍只有 `users`、`sessions`、`cards`、`fee_cycles`、`fee_events`、`progress_entries`、`reminder_rules`、`reminders`、`audit_logs` 和 `worker_heartbeats`。工作台文档中的活动、权益、积分、兑换、来源快照、outbox/inbox 和统一提醒均是规划能力，不能描述为已实现。

`docs/DATABASE-WORKBENCH.md` 的模型方向正确，但关键安全与账务保证仍有“文字声明而非可执行约束”的情况。P0 发布前必须先把基线所有权、活动/任务事实、奖励事实和提醒去重落库；P1-a/P1-b 再分别启用权益和积分/兑换。任何阶段都不能通过直接修改 cache、余额或兼容状态列来绕过事实流水。

## 2. Canonical 决策

1. **所有权**：所有子表保留 `user_id`；固定卡关系同时保留 `card_id`。数据库使用 `(id,user_id)`、必要时 `(id,user_id,card_id)` 唯一键和复合 FK，应用层仍从会话取得 owner。对象型提醒若继续使用 `object_id`，必须由按类型触发器/存储过程验证父对象的 `user_id`；更可审计的方案是按对象类型拆 target 表。
2. **事实**：participation event、reward event、SpendTaskEntry、benefit entitlement ledger、points ledger、lot allocation、redemption link 均 append-only。普通应用角色撤销 `UPDATE/DELETE`；修正只追加 correction/reversal，并在同一事务写 audit、幂等结果和 outbox。
3. **活动与任务**：活动身份与每卡 `ActivityParticipation` 分离；资格、报名、名额、结果、奖励五轴正交。任务冻结 `rule_version`、method snapshot、窗口和 IANA 时区；`snapshot` 与 `entries` 二选一。`occurred_on <= posted_on <= settled_on`（存在时）以及 reversal 精确反向/部分退款累计上限必须由 deferred trigger 或唯一 command 保证。
4. **权益**：`reservation_status`、`redemption_status` 是事实轴，兼容 `BenefitUsage.status` 只能由投影生成。只有首次 `redeemed` 写 `use`，预约、取消、拒绝、争议不扣额度；剩余量可为负但必须标 `needs_review`，不得截断。
5. **积分**：`ledger_balance = sum(points_delta)`；`allocated_balance = sum(lot allocations)`；有符号 `unallocated_difference = ledger_balance - allocated_balance`；`reconciliation_difference = confirmed_balance - ledger_balance`。两种差额不能合并。架构稿中 `max(lot_gap,0)` 的非负投影与 PRD/DBA 的有符号契约冲突，必须以有符号值为 canonical。未知到期日不生成提醒。
6. **兑换**：canonical 字段名统一为 `points_debit_status`（DB 草案现称 `ledger_status`，架构稿又称 `debit_status`；旧名只做读映射）。订单 `success`、本地 debit `posted`、退款 `refunded` 独立；只有已 `posted` debit link 和官方退分证据才能追加等额 reversal。外部成功但本地余额不足保留真实负数并标记 `needs_review`。

## 3. 正式数据库文档仍缺的约束

| 优先级 | 缺口与证据 | 应补的数据库/事务约束 | 风险 |
| --- | --- | --- | --- |
| P0 | 现有 `fee_cycles`、`fee_events`、`progress_entries`、`reminders` 仅有单列 FK；`user_id` 与父卡/周期可被交叉写入（`db/migrations/0000_initial.sql:86-197`）。 | 盘点孤儿和跨 owner 行后，为父表加复合唯一键；以 `NOT VALID` 加入 `(child_id,user_id[,card_id])` FK，再离峰 `VALIDATE`。提醒 target 也要校验同 owner。 | IDOR、跨卡累计和错误删除级联。
| P0 | `workbench_reminders` 只有建议 DDL；现有提醒仅支持 `fee_event/progress`，且多态 `object_id` 没有 FK。 | expand 现有 `reminders` 或新表，加入 `object_type/object_id/reminder_type/trigger_at/timezone/dedupe_key/source_sequence`、租约/重试字段；稳定 `unique(user_id,dedupe_key)`，写入函数按对象类型检查 ownership。 | 重复提醒、跨用户引用、worker 重放无法恢复。
| P0 | `activity_participation_events`、`activity_reward_events` 仍为 prose；`activity_rewards` 仅有 `reward_key` 唯一，未提供事件 sequence/状态迁移边。 | 建 event 表 `(aggregate_id,sequence)`、`(aggregate_id,business_key)` 唯一；状态只能由 transition function/trigger 投影，要求确认时间、合法边和同键 request hash 冲突。 | 报名/奖励历史可被覆盖，`target_reached` 被误当到账。
| P0 | SpendEntry 的日期顺序、task 币种、cutoff 与 `qualification_status` 关系只在说明中出现；DDL 仅校验正负符号（`DATABASE-WORKBENCH.md:373-429`）。 | `CHECK` 日期顺序和非零增量；触发器校验 entry currency/method/task、`included` 是否满足 cutoff、部分 refund 累计绝对值不超过原 entry、reversal 无环且同 task；锁 task 分配 sequence。 | 预计值进入确定进度、重复/非精确冲正、跨币种重算。
| P0 | append-only、sequence 连续分配和 outbox/inbox 只有运行约定，实际表/权限不存在。 | 基础迁移创建 outbox、inbox、idempotency command/result；受控 `SECURITY DEFINER` 写函数固定 `search_path`，应用角色无 entry/ledger `UPDATE/DELETE`；sequence 由父行锁下分配。 | 重试形成重复事实，事件已发出但事实未提交。
| P1 | BenefitUsage 的兼容 `status` 没有数据库投影约束；ledger 只以文字保证 `redeemed` 才能 use，缓存/单位/超用也无 deferred 校验。 | 三列 entitlement FK；状态转换触发器；ledger trigger 校验 usage 同实例、grant/use/reversal 符号、同币种、精确反向和 `remaining = sum(ledger)`，负值自动标 `needs_review`。 | 预约扣额度、跨权益错扣、负剩余被隐藏。
| P1 | PointsLotAllocation 有 `unique(account_id,allocation_sequence)`，但未明确 allocation 方向、总量上限和 lot 不得负；一笔 ledger 拆多个 lot 会冲突（`DATABASE-WORKBENCH.md:710-737`）。 | 保留 `(ledger_entry_id,lot_id)` 去重；`allocation_sequence` 独立于 ledger sequence；deferred trigger 校验同账户、方向、绝对值不超 entry、lot remaining 恒等式和负差标记。 | 合法拆 lot 失败或账面/批次不守恒。
| P1 | `points_accounts` 缺 `balance_source/last_verified_on/source_snapshot_id` 等可追溯字段；`points_reconciliations` 以 `(user_id,client_request_key)` 唯一，账户命名空间不清。 | 以 `(account_id,client_request_key)` 作为 reconciliation 幂等键并保存 request hash/source；账户 confirmed snapshot 必须有 as-of/source；同计划按卡账户与合并池由 `account_key` 明确区分。 | 不同账户误冲突，无法解释确认余额来源。
| P1 | Redemption 的 `card_id` 可空，复合 FK 遇 NULL 会放行“固定卡账户 + 未填 card”；`status/ledger_status` check 不要求 refund link 已存在。 | 触发器/存储过程强制：账户绑定卡时 redemption.card_id 必须相同；合并池才允许 NULL。`refund_pending/refunded` 仅能从 `posted` debit link 进入，`refunded` 必须有唯一 refund link 且金额精确相反。 | 同用户跨卡兑换、先退分后扣分、重复退分。
| P1 | PointsLot 缺 `unit/scale` 继承、origin/source 和明确初始 amount；账户/lot cache 由客户端无法直接证明。 | lot/entry 写入触发器读取账户 `unit_code/points_scale`；source snapshot、origin type/id 必填规则按来源分支校验；cache 只能由重放过程更新。 | 小数精度或批次来源漂移，差额不可解释。
| 横切 | 时区要求通过 `pg_timezone_names` 校验，但普通 CHECK 不能安全执行子查询；索引只覆盖 UTC 触发时间，未定义冻结 local-date。 | 建 `is_valid_iana_timezone()` 稳定函数/触发器；对象保存冻结 timezone 与 `local_date`/窗口 date；提醒按 `(user_id,status,trigger_at)`、对象和 pending partial index，worker lease/attempt/dead-letter 有索引。 | DST/跨日重复或漏提醒，查询退化。

## 4. 分阶段 Expand/Contract 与恢复

### Stage 0：预检与恢复基线（不可回滚的前置）

- 确认 PostgreSQL 15、`pgcrypto/citext`、`btree_gist` 权限、RLS/worker 角色和 `set_updated_at()`；若无 `btree_gist`，采用锁 `rules` 的 constraint trigger，不删除重叠期保证。
- 做加密全量备份和 PITR/WAL 标记，记录表计数、孤儿、跨 owner/card 引用、重复自然键、当前 reminder 生成量和可恢复时间点。失败只出报告，不清理数据。

### Stage 1：Ownership 与基础横切

- 先增加父表复合唯一索引，再 `NOT VALID` 加入并验证现有 cards/cycles/events/progress/reminders 的复合 FK；清理/隔离孤儿必须有可重试清单和审计。
- 创建 `iso_4217_currencies`、source reference/snapshot/rule/version/citation、append-only 触发器、最小数据库角色、idempotency command/result、outbox/inbox。没有 primary snapshot 的规则不得 active。
- 建立 IANA 校验函数和统一 `request_hash` 规范；所有基础表的 `updated_at` 触发器不应作用于 append-only 表。

### Stage 2：P0 活动、任务、奖励与提醒

- expand `reminders`（或切入统一表）并双写 fee reminders；先只读 shadow 查询比较 `dedupe_key`、timezone、trigger_at 和旧提醒数量。新增 activity end/task due/reward verification 后再切写。
- 创建 campaign/participation/event/reward/reward-event、spend task/method snapshot/entry；在事务内锁聚合并写 audit/outbox，状态列仅为投影。
- 旧 `progress_entries` 建只读 legacy adapter：可推导的日期/金额回填为 `legacy_progress` contribution；没有 posted/settled/business key 的行标 `needs_review`，不得伪造银行事实。双写观察至少覆盖一个完整年费周期，逐 task 全量重放与旧读路径做 parity 报告。
- Gate P0：跨用户/跨卡 404、同活动多卡唯一、日期/cutoff、重复累计、精确 reversal、提醒 worker 重放/DST/闰日、备份恢复 smoke 全部通过。

### Stage 3：P1-a 权益

- 创建 benefit/entitlement/usage/ledger；回填仅接受有稳定业务键的 grant/use，预约不得转换成 use。先启用只读投影，再开启 redeemed command。
- 并发核销锁 entitlement；重复 key 返回同结果，同 key 异 hash 409。超用事实保留并标 `needs_review`，不回写/截断 cache。
- Gate P1-a：预约/出示/核销双轴、跨 entitlement FK、grant/use/reversal 重放、归档卡和删除清单通过。

### Stage 4：P1-b 积分、lot、对账与兑换

- 先建 account/points ledger/sequence/reconciliation，再建 lots/allocations；旧余额只能成为 confirmed observation 或 reconciliation adjustment，不能伪造 earn lot。明确到期日之外的差额保持未分配、不触发提醒。
- 建 redemption/link、状态转换和 debit/refund outbox consumer；冻结任何旧兑换 worker，逐单核对 success/failed/cancelled/refund 后再开放新命令。
- Gate P1-b：points scale、账户锁和连续/唯一 sequence、拆 lot、正负差额、负余额 `needs_review`、双 worker 幂等、先扣后退、PITR 后外部事件重放通过。

### Stage 5：Contract 与长期恢复

- 至少两个完整核对周期且重放、并发、导出/删除和恢复演练通过后，关闭旧写入口、切换新读路径；旧表与业务键保留只读观察期，不立即删除。
- 常规回滚只停 feature flag、consumer 和新写入口，恢复旧读 facade；不删除新事实、不把新账本回写旧累计。缓存损坏从事实全量重建；PITR 后按业务 key 重放恢复点之后已确认的兑换/退款，并重新校验 outbox/inbox、RLS、lot 恒等式和删除注册表。

## 5. 验收重点

1. 同一 `(user,campaign,card)` 并发只产生一条 participation；同活动的另一张卡独立累计，跨卡 FK 失败。
2. 发生日在窗口内但入账日在窗口外时，只进 pending；日期倒序、任务币种不一致、method 属于另一 task 均失败。
3. 部分 refund 累计不超过原 entry；第二 reversal、跨 task、引用自身和非精确 reversal 均失败；负进度保留并标 `needs_review`。
4. 预约 confirmed、现场 rejected/cancelled/disputed 都不产生 use；两个并发 redeemed 最多一条 use，reversal 恢复一次且可重放。
5. 一条 earn/redeem 拆到两个 lot 成功；`ledger = allocated + unallocated`，正差不造到期提醒，负差进入 mismatch；跨账户 allocation 失败。
6. 同一兑换重复 HTTP、outbox、两个 debit worker 和死信重放只有一个 debit link；failed/cancelled 无 debit；debit 未 posted 的 refund 被拒。
7. 提醒同一 dedupe key 只一条；归档/完成不重新生成；UTC 与冻结 IANA 时区在 DST、闰日和跨日边界稳定，旧事件不覆盖新水位。
8. 从备份+WAL 恢复后，活动/任务/权益/积分/lot/redemption/remainder cache 均可重建，删除账户不会通过恢复副本回灌在线数据。

## 6. Risks / open questions

- `iso_4217_currencies` 的维护主体、`btree_gist` 可用性、RLS worker 旁路角色尚未签字。
- 多卡联合活动贡献、跨账户 transfer、自动 FIFO/用途限制、系统内积分 hold、部分退款不属于 P0/P1，必须另建双边守恒模型。
- 旧 `progress_entries` 是否有可推导 posted/settled 证据尚未盘点；在盘点前只能有损迁移并显示 `needs_review`。
- 账户删除/导出再认证、备份保留期、RPO/RTO、来源对象清理注册表仍是发布阻断项。
- 提醒多态目标若不拆表，触发器必须覆盖每一种 `object_type` 的 owner、归档和终态规则；不能仅凭 `object_id` 存在性通过。

## 7. 交接

**Changed files**：`docs/research/CARD-DOMAIN-FOLLOWUP-DATA.md`（唯一新增文件）。

**Decisions**：以有符号积分未分配差额和独立 reconciliation 差额为 canonical；统一兑换 `points_debit_status` 语义；账户固定卡/合并池显式兼容；提醒对象 ownership、append-only 触发器、状态 transition、lot/reversal 守恒必须从 prose 落为数据库可执行约束；按 Stage 0--5 expand/contract、adapter、重放和恢复门槛推进。

**Validation**：已对照 `docs/PRD-WORKBENCH.md`、`docs/ARCHITECTURE-WORKBENCH.md`、`docs/DATABASE-WORKBENCH.md`、`docs/SECURITY-WORKBENCH.md`、`docs/QA-WORKBENCH.md`、`docs/UX-WORKBENCH.md`、`docs/research/CARD-DOMAIN-*`、现有 Drizzle schema 与 `0000`--`0003` migration；未运行数据库迁移或业务测试。完成编辑后执行 `git diff --check`。

**Risks/open questions**：真实 PostgreSQL 约束、RLS/worker、outbox/inbox、旧数据可回放性、提醒 lease/DST、删除/恢复和 RPO/RTO 尚未验证；P0/P1/P2 规划能力不能视为已实现。

**Ready for integration**：yes；主会话可将本稿作为 DBA follow-up 合并输入，但应先关闭第 6 节风险并在影子 PostgreSQL 完成各阶段 gate。
