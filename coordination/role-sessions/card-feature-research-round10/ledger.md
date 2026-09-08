# 卡功能扩展调研（第十轮）

## Charter
- Goal: 在既有年费 MVP 和第九轮卡领域契约之上，重新核验卡活动、卡权益、刷卡方式/任务、积分账户与积分兑换的用户需求、优先级、来源边界和实现依赖，并把可执行增量写回正式需求/技术文档。
- Non-goals: 本轮不实现业务代码、数据库迁移、API、worker 或自动化外部连接；不把公开规则当作用户资格或实时余额证明。
- Completion criteria: 产品、领域架构、DBA/数据约束角色各有独立研究稿；主会话完成冲突决策、PRD/技术文档增量合并、台账交接和静态验证。
- Parent session: Cardfolio local integrator
- Repository / base branch: main at `e756538` (working tree contains prior uncommitted UI/docs changes; role work is report-only)
- Created: 2026-08-15

## Decisions
| Date | Decision | Owner | Rationale | Affected sessions |
| --- | --- | --- | --- | --- |
| 2026-08-15 | 本轮只做增量核验，继承第九轮 canonical 状态、四元 participation、账本双差额和兑换四轴，不另起第二套模型。 | Integrator | 现有 PRD 已覆盖大量边界，避免重复或产生冲突语义。 | product, domain, architect-dba |
| 2026-08-15 | 研究稿只写 `docs/research/` 与本台账；正式 PRD/架构/数据库文档由主会话串行整合。 | Integrator | 防止并行角色争抢共享正式文档和留下未审查的交叉修改。 | all |

## Session Register
| Status | Title | Role | Thread ID | Branch/worktree | Owned files | Depends on | Output | Validation |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| complete | 产品经理｜Cardfolio｜扩展功能用户需求核验 | Product manager | `/root/card_feature_product_round10` | shared read-only workspace | `docs/research/CARD-FEATURE-ROUND10-PRODUCT.md` | `docs/PRD-WORKBENCH.md`, prior product research | user jobs, MVP/P1/P2 priority, acceptance gaps, source boundary | 8 official URLs HTTP 200; 24 GWT; whitespace check |
| complete | 领域架构师｜Cardfolio｜活动权益积分业务模型核验 | Architect | `/root/card_feature_arch_round10` | shared read-only workspace | `docs/research/CARD-FEATURE-ROUND10-ARCHITECTURE.md` | PRD + architecture + prior research | aggregate boundaries, workflow dependencies, API/event gaps, rollout gates | 20 interface/state GWT; naming and whitespace checks |
| complete | DBA｜Cardfolio｜扩展账本与查询约束核验 | DBA | `/root/card_domain_qa_round8` (reassigned) | shared read-only workspace | `docs/research/CARD-FEATURE-ROUND10-DATA.md` | PRD + database + prior research | schema/index/constraint gaps, migration order, recovery/observability gates | D-01..D-16; whitespace/fence/table checks |

## Handoffs
### product
- Changed artifacts: `docs/research/CARD-FEATURE-ROUND10-PRODUCT.md`; 未修改正式 PRD、架构、数据库、代码、迁移或锁文件。
- Interface or decision: Round10 不新增状态机，补齐规则新鲜度/关键动作前复核、待核对行动队列、报名 attempt/重试、活动取消与跨周期退款恢复、canonical spend fact + per-task evaluation、凭证轮换、部分履约和用户可解释文案。首个纵切仍为单用户/单卡/单活动/单任务/单奖励组件；P1-a 权益与 P1-b 积分兑换独立发布。
- Validation evidence: 2026-08-15 对研究稿列出的 8 个银行官方 URL 执行 `curl -L --max-time 25 -s -o /dev/null -w '%{http_code} %{url_effective}'`，均返回 HTTP 200；已静态对照 PRD、Round8/9 产品稿；`git diff --check -- docs/research/CARD-FEATURE-ROUND10-PRODUCT.md` 通过；研究稿含用户任务地图、缺失/重复/冲突/保留差距、P0/P1/P2、24 条 Given/When/Then、来源不可泛化边界。
- Risks or rollback: 跨任务消费 link、报名 attempt、部分履约 item 的最小模型需架构/DBA 在 Gate 0 冻结；规则新鲜度阈值、取消后的提醒租约和时区变更重算需 QA 固定事件顺序。若实现未满足契约，按 feature flag 停用对应写入口并保留 append-only 事实/审计，不删除用户证据。
- Ready for integration: yes（仅研究稿交付；不代表活动、权益、积分或兑换已部署）。

### domain-architecture
- Changed artifacts: `docs/research/CARD-FEATURE-ROUND10-ARCHITECTURE.md`；本轮未修改正式架构、PRD、数据库、代码、迁移或锁文件。
- Interface or decision: 补齐活动 -> SpendTask/Reward -> Benefit usage -> Points ledger -> Redemption 的 outbox/inbox 依赖图；维持四元 participation、SpendMilestone、权益 usage ledger、积分双差额/lot、兑换四轴 canonical 边界；明确 fixed-card/merged-pool scope、规则换版、部分履约/部分退分和 unknown 行动契约。P0 活动/单卡任务、P1-a 权益、P1-b 积分兑换分别使用独立 feature flag，年费 MVP 保持隔离。
- Validation evidence: 研究稿包含 20 条 Given/When/Then 接口/状态验收，覆盖跨卡/跨账户、重复请求、规则换版、snapshot/entries 互斥、里程碑顺序、权益重复核销、双差额、部分履约、退款/冲正、事件重放和 flag 隔离；已对本稿与本台账执行 `git diff --check --no-index` 空白检查及 `rg` 命名一致性检查。
- Risks or rollback: 尚未运行真实 PostgreSQL、RLS、worker、迁移、并发或恢复 E2E；merged pool scope、部分履约/退分金额守恒、projection stale/RPO/RTO 仍需 DBA/产品签收。回滚按 `p1b -> p1a -> p0 -> canonical_read_model` 逆序停写并切回旧读路由，保留 canonical 事实，禁止双向写入或删除已提交事件。
- Ready for integration: yes（仅研究稿交付，等待主会话串行整合；不代表部署 ready）。

### dba
- Changed artifacts: `docs/research/CARD-FEATURE-ROUND10-DATA.md`.
- Interface or decision: canonical-only new writes with legacy read adapters; user/card/account/instance composite scope enforced by application port + RLS + composite FK/trigger; projection watermark/rebuild and backfill fences; Gate 0 precision/timezone/RuleVersion interval freeze; Stage 0--6 migration, one-way annual-fee adapter, PITR/delete/recovery and observability gates; 16 PostgreSQL acceptance cases D-01..D-16.
- Validation evidence: `git diff --check -- docs/research/CARD-FEATURE-ROUND10-DATA.md` passed; 277-line report; fenced code blocks count is 4 (balanced); 43 table rows and 44 constraint/gate keyword checks found. No real PostgreSQL/RLS/concurrency/PITR/worker execution.
- Risks or rollback: precision (`numeric(14,2)` vs `numeric(18,3)`), RuleVersion interval semantics, projection checkpoint table shape, SourceSnapshot anonymization vs restrict FK, merged-pool/contribution scope, Reminder lease/SLA and RPO/RTO remain unsigned; rollback is feature flag/read-route switch or canonical replay, never dual-write.
- Ready for integration: yes, report-only; integrator must merge Gate 0 decisions before formal migration.

## Integration Queue
| Order | Shared concern | Integrator | Prerequisite | State |
| --- | --- | --- | --- | --- |
| 1 | 用户场景、范围和验收增量 | Integrator | product handoff | completed |
| 2 | 领域边界、接口和发布依赖 | Integrator | product + architecture handoffs | completed |
| 3 | 数据约束、迁移和可恢复性 | Integrator | product + architecture + dba handoffs | completed |
| 4 | 合并正式文档、静态验证和交接 | Integrator | all handoffs | completed |

## Final Evidence
- Commits: not created by this initiative.
- Test / build / deployment checks: `git diff --check` passed; no trailing whitespace in Round10 artifacts; role-specific source/fence/table checks passed. `npm run typecheck`, `npm test -- --run` (17 files/45 tests), `npm run build`, and `npm run test:e2e` (2 passed) passed after integration. No new runtime code was introduced by this initiative.
- Deferred follow-ups: implementation remains gated by existing Gate 0--5; only年费 MVP is currently deployable.
