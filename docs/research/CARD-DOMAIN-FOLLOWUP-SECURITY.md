# Cardfolio 卡领域安全跟进复核

| 项目 | 内容 |
| --- | --- |
| 角色 | 安全工程师 |
| 复核日期 | 2026-08-14 |
| 基线 | 当前 working tree；保留已有未提交变更 |
| 性质 | 只读研究/审查；不代表工作台能力已经实现 |
| 唯一交付 | `docs/research/CARD-DOMAIN-FOLLOWUP-SECURITY.md` |

## 1. 结论

当前代码仍是年费 MVP。现有卡片、年费周期/事件、进度、提醒和账户删除路径具备部分服务层 `user_id` 过滤、会话保护和基础审计，但不存在工作台的活动参与、独立奖励事实、权益、积分、兑换、来源快照、附件、导入、outbox/inbox 或 RLS。任何“已报名、已达标、可使用、兑换成功、已同步”的文字都必须继续表示用户手工确认或外部结果记录，而不是银行确认。

工作台发布的核心安全结论是：先完成对象级所有权和不可变事实，再开放任何跨对象写入或后台自动化；敏感卡资料、凭证、导入原件和连接器令牌按高风险数据单独隔离；失败重试只能恢复已提交事实，不能猜测奖励、退分或资格。

## 2. 复核范围与证据

已阅读：

- `docs/PRD-WORKBENCH.md`
- `docs/ARCHITECTURE-WORKBENCH.md`
- `docs/DATABASE-WORKBENCH.md`
- `docs/SECURITY-WORKBENCH.md`
- `docs/QA-WORKBENCH.md`
- `docs/UX-WORKBENCH.md`
- `docs/research/CARD-DOMAIN-*`（产品、架构、数据、QA 对齐稿及早期评审稿）
- 当前认证、repository、审计、导出、账户清理、worker、schema 和迁移

现状中可复用的控制：会话令牌只存哈希，Cookie 使用 `HttpOnly`/`SameSite=Lax`（生产需 `Secure`）；现有年费资源 repository 通常把会话所得 `userId` 放入查询；写 API 经过 Origin 校验；卡片只允许 `last4`；现有提醒使用自然键/唯一索引。以上不等于新领域已经受到同等保护。

现状缺口：`auditLogs.metadata` 是无 schema 的 JSONB，`recordAudit` 直接写入调用方对象；导出服务直接拼装实体和审计记录；账户清理只覆盖当前 MVP 表；worker 只有定时作业/心跳，没有通用重试、inbox 去重、死信或工作台所有权上下文；限流为单实例内存实现。发布工作台前必须补齐这些横切能力。

## 3. 安全决策

### 3.1 所有权与 IDOR

1. `actor_user_id` 只能来自会话/受控 worker 身份；请求体、URL 参数和事件 payload 不接受可覆盖的 `owner_user_id`。
2. 每个读、写、状态动作、撤销、导出、下载和 worker 重试都以 `(resource_id, user_id)` 过滤。创建或引用子对象时，在同一事务验证完整父链：卡片、活动参与、任务、规则版本、来源快照、权益、积分账户/批次、兑换和附件必须属于同一用户；不存在与无权限统一返回 `404`。
3. 规则模板若将来公开，只能是只读模板；不能因为用户引用模板而获得编辑用户报名、进度、奖励或估值的权限。
4. 多卡活动使用“规则可关联多卡、参与和任务按卡独立”的模型，唯一键至少为 `(user_id, campaign_id, card_id)`。两张卡的消费、资格、名额、奖励不得跨卡合并。
5. `Redemption.account_id`、可选 `card_id` 和 `user_id` 必须通过复合 FK/事务校验相容；合并积分池必须显式表示 `card_id IS NULL`，不能把任意卡挂接到账户。
6. worker 不做无边界的“按客户端 ID 读数据”。job 只携带资源 ID、必要的用户 ID、事件 ID 和版本；消费前再次执行所有权校验，使用最小数据库角色。RLS 是纵深控制，启用前须验证受控 worker 旁路不会扩大读取范围。

### 3.2 敏感卡数据最小化

下列限制在客户端提示、服务端校验、日志/审计/分析和导出层同时执行：

| 数据 | 决策 |
| --- | --- |
| 完整 PAN、磁道、CVV/CVC、PIN、有效期组合、密码、验证码、银行登录材料 | 永不落库、入日志、审计、JSONB、来源正文、导出或附件；命中时拒绝请求，不回显疑似原文 |
| 卡片识别 | 只保存可选四位数字 `last4`；展示统一掩码；不把尾号与其他字段拼成“可还原卡号” |
| 消费记录 | P0 仅保存用户手工确认的日期、金额/次数、币种、方式快照和短纯文本备注；不要求商户名、商品、地点或完整账单 |
| 订单/预约/凭证参考号 | 仅保存掩码、哈希或用户自定义的最小尾段；字段长度和字符集受限，拒绝把其当作无限文本入口 |
| 服务商凭证、二维码、会员号 | P0 不接收原件；P1 只存最小掩码/对象 ID，不存可直接使用的秘密；凭证泄露按高影响事件处理 |
| 规则和来源摘录 | 保存必要、限长、纯文本的脱敏摘要及内容哈希；不保存登录态、完整 HTML、用户参数或银行账户信息 |

活动资格、报名、名额、任务进度和奖励是五条独立事实链。`target_reached` 不等于银行认定，`submitted` 不等于报名确认，奖励到账只能由用户记录外部核对证据。不得增加“bank_confirmed”之类系统无法证明的状态。

### 3.3 来源 URL、附件和导入

**P0 来源登记**只保存用户提供的规范化 `https` URL、标题、访问日期、来源等级、限长脱敏摘录和 `content_hash`。清理敏感 query 参数，不把用户 ID、报名状态或令牌拼入链接。P0 不由服务器主动抓取网页，不支持附件或 CSV/PDF 导入。

若未来受控抓取，必须由隔离低权限 worker 执行：解析和连接时双重拦截私网、localhost、link-local、云元数据和 DNS rebinding；限制重定向次数、响应大小、超时、MIME 和下载速率；不发送认证头；正文纯文本化/严格 sanitizer，禁止脚本、iframe、远程资源和可执行规则 DSL。来源内容永远是不可信输入。

P1 附件/导入只允许隔离后的只读预览：

- 私有 quarantine bucket、随机对象键、扩展名与文件魔数双校验、大小/页数/行数配额、恶意文件扫描；拒绝宏、可执行文件、压缩包和不支持格式。
- 解析进程/容器禁网、禁子进程并有 CPU/内存/时间上限；CSV/JSON 限制列数、嵌套和字符集；PDF 禁止脚本和嵌入对象；图片清理 EXIF，拒绝危险 SVG。
- 预览只返回掩码后的结构化候选、行号、文件哈希和 parser version，不写活动、任务、积分或权益事实。P2 才允许逐行确认，且每行转为普通幂等命令。
- 预览/确认批次按用户隔离，失败不产生隐式半写入；撤销只追加作废/反向事实。原件、派生预览、索引和短时下载链接必须有到期清理。
- CSV/JSON 导出将 `= + - @` 开头单元格转义为文本；不导出密码哈希、会话、token 或对象存储永久 URL。

### 3.4 审计、日志与 JSONB

审计应是追加式最小事件，而不是请求/文件复制品。最低字段：`actor_type`、`actor_id`、`user_id`、action、resource type/ID、目标版本、`request_id`/`correlation_id`、结果、时间，以及字段级变更摘要；规则/导入额外带 `rule_version_id`、`source_snapshot_id`、`import_batch_id`、行号和 parser version；兑换带 `redemption_id`、账本 entry/link 和幂等命令 ID。

`metadata`、日志、错误、分析埋点、队列 payload 和导出统一采用字段白名单与结构校验。禁止整包序列化再做字符串替换；禁止写入 PAN/CVV、密码、Cookie、Authorization、OAuth token、敏感 URL query、原始附件路径/内容、完整订单号、完整来源正文、用户备注原文或堆栈中的请求体。错误响应只返回稳定错误码、短消息和 `request_id`；详细异常进入受控且已脱敏的日志。

当前 `auditLogs.metadata` 无白名单且 `runAccountCleanup` 会把异常 `message` 写入 `deletionCleanupResult`/审计，存在数据库/外部响应泄露风险。未来必须使用统一 `AuditWriter`：先筛字段和长度、规范化 ID、哈希需要关联的值，敏感模式命中时拒绝写入；运行时、CI、预发布对日志、审计、JSON、CSV、source snapshot 和错误响应做模式扫描。

### 3.5 兑换订单、账本、幂等与重试

兑换订单轴和积分扣减轴必须分离：外部 `success` 先进入 `ledger_status=pending`，由受控 consumer 在锁定账户后按固定业务键 `redemption:{id}:debit` 追加一次负向 PointsEntry；订单失败/取消不推断退分。只有已有 `posted` debit link 且用户确认官方退回，才追加等额 reversal；退款先于扣分、重复退款、金额不符都拒绝并审计。

所有可重试写命令持久化 `Idempotency-Key`、规范化 request hash 和第一次结果。同一用户、同一命令、同一 key 同 payload 必须 replay 原结果；同 key 异 payload 返回 `409 IDEMPOTENCY_KEY_REUSED`，不能用单纯 `ON CONFLICT DO NOTHING` 掩盖冲突。键作用域不能跨用户或跨账户。

事实、投影、审计和 outbox 在同一事务提交；publisher 用 `FOR UPDATE SKIP LOCKED`，consumer 先插入 `(consumer_name,event_id)` inbox。瞬时失败指数退避，达到上限进入死信并告警；死信重放不能生成第二条事实。通知失败不回滚业务事实；消费者只能重建投影，不能把投影错误写回用户余额。积分余额不足保留真实负余额并标 `needs_review`，不截断为零。

### 3.6 导出、删除与保留

导出、删除、兑换确认和授权撤销都是高影响操作：要求近期登录/密码确认等新鲜再认证、明确确认、审计和限流；导出下载使用短时一次性令牌，重新校验用户所有权并在访问时记录审计。导出采用显式字段白名单和一致掩码，不能把审计 metadata、备注或来源原文当作无害数据。

账户删除注册表必须覆盖当前及未来的卡、周期/事件、活动/参与/奖励、任务/流水、权益/凭证、积分账户/批次/账本、兑换/link、来源快照、导入批次和文件、对象存储版本、缓存/搜索索引、提醒/通知、worker job/outbox/inbox、导出链接和连接器 token/游标。删除 job 要幂等、可重试、逐对象报告稳定错误码；在线访问先立即失效，审计按策略匿名化，备份按已披露期限自然过期，恢复副本不得回灌已删除账户。

当前清理逻辑只删除 MVP 表，未覆盖上述对象；清理失败时持久化原始 `Error.message` 也不满足最小化。上线前必须定义对象保留表、删除/匿名化顺序、备份期限和恢复验证。

### 3.7 未来银行连接器边界（P2）

连接器不是 P0/P1 的隐含能力。启用前需独立威胁模型、供应商和隐私/合规评估、授权界面、事故响应和灰度开关：

- 不收集银行用户名、密码、验证码、UKey 或设备认证材料；只使用批准授权模型的短期 token/授权码。
- token 由 KMS 信封加密，和业务数据库列隔离；connector 账号最小 scope；token 不进入日志、trace、队列 payload、审计 metadata 或导出。
- 授权页列出提供方、scope、读取范围、频率、保留期、末次同步和撤销入口；撤销后停止任务，删除原始同步数据、游标和缓存。
- 同步数据先进入隔离的 `external_transaction`/source snapshot 队列，由用户确认后才生成 SpendEntry/PointsEntry；connector 不能直接改写历史或代用户报名、兑换、选择交易路径。
- webhook 必须签名验证、时间窗/nonce 防重放；游标、乱序/重复投递、供应商故障、部分数据和死信都可审计并可恢复。

## 4. P0 必须门槛（发布阻断）

以下任一项未完成，只能继续发布现有年费 MVP，不能发布活动/刷卡工作台纵切：

1. API、命令、下载、导出和 worker 未执行会话推导的完整父链 ownership；跨用户/跨卡读写未统一 `404`；复合 FK/RLS 或等价事务保护没有真实 PostgreSQL/API 测试。
2. 服务端仍接受完整卡号、CVV、密码、token、验证码、敏感 URL 参数或客户端 `owner_user_id`，或这些值能进入 JSONB、日志、审计、错误和导出。
3. 活动参与未按卡独立、五轴状态未分离、规则/来源快照可被覆盖，或任务/奖励把计算达标等同银行确认。
4. P0 写命令没有 `Idempotency-Key + request_hash + result`、版本冲突和同键异 payload `409`；事实、审计、outbox/inbox 不能事务化重放；提醒/worker 重复执行会重复产生事实。
5. 导出/删除缺新鲜再认证、短时下载、限流、审计或完整删除注册表；删除/重试会泄露原始错误、残留任务或已删除用户数据。
6. 缺少 IDOR、敏感模式扫描、Origin/CSRF、并发/重放、规则版本、冲正和删除恢复测试，或测试/迁移回滚失败。

## 5. P1 必须门槛

开放权益、积分、兑换、附件或导入前还必须满足：

1. 权益凭证私有隔离、quarantine 扫描、短时授权、EXIF/内容清理、访问审计和到期删除；预约/出示/核销分轴，只有首次 `redeemed` 扣额度。
2. Points ledger/lot/reconciliation 可重放，账户/卡/用户复合归属有效；真实负差额进入 `mismatch/needs_review`，未知到期不提醒。
3. Redemption order 与 debit/refund 独立；账户锁、业务键、inbox 去重、posted-debit refund 前置条件和真实负余额测试通过；失败不自动退分。
4. CSV/PDF/图片导入先隔离预览、限资源、文件/行去重、parser 版本化，不自动写业务表；P2 确认写入可事务化、可撤销、可逐行审计。
5. 导出/删除覆盖对象存储、派生预览、队列、缓存、索引和审计匿名化；备份保留期限、RPO/RTO 和恢复后删除验证有运维证据。

## 6. P2 延后项

- 系统内积分 reservation/hold/release、自动 FIFO/跨用途分配、部分退款、跨账户 transfer。
- 服务器抓取任意来源网页、OCR/PDF 直写、批量导入自动确认和自动提醒渠道。
- 银行/兑换商 connector、自动报名/自动兑换、外部履约和任何交易路由。
- 家庭/附属卡共享、管理员模板与个人实例混合授权；需要新的 workspace/member 策略和隐私评审。

## 7. Risks/open questions

1. 正式 PRD/架构/DB/QA 仍有状态词和事件漂移（五轴名额、奖励独立事实、`success`/`fulfilled`、`redeem_debit` 等）；Gate 0 前需冻结 canonical 写契约。
2. RLS 启用时机、worker 受控旁路、最小数据库角色和复合 FK 迁移尚未落地；现有父表单列 FK 不能证明跨卡/跨用户引用安全。
3. P0 再认证方式、导出链接模型、账户删除冷静期、审计匿名化和备份/附件保留期限尚未由产品/运维签收。
4. 分布式部署仍使用单实例内存限流；必须在公网多副本前接入网关/WAF/共享限流并为上传、导入、兑换设置独立配额。
5. `auditLogs.metadata` 和删除错误字段目前是任意 JSON/原始 message；在统一白名单和稳定错误码前，审计与日志可能成为敏感数据旁路。
6. 当前 worker 以全量用户扫描生成提醒，且没有工作台 job payload、租约、死信或 inbox；扩展前需避免 worker 读取超出任务范围的数据。
7. 备份/PITR、对象存储版本和恢复副本的删除语义没有实证；不能在此之前对用户承诺“立即彻底删除”。

## 8. Validation

- 完成了指定正式文档、所有 `CARD-DOMAIN-*` 研究稿、当前 schema/迁移、认证/授权 repository、审计、导出、账户清理和 worker 的静态复核。
- 未修改代码、迁移、package、正式契约文档、UX/QA/架构文件或 coordination ledger；未提交、未推送、未创建外部资源。
- 仅允许的文件变更为本文档。已运行 `git diff --check`（交付前再次执行并确认无空白错误）。
- 未运行应用、数据库、E2E、渗透或恢复测试；本文所有“必须”均是实现/发布前门槛，不是现有能力声明。

## 9. 交接

- **Changed files**: `docs/research/CARD-DOMAIN-FOLLOWUP-SECURITY.md`（唯一文件）。
- **Decisions**: P0 仅手工活动/任务；对象级复合 ownership、敏感数据拒绝、append-only + 幂等/outbox/inbox、来源 URL 登记边界、导出/删除清理注册表为阻断项；P1 才可隔离附件/预览导入、权益/积分/兑换账本；连接器和自动化留 P2。
- **Validation**: 静态文档/代码复核完成；`git diff --check` 通过；未运行运行时测试。
- **Risks/open questions**: 见第 7 节，尤其是 canonical 契约、RLS/worker 角色、再认证、保留/备份和分布式限流。
- **Ready for integration**: yes。主会话可将本稿门槛和未决项整合进正式契约；整合前不得把规划能力描述为已实现。
