# Cardfolio 文档

Cardfolio（卡片档案）是面向个人用户的信用卡档案、年费、免年费进度和站内提醒 Web 应用。

## 阅读顺序

1. [产品需求文档](./PRD.md)：确认用户、MVP 范围、功能优先级和验收标准。
2. [技术方案](./TECHNICAL.md)：确认技术栈、模块边界、API、任务机制和实施阶段。
3. [数据库设计](./DATABASE.md)：确认 PostgreSQL 表结构、约束、索引、迁移和备份策略。
4. [MVP 交付说明](./MVP-DELIVERY.md)：查看实际交付范围、运行方式、验收证据和生产边界。
5. [工作台扩展 PRD](./PRD-WORKBENCH.md)：卡活动、卡权益、刷卡任务、积分与兑换的范围、调研、流程和验收（v1.4；第 21 节定义活动闭环，第 22 节定义待办日历和列表，第 23 节定义管理员发布与成员查看/加入）。
6. [工作台领域架构](./ARCHITECTURE-WORKBENCH.md)：模块边界、API、事件、状态机和分阶段演进（v0.11，包含 PRD 第 21—23 节的周期/待办及目录授权框架）。
7. [工作台数据库设计](./DATABASE-WORKBENCH.md)：表结构、约束、索引、迁移、对账和备份风险（第四轮基线 + 第十轮增量）。
8. [工作台 UX 规范](./UX-WORKBENCH.md)：信息架构、桌面/移动端流程、状态和可访问性（v0.5，第五轮复核）。
9. [工作台安全评审](./SECURITY-WORKBENCH.md)：隐私、授权、幂等、附件和同步安全门槛（v0.4，第五轮复核）。
10. [工作台 QA 验收矩阵](./QA-WORKBENCH.md)：测试场景、回归基线和发布 Gate（v0.3，第五轮复核）。
11. [科技感视觉方向](./UX-VISUAL-DIRECTION.md)：Apple / Emil 设计原则、材质边界、语义 token 和当前 MVP 壳层落地记录（v0.2）。
12. [UX V2 工作台视觉交付](./research/UX-TECH-WORKBENCH-V2.md)：深色/浅色主题、桌面/移动原型、关键状态和截图证据。
13. [按卡活动、周期奖励与待办架构](./ARCHITECTURE-ACTIVITIES-TODOS.md)：PRD 第 21、22 节的周期、消费关联、奖励领取、待办/日历、API、迁移和验收合同（v0.3，补充平台来源引用和私人参与边界）。
14. [前端架构](./FRONTEND-ARCHITECTURE.md)：业务模块、组件职责、页面/controller/model/API 分层、状态归属、查询失效和渐进迁移（v0.3，增加成员目录/管理及共享模板模块）。
15. [银行活动目录与管理员发布架构](./ARCHITECTURE-ACTIVITY-CATALOG.md)：PRD 第 23 节的权限、草稿/发布、个人导入、版本采用/下架、API 与九项验收；实际实现与边界见 [目录交付](./CC-23-DELIVERY.md) 和 [review 修复](./CC-23-REVIEW-FIXES-2026-10-10.md)。
16. [第 21、22 节后端补齐架构](./ARCHITECTURE-CC21-22-BACKEND.md)：基于现有代码确定共用模型、独立私人 runtime、追加迁移、年费/自定义待办、完整活动周期事实、job/worker、兼容接口及 18 项验收；后端已实现并完成返工复验（2026-10-13）。
17. [第 21、22 节后端独立验收](./CC21-22-BACKEND-REVIEW-2026-10-13.md)：R1—R10 后端返工复验 18/18 通过；记录原始缺陷、修复结果及完整产品验收的剩余范围。

## 当前决策

- MVP 采用响应式 Web、模块化单体和 PostgreSQL。
- 只保存信用卡后四位，不接入银行账户或自动同步交易。
- 年费日期和提醒按用户 IANA 时区计算；站内提醒默认提前 30/7/1 天。
- JSON 数据导出属于 MVP；CSV 导入/导出、权益收益和外部通知属于 P1。
- V1.1 已实现卡片字段/状态、累计进度、Dashboard、时间线和账户删除可观测性，验收清单见 V1.1-ACCEPTANCE.md。
- 第 23 节已提供目录发布/个人加入的最小真实后端和验证；成员的卡、进度、奖励和待办保持私有。第 21、22 节私人活动、统一待办及自定义写入后端已完成本轮独立回归；正式账户页面、目录开关和共享服务部署状态仍需分别联调确认，不能把开发预览当作已上线功能。

## 角色研究稿

- [产品经理：卡活动、权益与积分研究](./research/CARD-DOMAIN-PRODUCT-RESEARCH.md)：10 个官方来源、用户任务、20 条验收和非自动化边界。
- [架构师：卡领域状态与接口复核](./research/CARD-DOMAIN-ARCHITECTURE-REVIEW.md)：四条事实链、API、事件、幂等、恢复与分期。
- [DBA：卡领域数据约束复核](./research/CARD-DOMAIN-DATA-REVIEW.md)：复合所有权、账本恒等式、迁移顺序和 15 类数据库验收。
- [产品经理：领域对齐决策稿](./research/CARD-DOMAIN-ALIGNMENT-PRODUCT.md)：P0/P1-a/P1-b/P2 发布门、五轴活动和用户验收。
- [架构师：领域对齐契约](./research/CARD-DOMAIN-ALIGNMENT-ARCHITECTURE.md)：canonical 状态、命令、事件、聚合边界和兼容映射。
- [DBA/安全：领域对齐数据约束](./research/CARD-DOMAIN-ALIGNMENT-DATA.md)：提醒、名额/奖励、双状态账本、迁移和恢复阻断项。
- [QA：领域对齐发布门](./research/CARD-DOMAIN-ALIGNMENT-QA.md)：跨文档漂移矩阵、P0/P1 测试矩阵和 Gate 0/1/2。
- [UX：真实 MVP 视觉复核](./research/UX-TECH-VISUAL-REVIEW.md)：真实桌面/移动截图、当前信息架构和视觉回归风险；工作台扩展尚未实现。
- [第五轮产品复核](./research/CARD-DOMAIN-FOLLOWUP-PRODUCT.md)：P0 最小纵切、未知状态可行动化、P1 发布门和延后项。
- [第五轮架构复核](./research/CARD-DOMAIN-FOLLOWUP-ARCHITECTURE.md)：里程碑、review 轴、积分/兑换三轴和兼容迁移。
- [第五轮数据复核](./research/CARD-DOMAIN-FOLLOWUP-DATA.md)：账本守恒、差额、提醒约束和 expand/contract 阶段。
- [第五轮安全复核](./research/CARD-DOMAIN-FOLLOWUP-SECURITY.md)：所有权、敏感数据、导入、删除和连接器边界。
- [第五轮 QA 复核](./research/CARD-DOMAIN-FOLLOWUP-QA.md)：P0/P1/P2 可执行矩阵和发布阻断项。
- [第五轮 UX 复核](./research/CARD-DOMAIN-FOLLOWUP-UX.md)：MVP/规划共存、状态文案、桌面/移动和空错态。
- [第六轮产品复核](./research/CARD-DOMAIN-ROUND6-PRODUCT.md)：扩展能力范围、官方页面边界、16 条 GWT 和 P0/P1/P2 发布门。
- [第六轮架构复核](./research/CARD-DOMAIN-ROUND6-ARCHITECTURE.md)：聚合、状态/API/事件、幂等、兼容 adapter 和 Gate 0--2。
- [第六轮 DBA 复核](./research/CARD-DOMAIN-ROUND6-DATA.md)：账本/批次、约束索引、expand/contract、恢复和数据库验收。
- [第七轮产品研究](./research/CARD-DOMAIN-ROUND7-PRODUCT.md)：用户行动、20 条 GWT、来源边界和当前契约阻断。
- [第七轮架构复核](./research/CARD-DOMAIN-ROUND7-ARCHITECTURE.md)：canonical API、事件、Reminder worker 和 Gate 0--3。
- [第七轮 DBA 复核](./research/CARD-DOMAIN-ROUND7-DATA.md)：奖励事件、SpendMilestone、lease/dead-letter、scope trigger 和恢复验收。
- [第八轮产品补充调研](./research/CARD-DOMAIN-ROUND8-PRODUCT.md)：活动预检、报名截止、刷前路由、权益改期、负余额和部分履约的用户行动与 18 条 GWT。
- [第八轮架构补充复核](./research/CARD-DOMAIN-ROUND8-ARCHITECTURE.md)：canonical 聚合、兼容 adapter、未知/幂等/恢复契约和 Gate 0--5。
- [第八轮 DBA 补充复核](./research/CARD-DOMAIN-ROUND8-DATA.md)：跨用户 ownership 预检、账本约束、expand/contract 迁移和恢复门槛。
- [第八轮 QA 跨文档复核](./research/CARD-DOMAIN-ROUND8-QA.md)：15 条跨文档验收、冲突清单、发布阻断与年费回归影响。
- [第九轮产品需求整合](./research/CARD-DOMAIN-ROUND9-PRODUCT.md)：卡活动/权益/刷卡方式/积分兑换的用户动作、公开来源、分期和新增验收。
- [第九轮架构整合复核](./research/CARD-DOMAIN-ROUND9-ARCHITECTURE.md)：canonical 聚合、命令/事件边界、兼容迁移和 Gate 0--3。
- [第九轮 DBA 数据复核](./research/CARD-DOMAIN-ROUND9-DATA.md)：事实/投影边界、账本约束、复合所有权和迁移门槛。
- [第九轮 QA 验收复核](./research/CARD-DOMAIN-ROUND9-QA.md)：跨模块夹具、Given/When/Then 矩阵和 Gate 0--3。
- [第九轮安全复核](./research/CARD-DOMAIN-ROUND9-SECURITY.md)：活动/权益/刷卡/积分/兑换数据分级、越权、幂等和导入边界。
- [第十轮产品行动核验](./research/CARD-FEATURE-ROUND10-PRODUCT.md)：用户任务地图、规则新鲜度、报名重试、跨任务防双算、解释文案、24 条 GWT 和 P0/P1/P2 发布建议。
- [第十轮领域架构核验](./research/CARD-FEATURE-ROUND10-ARCHITECTURE.md)：端到端依赖、报名尝试、消费事实关联、部分履约、canonical API/事件、feature flag 和回滚顺序。
- [第十轮 DBA 数据核验](./research/CARD-FEATURE-ROUND10-DATA.md)：canonical/legacy 写围栏、复合 scope、projection watermark、精度/区间、迁移恢复和 D-01--D-16 数据库验收。
- [UX V2 科技感工作台交付](./research/UX-TECH-WORKBENCH-V2.md)：可交互原型、状态优先的信息架构、透明材质边界和响应式验证。

## 文档状态

PRD 为 v1.4，总架构为 v0.11，活动/待办及前端架构为 v0.3，目录架构为 v0.1。第 21、22 节前端预览已交付，真实后端接入边界见 [前端实施说明](./FRONTEND-IMPLEMENTATION.md)；第 23 节实际代码与修复见目录交付报告。2026-10-13 后端 R1—R10 返工复验通过，18 项真实 HTTP 场景全部通过；完整产品验收仍待前端联调及未覆盖矩阵，详见 [后端验收报告](./CC21-22-BACKEND-REVIEW-2026-10-13.md)。数据库文档保留历史设计，真实迁移已到 0011；全新库迁移和目录集成测试中的 0006 有数据升级均已通过，正式升级演练仍需单独验证。新入口按数据库/API/worker/实际 HTTP 与页面联调证据开放，现有 MVP 与已交付目录事实/历史必须保留。
