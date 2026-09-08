# Card Domain Round 8

## Charter
- Goal: 基于公开官方规则和现有七轮成果，复核 Cardfolio 对卡活动、卡权益、刷卡方式、积分与兑换的需求完整性，并将新增决策交付给主会话合并。
- Non-goals: 本轮不修改业务代码、数据库迁移、锁文件或部署配置；不接入银行登录、交易同步、自动报名、自动兑换或外部通知。
- Completion criteria: 产品、架构、DBA 三份独立研究稿完成；QA 对跨文档契约和验收门槛进行复核；主会话更新正式 PRD、README 和角色台账，并记录来源、优先级、未决项与验证证据。
- Parent session: Cardfolio product integrator.
- Repository / base branch: `main`; preserve existing uncommitted worktree changes.
- Created: 2026-08-14.

## Working rules
1. 角色只写各自 `docs/research/CARD-DOMAIN-ROUND8-*.md`，不修改正式 PRD、架构、DBA、QA、安全、UX 文档、代码、迁移或其他角色文件。
2. 公开资料只用来确认规则维度和产品边界，不推导个人资格、实时余额、库存、发奖、退分或服务可用性。
3. 所有未知状态必须带原因、证据时间和下一步；不得为了“完整”填充默认事实。
4. 研究稿须返回变更文件、关键决策、验证命令、风险和交接状态。

## Decision log
| Date | Decision | Owner | Affected roles |
| --- | --- | --- | --- |
| 2026-08-14 | 以现有 PRD v0.8 和 Round7 canonical 契约为输入，重点检查用户可执行性、来源可信度、账本/状态边界和发布门，而不是重复堆字段。 | Integrator | product, architect, dba, qa |
| 2026-08-14 | 研究结论先进入独立稿，正式文档只由 Integrator 串行整合；当前代码仍为年费 MVP，任何新领域只能标记为规划能力。 | Integrator | all |

## Session register
| Status | Title | Role | Agent | Owned artifact | Depends on | Handoff |
| --- | --- | --- | --- | --- | --- | --- |
| complete | 产品经理｜Cardfolio｜领域需求补充调研 | Product manager | `/root/card_domain_product_round8` | `docs/research/CARD-DOMAIN-ROUND8-PRODUCT.md` | PRD v0.8 + official public sources | 12 user gaps, P0/P1/P2, 18 incremental GWT | HTTP 200 source checks; `git diff --check` |
| complete | 架构师｜Cardfolio｜状态与接口补充复核 | Architect | `/root/card_domain_arch_round8` | `docs/research/CARD-DOMAIN-ROUND8-ARCHITECTURE.md` | ARCH v0.6 + Round7 contract | canonical states/API/events, compatibility, Gate 0-5 | `git diff --check` |
| complete | DBA｜Cardfolio｜账本与迁移补充复核 | DBA | `/root/card_domain_dba_round8` | `docs/research/CARD-DOMAIN-ROUND8-DATA.md` | DATABASE-WORKBENCH + Round7/8 findings | constraints, ownership, idempotency, migration/recovery gates | `git diff --check`; no real PostgreSQL/worker/RLS/recovery run |
| complete | QA｜Cardfolio｜跨文档验收复核 | QA | `/root/card_domain_qa_round8` | `docs/research/CARD-DOMAIN-ROUND8-QA.md` | product/architect/dba handoffs | drift matrix, test fixtures, release blockers | `git diff --check`; no new-domain runtime tests |

## Integration queue
| Order | Concern | Prerequisite | State |
| --- | --- | --- | --- |
| 1 | 官方来源和用户行动缺口 | product | completed |
| 2 | canonical 状态/API/事件一致性 | product + architect | completed |
| 3 | 数据约束、幂等和迁移门槛 | architect + dba | completed |
| 4 | QA 跨文档验收与发布判断 | 1-3 | completed |
| 5 | 串行更新正式 PRD、README 和本台账 | 4 | completed |

## Final evidence
- Research artifacts: `CARD-DOMAIN-ROUND8-PRODUCT.md`, `CARD-DOMAIN-ROUND8-ARCHITECTURE.md`, `CARD-DOMAIN-ROUND8-DATA.md`, `CARD-DOMAIN-ROUND8-QA.md`.
- Integrated docs: `docs/PRD-WORKBENCH.md` v0.9 and `docs/README.md`; formal architecture/database/QA source docs remain unchanged because their Round8 conclusions are captured as research handoffs and must be integrated serially in a later implementation planning pass.
- Validation: all four role files passed individual `git diff --check`; eight official URLs returned HTTP 200 on 2026-08-15. No real PostgreSQL, RLS, worker, migration, restore or new-domain E2E was run.
- Commits: not created in this round.
- Release status: current application remains annual-fee MVP; activity/benefit/spend/points/redemption remain planning artifacts until implementation gates pass.
