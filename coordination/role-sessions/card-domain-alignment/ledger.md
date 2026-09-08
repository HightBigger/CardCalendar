# Card Domain Alignment

## Charter
- Goal: 将卡活动、卡权益、刷卡方式、积分与兑换的调研结论收敛为一套可实现、可验收的 Cardfolio 工作台需求与技术契约。
- Non-goals: 本轮不实现业务代码、数据库迁移、银行连接器或自动报名/预约/兑换。
- Completion criteria: 角色审查稿完成；正式 PRD、架构、数据库文档完成对齐；关键状态、分期、提醒和数据约束无冲突；静态检查通过。
- Parent session: Cardfolio product integrator.
- Repository / base branch: `main` (保留现有未提交用户改动)。
- Created: 2026-08-14.

## Decisions
| Date | Decision | Owner | Rationale | Affected sessions |
| --- | --- | --- | --- | --- |
| 2026-08-14 | 首个发布纵切只承诺活动 + 单卡刷卡任务 + 手工确认奖励；权益、积分、兑换分为 P1-a/P1-b。 | Integrator | 当前代码仍是年费 MVP，避免文档把规划能力误示为已实现。 | product, architect, dba, qa |
| 2026-08-14 | 角色只编辑各自审查稿；正式文档由主会话串行整合。 | Integrator | 避免并行角色修改共享契约文件造成冲突。 | all |

## Session Register
| Status | Title | Role | Thread ID | Branch/worktree | Owned files | Depends on | Output | Validation |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| complete | 产品经理｜Cardfolio｜领域需求收敛 | Product manager | `/root/qa_review/card_alignment_product` | shared workspace, report-only | `docs/research/CARD-DOMAIN-ALIGNMENT-PRODUCT.md` | PRD v0.5 + product research | P0/P1-a/P1-b/P2 scope, journeys, acceptance deltas | `git diff --check` |
| complete | 架构师｜Cardfolio｜状态与契约对齐 | Architect | `/root/qa_review` | shared workspace, report-only | `docs/research/CARD-DOMAIN-ALIGNMENT-ARCHITECTURE.md` | architecture v0.3 + architecture review | canonical states, commands, events, rollout | `git diff --check` |
| complete | DBA｜Cardfolio｜提醒与账本约束 | DBA | `/root/security_review` | shared workspace, report-only | `docs/research/CARD-DOMAIN-ALIGNMENT-DATA.md` | database third-round addendum | P0 reminder schema, reward/quota, ledger/reconciliation constraints | `git diff --check` |
| complete | QA｜Cardfolio｜领域一致性验收 | QA | `/root/qa_review` | shared workspace, report-only | `docs/research/CARD-DOMAIN-ALIGNMENT-QA.md` | PRD + architecture + database | cross-doc matrix, blocking tests, Gate 0/1/2 | `git diff --check` |

## Handoffs
### product
- Changed artifacts: `docs/research/CARD-DOMAIN-ALIGNMENT-PRODUCT.md`.
- Interface or decision: P0 multi-card rule with per-card participation; five independent activity axes; P1-a benefits; P1-b points/manual redemption; P2 automation.
- Validation evidence: `git diff --check -- docs/research/CARD-DOMAIN-ALIGNMENT-PRODUCT.md` passed.
- Risks or rollback: card-specific eligibility, quota, inventory and external outcomes still require user confirmation.
- Ready for integration: yes; merged into PRD and architecture/QA phase gates.

### architect
- Changed artifacts: `docs/research/CARD-DOMAIN-ALIGNMENT-ARCHITECTURE.md`.
- Interface or decision: canonical states/commands/events; owner ports; P0/P1-a/P1-b/P2 release boundaries; idempotent outbox/inbox and compatibility mapping.
- Validation evidence: `git diff --check -- docs/research/CARD-DOMAIN-ALIGNMENT-ARCHITECTURE.md` passed.
- Risks or rollback: real migrations, RLS and legacy adapter remain implementation blockers.
- Ready for integration: yes; merged into ARCHITECTURE section 17.

### dba
- Changed artifacts: `docs/research/CARD-DOMAIN-ALIGNMENT-DATA.md`.
- Interface or decision: UTC/IANA reminders; quota and independent reward fact; BenefitUsage dual axes; append-only points/lot/allocation; account-card redemption constraint; expand/contract and recovery.
- Validation evidence: `git diff --check -- docs/research/CARD-DOMAIN-ALIGNMENT-DATA.md` passed.
- Risks or rollback: no real migration or DB tests; deletion/backup/RPO-RTO and legacy progress mapping require implementation sign-off.
- Ready for integration: yes; merged into DATABASE and QA constraints.

### qa
- Changed artifacts: `docs/research/CARD-DOMAIN-ALIGNMENT-QA.md`.
- Interface or decision: P0/P1-a/P1-b/P2 test matrix; multi-card isolation; reward/quota; benefit redemption; negative balance and debit/refund gates.
- Validation evidence: `git diff --check -- docs/research/CARD-DOMAIN-ALIGNMENT-QA.md` passed.
- Risks or rollback: application, PostgreSQL and E2E tests not run; Gate 1 remains blocked until implementation.
- Ready for integration: yes; merged into QA section 10 and formal release gates.

## Integration Queue
| Order | Shared concern | Integrator | Prerequisite | State |
| --- | --- | --- | --- | --- |
| 1 | 需求范围、P0/P1/P2 和用户验收 | Integrator | product | completed |
| 2 | canonical 状态/命令/事件 | Integrator | architect | completed |
| 3 | P0 提醒、账本与迁移前置 | Integrator | dba | completed |
| 4 | QA 阻断项与测试矩阵 | Integrator | qa + 1-3 | completed |
| 5 | 串行更新正式 PRD/ARCHITECTURE/DATABASE/QA/README | Integrator | 1-4 | completed |
| 6 | 文档静态检查与基线测试 | Integrator | 5 | completed |

## Final Evidence
- Commits: not created in this documentation pass; existing user worktree changes preserved.
- Test / build / deployment checks: tracked and role research docs pass git diff --check; npm run typecheck passed; npm test passed (17 files/45 tests); npm run build passed. No database migration or E2E for new domains exists yet.
- Deferred follow-ups: implement P0 only after Gate 0 sign-off; then P1-a/P1-b migrations and tests; P2 automation requires separate security review.
