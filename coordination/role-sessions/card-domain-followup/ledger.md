# Card Domain Follow-up

## Charter
- Goal: 对卡活动、卡权益、刷卡方式/任务、积分与兑换的现有需求和技术契约做一次实现前收敛，找出状态、数据、权限、验收和体验上的遗漏。
- Non-goals: 本轮不实现业务代码、数据库迁移、银行连接器、自动报名、自动交易、自动预约或自动兑换；不把研究结论当作当前已上线能力。
- Completion criteria: 六个角色完成各自只读复核并交付研究稿；主会话串行更新正式 PRD、架构、数据库、QA、安全和 UX 文档；文档静态检查通过；未决事项有明确 owner 和阶段。
- Repository / base branch: `main`；继承当前工作树，保留已有未提交变更。
- Created: 2026-08-14.

## Working rules
1. 角色只写自己拥有的 `docs/research/CARD-DOMAIN-FOLLOWUP-*.md`，不得修改正式契约、代码、迁移、锁文件或其他角色文件。
2. 角色只提交可追溯结论：输入文件、公开来源/条款边界、决策、未决项、验收建议和 `git diff --check` 证据。
3. 正式文档由主会话串行整合；任何跨角色冲突先写入本台账，再决定采用、延后或保留为未知。
4. 不记录密钥、完整卡号、凭据、用户数据或未脱敏原始页面内容。

## Session register
| Status | Title | Role | Thread ID | Owned artifact | Scope | Handoff |
| --- | --- | --- | --- | --- | --- | --- |
| complete | 产品经理｜Cardfolio｜领域需求复核 | Product manager | `01a000ae-5208-7d12-9278-fc042dae05df` | `docs/research/CARD-DOMAIN-FOLLOWUP-PRODUCT.md` | P0/P1 分期、未知原因/下一步、可执行验收 | `git diff --check`; ready for integration |
| complete | 架构师｜Cardfolio｜状态与接口复核 | Architect | `01a000ae-5207-7dd3-a6d6-0a6eb40c6759` | `docs/research/CARD-DOMAIN-FOLLOWUP-ARCHITECTURE.md` | 五轴活动、消费里程碑、权益/积分/兑换状态与迁移 | `git diff --check`; ready for integration |
| complete | DBA｜Cardfolio｜账本与迁移复核 | DBA | `01a000ae-5a01-7190-8f4b-4238a1633b0d` | `docs/research/CARD-DOMAIN-FOLLOWUP-DATA.md` | 账本守恒、差额、约束、提醒与 expand/contract | `git diff --check`; ready for integration |
| complete | 安全工程师｜Cardfolio｜隐私与滥用复核 | Security | `01a000ae-6258-7090-838b-aa1e1402f851` | `docs/research/CARD-DOMAIN-FOLLOWUP-SECURITY.md` | 所有权、敏感数据、来源/导入、删除和威胁 | `git diff --check`; ready for integration |
| complete | QA｜Cardfolio｜跨域验收复核 | QA | `01a000ae-6a2d-7620-a3f0-1734bb71b286` | `docs/research/CARD-DOMAIN-FOLLOWUP-QA.md` | 测试矩阵、发布门槛、回归和失败语义 | `git diff --check`; 45/45 unit; E2E run conflicted with dev cache |
| complete | UX｜Cardfolio｜工作台信息架构复核 | UX / design | `01a000ae-6d75-7040-9b94-84517a53968c` | `docs/research/CARD-DOMAIN-FOLLOWUP-UX.md` | 导航、详情、状态可见性、移动端和空/错态 | `git diff --check`; ready for integration |

## Decision log
| Date | Decision | Owner | Affected roles |
| --- | --- | --- | --- |
| 2026-08-14 | 现有 `docs/research/CARD-DOMAIN-*` 和正式工作台文档是本轮输入；不重复创建一份总需求稿。 | Integrator | all |
| 2026-08-14 | P0 仍只承诺活动 + 单卡刷卡任务 + 奖励人工核对；权益为 P1-a，积分/兑换为 P1-b，自动化和导入按 P2 处理，除非角色提出有证据的调整。 | Integrator | product, architect, dba, qa, security |
| 2026-08-14 | P0 `custom` 只保存说明；未知状态必须带原因、证据时间和下一步；P1-a/P1-b 分别以权益核销账本和积分/兑换账本门槛开放。 | Integrator | product, architect, dba, qa, security, ux |
| 2026-08-14 | 消费 posted/settled 改为追加 milestone；积分到期 P1 只提醒；兑换订单、履约、扣分/退分三轴；`review_status` 不覆盖生命周期。 | Integrator | architect, dba, qa |

## Integration queue
| Order | Concern | Prerequisite | State |
| --- | --- | --- | --- |
| 1 | 收集六个角色审查稿 | all sessions | completed |
| 2 | 解决状态、枚举、时间口径和优先级冲突 | product + architect + dba | completed |
| 3 | 串行更新 PRD / ARCHITECTURE / DATABASE / SECURITY / QA / UX / README | 1-2 | completed |
| 4 | `git diff --check`、链接/版本/范围核对 | 3 | completed |

## Handoff format
每个角色结束时必须给出：Changed files、Decisions、Validation、Risks/open questions、Ready for integration。角色不得声称未实现的领域已可部署。

## Integration result

- Formal artifacts updated: `docs/PRD-WORKBENCH.md` v0.7, `docs/ARCHITECTURE-WORKBENCH.md` v0.5, `docs/DATABASE-WORKBENCH.md` fourth-round addendum, `docs/SECURITY-WORKBENCH.md` v0.4, `docs/QA-WORKBENCH.md` v0.3, `docs/UX-WORKBENCH.md` v0.5, and `docs/README.md`.
- Research artifacts: six `docs/research/CARD-DOMAIN-FOLLOWUP-*.md` files.
- Validation: `git diff --check` passed after integration; no code, migration, package, commit or push was performed in this documentation pass.
- Release status: current code remains annual-fee MVP. Workbench P0/P1-a/P1-b/P2 are planning contracts only; Gate 0 is not yet implemented and Gate 1/2 remain blocked by migrations, APIs, ownership/RLS, ledger facts, workers and domain E2E.
- Known verification gap: the QA role's E2E rerun conflicted with a reused dev server/build cache and did not reach business assertions; the existing clean MVP baseline from the parent session remains separate evidence and must be rerun on a clean port before release.

## Sixth-round request: workbench capability scope (2026-08-14)

### Charter
- Goal: 在已有五轮文档的基础上，重新核对卡活动、卡权益、刷卡方式/任务、积分账户和积分兑换的用户价值、优先级与实现边界，形成可进入下一版 PRD 的收敛结论。
- Non-goals: 不修改业务代码、数据库迁移、正式架构/DBA 契约或 UI；不把银行公开页面当作用户资格、实时余额、库存或奖励结果；不引入银行登录、自动报名、自动交易、自动预约或自动兑换。
- Completion criteria: 产品、架构、DBA 三份角色研究稿完成；每份有来源/输入、决策、P0/P1/P2 影响、验收建议、未决项和静态校验；主会话将不冲突的结论合并到正式 PRD，并保留未知状态和责任边界。
- Parent session: Cardfolio local integrator.
- Repository / base branch: main; shared working tree retained.

### Working rules
1. 角色只写自己的 `docs/research/CARD-DOMAIN-ROUND6-*.md`，不得修改正式 PRD、架构、数据库、代码、迁移或其他角色文件。
2. 角色只提交可追溯结论，公开来源必须说明访问日期、适用边界和不能推出的事实。
3. 主会话串行合并正式文档；若与现有 canonical 状态、优先级或公式冲突，先记录冲突再决定采用、延后或保留未知。
4. 不记录密钥、完整卡号、凭据、用户数据或未脱敏页面内容。

### Decision log
| Date | Decision | Owner | Affected roles |
| --- | --- | --- | --- |
| 2026-08-14 | 第六轮只把公开页面用于确认建模维度；不把资格、库存、实时余额、发奖或退分结果当作产品事实。 | Integrator | product, architect, dba |
| 2026-08-14 | 参与实例唯一键扩展为 `(owner_user_id, campaign_id, card_id, activity_instance_key)`；奖励按组件独立记录。 | Product + Architect | dba, qa, ux |
| 2026-08-14 | canonical 双差额冻结为 `confirmed-ledger` 与 `ledger-lots`；兑换保留 order/fulfillment/debit/refund 四个底层事实轴，旧 pending_refund/refunded 只读映射；P1 失败不自动退分。 | Architect + DBA | product, qa, security |
| 2026-08-14 | PRD v0.8、架构 v0.6 和 DBA 第六轮附录完成整合；当前代码仍为年费 MVP，Gate 0/1/2 未通过。 | Integrator | all |

### Session register
| Status | Title | Role | Thread ID | Owned artifact | Scope | Handoff |
| --- | --- | --- | --- | --- | --- | --- |
| complete | 产品经理｜Cardfolio｜扩展能力范围复核 | Product manager | `/root/round6_product` | `docs/research/CARD-DOMAIN-ROUND6-PRODUCT.md` | 用户场景、优先级、范围、成功指标、Given/When/Then 验收 | diff check passed; ready |
| complete | 架构师｜Cardfolio｜扩展状态与契约复核 | Architect | `/root/round6_architecture` | `docs/research/CARD-DOMAIN-ROUND6-ARCHITECTURE.md` | 聚合边界、状态轴、命令/API、事件、兼容和分阶段门槛 | diff check passed; ready |
| complete | DBA｜Cardfolio｜扩展账本与迁移复核 | DBA | `/root/round6_dba` | `docs/research/CARD-DOMAIN-ROUND6-DATA.md` | 表/约束/索引、账本守恒、幂等、迁移顺序和恢复 | diff check passed; ready |

### Integration queue
| Order | Concern | Prerequisite | State |
| --- | --- | --- | --- |
| 1 | 收集产品/架构/DBA 研究稿 | three sessions | completed |
| 2 | 合并不冲突的范围、状态和数据结论到 PRD/架构/DB 文档 | handoffs | completed |
| 3 | 静态检查、链接/版本/优先级核对并记录未决项 | integrated docs | completed |

### Sixth-round handoffs

#### product
- Changed artifacts: `docs/research/CARD-DOMAIN-ROUND6-PRODUCT.md`.
- Decisions: 线索与正式活动分离；参与实例按用户/活动/卡/周期隔离；多奖励组件、支付路由快照、权益 usage model、积分双差额和兑换双轴；P0/P1-a/P1-b/P2 首纵切。
- Validation: 8 个官方 URL 复查 HTTP 200；16 条 GWT；`git diff --check` passed。
- Risks: 银行规则、名额、库存、发奖和退分结果仍需用户在官方渠道核对；未实现能力不能开放入口。
- Ready for integration: yes; integrated into `docs/PRD-WORKBENCH.md` v0.8。

#### architecture
- Changed artifacts: `docs/research/CARD-DOMAIN-ROUND6-ARCHITECTURE.md`.
- Decisions: 模块化单体；活动五轴与 reward component；SpendEntry/Milestone 分离；权益 consume/restore 守恒；积分三层和双差额；兑换 order/fulfillment/debit/refund 独立；命令幂等、事件和旧年费 adapter。
- Validation: 18 条不变量；`git diff --check` passed。
- Risks: refund_status 与旧 points_debit_status 的兼容映射需 Gate 0 冻结；真实迁移、RLS、worker 和恢复未验证。
- Ready for integration: yes; integrated into `docs/ARCHITECTURE-WORKBENCH.md` v0.6。

#### dba
- Changed artifacts: `docs/research/CARD-DOMAIN-ROUND6-DATA.md`.
- Decisions: 复合 ownership/FK、append-only ledger、提醒 dedupe、expand/contract Stage 0--6、PITR/删除审计和 14 条数据库验收。
- Validation: `git diff --check` passed；未运行真实 PostgreSQL/迁移/恢复。
- Risks: migration、RLS、索引性能和备份恢复仍需影子库演练；未知批次不得自动生成到期事实。
- Ready for integration: yes; integrated into `docs/DATABASE-WORKBENCH.md`。
