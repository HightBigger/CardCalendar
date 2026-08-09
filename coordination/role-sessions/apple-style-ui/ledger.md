# Apple-Style UI

## Charter
- Goal: Rework CardCalendar's visual system and interaction details around the upstream `apple-design` skill while preserving its financial-management workflows and information density.
- Non-goals: Change domain behavior, API contracts, database schema, product scope, or add a frontend dependency without an explicit integration decision.
- Completion criteria: Desktop and mobile interfaces use deliberate system typography, restrained translucent hierarchy, direct feedback, reversible motion where interaction warrants it, and support reduced motion/transparency/contrast. Existing E2E flows and keyboard behavior remain valid.
- Parent session: CardCalendar local integrator.
- Repository / base branch: `main` at `49cbb8f`.
- Created: 2026-08-09.

## Decisions
| Date | Decision | Owner | Rationale | Affected sessions |
| --- | --- | --- | --- | --- |
| 2026-08-09 | Use the upstream `apple-design` skill as the design authority, with the existing `emil-design-eng` skill for implementation quality. | Integrator | The installed prior skill covered motion polish but not Apple's material, typography, gesture, and accessibility foundations. | design, QA, frontend |
| 2026-08-09 | Preserve CardCalendar as a dense operational tool, not a decorative consumer or marketing surface. | Integrator | Annual-fee decisions need fast scanning and reliable repeated actions. | design, frontend |
| 2026-08-09 | Give one frontend session exclusive write ownership of `app/globals.css` and `components/`; all other role sessions are read-only. | Integrator | Prevent CSS/component conflicts. | design, QA, frontend |

## Session Register
| Status | Title | Role | Thread ID | Branch/worktree | Owned files | Depends on | Output | Validation |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| complete | UX / Design｜CardCalendar｜Apple 风格审计 | UX / design | 019fe4c7-cec6-7f90-84aa-c08a9a905350 | `/Users/chenyixing/.codex/worktrees/e602/xyk管理` | none | upstream skill + current UI | signed-off visual spec | desktop/mobile evidence |
| complete | QA｜CardCalendar｜多端视觉基线 | QA | 019fe4c7-cebf-7522-b344-64332aad9960 | `/Users/chenyixing/.codex/worktrees/0289/xyk管理` | none | current UI | reproducible visual baseline | screenshots and interaction checks |
| complete (manually integrated) | Frontend Engineer｜CardCalendar｜Apple 风格实现 | Frontend engineer | 019fe4ce-64c5-7d53-8e48-b2626b5f1410 | `/Users/chenyixing/.codex/worktrees/95ff/xyk管理` | `components/modal.tsx`, `components/mvp-app.tsx`, `components/toast.tsx` | design and QA evidence | navigation, focus, modal, toast refinements | typecheck, E2E, screenshots |
| closed (audit supplied) | Visual Systems Engineer｜CardCalendar｜CSS 交付 | Visual systems | 019fe4e1-3c30-7721-b1c6-80fe8f6138b4 | `/Users/chenyixing/.codex/worktrees/8b85/xyk管理` | `app/globals.css` | design contract | token and selector audit; parent applied final CSS | parent validation |

## Handoffs
### design
- Changed artifacts: none expected.
- Interface or decision: semantic neutral canvas/surface/text/separator/status tokens; translucent material only for sidebar/top bar; unframed content sections; one settings navigation entry; tabular financial numerals; compact-control press feedback only; all three system accessibility preferences.
- Validation evidence: source audit plus login checks at desktop and 390px.
- Risks or rollback: preserve every existing interaction and E2E selector; do not add glass to data rows or nested content.
- Ready for integration: yes.

### qa
- Changed artifacts: none expected.
- Interface or decision: retain 390px no-overflow, modal autofocus/focus containment/Escape restoration, toast announcement/dismissal, drawer open-select-close behavior, and data-density checks.
- Validation evidence: committed E2E suite passed 2/2 in 50.6 seconds; manual desktop/mobile visual baseline completed.
- Risks or rollback: increase sub-44px touch controls; add `prefers-reduced-transparency` and `prefers-contrast: more`; preserve calendar tab selection semantics.
- Ready for integration: yes.

### frontend
- Changed artifacts: `components/modal.tsx`, `components/mvp-app.tsx`, `components/toast.tsx`; integrated manually after the role's CSS write stalled.
- Interface or decision: one settings navigation destination; focus-managed mobile drawer; modal trap re-queries dynamic controls; reduced-motion-aware close delay; toast preserves its spoken content during exit.
- Validation evidence: `npm run typecheck`, `npm test`, `npm run build`, Playwright flow checks, desktop/mobile browser inspection.
- Risks or rollback: no API/data contract changes; all changes are isolated to frontend UI files.
- Ready for integration: yes.

### visual-systems
- Changed artifacts: no role branch commit accepted; parent applied final `app/globals.css` implementation after the role's semantic token audit.
- Interface or decision: neutral canvas/surfaces, system-blue primary action, structural material only for sidebar/topbar, compact 44px mobile controls, and three system preference fallbacks.
- Validation evidence: inspected login, cards, modal, mobile drawer, and mobile calendar at 1440px and 390px-equivalent viewports; no horizontal overflow observed.
- Risks or rollback: CSS-only visual changes preserve class names and product flows.
- Ready for integration: yes.

## Integration Queue
| Order | Shared concern | Integrator | Prerequisite | State |
| --- | --- | --- | --- | --- |
| 1 | Design acceptance contract | Integrator | design + QA handoffs | complete |
| 2 | UI stylesheet and components | Integrator | frontend handoff | complete |
| 3 | Browser visual and E2E validation | Integrator | integrated UI changes | complete |

## Final Evidence
- Commits: pending final integration commit.
- Test / build checks: `npm run typecheck` passed; `npm test` passed (17 files / 45 tests); `npm run build` passed after the local dev server was stopped; Playwright status passed; `npm audit --omit=optional` found 0 vulnerabilities; `git diff --check` passed.
- Visual checks: login and cards/modal at 1440px; overview/drawer and calendar at 390px-equivalent viewport; no horizontal overflow or clipping observed.
- Deferred follow-ups: add arrow-key navigation to the calendar tabs only if keyboard power users request it; current tabs have selected state, focus order, and tabpanel linkage.
