# Card Domain Research

## Charter
- Goal: 基于公开官方规则与行业产品实践，补强 Cardfolio 对卡活动、卡权益、刷卡方式、积分与兑换的需求边界、状态和验收条件。
- Non-goals: 不接入银行账户、不抓取登录态、不实现自动交易/兑换、不在本轮修改业务代码或数据库迁移。
- Completion criteria: 产品研究稿、领域架构研究稿、数据约束研究稿完成；主会话把已验证结论合并进需求/技术文档，并记录来源、优先级、未决项和验证证据。
- Parent session: Cardfolio product integrator.
- Repository / base branch: `main` (working tree contains prior uncommitted documentation/UI changes; preserve them).
- Created: 2026-08-14.

## Decisions
| Date | Decision | Owner | Rationale | Affected sessions |
| --- | --- | --- | --- | --- |
| 2026-08-14 | 研究稿与正式 PRD/架构/数据库文档分离，先独立评审后由主会话合并。 | Integrator | 避免并行角色改同一文件产生冲突，并保留可追溯证据。 | product, architect, dba |
| 2026-08-14 | 只采纳官方银行/积分计划条款作为规则事实；第三方资料只能作为待核对线索。 | Integrator | 银行活动、积分有效期和权益限制高度差异化，搜索摘要不能证明资格。 | all |
| 2026-08-14 | P0 保持手工确认纵切；权益账本、积分批次和兑换双状态先定义清楚，再按 P1 逐步实现。 | Integrator | 当前代码仍是年费 MVP，避免把规划能力误示为已实现。 | all |
| 2026-08-14 | 本轮只做候选结论复核：产品、QA/架构、安全/DBA 分别检查正式文档与研究稿的一致性，正式契约仍由 Integrator 串行修改。 | Integrator | 既有研究稿已覆盖主要领域，本轮重点是发现遗漏和文档漂移，不重复并行改共享文件。 | product, qa, security |

## Session Register
| Status | Title | Role | Thread ID | Branch/worktree | Owned files | Depends on | Output | Validation |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| complete | 产品经理｜Cardfolio｜卡活动与积分需求调研 | Product manager | `/root/card_domain_product` | shared workspace, report-only | `docs/research/CARD-DOMAIN-PRODUCT-RESEARCH.md` | current PRD + official sources | 10 official sources, user journeys, P0/P1/P2, 20 acceptance criteria | URL HTTP 200 + `git diff --check` |
| complete | 架构师｜Cardfolio｜卡权益与兑换领域复核 | Architect | `/root/card_domain_architect` | shared workspace, report-only | `docs/research/CARD-DOMAIN-ARCHITECTURE-REVIEW.md` | current architecture + product report | four fact chains, state/API boundaries, rollout | `git diff --check` |
| complete | DBA｜Cardfolio｜积分与权益数据约束调研 | DBA | `/root/card_domain_dba` | shared workspace, report-only | `docs/research/CARD-DOMAIN-DATA-REVIEW.md` | current database + product/architecture reports | entities, composite ownership, ledger constraints, migration risks | `git diff --check` |
| complete | 安全工程师｜Cardfolio｜领域安全复核 | Security | `/root/security_review` | shared workspace, report-only | `docs/research/CARD-DOMAIN-ALIGNMENT-DATA.md` | integrated PRD/ARCH/DB/SECURITY/QA/UX | IDOR, sensitive data, idempotency, import/sync boundaries | `git diff --check` |
| complete | QA｜Cardfolio｜领域一致性复核 | QA | `/root/qa_review` | shared workspace, report-only | `docs/research/CARD-DOMAIN-ALIGNMENT-QA.md` | integrated PRD/ARCH/DB/SECURITY/UX | P0/P1 gates, cross-document drift, regression blockers | `git diff --check` |
| complete | 产品经理｜Cardfolio｜领域需求复核 | Product manager | `/root/qa_review/card_alignment_product` | shared workspace, report-only | `docs/research/CARD-DOMAIN-ALIGNMENT-PRODUCT.md` | formal PRD + all research | usage_model, reward components, dual points differences, P2 import/transfer, acceptance 21-25 | `git diff --check` |
| complete | QA/架构｜Cardfolio｜契约一致性复核 | QA + Architect | `/root/qa_review` | shared workspace, report-only | `docs/research/CARD-DOMAIN-ALIGNMENT-QA.md`, `docs/research/CARD-DOMAIN-ALIGNMENT-ARCHITECTURE.md` | formal PRD/ARCH/DB/SECURITY/QA | five-axis drift, reminder DDL gap, canonical state map, Gate 0 order | `git diff --check` |
| complete | 安全/DBA｜Cardfolio｜领域安全门槛复核 | Security + DBA | `/root/security_review` | shared workspace, report-only | `docs/research/CARD-DOMAIN-ALIGNMENT-DATA.md` | formal PRD/ARCH/DB/SECURITY | ownership, sensitive data, idempotency, deletion/import boundary | `git diff --check` |
| complete | UX/视觉｜Cardfolio｜真实工作台复核 | UX / design | `/root/ux_visual_direction` | shared workspace, report-only | `docs/research/UX-TECH-VISUAL-REVIEW.md`, `design-prototypes/screenshots/actual-mvp-*.png` | running MVP + UX skill | current IA, responsive evidence, visual blockers | screenshot evidence + report |

## Handoffs
### product
- Changed artifacts: `docs/research/CARD-DOMAIN-PRODUCT-RESEARCH.md`.
- Interface or decision: P0 activity + spend task; P1 benefits/points/redemption; unknown values remain explicit; 10 official sources and 20 acceptance cases.
- Validation evidence: all source URLs returned HTTP 200; `git diff --check` passed.
- Risks or rollback: individual eligibility, quota, inventory, posting and refund outcomes still require official-channel confirmation.
- Ready for integration: yes; merged into `docs/PRD-WORKBENCH.md` v0.5.

### architect
- Changed artifacts: `docs/research/CARD-DOMAIN-ARCHITECTURE-REVIEW.md`.
- Interface or decision: four independent fact chains; no delegated enrollment/transaction/redemption; pending is not success; P0 manual vertical slice and P2 reservation.
- Validation evidence: `git diff --check` passed.
- Risks or rollback: legacy simplified state sections remain compatibility notes; §14 and this round's addendum are authoritative.
- Ready for integration: yes; merged into `docs/ARCHITECTURE-WORKBENCH.md` v0.3.

### dba
- Changed artifacts: `docs/research/CARD-DOMAIN-DATA-REVIEW.md`.
- Interface or decision: composite ownership, usage-entitlement FK, account_key, split lot allocation, immutable ledgers and posted-debit refund precondition.
- Validation evidence: `git diff --check` passed; current migrations/schema inspected; no migration created.
- Risks or rollback: PostgreSQL extension/RLS/currency reference and legacy progress evidence require pre-migration decisions.
- Ready for integration: yes; merged into `docs/DATABASE-WORKBENCH.md` third-round addendum.

### security
- Changed artifacts: `docs/research/CARD-DOMAIN-ALIGNMENT-DATA.md` (security/DBA handoff).
- Interface or decision: session-derived ownership, composite FK/RLS, IDOR 404, sensitive-data rejection, append-only facts, idempotent debit/refund, isolated import/sync.
- Validation evidence: read-only review completed; `git diff --check` passed; no DB or application tests run.
- Risks or rollback: real migrations, source URL SSRF controls, deletion/re-authentication, backup/RPO-RTO and account-card redemption constraints remain implementation gates.
- Ready for integration: yes; formal SECURITY and QA semantics aligned.

### qa
- Changed artifacts: `docs/research/CARD-DOMAIN-ALIGNMENT-QA.md` and `docs/research/CARD-DOMAIN-ALIGNMENT-ARCHITECTURE.md`.
- Interface or decision: P0 multi-card/per-card activity, P1-a benefits, P1-b points/manual redemption, P2 automation; canonical states and Gate 0/1/2 blockers.
- Validation evidence: static cross-document review completed; both files pass `git diff --check`; no application/DB/E2E tests run.
- Risks or rollback: current code remains annual-fee MVP; formal migrations, reward/quota facts, reminder worker and legacy progress adapter are not implemented.
- Ready for integration: yes; merged into formal QA and architecture sections.

### product-round-4
- Changed artifacts: `docs/research/CARD-DOMAIN-ALIGNMENT-PRODUCT.md`.
- Interface or decision: points dual differences; benefit `usage_model`; multi-component rewards; `activity_instance_key`; P1 preview-only import; transfer/OCR/batch write deferred to P2.
- Validation evidence: `git diff --check` passed; no application/DB/E2E tests run.
- Risks or rollback: formal PRD/DB/UX needed canonical updates; insurance claims and fee credits must not consume quota.
- Ready for integration: yes; merged into PRD v0.6 and DB/UX boundary notes.

### qa-round-5
- Changed artifacts: `docs/research/CARD-DOMAIN-ALIGNMENT-QA.md`.
- Interface or decision: quota five-axis, reminder DDL, canonical redemption/points/benefit/spend mappings, deprecated legacy commands/events and Gate 0 order.
- Validation evidence: `git diff --check` passed; no application/DB/E2E tests run.
- Risks or rollback: real migrations and shadow PostgreSQL validation remain blocking.
- Ready for integration: yes; formal docs updated serially.

### ux-round-visual
- Changed artifacts: `docs/research/UX-TECH-VISUAL-REVIEW.md` and actual MVP screenshots.
- Interface or decision: current UI is still annual-fee MVP; activity/benefit/points IA is planned, not implemented; preserve dense readable data surfaces and clarify future modules.
- Validation evidence: 1440x900 and 390x844 screenshots; no horizontal overflow; mobile drawer keyboard behavior verified.
- Risks or rollback: three visual regressions remain in current UI (metric grid, risk color, light modal cascade); this round did not change product code.
- Ready for integration: yes; UI implementation remains a separate follow-up.

## Integration Queue
| Order | Shared concern | Integrator | Prerequisite | State |
| --- | --- | --- | --- | --- |
| 1 | 公开规则研究与来源等级 | Integrator | product report | completed |
| 2 | 状态机、命令与分期 | Integrator | product + architect reports | completed |
| 3 | 数据事实、幂等与迁移风险 | Integrator | architect + dba reports | completed |
| 4 | 合并 PRD/ARCHITECTURE/DATABASE/README | Integrator | all handoffs | completed |
| 5 | QA/security 只读复核 | Integrator | integrated diff | completed |
| 6 | 文档静态检查与测试基线 | Integrator | review findings resolved | completed |
| 7 | 本轮角色复核结论合并 | Integrator | product + qa/architect + security/dba handoffs | completed |
| 8 | 全量文档检查与基线测试 | Integrator | queue item 7 | completed |

## Final Evidence
- Commits: not created in this research pass; existing unrelated worktree changes preserved.
- Test / build / deployment checks: `git diff --check` passed; `npm run typecheck` passed; `npm test` passed (17 files/45 tests); `npm run build` passed; `npm run test:e2e` passed (2 tests). No migration or feature code changed.
- Deferred follow-ups: implement only after P0 contract and release gates are approved. Fix the three visual regressions before extending the workbench IA; current app remains annual-fee MVP.
