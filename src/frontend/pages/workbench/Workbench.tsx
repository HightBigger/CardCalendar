"use client";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import type { ApiCard, ApiFeeEvent, CardDraft } from "../../../contracts/mvp";
import type { PrimaryAction } from "../../../contracts/workbench";
import { ActionDispatcher } from "../../app/ActionDispatcher";
import { TodosPage } from "../todos/TodosPage";
import { ActivitiesPage } from "../activity-detail/ActivitiesPage";
import type { FeatureGates } from "../../../contracts/feature-gates";
import { AppShell, viewPaths, WorkbenchView } from "../../app/AppShell";
import { SessionBoundary, useSession } from "../../app/SessionBoundary";
import { CardForm, CardsView, useCardsController } from "../../features/cards";
import { CalendarView, useAnnualFeesController } from "../../features/annual-fees";
import { CardActivitiesSummary, StopTrackingDialog } from "../../features/activities";
import { RemindersView, useNotificationsController } from "../../features/notifications";
import { SettingsView, useSettingsController } from "../../features/settings";
import { QueryState, Toast } from "../../shared/ui";
import { useCatalogCapabilities } from "../../app/useCatalogCapabilities";
import { Overview } from "../overview/Overview";
import { RecentTodos } from "../overview/RecentTodos";
import { CardDetailModal } from "../card-detail/CardDetailModal";

export function WorkbenchEntry({ gates, initialView }: { gates: FeatureGates; initialView?: WorkbenchView }) {
  return <Suspense fallback={<main className="loading-page">正在加载工作台…</main>}><SessionBoundary><Workbench gates={gates} initialView={initialView} /></SessionBoundary></Suspense>;
}
export function Workbench({ gates, initialView }: { gates: FeatureGates; initialView?: WorkbenchView }) {
  const session = useSession();
  const catalogCapabilities = useCatalogCapabilities(session.scope);
  const path = usePathname();
  const view = (path.startsWith("/activities") ? "activities" : Object.entries(viewPaths).find(([, url]) => url === path)?.[0] ?? initialView ?? "overview") as WorkbenchView;
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<ApiCard | null>(null);
  const [action, setAction] = useState<PrimaryAction | null>(null);
  const [active, setActive] = useState<ApiCard | null>(null);
  const [archiving, setArchiving] = useState(false);
  const cards = useCardsController(session.scope);
  const fees = useAnnualFeesController(session.scope, active);
  const notifications = useNotificationsController(session.scope);
  const settings = useSettingsController(session.scope, session.updateProfile);
  const notify = useCallback((text: string) => { setNotice(text); if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => setNotice(null), 3600); }, []);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const perform = async (work: () => Promise<void>, message?: string) => { try { await work(); if (message) notify(message); } catch (error) { notify(error instanceof Error ? error.message : "操作失败"); throw error; } };
  const cardItems = cards.cards.data ?? [];
  const summaries = cards.summaries.data ?? [];
  const activeCards = useMemo(() => cardItems.filter((card) => card.status !== "archived"), [cardItems]);
  const visibleEvents = (fees.events.data ?? []).filter((event) => activeCards.some((card) => card.id === event.cardId));
  const upcomingEvents = visibleEvents.filter((event) => event.dueDate >= new Date().toLocaleDateString("sv-SE", { timeZone: session.profile.timezone }) && event.dueDate <= new Date(Date.now() + 90 * 86400000).toLocaleDateString("sv-SE", { timeZone: session.profile.timezone })).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const pendingReminders = (notifications.history.data ?? []).filter((item) => item.status === "pending" || item.status === "snoozed");
  const attention = summaries.filter((card) => card.status !== "archived" && card.progress && !card.progress.qualified).slice(0, 5);
  const filtered = summaries.filter((card) => (card.issuerName + " " + card.name + " " + card.last4).toLowerCase().includes(query.trim().toLowerCase()));
  const go = (next: WorkbenchView) => next === "bank-activities" || next === "catalog-admin" ? window.location.assign(viewPaths[next]) : window.history.pushState(null, "", viewPaths[next]);
  function dispatch(action: PrimaryAction) {
    if (action.kind === "annual_fee") {
      const event = fees.events.data?.find((item) => item.id === action.resourceId);
      const card = cardItems.find((item) => item.id === event?.cardId);
      if (card) setActive(card); else notify("年费记录暂时无法读取，请重新加载卡片与年费。");
    } else if (action.kind === "detail" && action.participationId) {
      window.history.pushState(null, "", "/activities?participation=" + encodeURIComponent(action.participationId));
    } else setAction(action);
  }
  async function save(draft: CardDraft) {
    if (editing?.status === "archived" && draft.status !== undefined) throw new Error("已归档卡片可保存名称与备注；恢复使用请到卡片详情操作");
    await perform(() => cards.save(draft, editing?.id), editing ? "卡片已更新" : "卡片已添加，提醒已创建"); setAddOpen(false); setEditing(null);
  }
  function closeCardDialogs() { setArchiving(false); setActive(null); setAction(null); setAddOpen(false); setEditing(null); }
  async function lifecycle(action: "archive" | "restore") {
    if (!active) return;
    if (action === "archive") { cards.lifecycleCommand.clearError(); setArchiving(true); return; }
    if (!window.confirm("确认恢复这张卡片？历史数据会保留，并重新生成待处理提醒。")) return;
    if (await cards.lifecycle(active, action)) { notify("卡片已恢复使用"); closeCardDialogs(); }
    else notify(cards.lifecycleCommand.error ?? "卡片状态更新失败，请重试");
  }
  const progress = (cycleId: string, payload: unknown, entryId?: string, reverse?: boolean) => perform(() => fees.writeProgress(cycleId, payload, entryId, reverse), "进度已更新");
  return <AppShell catalogCapabilities={catalogCapabilities.data} gates={gates} profile={session.profile} view={view} notifications={pendingReminders.length} onNavigate={go} onLogout={() => perform(settings.logout)}>
    <Toast message={notice} onDismiss={() => setNotice(null)} />
    {view === "overview" && <>
      <QueryState {...cards.cards} hasData={!!cards.cards.data} retry={cards.cards.reload} label="卡片" />
      <QueryState {...fees.events} hasData={!!fees.events.data} retry={fees.events.reload} label="年费" />
      <QueryState {...notifications.history} hasData={!!notifications.history.data} retry={notifications.history.reload} label="通知" />
      <Overview recentTodos={gates.todos ? <RecentTodos onPrimary={dispatch} onAll={() => go("todos")} /> : undefined} profile={session.profile} cards={activeCards} totalCards={summaries.length} activeCards={activeCards.length} attentionCards={attention} events={upcomingEvents} reminders={pendingReminders} upcomingAmount={upcomingEvents.reduce((total, event) => total + Number(event.expectedAmount), 0)} onAdd={() => setAddOpen(true)} onOpenCard={setActive} onGoCards={() => go("cards")} onGoReminders={() => go("notifications")} />
    </>}
    {view === "cards" && <QueryState {...cards.summaries} hasData={!!cards.summaries.data} retry={cards.summaries.reload} label="卡片"><CardsView cards={filtered} query={query} onQueryChange={setQuery} onAdd={() => setAddOpen(true)} onEdit={(card) => { setEditing(card); setAddOpen(true); }} onOpenCard={setActive} />{gates.activities && <button className="secondary-button" onClick={() => go("activities")}>查看卡片活动</button>}</QueryState>}
    {view === "todos" && gates.todos && <TodosPage onPrimary={dispatch} onNotifications={() => go("notifications")} />}
    {view === "activities" && gates.activities && <ActivitiesPage gates={gates} initialId={path.split("/")[2]} onPrimary={dispatch} />}
    {view === "calendar" && <QueryState {...fees.events} hasData={!!fees.events.data} retry={fees.events.reload} label="年费"><CalendarView events={visibleEvents} cards={activeCards} /></QueryState>}
    {view === "notifications" && <QueryState {...notifications.history} hasData={!!notifications.history.data} retry={notifications.history.reload} label="通知"><RemindersView reminders={notifications.history.data ?? []} onAction={(reminder, action) => { void perform(() => notifications.action(reminder, action)).catch(() => {}); }} /></QueryState>}
    {view === "settings" && <><QueryState {...notifications.rules} hasData={!!notifications.rules.data} retry={notifications.rules.reload} label="提醒偏好" /><SettingsView profile={session.profile} onSaveProfile={(name, timezone) => perform(() => settings.save(name, timezone), "个人设置已保存")} onDelete={settings.remove} reminderRules={notifications.rules.data ?? []} onReminderRulesChange={(rules) => perform(() => notifications.saveRules(rules), "提醒规则已保存")} /></>}
    <ActionDispatcher onPrimary={dispatch} action={action} onClose={() => setAction(null)} />
    {archiving && active && <StopTrackingDialog kind="card" name={active.name} error={cards.lifecycleCommand.error} onClose={() => setArchiving(false)} onSave={async (policy, note) => { const saved = await cards.lifecycle(active, "archive", policy, note); if (saved) { notify("卡片已归档"); closeCardDialogs(); } return saved; }} />}
    <CardForm key={editing?.id ?? "new"} open={addOpen} initial={editing} onClose={() => { setAddOpen(false); setEditing(null); }} onSubmit={save} />
    <CardDetailModal activities={gates.activities && active ? <CardActivitiesSummary scope={session.scope} timezone={session.profile.timezone} cardId={active.id} onPrimary={dispatch} onOpen={(id) => { setActive(null); window.history.pushState(null, "", "/activities?participation=" + encodeURIComponent(id)); }} /> : undefined} error={fees.detail.error} onRetry={fees.detail.reload} open={!!active} detail={fees.detail.data ?? null} loading={fees.detail.loading} events={fees.events.data ?? []} eventHistory={fees.detail.data?.eventHistory ?? {}} reminderTimeline={fees.detail.data?.reminderTimeline ?? {}} onActivities={gates.activities && active ? () => { const id = active.id; setActive(null); window.history.pushState(null, "", "/activities?activityCardId=" + encodeURIComponent(id)); } : undefined} onClose={() => setActive(null)} onEdit={() => { setEditing(active); setAddOpen(true); }} onArchive={() => { void lifecycle("archive").catch(() => {}); }} onRestore={() => { void lifecycle("restore").catch(() => {}); }} onAddProgress={(id, entryDate, countDelta, amountDelta, note) => progress(id, { entryDate, countDelta, amountDelta, note })} onSetProgressValue={(id, entryDate, currentCount, currentAmount, note) => progress(id, { mode: "cumulative", entryDate, currentCount, currentAmount, note })} onEditProgress={(id, entryId, entryDate, countDelta, amountDelta, note) => progress(id, { entryDate, countDelta, amountDelta, note }, entryId)} onReverseProgress={(id, entryId) => progress(id, {}, entryId, true)} onUpdateEvent={(event: ApiFeeEvent, status, actualAmount, occurredOn, notes) => perform(() => fees.updateEvent(event, status, actualAmount, occurredOn, notes), "年费事件已更新")} />
  </AppShell>;
}
