# 工作台扩展

## Charter
- Goal: 将 Cardfolio 从信用卡年费管理扩展为个人信用卡管理工作台，覆盖卡片档案、卡活动、卡权益、刷卡任务、积分与兑换，并保持可分阶段交付。
- Non-goals: 不接入银行登录、完整卡号、CVV、自动交易同步或自动兑换；不在本轮直接实现业务代码。
- Completion criteria: 产品 PRD、领域架构建议、数据库演进建议和工作台 UX 信息架构完成；角色结论可追溯并由主会话汇总入库。
- Parent session: Cardfolio local integrator.
- Repository / base branch: main at `c10bd5c`.
- Created: 2026-08-12.

## Decisions
| Date | Decision | Owner | Rationale | Affected sessions |
| --- | --- | --- | --- | --- |
| 2026-08-12 | 卡片是核心聚合；活动、权益、刷卡任务、积分账户和兑换记录是可独立演进的关联模块。 | Integrator | 避免把未来领域字段堆进 cards 表，支持不同银行规则和多次参加活动。 | product, architect, dba, ux |
| 2026-08-12 | 本轮只完善文档，不实现业务代码；每个角色只写自己的交付文档。 | Integrator | 先统一范围、术语、优先级和数据边界，再进入实现。 | all |
| 2026-08-12 | 所有活动/权益/兑换规则必须记录来源、有效期、地区/渠道限制和最后确认时间；收益只做用户输入的记录与计算。 | Integrator | 银行规则会变，且产品不应提供金融承诺。 | product, architect, dba, ux |
| 2026-08-12 | 兑换分阶段：P0 只记录外部兑换并在用户确认到账后幂等记账；系统内积分预占、并发锁和自动履约后置到 P1/P2。 | Integrator | 架构、DBA、QA 复核显示首个纵切应保持手工优先，避免把未实现的自动兑换能力写成当前交付。 | product, architect, dba, qa |

## Session Register
| Status | Title | Role | Thread ID | Branch/worktree | Owned files | Depends on | Output | Validation |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ready | 产品经理｜Cardfolio｜工作台需求调研 | Product manager | `019ff620-6e9c-7aa0-9df6-17bfda281928` | `/Users/chenyixing/.codex/worktrees/0e98/xyk管理` | `docs/PRD-WORKBENCH.md` | current PRD + public research | feature scope and acceptance | 13 public links, static checks |
| ready | 架构师｜Cardfolio｜工作台领域演进 | Architect | `019ff620-6eaa-70e1-ba4b-84507a8facbb` | `/Users/chenyixing/.codex/worktrees/3189/xyk管理` | `docs/ARCHITECTURE-WORKBENCH.md` | current TECHNICAL + product scope | boundaries, contracts, rollout | second-review API/state check |
| ready | DBA｜Cardfolio｜工作台数据模型 | DBA | `019ff620-6eab-7af3-8981-48d0536ae3a1` | `/Users/chenyixing/.codex/worktrees/9373/xyk管理` | `docs/DATABASE-WORKBENCH.md` | current DATABASE + product scope | schema evolution and indexes | entity/constraint/diff check |
| ready | UX｜Cardfolio｜工作台信息架构 | UX / design | `019ff620-6f25-7141-b02a-faaab0db7fa5` | `/Users/chenyixing/.codex/worktrees/e8a7/xyk管理` | `docs/UX-WORKBENCH.md` | current UI + product scope | navigation, views, empty/error states | UX-R2-01..10 static coverage |
| ready | 安全工程师｜Cardfolio｜工作台隐私边界 | Security engineer | `/root/security_review` | shared workspace | `docs/SECURITY-WORKBENCH.md` | PRD + architecture + database scope | threat model, data minimization, abuse controls | static review, diff check |
| ready | QA｜Cardfolio｜工作台验收矩阵 | QA | `/root/qa_review` | shared workspace | `docs/QA-WORKBENCH.md` | PRD + architecture + UX scope | test matrix, edge cases, release gates | static review, diff check |

## Handoffs
### product
- Changed artifacts: `docs/PRD-WORKBENCH.md`.
- Interface or decision: six independent status chains; P0 manual confirmation; 13 public source links; 6 product metrics and 10 boundary acceptance cases.
- Validation evidence: static coverage and Markdown whitespace checks.
- Risks or rollback: bank rules change; dynamic/search snippets are not eligibility evidence.
- Ready for integration: yes.

### architect
- Changed artifacts: `docs/ARCHITECTURE-WORKBENCH.md`.
- Interface or decision: Campaign/Participation split; immutable spend snapshots; orthogonal task states; immutable ledger; P0 manual redemption debit, reservation deferred.
- Validation evidence: second-review API/event/state checks.
- Risks or rollback: first vertical slice must stay narrow; no automatic qualification or external automation.
- Ready for integration: yes.

### dba
- Changed artifacts: `docs/DATABASE-WORKBENCH.md`.
- Interface or decision: explicit `rule_versions`, campaigns, benefits/entitlements, points accounts/immutable ledger, redemptions, snapshots and value records; numeric precision and expand/contract migrations.
- Validation evidence: required-entity, constraint and `git diff --check` review.
- Risks or rollback: no executable migrations yet; FIFO/lot allocation and RLS timing remain implementation decisions.
- Ready for integration: yes.

### ux
- Changed artifacts: `docs/UX-WORKBENCH.md`.
- Interface or decision: six-entry IA; activity/task and points/redemption subviews; desktop inspector/mobile drawer; separate unknown/pending/expired/failed/refunded states.
- Validation evidence: UX-R2-01..10 static acceptance coverage.
- Risks or rollback: prototype and real browser/assistive-tech validation still required.
- Ready for integration: yes.

### security
- Changed artifacts: `docs/SECURITY-WORKBENCH.md`.
- Interface or decision: ownership checks, immutable ledger, idempotency, audit allowlist, attachment/import isolation and sync least privilege.
- Validation evidence: static review and `git diff --check`.
- Risks or rollback: re-auth, attachment retention, RLS, backup retention and distributed rate limits need release decisions.
- Ready for integration: yes.

### qa
- Changed artifacts: `docs/QA-WORKBENCH.md`.
- Interface or decision: domain/cross-cutting matrix, current MVP regression baseline, Gate 0--3 and release blockers.
- Validation evidence: static matrix review and `git diff --check`.
- Risks or rollback: workbench modules have no code, migrations, API or tests yet; only annual-fee MVP is currently verifiable.
- Ready for integration: yes.

## Integration Queue
| Order | Shared concern | Integrator | Prerequisite | State |
| --- | --- | --- | --- | --- |
| 1 | 产品范围与术语 | Integrator | product handoff | completed |
| 2 | 领域边界/API演进 | Integrator | product + architect | completed |
| 3 | 数据模型与迁移 | Integrator | product + architect + dba | completed |
| 4 | 工作台信息架构 | Integrator | product + ux | completed |
| 5 | 安全与质量门槛 | Integrator | product + architect + dba + ux | completed |
| 6 | 合并文档、验证、推送 | Integrator | all handoffs | in_progress |

## Final Evidence
- Commits: pending integration commit.
- Test / build / deployment checks: `git diff --check`; no application tests/build because this turn is documentation-only.
- Deferred follow-ups: freeze Gate 0 contracts, then implement a narrow manual vertical slice; add browser/assistive-tech prototype validation before UI implementation.
