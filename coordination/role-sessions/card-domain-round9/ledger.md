# Cardfolio 卡领域工作台 Round9

## Charter
- Goal: 调研并完善卡活动、卡权益、刷卡方式/任务、积分账户与积分兑换的产品需求及跨领域约束。
- Non-goals: 不实现业务代码、数据库迁移、银行连接、自动报名、自动交易、自动兑换或自动判断个人资格。
- Completion criteria: 研究证据可追溯；PRD 明确用户任务、状态链、P0/P1/P2 边界和验收；数据、QA、安全角色完成独立复核；主会话合并并完成静态校验。
- Parent session: Cardfolio local integrator.
- Repository / base branch: main at `e756538` (working tree contains prior UI and documentation changes).
- Created: 2026-08-15.

## Decisions
| Date | Decision | Owner | Rationale | Affected sessions |
| --- | --- | --- | --- | --- |
| 2026-08-15 | 本轮把“活动、权益、刷卡任务、积分、兑换”视为五条独立事实链，并只通过明确关联字段互相引用。 | Integrator | 报名、核销、入账、扣分和履约的时间与证据不同，合并状态会制造错误结论。 | product, dba, qa, security |
| 2026-08-15 | P0 继续限定为活动 + 单卡刷卡任务 + 奖励人工核对；权益、积分批次和兑换账本进入 P1；自动化能力进入 P2。 | Integrator | 保持首个纵切可验证，避免把银行实时结果或自动动作伪装成已上线能力。 | all |
| 2026-08-15 | 未知、待入账、待下发、待退分和争议均为显式业务状态；不得用空值或默认值代替。 | Integrator | 银行规则、渠道和外部履约无法跨机构统一推断。 | all |

## Session Register
| Status | Title | Role | Thread ID | Branch/worktree | Owned files | Depends on | Output | Validation |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ready | DBA｜Cardfolio｜卡领域数据复核 Round9 | DBA | `/root/card_domain_dba_round8` | shared workspace (report-only) | `docs/research/CARD-DOMAIN-ROUND9-DATA.md` | PRD/architecture/DBA Round8 | schema and invariant gaps | `git diff --check` passed |
| integrated | QA｜Cardfolio｜卡领域验收复核 Round9 | QA + Integrator | `/root/card_domain_qa_round8` -> `/root` | shared workspace (report-only) | `docs/research/CARD-DOMAIN-ROUND9-QA.md` | PRD/architecture/DBA/QA Round8 | P0 matrix + parent-completed P1/P2/Gates | `git diff --check` pending |
| ready | 安全工程师｜Cardfolio｜卡领域安全复核 Round9 | Security engineer | `/root/security_review` | shared workspace (report-only) | `docs/research/CARD-DOMAIN-ROUND9-SECURITY.md` | PRD/architecture/DBA/security scope | threat model and controls | `git diff --check` passed |
| integrated | 产品经理 + 架构整合｜Cardfolio｜卡领域需求 Round9 | Product manager / Architect / Integrator | `/root` | current checkout | `docs/PRD-WORKBENCH.md`, `docs/ARCHITECTURE-WORKBENCH.md`, `docs/DATABASE-WORKBENCH.md`, `docs/README.md`, `docs/research/CARD-DOMAIN-ROUND9-PRODUCT.md`, `docs/research/CARD-DOMAIN-ROUND9-ARCHITECTURE.md`, this ledger | role handoffs + existing official research | integrated requirement and contract | `git diff --check` pending |

## Handoffs
### dba
- Changed artifacts: `docs/research/CARD-DOMAIN-ROUND9-DATA.md` (348 lines).
- Interface or decision: canonical/compatibility mapping, multi-level ownership scope, projection watermark/rebuild fence, fixed-card versus merged-pool rules, points/benefit/redemption conservation and Stage 0--6 migration order.
- Validation evidence: `git diff --check -- docs/research/CARD-DOMAIN-ROUND9-DATA.md` passed; no real PostgreSQL/RLS/worker/PITR run.
- Risks or rollback: report-only; no schema or migration changes. Existing annual-fee cross-owner references remain a Stage 0 blocker.
- Ready for integration: yes.

### qa
- Changed artifacts: `docs/research/CARD-DOMAIN-ROUND9-QA.md`; QA role supplied P0 matrix, parent integrated P1-a/P1-b/P2/Gate tail after session interruption.
- Interface or decision: fixed fixtures, Given/When/Then evidence requirements, cross-user/cross-card/idempotency assertions and Gate 0--3 criteria.
- Validation evidence: `git diff --check -- docs/research/CARD-DOMAIN-ROUND9-QA.md` passed as part of the final full-tree check; no executable domain tests.
- Risks or rollback: report-only; no test implementation changes; role session interruption recorded.
- Ready for integration: yes, subject to final static check.

### security
- Changed artifacts: `docs/research/CARD-DOMAIN-ROUND9-SECURITY.md` (247 lines).
- Interface or decision: sensitive field allowlist, SSRF/XSS and source snapshot controls, composite ownership/RLS, idempotency/replay, credentials, four-axis redemption, worker lease and deletion/recovery controls.
- Validation evidence: `git diff --check -- docs/research/CARD-DOMAIN-ROUND9-SECURITY.md` passed; no real PostgreSQL/RLS/worker/penetration/recovery run.
- Risks or rollback: report-only; no security configuration changes. RPO/RTO, retention and worker bypass decisions remain open.
- Ready for integration: yes.

### product-architect
- Changed artifacts: `docs/research/CARD-DOMAIN-ROUND9-PRODUCT.md`, `docs/research/CARD-DOMAIN-ROUND9-ARCHITECTURE.md`, and the Round9 sections in formal PRD/architecture/database/QA/security/README docs.
- Interface or decision: five independent fact chains, P0/P1-a/P1-b/P2 delivery, SpendMethod taxonomy, benefit usage models, points/redemption four-axis model, API/event boundaries and Gate 0--3.
- Validation evidence: official source URLs and existing public-page research reviewed; final `git diff --check` passed.
- Risks or rollback: no implementation or external action; current code remains annual-fee MVP.
- Ready for integration: yes.

## Integration Queue
| Order | Shared concern | Integrator | Prerequisite | State |
| --- | --- | --- | --- | --- |
| 1 | 角色研究稿 | Parent | all role handoffs | completed |
| 2 | 产品范围、用户任务与分期 | Parent | product evidence + QA | completed |
| 3 | 领域边界、状态和 API 约束 | Parent | DBA + security evidence | completed |
| 4 | 合并正式文档并更新入口 | Parent | decisions recorded above | completed |
| 5 | 静态检查与交付报告 | Parent | all artifacts integrated | completed |

## Final Evidence
- Commits: none in this round; parent preserved pre-existing UI/documentation changes and did not commit or push.
- Test / build / deployment checks: `git diff --check` passed for the full working tree; all five Round9 research artifacts exist. No runtime tests were needed for documentation-only changes; domain PostgreSQL/RLS/worker/PITR/E2E evidence remains pending.
- Deferred follow-ups: implement P0 activity/spend vertical slice only after Gate 0 contracts are frozen; no deployment approval for unimplemented P1/P2 modules.
