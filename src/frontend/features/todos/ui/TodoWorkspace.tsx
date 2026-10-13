"use client";
import { useState } from "react";
import type { TodoAction, TodoCommand } from "../../../../contracts/todos";
import type { PrimaryAction } from "../../../../contracts/workbench";
import { QueryState } from "../../../shared/ui";
import type { TodoWorkspaceController } from "../application/useTodoWorkspaceController";
import { groupLabels } from "../model/filters";
import { TodoFilters } from "./TodoFilters";
import { TodoRow } from "./TodoRow";
import { TodoCalendar } from "./TodoCalendar";
import { CustomTodoForm } from "./CustomTodoForm";
import { TodoDetail } from "./TodoDetail";
export function TodoWorkspace({ controller: c, timezone, onPrimary, onNotifications }: { controller: TodoWorkspaceController; timezone: string; onPrimary: (action: PrimaryAction) => void; onNotifications: () => void }) {
  const [form, setForm] = useState<TodoAction | "new" | null>(null);
  const [snoozing, setSnoozing] = useState(false);
  const act = (action: TodoAction, kind: TodoCommand["command"]) => { if (kind === "snooze") { setSnoozing(true); c.select(action.id); } else void c.act(action, kind); };
  return <div className="todo-workspace"><div className="welcome-row"><div><p className="eyebrow">行动工作区</p><h1>待办</h1><p className="subline">按截止安排处理，报名、领取和到账各自核对。</p></div><div className="workspace-tools"><button className="text-button" onClick={onNotifications}>通知历史</button><button className="primary-button" disabled={c.list.data?.canCreateCustom === false} title={c.list.data?.canCreateCustom === false ? "自定义待办暂未开放" : undefined} onClick={() => { c.command.clearError(); setForm("new"); }}>新增自定义待办</button></div></div>
    {c.list.data?.coverage === "catalog_only" && <p className="form-error" role="status">此处仅显示银行活动待办。年费与自定义事项暂未接入。</p>}
    <div className="workspace-view" role="tablist" aria-label="待办视图">{(["list", "calendar"] as const).map((view) => <button id={"todo-tab-" + view} key={view} role="tab" aria-selected={c.filters.view === view} aria-controls="todo-view-panel" className={c.filters.view === view ? "active" : ""} onClick={() => c.updateFilters({ view })}>{view === "list" ? "列表" : "日历"}</button>)}</div>
    <TodoFilters filters={c.filters} cards={c.list.data?.cards ?? []} update={c.updateFilters} />
    {c.filters.from && c.filters.to && c.filters.from > c.filters.to && <p className="form-error" role="alert">日期范围结束应晚于开始，请调整筛选。</p>}
    {c.command.error && !c.selectedId && !form && <p className="form-error" role="alert">{c.command.error}</p>}
    <div id="todo-view-panel" role="tabpanel" aria-labelledby={"todo-tab-" + c.filters.view}>{c.filters.view === "list" ? <QueryState {...c.list} hasData={!!c.list.data} retry={c.list.reload} label="待办"><p className="workspace-count">共 {c.list.data?.total ?? 0} 条 · 日期与分组按 {c.list.meta?.timezone ?? timezone}</p>{c.list.data?.groups.filter((group) => group.items.length > 0).map((group) => <section className="todo-group" key={group.key} aria-label={groupLabels[group.key]}><h2>{groupLabels[group.key]} <span>{group.count}</span></h2>{group.items.map((item) => <TodoRow key={item.id} action={c.latest(item)} timezone={timezone} busy={c.command.busy} onOpen={c.select} onPrimary={onPrimary} onCommand={act} />)}</section>)}{c.list.data?.total === 0 && <div className="empty-state"><strong>没有符合当前条件的待办</strong><p>可调整筛选，或新增自己的处理事项。</p></div>}{(c.list.data?.nextCursor || c.list.meta?.nextCursor) && <button className="secondary-button" onClick={c.nextPage}>下一页</button>}<button className="text-button" onClick={() => { c.firstPage(); void c.list.reload(); }}>刷新列表</button></QueryState> : <QueryState {...c.calendar} hasData={!!c.calendar.data} retry={c.calendar.reload} label="日历"><TodoCalendar filters={c.filters} entries={c.calendar.data?.entries ?? []} undated={c.calendar.data?.undatedCount ?? 0} update={c.updateFilters} onOpen={c.select} onPrimary={onPrimary} latest={c.latest} /></QueryState>}</div>
    {c.selectedId && !form && <TodoDetail key={c.selectedId} action={c.selected} loading={c.detail.loading} loadError={c.detail.error} error={c.command.error} busy={c.command.busy} timezone={timezone} serverNow={c.detail.meta?.serverNow ?? c.list.meta?.serverNow ?? new Date().toISOString()} snoozing={snoozing} onClose={() => { c.select(null); setSnoozing(false); }} onRetry={c.detail.reload} onPrimary={onPrimary} onAct={c.act} onEdit={(action) => setForm(action)} />}
    {form && <CustomTodoForm key={form === "new" ? "new" : form.id} initial={form === "new" ? undefined : c.latest(form)} cards={c.list.data?.cards ?? []} timezone={timezone} busy={c.command.busy} error={c.command.error} onSave={(draft) => c.save(draft, form === "new" ? undefined : form)} onClose={() => setForm(null)} />}
  </div>;
}
