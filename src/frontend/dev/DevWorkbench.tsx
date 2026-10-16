"use client";
import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { PrimaryAction } from "../../contracts/workbench";
import { AppShell, viewPaths, WorkbenchView } from "../app/AppShell";
import { FixtureSession, useSession } from "../app/SessionBoundary";
import { ActionDispatcher } from "../app/ActionDispatcher";
import { TodosPage } from "../pages/todos/TodosPage";
import { ActivitiesPage } from "../pages/activity-detail/ActivitiesPage";
import { CardDetailModal } from "../pages/card-detail/CardDetailModal";
import { RecentTodos } from "../pages/overview/RecentTodos";
import { Overview } from "../pages/overview/Overview";
import { CardActivitiesSummary, StopTrackingDialog } from "../features/activities";
import { createFixtureWorkbench } from "./fixtures";
const gates = { todos: true, activities: true, activityPeriods: true };
export function DevWorkbench() { const search = useSearchParams(); const scenario = search.get("scenario") ?? "full"; return <FixtureSession><FixtureWorkspace key={scenario} scenario={scenario} /></FixtureSession>; }
function FixtureWorkspace({ scenario }: { scenario: string }) {
  const session = useSession(); const search = useSearchParams(); const fixture = useMemo(() => createFixtureWorkbench(scenario), [scenario]);
  const screen = search.get("screen"); const view: WorkbenchView = screen === "overview" ? "overview" : screen === "activities" ? "activities" : screen === "notifications" ? "notifications" : "todos";
  const [action, setAction] = useState<PrimaryAction | null>(null);
  const [fee, setFee] = useState(false);
  const [stopCard, setStopCard] = useState(false);
  const [cardStatus, setCardStatus] = useState<"active" | "archived">("active");
  const [feeStatus, setFeeStatus] = useState("pending");
  function navigate(view: WorkbenchView) {
    if (view === "cards" || view === "settings" || view === "calendar") { window.location.assign(viewPaths[view]); return; }
    const params = new URLSearchParams(search.toString());
    params.set("screen", view);
    window.history.pushState(null, "", "?" + params);
  }
  function dispatch(action: PrimaryAction) { if (action.kind === "annual_fee") setFee(true); else if (action.kind === "detail" && action.participationId) { const params = new URLSearchParams(search.toString()); params.set("screen", "activities"); params.set("participation", action.participationId); window.history.pushState(null, "", "?" + params); } else setAction(action); }
  const demoCard = { id: fixture.card.id, issuerName: fixture.card.bank, name: fixture.card.name, last4: fixture.card.last4, annualFeeAmount: 800, currency: "CNY", status: cardStatus, feeCycleType: "custom" as const, nextFeeDate: "2026-10-08", waiveRuleType: "count", targetCount: 5, createdAt: fixture.meta.serverNow };
  const cycle = { id: "fixture-fee-cycle", cardId: fixture.card.id, periodStart: "2026-01-01", periodEnd: "2026-12-31", feeDueDate: "2026-10-08", waiveRuleType: "count", targetCount: 5, status: "open" as const };
  return <AppShell gates={gates} profile={session.profile} view={view} onNavigate={navigate}><div className="preview-context"><details className="fixture-banner"><summary>示例预览<span>不保存到个人账号</span></summary><div><p>10—12 月每月 5 笔且 2,000 元；三期确认后 100 元返现；次年 1 月 5—20 日领取。</p><a href="?scenario=full&screen=todos&month=2026-10">完整示例</a><a href="?scenario=claim-open&screen=activities">领取窗口开放</a><a href="?scenario=queued-fail&screen=activities&participation=fixture-participation">后台任务失败恢复</a></div></details><a className="preview-exit" href="/">返回我的工作台</a></div>
    {view === "todos" && <TodosPage ports={fixture.ports} defaultMonth="2026-10" onPrimary={dispatch} onNotifications={() => navigate("notifications")} />}
    {view === "overview" && <Overview profile={session.profile} cards={cardStatus === "archived" ? [] : [demoCard]} events={[]} reminders={[]} onAdd={() => window.location.assign(viewPaths.cards + "?new=1")} onOpenCard={() => setFee(true)} onGoCards={() => navigate("cards")} onGoReminders={() => navigate("notifications")} recentTodos={<RecentTodos ports={fixture.ports} onPrimary={dispatch} onAll={() => navigate("todos")} />} />}
    {view === "activities" && <ActivitiesPage gates={gates} ports={fixture.ports} onPrimary={dispatch} />}
    {view === "notifications" && <section className="section-block"><h1>通知历史</h1><p>同一年费行动的三次提前通知</p>{[30, 7, 1].map((days) => <p key={days}>年费通知 · 提前 {days} 天 · 关联同一处理行动</p>)}<button className="text-button" onClick={() => navigate("todos")}>返回待办</button></section>}
    {stopCard && <StopTrackingDialog kind="card" name={demoCard.name} onClose={() => setStopCard(false)} onSave={async () => { setCardStatus("archived"); setStopCard(false); setFee(false); setAction(null); return true; }} />}
    <ActionDispatcher onPrimary={dispatch} action={action} ports={fixture.ports} onClose={() => setAction(null)} />
    <CardDetailModal activities={<CardActivitiesSummary scope={session.scope} timezone={session.profile.timezone} cardId={fixture.card.id} api={fixture.ports.activities} onPrimary={dispatch} onOpen={(id) => { setFee(false); dispatch({ kind: "detail", resourceId: id, participationId: id, label: "查看活动", enabled: true }); }} />} open={fee} detail={{ card: demoCard, cycles: [cycle], progress: { [cycle.id]: { cycle, entries: [], progress: { count: 3, amount: 1200, percentage: 60, qualified: false, remainingCount: 2 } } }, eventHistory: {}, reminderTimeline: {} }} loading={false} events={[{ id: "fixture-fee-event", cardId: demoCard.id, cycleId: cycle.id, dueDate: "2026-10-08", expectedAmount: 800, status: feeStatus }]} eventHistory={{}} reminderTimeline={{}} onClose={() => setFee(false)} onEdit={() => {}} onArchive={() => setStopCard(true)} onRestore={() => setCardStatus("active")} onAddProgress={() => {}} onSetProgressValue={() => {}} onEditProgress={() => {}} onReverseProgress={() => {}} onUpdateEvent={(_, status) => setFeeStatus(status)} />
  </AppShell>;
}
