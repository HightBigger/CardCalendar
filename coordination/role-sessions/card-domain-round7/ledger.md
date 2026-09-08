# Card Domain Round 7

## Charter
- Goal: 调研并收敛 Cardfolio 工作台的卡活动、卡权益、刷卡方式/消费任务、积分账户与积分兑换需求，补齐正式 PRD 的用户场景、优先级、状态语义和验收边界。
- Non-goals: 本轮不实现业务代码、数据库迁移、银行登录/连接器、自动报名、自动交易或自动兑换；研究结论不能宣称为已上线能力。
- Completion criteria: 产品、架构、DBA 三份只读研究稿完成；主会话把稳定结论合并至正式 PRD/架构/数据库/QA 文档；关键冲突、来源、未决项和发布门槛记录清楚。
- Parent session: Cardfolio product integrator.
- Repository / base branch: `main`; preserve existing uncommitted changes.
- Created: 2026-08-14.

## Working rules
1. 每个角色只写自己的 `docs/research/CARD-DOMAIN-ROUND7-*.md`，不得修改正式文档、代码、迁移、锁文件或其他角色文件。
2. 公开规则只作为建模依据，不推导具体用户资格、实时余额、库存、发奖或退分结果；记录来源 URL、访问日期、适用边界和不能推出的事实。
3. 正式契约由主会话串行整合；跨角色冲突先写入本台账，再决定采用、延后或保留为未知。
4. 不记录完整卡号、CVV、凭据、密钥、用户数据或未脱敏页面内容。

## Decision log
| Date | Decision | Owner | Affected roles |
| --- | --- | --- | --- |
| 2026-08-14 | 研究范围覆盖活动生命周期、权益 usage model、消费资格事实、积分批次/差额、兑换履约与失败恢复；P0 仍保持手工确认纵切。 | Integrator | product, architect, dba |
| 2026-08-14 | 角色只写研究稿，正式 PRD/技术文档由主会话统一修改；本轮优先解决第六轮发现的四元活动实例、SpendMilestone、奖励历史、Reminder DDL 漂移。 | Integrator | all |
| 2026-08-14 | canonical 兑换冻结为 order/fulfillment/debit/refund 四个底层轴；Benefit 新写为 grant/consume/restore/expire，reversal 仅技术性反向；固定卡与 merged pool 由 scope trigger 区分。 | Integrator + DBA | product, architect, qa, security |

## Session register
| Status | Title | Role | Agent | Owned artifact | Depends on | Handoff |
| --- | --- | --- | --- | --- | --- | --- |
| complete | 产品经理｜Cardfolio｜领域需求调研 | Product manager | `/root/qa_review` | `docs/research/CARD-DOMAIN-ROUND7-PRODUCT.md` | current PRD + public official sources | GWT, scope, metrics, open questions |
| complete | 架构师｜Cardfolio｜领域契约收敛 | Architect | `/root/qa_review` | `docs/research/CARD-DOMAIN-ROUND7-ARCHITECTURE.md` | current architecture + round6 findings | canonical states/API/events, compatibility, gates |
| complete | DBA｜Cardfolio｜账本与迁移收敛 | DBA | `/root/round6_dba` | `docs/research/CARD-DOMAIN-ROUND7-DATA.md` | current DB + round6 findings | DDL-level gaps, constraints, migration order, recovery |

## Handoffs
### product
- Changed artifacts: `docs/research/CARD-DOMAIN-ROUND7-PRODUCT.md`。
- Decisions: 用户行动优先；活动参与实例、权益 usage model、SpendMethodSnapshot、积分双差额和兑换四轴；P0/P1/P2 发布门。
- Validation: 8 个官方 URL HTTP 200；20 条 GWT；`git diff --check` passed。
- Risks/open questions: 规则/资格/库存/余额/发奖/退分仍需官方核对；当前代码为年费 MVP。
- Ready for integration: yes。

### architect
- Changed artifacts: `docs/research/CARD-DOMAIN-ROUND7-ARCHITECTURE.md`。
- Decisions: 四元活动参与实例；reward component canonical 事件；SpendEntry/SpendMilestone 分离与 `/spend-entries/{id}/milestones`；权益 usage_model；积分双差额；兑换四轴；Reminder worker；Gate 0--3。
- Validation: `git diff --check -- docs/research/CARD-DOMAIN-ROUND7-ARCHITECTURE.md` 通过；未运行真实迁移/API/E2E。
- Risks/open questions: activity_instance_key 生成、旧 milestone 路径退役窗口、历史 posted 字段映射、worker 租约和 RPO/RTO 尚未冻结。
- Ready for integration: yes。

### dba
- Changed artifacts: `docs/research/CARD-DOMAIN-ROUND7-DATA.md`。
- Decisions: reward event、SpendMilestone、snapshot/entries trigger、Reminder lease/dead-letter、Benefit canonical ledger、Points allocation、固定卡/merged pool scope trigger、RLS/PITR/删除恢复。
- Validation: `git diff --check -- docs/research/CARD-DOMAIN-ROUND7-DATA.md` 通过；未运行真实 PostgreSQL/迁移/API/E2E/恢复。
- Risks/open questions: 托管 PostgreSQL 能力、旧 progress 回放、提醒退避、旧 adjustment 语义和 RPO/RTO 尚待签收。
- Ready for integration: yes。

## Integration queue
| Order | Concern | Prerequisite | State |
| --- | --- | --- | --- |
| 1 | 公开规则与用户场景 | product | completed |
| 2 | canonical 状态/API/事件 | product + architect | completed |
| 3 | 表、约束、幂等和迁移门槛 | architect + dba | completed |
| 4 | 串行更新正式 PRD/ARCHITECTURE/DATABASE/QA | 1-3 | completed |
| 5 | 静态检查和发布结论 | 4 | completed |

## Final evidence
- Commits: not created in this round.
- Validation: all role research and parent worktree `git diff --check` passed; `npm run typecheck` passed; `npm test -- --run` passed (17 files, 45 tests); `npm run build` passed. No real PostgreSQL migration, RLS, worker, API contract, domain E2E, backup or restore verification was run.
- Release status: current application remains annual-fee MVP. The activity/benefit/spend-method/points/redemption contracts are implementation-ready planning artifacts only; Gate 0 and later implementation gates must pass before claiming the workbench is deployable.
