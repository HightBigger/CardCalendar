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
| 2026-08-14 | 开启第二轮调研复核，重点覆盖活动资格/报名、权益下发与核销、刷卡交易口径、积分批次与兑换失败恢复；角色只修改各自文档，主会话负责合并。 | Integrator | 第一轮文档已覆盖主体范围，但需要验证边界状态、实际银行差异和首个可开发纵切是否足够明确。 | product, architect, dba, ux, security, qa |

## Session Register
| Status | Title | Role | Thread ID | Branch/worktree | Owned files | Depends on | Output | Validation |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ready | 产品经理｜Cardfolio｜工作台需求调研 | Product manager | `019ff620-6e9c-7aa0-9df6-17bfda281928` | `/Users/chenyixing/.codex/worktrees/0e98/xyk管理` | `docs/PRD-WORKBENCH.md` | current PRD + public research | feature scope and acceptance | 13 public links, static checks |
| ready | 架构师｜Cardfolio｜工作台领域演进 | Architect | `019ff620-6eaa-70e1-ba4b-84507a8facbb` | `/Users/chenyixing/.codex/worktrees/3189/xyk管理` | `docs/ARCHITECTURE-WORKBENCH.md` | current TECHNICAL + product scope | boundaries, contracts, rollout | second-review API/state check |
| ready | DBA｜Cardfolio｜工作台数据模型 | DBA | `019ff620-6eab-7af3-8981-48d0536ae3a1` | `/Users/chenyixing/.codex/worktrees/9373/xyk管理` | `docs/DATABASE-WORKBENCH.md` | current DATABASE + product scope | schema evolution and indexes | entity/constraint/diff check |
| ready | UX｜Cardfolio｜工作台信息架构 | UX / design | `019ff620-6f25-7141-b02a-faaab0db7fa5` | `/Users/chenyixing/.codex/worktrees/e8a7/xyk管理` | `docs/UX-WORKBENCH.md` | current UI + product scope | navigation, views, empty/error states | UX-R2-01..10 static coverage |
| ready | 安全工程师｜Cardfolio｜工作台隐私边界 | Security engineer | `/root/security_review` | shared workspace | `docs/SECURITY-WORKBENCH.md` | PRD + architecture + database scope | threat model, data minimization, abuse controls | static review, diff check |
| ready | QA｜Cardfolio｜工作台验收矩阵 | QA | `/root/qa_review` | shared workspace | `docs/QA-WORKBENCH.md` | PRD + architecture + UX scope | test matrix, edge cases, release gates | static review, diff check |
| superseded | 产品经理｜Cardfolio｜第二轮规则与场景复核 | Product manager | `019ff620-6e9c-7aa0-9df6-17bfda281928` | archived worktree unavailable | `docs/PRD-WORKBENCH.md` | first-round PRD + public source review | replaced by new worktree session | no handoff |
| superseded | 架构师｜Cardfolio｜第二轮状态与接口复核 | Architect | `019ff620-6eaa-70e1-ba4b-84507a8facbb` | archived worktree unavailable | `docs/ARCHITECTURE-WORKBENCH.md` | revised PRD | replaced by new worktree session | no handoff |
| superseded | DBA｜Cardfolio｜第二轮约束与演进复核 | DBA | `019ff620-6eab-7af3-8981-48d0536ae3a1` | archived worktree unavailable | `docs/DATABASE-WORKBENCH.md` | revised PRD + architecture | replaced by new worktree session | no handoff |
| complete | UX｜Cardfolio｜第二轮工作台流程复核 | UX / design | `019ff620-6f25-7141-b02a-faaab0db7fa5` | existing role worktree | `docs/UX-WORKBENCH.md` | revised PRD | workflow/state updates and UX-R2-B01..B12 | static coverage passed |
| complete | 产品经理｜Cardfolio｜第二轮规则与场景复核（新 worktree） | Product manager | `01a0001f-6989-7561-804d-d661679a431f` | `/Users/chenyixing/.codex/worktrees/c69b/xyk管理` | `docs/PRD-WORKBENCH.md` | e756538 + official source review | v0.4 PRD and P0/P1 acceptance | static/source checks passed |
| complete | 架构师｜Cardfolio｜第二轮状态与接口复核（新 worktree） | Architect | `01a0001f-698a-7002-aa36-4bae27bd73da` | `/Users/chenyixing/.codex/worktrees/07cf/xyk管理` | `docs/ARCHITECTURE-WORKBENCH.md` | revised PRD | state/API/invariant contract | `git diff --check` passed |
| complete | DBA｜Cardfolio｜第二轮约束与演进复核（新 worktree） | DBA | `01a0001f-69f7-7763-93c4-8c1af9a2fc91` | `/Users/chenyixing/.codex/worktrees/002e/xyk管理` | `docs/DATABASE-WORKBENCH.md` | revised PRD + architecture | schema/ledger/inbox contract | `git diff --check`, fence check passed |

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
| 6 | 合并文档、验证、推送 | Integrator | all handoffs | completed locally; push pending user release decision |

## Final Evidence
- Commits: uncommitted documentation diff; no push performed.
- Test / build / deployment checks: `git diff --check` passed; static docs check passed (8 files); `npm run typecheck`, `npm test -- --run` (17 files/45 tests), and `npm run build` passed. Workbench modules remain unimplemented.
- Deferred follow-ups: freeze Gate 0 contracts, create migrations/API tests for the P0 manual vertical slice, then add browser/assistive-tech prototype validation before UI implementation.

## Second-Round Handoffs

### Scope
- Review date: 2026-08-14
- Research focus: campaign eligibility/enrollment/reward settlement, benefit delivery/usage, spend qualification basis, points lots/expiry/reconciliation, redemption failure/refund, and first vertical-slice boundaries.
- Integration rule: role worktrees may update only their owned document; parent session must review and merge all changes.

### Integrated second-round findings
- Product: PRD v0.4 narrows P0 to source -> activity participation -> manual spend task -> reward reconciliation; benefits and points/redemption ledgers move to P1. Source confidence, qualification basis, pending/confirmed progress, refund reversal and delayed rewards are explicit.
- UX: `docs/UX-WORKBENCH.md` adds MVP/extension coexistence, independent state presentation, mobile/desktop actions and `UX-R2-B01..B12`.
- Security: P0 is blocked until composite ownership checks, immutable usage/ledger facts, inbox idempotency, source immutability, re-authenticated export/delete and cross-user worker tests are implemented.
- QA: P0 is blocked until database facts can represent participation, benefit usage, spend reversal, points lots/mismatch and external redemption failure/refund; current code still verifies annual-fee MVP only.
- Parent integration: product, architecture and DBA worktree diffs have been reviewed and merged; UX, security and QA second-round findings are recorded above and in their documents.
