# Cardfolio 卡领域第九轮安全与隐私复核

| 项目 | 内容 |
| --- | --- |
| 文档版本 | v0.1 |
| 复核日期 | 2026-08-15 |
| 角色 | 安全工程师 |
| 复核范围 | 活动/权益来源与凭证、刷卡记录、积分余额与批次、兑换订单、提醒 worker、导入导出、审计和恢复 |
| 输入 | `docs/PRD-WORKBENCH.md` v0.9、`docs/ARCHITECTURE-WORKBENCH.md`、`docs/DATABASE-WORKBENCH.md`、`docs/SECURITY-WORKBENCH.md`、Round7/8 产品、架构、DBA、QA 研究稿及当前代码 |
| 产品现状 | 当前代码仍是年费 MVP；本文是安全研究和发布门，不代表新领域已实现 |
| 允许修改范围 | 仅本文件；不修改正式文档、代码、配置、schema、migration、锁文件或提交 |

## 1. 结论先行

Round8 已新增报名截止/回执、刷前支付路由确认、规则换版影响、权益改期与凭证轮换、待入账积分/负余额、现金部分/部分履约和 Reminder lease。这些字段同时扩大了敏感数据、越权和重放风险。安全结论如下：

1. P0 只允许用户手工记录来源、活动参与、单卡消费任务、奖励核对和站内提醒；不接收银行凭据，不主动抓取网页，不自动报名、交易、发奖或兑换。
2. 所有聚合从会话推导 `owner_user_id`，父子引用执行复合 ownership/FK/RLS/API 三层检查；跨用户和不兼容跨卡引用统一返回 `404`，不能通过错误信息泄露存在性。
3. 完整 PAN、CVV/CVC、PIN、密码、验证码、Cookie、Authorization/token、二维码原文、会员凭证原文、敏感 URL query、完整回执/订单号不得进入业务字段、JSONB、日志、审计、导出或附件。
4. 活动、权益、消费、积分和兑换事实均 append-only；幂等命令、outbox/inbox、Reminder lease 和 dead-letter 必须可重放且不重复扣分、扣额度、生成提醒或泄露其他用户数据。
5. 当前未有新领域迁移、RLS、worker、扫描、删除注册表、备份恢复和领域 E2E 证据，工作台不能部署；可部署范围仍只有年费 MVP。

## 2. 证据与安全参考

### 2.1 已审阅材料

- 正式 PRD、架构、数据库、安全、QA、UX 文档及 Round7/8 角色研究稿。
- 当前 `db/schema`、已有 migrations、认证/会话、repository、审计、导出、账户删除和提醒 worker 实现。
- Round8 规划中的活动预检、报名回执掩码/哈希、路由快照、凭证版本、pending points、负余额、部分履约和 Reminder lease。

### 2.2 规范参考

以下页面于 2026-08-15 通过公开 HTTP 复查，均返回 200。它们是控制设计参考，不替代项目自身的 threat model、代码和测试证据：

| 来源 | 可用于本项目的控制 | 不能替代的证据 |
| --- | --- | --- |
| [OWASP Authorization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html) | 默认拒绝、每请求对象级授权、纵深防御和权限测试 | Cardfolio 的复合 ownership、RLS 和 worker 旁路测试 |
| [OWASP SSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html) | URL allowlist、私网/metadata 拦截、DNS/重定向防护 | 项目实际 URL 规范化、解析器和部署网络隔离 |
| [OWASP File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html) | 文件类型/魔数、大小、隔离、恶意内容和短时访问控制 | 项目实际 quarantine、解析沙箱、对象删除和扫描证据 |
| [OWASP Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html) | 结构化日志、敏感字段排除、关联 ID、告警和保留 | 项目 `AuditWriter`、JSONB schema、模式扫描和删除匿名化 |
| [PostgreSQL 15 Row Security Policies](https://www.postgresql.org/docs/15/ddl-rowsecurity.html) | RLS 默认拒绝、策略和受控角色 | 项目实际 policy、`set local app.user_id`、worker 最小角色和集成测试 |
| [RFC 9110 HTTP Semantics](https://www.rfc-editor.org/rfc/rfc9110) | 404/409/条件请求的 HTTP 语义基线 | Cardfolio 自定义幂等键、错误码和命令结果存储 |

## 3. 数据分级与最小化

### 3.1 允许保存的最小字段

| 领域 | P0/P1 可保存 | 必须限制或禁止 |
| --- | --- | --- |
| 卡活动/来源 | 规则 URL、标题、来源等级、访问日期、适用期、短脱敏摘录、内容 hash、资格/报名/名额结果、回执 hash/掩码 | 不保存登录态、报名页面完整 HTML、用户参数、完整回执、银行账户或“银行已确认”伪造状态 |
| 刷卡任务 | 用户确认的日期、金额/次数、币种、冻结的支付路由快照、入账里程碑、短备注和证据级别 | 不要求完整账单、商品明细、地点、商户联系人或自动读取交易；拒绝把完整卡号放在备注 |
| 权益/凭证 | usage model、预约/出示/核销事件、服务商/地区、拒绝原因、凭证版本 ID、掩码/哈希、过期时间 | 不保存可直接使用的二维码、会员号、条码、动态 token 或凭证原图；凭证原件如未来允许必须隔离且短期保留 |
| 积分 | confirmed observation、as-of、来源、pending/earn/adjustment/expire/debit/reversal 事实、lot 证据和两个差额 | 不保存银行登录材料；不把客户端的 `ledger_balance`、`remaining` 或负余额修正作为事实 |
| 兑换 | provider ID、掩码/哈希订单号、商品名称、积分/现金金额、币种、规则快照、四轴状态和履约行 | 不保存完整订单号、完整付款卡信息、外部 token；现金部分和积分扣减不得混成一个无来源金额 |
| 提醒/审计 | 对象 ID、版本/sequence、UTC 时间、IANA 时区、dedupe、租约、attempt、稳定错误码、actor 和关联 ID | 不把完整业务键、来源正文、原始异常、用户备注或 token 放入提醒 payload/日志 |

### 3.2 强制拒绝规则

服务端必须拒绝以下输入，并在拒绝响应中只返回稳定错误码和 `request_id`，不得回显命中的原文：

- 13--19 位连续数字且具有卡号语义、磁道数据、CVV/CVC、PIN、密码、验证码或银行登录材料。
- `owner_user_id`、任意客户端用户 ID、跨用户父对象 ID、固定卡账户与不兼容卡片的组合。
- `Authorization`、`Cookie`、OAuth token、会话 ID、签名 URL、敏感 query（如手机号、活动 token、回执 token）。
- 未掩码的预约号、订单号、会员号、二维码、服务商凭证或附件永久 URL。
- 将 `ledger_balance`、`remaining_value`、`progress_status`、`points_debit_status` 等派生字段直接作为事实提交。

模式扫描必须在 API 校验、JSONB schema、审计、队列、错误日志、导出和 CI/预发布同时运行；扫描命中进入人工复核，不能再次打印疑似敏感原文。

## 4. 领域威胁与控制

### 4.1 所有权、IDOR 和跨卡混淆

攻击者可枚举 UUID、替换 `card_id/account_id/participation_id`、利用固定卡账户 `card_id=NULL` 或通过 worker payload 访问其他用户。每个读写、状态动作、撤销、下载、导出、提醒领取和死信重放必须：

1. 从会话或受控 worker 身份推导 user，不接受请求体 owner。
2. 在同一事务按 `(id, user_id)` 锁根聚合，再验证完整父链和同卡/账户 scope。
3. 固定卡积分账户要求兑换带同卡；merged pool 只有显式 scope trigger 才允许 `card_id=NULL`，不能依赖 PostgreSQL NULL FK 语义。
4. RLS 以 `set local app.user_id` 默认拒绝；worker 仅能领取自己的提醒并调用受控命令，不能直接写 Points/Benefit/Redemption 事实。
5. 不存在和无权访问统一 `404`；`409` 只用于同一用户同一幂等键的参数冲突或状态冲突。

**必测滥用场景**：用户 A 读取/修改 B 的活动、来源、凭证、task、lot、兑换和导出；A 以 B 的 `card_id` 绑定自己的账户；同用户 A 的卡 1 task 引用卡 2 method snapshot；worker 重放 B 的 reminder；RLS 缺少上下文时查询。

### 4.2 活动来源、报名回执和规则换版

- P0 只登记用户提供的 HTTPS URL/人工摘要；来源是不可控输入，不能因 HTTP 200、content hash 或抓取成功提升资格、名额、奖励或报名状态。
- URL 规范化必须拒绝 `file/data/javascript`、localhost、私网、link-local、云 metadata、敏感 query 和用户标识；若未来抓取，DNS 解析和实际连接都要拦私网，限制重定向、MIME、响应大小、超时和 Content-Type，不发送认证头。
- 来源摘录纯文本化/严格 sanitizer，不渲染脚本、iframe、远程资源或可执行 DSL；规则版本只追加，历史 participation 固定旧版本。
- 报名回执只保存掩码/哈希和最小时间/状态；同一 participation 的重复回执同 hash 幂等，异 hash 409；截止后不能通过重放继续提交。
- 活动取消、报名拒绝、名额未分配只停止未来消费/奖励提醒，保留历史参与、来源和审计；不将 `rejected/needs_review` 映射为银行全局失败。

### 4.3 刷卡记录、支付路由和消费排除

- 任务激活时冻结 `SpendMethodSnapshot`、规则版本、`cutoff_basis`、IANA 时区、商户/MCC、币种和排除项；激活后修改必须产生新版本/实例。
- `occurred`、`posted`、`settled` 里程碑和 `included/pending/excluded/disputed` 原因必须追加事实；客户端不能直接提交“已达标”或覆盖排除原因。
- 钱包/路由未知、币种不匹配、商户/MCC 被排除、posted 缺失时只显示待核对/预计值；不能以商户名称推断路由或把用户备注升级为官方事实。
- 退款/冲正只追加关联反向 entry，严格限制累计反向金额/次数不超过原事实；原 entry、奖励和审计不可删除。重复 reversal 只返回首次结果。
- 日志、分析和导出只使用脱敏 merchant/reference；金额、日期和币种属于个人财务数据，按用户隔离和删除注册表处理。

### 4.4 权益使用、凭证轮换和现场拒绝

- `credential_masked/hash/version` 是敏感引用；新凭证追加版本，旧版本标过期，不在普通 UI 或日志显示可用凭证原文。
- 预约、改期、取消、出示、现场拒绝、服务商变更和争议是独立事件；只有 `consumable_quota` 首次 `redeemed` 追加 consume，`coverage_claim/fee_credit/service_record` 不进入次数账本。
- 同一 usage 并发确认只允许一次 consume；restore 必须引用已有 consume 和外部证据，不能以“取消预约”恢复不存在的扣减。额度为负时保留事实并进入 `needs_review`，不得截断为零。
- 服务商/地区/容量拒绝只保存必要的 reason、location scope 和下一步，不保存现场人员手机号、身份证件或完整凭证照片。

### 4.5 积分余额、批次和兑换订单

- `confirmed_balance` 是用户在官方渠道看到的 observation；`pending_earn` 不进入 confirmed/ledger 已确认投影，负余额必须真实展示并 `needs_review`。
- 固定公式为 `confirmed-ledger` 和 `ledger-lots` 两个差额；未知批次不生成到期提醒、FIFO、lot 或 expire。客户端不得提交可用余额或分配结果。
- 兑换预检先校验账户 scope、适用卡、所需积分、现金部分、币种、库存/上限和不可取消说明；未知时只保存 `planned/needs_review`，不显示可兑换承诺。
- `order_status`、`fulfillment_status`、`points_debit_status`、`refund_status` 四轴独立；部分履约采用 line/item 事实，`fulfilled + rejected <= requested`。履约成功不自动扣分，失败/取消不自动退分。
- 只有用户提供官方扣分证据且 debit 已 `posted` 才能追加 reversal；部分退分累计不能超过已扣分。余额不足保留负值，不伪造成功或回滚外部订单。

### 4.6 Reminder worker、租约和死信

Canonical Reminder 至少需要 `owner_user_id`、对象版本/sequence、UTC `trigger_at`、冻结 IANA 时区、`dedupe_key`、`lease_owner/lease_expires_at`、`attempt_count/next_attempt_at`、稳定 `last_error_code`、`dead_lettered_at/reason` 和 delivery attempt 历史。

- 生成使用 `(user_id, dedupe_key)` 唯一约束；dedupe key 包含对象类型/ID、版本或 sequence、提醒类型和触发节点，不能只用标题。
- worker 在事务内 `FOR UPDATE SKIP LOCKED` 领取并写租约；发送回执必须带 reminder ID + lease token 条件更新，过期 worker 不能覆盖新租约。
- 失败只更新投递状态、attempt 和稳定错误码，不回滚活动、任务、积分或权益事实；达上限进入 dead-letter，重放复用原 reminder/event ID。
- 活动取消、报名失败、任务结束和卡归档只取消未来未发送提醒，保留发送尝试和审计；未知日期、未知 lot、未知奖励期限只能生成补证提醒，不能生成逾期结论。
- worker 日志按 user/account/card 脱敏聚合，不打印完整 dedupe/business key；队列 payload 只带最小资源 ID、user scope、event ID 和版本。

## 5. 审计、日志、导入和导出

### 5.1 统一审计写入

所有事实命令至少审计：`actor_type`、`actor_id`、`user_id`、action、resource type/ID、目标版本、`request_id`/`correlation_id`、结果、时间、字段级变更摘要、幂等 key/hash 和 source snapshot（适用时）。报名回执、凭证轮换、余额 observation、扣分/退分和 Reminder dead-letter 不能只写日志。

`metadata`、队列、错误、埋点和导出使用 schema version + 字段 allowlist + 长度限制。禁止整包序列化；错误返回稳定 code/message/request ID，堆栈和外部响应只进受控脱敏日志。管理员、迁移、RLS bypass 和人工死信重放必须有显式 actor 与原因。

### 5.2 导入/附件隔离

P1 只返回隔离预览，不写活动、消费、权益或积分事实；P2 逐行确认才转普通幂等命令：

- 私有 quarantine bucket、随机对象键、扩展名+魔数/MIME 双校验、大小/页数/行数/列数上限；拒绝宏、可执行文件、压缩包、危险 SVG 和 PDF 脚本/嵌入对象。
- 解析进程隔离、禁网/禁子进程、CPU/内存/时间限制；清理图片 EXIF；文件/行 hash、parser version、owner、到期时间和撤销状态可审计。
- 预览字段掩码 PAN/CVV/token/凭证/订单号；原文件和派生对象短期保留，访问用短时授权 URL 并记录审计。
- 撤销导入只能追加作废/反向事实，不能覆盖手工记录；删除要清理原件、预览、索引、缓存和下载链接。

### 5.3 导出、删除和备份

- 导出/删除/兑换确认/授权撤销要求近期再认证、一次性短时 token、限流和审计；导出采用显式字段白名单、统一掩码和 CSV 公式注入防护。
- 删除注册表覆盖活动/参与/奖励、消费 entry/milestone、权益/凭证、积分 observation/lot/ledger、兑换履约行/link、来源 snapshot、提醒/attempt、outbox/inbox、对象存储、缓存、搜索索引、导出链接和审计匿名化。
- 删除 job 按对象分步、可重试、幂等；错误只存稳定码。在线访问先撤销，备份按已披露期限自然过期，恢复副本不能把已删除账户写回线上。
- 备份/PITR 恢复到隔离环境后重跑 owner/RLS、账本、lot、权益、兑换 link、Reminder lease/dead-letter 和对象 hash 检查；恢复点后的外部扣分/退分事件按业务键补齐，不能重复入账。

## 6. 分阶段安全门槛

### 6.1 Gate 0：实现前契约（阻断）

必须签收：

1. canonical 聚合/状态/事件，旧 `success/fulfilled/used` 仅兼容读取；
2. 四元活动实例、复合 ownership/RLS、fixed-card/merged-pool scope；
3. SourceSnapshot URL 规范化和 SSRF/XSS 输入规则；
4. 敏感字段 schema/allowlist/扫描器和稳定错误码；
5. 幂等 request hash/result、outbox/inbox、append-only/版本冲突；
6. Reminder dedupe、lease token、attempt/dead-letter 和 worker 最小角色；
7. 删除注册表、再认证、导出字段白名单、备份保留/RPO/RTO 和恢复演练范围。

### 6.2 P0：活动 + 单卡刷卡任务 + 奖励核对

必须有真实 API/PostgreSQL/worker 证据：

- 用户 A/B、同用户跨卡、固定卡/merged pool 和 worker 越权均为 404/拒绝；
- 来源 URL、回执掩码、route unknown、备注、entry、reward event、Reminder payload 通过敏感扫描；
- 同 key 重放只产生一条报名/消费/reversal/reward/reminder；异 payload 409；
- 规则换版/活动取消/退款保留历史并停止未来动作；
- Reminder 租约过期、重复投递、死信和用户忽略不改变业务事实；
- 导出/删除再认证、对象清理、日志脱敏、备份恢复和年费回归通过。

### 6.3 P1-a：权益和凭证

- 凭证版本/预约回执只存掩码/hash，短时访问与审计有效；
- 改期、取消、凭证轮换、服务商拒绝、争议不扣额度；并发 redeemed 至多一次 consume；
- `coverage_claim/fee_credit/service_record` 不进入 quota；负额度保留并 `needs_review`；
- 删除和恢复覆盖凭证、对象存储、usage events 和 quota ledger。

### 6.4 P1-b：积分和兑换

- pending/confirmed、双差额、负余额、lot allocation 和 fixed-card/merged-pool scope 可从零重放；
- 订单/部分履约/现金部分/扣分/退分四轴独立，debit/refund 业务键和金额上限并发安全；
- provider ref、回执、现金支付和导出不泄露完整凭据；
- 失败/取消、refund 早于 debit、重复/部分 refund、合作方拒绝和未知结果保留事实并可人工复核。

### 6.5 P2：导入、抓取、连接器和自动化

需要独立威胁建模、供应商/隐私评估、授权撤销、KMS token 隔离、webhook 签名与重放保护、隔离解析、灰度和一键关闭。不得因 P0/P1 通过而自动开放银行同步、自动报名、自动兑换或自动交易。

## 7. 安全验收矩阵

| ID | 场景 | 预期结果 | 证据 |
| --- | --- | --- | --- |
| S-01 | A 读取/修改 B 的活动、source、task、benefit、points、redemption、导出 | 统一 404，无存在性泄露 | API/RLS/复合 FK 测试 |
| S-02 | 同用户卡 1 的 task 引用卡 2 route/benefit/account | 拒绝或 404，未写事实 | scope trigger + API |
| S-03 | fixed-card account 兑换带 NULL card，或 merged pool 伪造固定卡 | 拒绝；不依赖 NULL FK 放行 | PostgreSQL scope test |
| S-04 | 回执/订单/预约/凭证输入完整号、token、二维码、敏感 query | 稳定错误码；日志/审计/导出无原文 | secret scanner + negative API |
| S-05 | 第三方 URL 指向私网、metadata、重定向或 XSS | P0 不抓取；未来抓取阻断且无外带头 | URL/SSRF/XSS tests |
| S-06 | 同一报名/entry/reward/debit/refund/reminder 重放 | 返回首次结果；不重复事实 | idempotency/inbox/outbox test |
| S-07 | 同 key 异 request hash | 409，原事实不变 | command contract test |
| S-08 | 规则换版/活动取消/退款 | 旧事实只读保留，新动作停止 | event/replay/audit test |
| S-09 | Reminder lease 过期后旧 worker 回写 | 条件更新失败，新 worker 独占；达到上限进死信 | lease/attempt test |
| S-10 | 权益改期/拒绝/凭证轮换/并发核销 | 不提前扣；首次 redeemed 一次 consume | ledger/concurrency test |
| S-11 | pending earn、负余额、未知 lot | 不进入 confirmed/到期/兑换建议；负值保留 | points replay/UI snapshot |
| S-12 | 订单失败、部分履约、refund 早于 debit | 不自动退分；非法 refund 拒绝并审计 | four-axis/ledger test |
| S-13 | 导入恶意文件/CSV 公式/PDF 脚本/重复行 | quarantine、扫描、只预览，不写事实 | sandbox/upload tests |
| S-14 | 导出/删除/恢复 | 再认证、掩码、清理注册表、恢复隔离且不回灌删除账户 | E2E + restore report |

## 8. 未决问题和风险

1. P0 再认证采用近期登录、密码确认还是 WebAuthn；导出、删除、兑换确认和授权撤销是否同一策略。
2. 报名回执、订单号、预约号和凭证 hash 的算法、掩码长度、provider scope 和跨活动复用规则尚未签收。
3. Source URL 是否永远只登记不抓取；若抓取，允许域名、出网策略、DNS rebinding 防护和内容保留期限需单独批准。
4. RLS 的 `set local app.user_id`、worker 受控旁路、迁移/管理员角色和 `BYPASSRLS` 审计尚未在真实 PostgreSQL 验证。
5. Reminder lease 时长、退避、dead-letter 处理 SLA、发送方幂等能力和错误码 allowlist 未冻结。
6. 凭证和附件是否进入 P1，保留天数、扫描供应商、原件下载和删除/恢复语义未由产品/运维签收。
7. 备份保留、RPO/RTO、对象存储区域、删除等待期和恢复副本隔离未签收；不能对用户承诺“立即彻底删除”。
8. 当前正式安全文档与 Round8 数据稿仍需要串行合并；研究稿的门槛不能替代实现和运行时证据。

## 9. 交接

### Changed files

仅新增 `docs/research/CARD-DOMAIN-ROUND9-SECURITY.md`；未修改正式契约、代码、配置、schema、migration、锁文件、台账或外部系统；未 commit/push。

### Decisions

- 以会话推导 ownership + 复合 FK/RLS/API 三层防护固定所有领域边界；跨用户/不兼容跨卡 404。
- P0 仅 HTTPS 来源登记/人工摘要和手工事实；完整卡资料、银行凭据、凭证原文、token、敏感 query、完整订单/回执均禁止。
- 规则/活动/消费/权益/积分/兑换/提醒事实 append-only；幂等、outbox/inbox、lease/dead-letter 和恢复重放不能重复业务事实。
- 活动来源/回执、刷卡路由/排除、权益凭证、积分负余额/批次、兑换现金/部分履约分别设安全控制；失败不猜发奖或退分。
- P1 才能开放隔离附件/导入、权益凭证、积分/兑换账本；P2 才能抓取、连接器、自动报名/预约/兑换/交易。

### Validation

- 已静态复核 PRD v0.9、正式架构/DBA/安全/QA 文档及 Round7/8 产品/架构/DBA/QA 研究稿和当前代码边界。
- OWASP Authorization/SSRF/File Upload/Logging、PostgreSQL 15 RLS、RFC 9110 参考页于 2026-08-15 通过 `curl -L --max-time 20` 复查，均 HTTP 200。
- 待执行：`git diff --check -- docs/research/CARD-DOMAIN-ROUND9-SECURITY.md`；未运行真实 PostgreSQL/RLS、迁移、worker、渗透、文件沙箱、E2E 或恢复演练。

### Risks/open questions

详见第 8 节。最高风险是新领域尚未落库/实现，现有任意 JSONB 审计、单实例限流、旧年费 ownership、删除注册表和 Reminder worker 不能作为工作台安全证据。

### Ready for integration

yes。主会话可将第 3--7 节映射到正式安全门、DBA 约束和 QA 验收；整合和实现证据完成前，工作台仍不可部署。
