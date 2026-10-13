"use client";
import { useState } from "react";
import type { TodoAction } from "../../../../contracts/todos";
import type { PrimaryAction } from "../../../../contracts/workbench";
import { QueryState } from "../../../shared/ui";
import type { TodoWorkspaceController } from "../application/useTodoWorkspaceController";
import { TodoRow } from "./TodoRow";
import { TodoDetail } from "./TodoDetail";
import { CustomTodoForm } from "./CustomTodoForm";

export function TodoAttention({ controller: c, timezone, onPrimary, onAll }: { controller: TodoWorkspaceController; timezone: string; onPrimary: (action: PrimaryAction) => void; onAll: () => void }) {
  const [editing, setEditing] = useState<TodoAction | null>(null);
  const primary = (action: PrimaryAction) => { if (action.kind === "detail" && !action.participationId) c.select(action.resourceId); else onPrimary(action); };
  const rows = c.list.data?.groups.flatMap((group) => group.items) ?? [];
  return <section className="section-block todo-attention" aria-label="近期待办">
    <div className="section-heading"><div><p className="section-kicker">逾期、今天与近期行动</p><h2>近期待办</h2></div><button className="text-button" onClick={onAll}>查看全部</button></div>
    <QueryState {...c.list} hasData={!!c.list.data} retry={c.list.reload} label="近期待办">
      <p className="workspace-count">共 {c.list.data?.total ?? 0} 条待处理，首页最多展示 5 条。</p>
      {rows.slice(0, 5).map((item) => <TodoRow key={item.id} action={c.latest(item)} timezone={timezone} busy={c.command.busy} onPrimary={primary} onOpen={c.select} onCommand={(action, kind) => { if (kind === "snooze") c.select(action.id); else void c.act(action, kind); }} />)}
      {rows.length === 0 && <p className="empty-note">近期没有待处理行动，可到列表查看后续安排和未定日期待办。</p>}
    </QueryState>
    {c.command.error && !c.selectedId && <p className="form-error" role="alert">{c.command.error}</p>}
    {c.selectedId && !editing && <TodoDetail key={c.selectedId} action={c.selected} loading={c.detail.loading} loadError={c.detail.error} error={c.command.error} busy={c.command.busy} timezone={timezone} serverNow={c.detail.meta?.serverNow ?? c.list.meta?.serverNow ?? new Date().toISOString()} onClose={() => c.select(null)} onRetry={c.detail.reload} onPrimary={primary} onAct={c.act} onEdit={setEditing} />}
    {editing && <CustomTodoForm key={editing.id} initial={c.latest(editing)} cards={c.list.data?.cards ?? []} timezone={timezone} busy={c.command.busy} error={c.command.error} onSave={(draft) => c.save(draft, editing)} onClose={() => setEditing(null)} />}
  </section>;
}
