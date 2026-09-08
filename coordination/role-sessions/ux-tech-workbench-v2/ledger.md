# UX Tech Workbench V2

## Charter
- Goal: 将 Cardfolio 工作台的“科技感”定义为可核对、可行动、可恢复的视觉系统，并交付可交互原型、截图证据和 MVP 壳层落地记录。
- Non-goals: 不伪造 AI 实时同步、银行资格判断、库存或奖励结果；不在本轮实现活动、权益、积分、兑换业务；不新增前端依赖。
- Completion criteria: UX 原型可打开并覆盖桌面/移动、深色/浅色、关键反馈和退化路径；正式视觉规范记录实际实现边界；当前 MVP 页面通过浏览器和回归验证。
- Parent session: Cardfolio product integrator.
- Repository / base branch: `main`; preserve existing uncommitted changes.
- Created: 2026-08-14.

## Design decisions
| Date | Decision | Owner | Evidence |
| --- | --- | --- | --- |
| 2026-08-14 | 深色石墨工作台作为专注主题，浅色主题作为阅读/打印语义映射；两者共享状态、间距和信息层级。 | UX / Design | `UX-TECH-WORKBENCH-V2.md`, theme screenshots |
| 2026-08-14 | 半透明只用于侧栏、顶栏、抽屉、浮层和 Toast；任务、时间线、积分批次等核心数据使用实心数据面。 | UX / Design | visual direction v0.2, prototype |
| 2026-08-14 | 科技感来自状态轨道、来源新鲜度、tabular numerals 和短反馈，不使用粒子、扫描线、伪 AI 实时提示或紫色渐变。 | UX / Design | visual direction v0.2, prototype |
| 2026-08-14 | 当前正式页面只落地年费 MVP 壳层；未来活动/权益/积分/兑换只在原型和规划文档中出现。 | Integrator | `components/mvp-app.tsx`, `app/globals.css`, PRD/QA gates |

## Session contract
- Role: UX / Design reviewer and visual direction owner.
- Owned artifacts: `design-prototypes/ux-tech-workbench-v2.html`, `docs/research/UX-TECH-WORKBENCH-V2.md`, `docs/UX-VISUAL-DIRECTION.md` (integrated by parent), screenshot evidence.
- Forbidden scope: business API, database, migrations, auth, package dependencies and unassigned product contracts.
- External actions: local browser verification only; no external publication.
- Commit/push: forbidden for this role; parent owns integration and release actions.

## Session register
| Status | Title | Role | Agent | Outputs | Validation |
| --- | --- | --- | --- | --- | --- |
| complete | UX 设计师｜Cardfolio｜科技感工作台 V2 | UX / Design | `/root/ux_visual_direction_v2` | interactive prototype, visual delivery doc, 1440/390 dark screenshots, 1440 light screenshot | theme switch, queue Toast, mobile drawer/bottom nav, no horizontal overflow |

## Handoff
- Changed artifacts: prototype and screenshots listed above; `app/globals.css` and `components/mvp-app.tsx` received the shell implementation in the parent integration session.
- Key decisions: L0-L4 semantic materials, status-first hierarchy, structural translucency only, short interruptible feedback, Chinese UI, reduced-motion/transparency/contrast fallbacks.
- Validation: UX prototype checked at 1440x900 and 390x844; actual MVP shell verified in a real authenticated browser session at 1440x900 and 390x844; mobile drawer Escape/focus recovery and card-form overflow were checked; `npm run typecheck`, `npm test -- --run`, `npm run build`, `npm run test:e2e`, and `git diff --check` passed in the parent session.
- Runtime evidence: `design-prototypes/screenshots/actual-workbench-runtime-1440x900.png`, `actual-workbench-runtime-390x844.png`, and `actual-workbench-runtime-card-form-390x844.png`.
- Risks: future workbench modules need real data/error states; runtime screenshots do not prove API correctness, screen-reader behavior, or real activity/benefit/points/redemption flows.
- Ready for integration: yes. The visual system is integrated into the current MVP shell; future domain screens remain gated by product/architecture/DBA/QA release gates.

## Final evidence
- No commit or push created by this role.
- Current deployable scope remains annual-fee MVP.

## Follow-up: 2026-08-15 真实 React 页面 UX 复核

### Evidence reviewed

- `components/mvp-app.tsx:601-709`：真实应用壳层、导航、移动抽屉、提醒入口和账户菜单。
- `components/mvp-app.tsx:819-954`：当前工作台仍是总卡片/使用中卡片/待处理提醒/未来 90 天年费/待办五个年费 MVP 指标，没有活动、权益、积分或兑换业务入口。
- `app/globals.css:3197-3242`：最终覆盖的默认 token 为深色 `color-scheme: dark`；当前没有用户主题切换或 `prefers-color-scheme` 映射，浅色只在 `@media print`（`app/globals.css:4048-4073`）提供打印退化。
- `app/globals.css:3979-4027` 与 `app/globals.css:4075-4265`：command-center polish 先定义桌面五列，但文件末尾又补了移动 `@media (max-width: 680px)` 两列、最后一项全宽，以及 `681-980px` 两列覆盖；后置规则已覆盖桌面声明，避免 390px 指标挤压。
- `app/globals.css:4075-4201`：静止网格、顶部渐变线、指标角点和状态光晕均为装饰性 CSS，没有循环动画；当前文案没有“AI”“实时同步”“预测”或“置信度”承诺。
- `design-prototypes/screenshots/actual-workbench-runtime-1440x900.png`、`actual-workbench-runtime-390x844.png` 和 `actual-workbench-runtime-card-form-390x844.png`：当前真实 React 登录态工作台、移动工作台和卡片表单截图；旧的 `actual-mvp-desktop-1440x900.png` / `actual-mvp-mobile-390x844.png` 是加载态截图，不作为本轮布局结论依据。另以 `actual-mvp-card-detail-1440x900.png` 复核桌面详情模态层级。
- `e2e/mvp-flow.spec.ts:3-42`：现有 E2E 明确验证 390px 无横向溢出、移动导航展开/收起、焦点和新增卡片流程；它没有断言五指标在 390px 的列数或文字是否可读。

### Final recommendations

#### 1. 深色默认 vs 浅色默认

建议**当前工作台先保持深色默认**，因为用户明确要求科技感，现有真实壳层已经围绕石墨画布、实心数据面和青蓝行动色完成迁移，视觉方向在 `actual-mvp-card-detail-1440x900.png` 中是连贯的。它应被命名为“专注工作台”，而不是实时终端。

但在完整工作台可部署前必须补齐浅色阅读主题，并提供显式切换或跟随系统设置：长中文规则、表单、来源原文、打印和视力敏感场景不应被深色锁死。不要根据临期程度自动切换主题，保持空间记忆和状态语义稳定。

#### 2. 科技感与“实时 AI”误导

科技感已足够形成方向：状态轨道/角点、实心数据面、结构 Chrome、tabular numerals、短促按下反馈和深色层级均已落地。当前没有直接的 AI 误导证据，因为没有 AI、预测、在线或同步中等文案，也没有循环扫描/粒子动画。

仍有一个 P1 风险：`body::before` 静止网格、`.main-area::before` 顶部渐变线、`.metrics::before` 颜色轨道和 `.metric.accent::after` 发光点组合起来容易被理解成遥测/实时状态。后续应把“最近核对时间、来源等级、待核对”放在工作台首屏固定位置，并避免把装饰性角点改成呼吸或扫描动画。没有真实后台同步事实时，不显示“在线”“同步中”或“AI 建议”。

#### 3. 桌面与 390px 可用性

- **桌面 1440px：** 248px 侧栏、42px 顶栏内边距和 `1.55fr / .9fr` 双栏比例有足够扫描空间；详情模态的实心表面、明确关闭/编辑/归档入口和滚动区域可用。当前主要风险是工作台首屏仍是年费 MVP 信息架构，而不是视觉密度或横向溢出。
- **移动 390px：** 抽屉使用 `transform`、遮罩、Escape 和焦点恢复，已有 E2E 验证无横向溢出；卡片列表在 `max-width: 680px` 将主按钮独占一行，筛选工具栏在 390px 变单列，方向正确。
- **移动指标（已修正）：** `app/globals.css:4236-4259` 已在 polish 末尾补充 390px 两列、最后一项全宽；`actual-workbench-runtime-390x844.png` 证明当前真实截图为 2+2+1 布局，未发现五列挤压。仍应在 320-360px 走查最长金额和中文标签，但不再作为当前 P0 阻断。
- **移动 P1：** 顶栏只保留视图标题、提醒和退出，没有最后核对/来源摘要；长标题和年费状态仍要进入详情才能核对。正式活动/权益/积分模块加入前，应先验证底部操作区、模态滚动和软键盘安全区，不能仅凭当前 loading 截图通过。

### Priority fixes

| Priority | Finding | Evidence | Required follow-up |
| --- | --- | --- | --- |
| P0（已解决） | 390px 指标曾有被桌面五列覆盖的风险 | `app/globals.css:4236-4265` 的后置覆盖；`actual-workbench-runtime-390x844.png` 实测 2+2+1 | 保留现有覆盖规则；补 320-360px 长文案/金额走查和 computed-style 断言 |
| P1 | 首屏没有“最近核对/来源等级”维度，用户无法区分真实数据新鲜度与装饰状态 | `components/mvp-app.tsx:819-954` 只有年费统计；当前 CSS 只有装饰角点/光晕 | 在活动/权益/积分实现前，先定义并复用来源/核对行；没有同步事实不显示在线/实时文案 |
| P1 | 深色是唯一交互主题，浅色只存在打印退化 | `app/globals.css:3199`, `4048-4073` | 增加用户可控浅色主题/系统跟随；核验 WCAG AA、长中文规则、表单和导出 |
| P1 | 静止 telemetry 纹理可能被误读为实时监控 | `app/globals.css:4075-4145` | 保持静止、弱化光晕；禁止循环动画，文案只使用“记录/核对/待确认” |
| P1 | 当前真实页面仍只展示年费 MVP，未来工作台模块尚无真实跨端证据 | `components/mvp-app.tsx:609-709`, `819-954`; existing screenshots are mostly loading/detail | 活动/权益/积分/兑换逐模块接入后，分别补 1440/1280/390、失败恢复、键盘和屏幕阅读器证据 |

### Handoff status

- 该复核为只读审查；本 follow-up 只更新本台账，未修改 `app/`、`components/`、CSS、原型或业务契约。
- 结论：视觉方向可继续，当前已没有未解决的 P0 视觉阻断；深色默认可保留为专注主题，但浅色主题、来源新鲜度和 320-360px 真实数据走查应列入发布门。
