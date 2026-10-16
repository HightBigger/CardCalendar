"use client";
import { useState } from "react";
import type { TodoAction } from "../../../../contracts/todos";
import type { PrimaryAction } from "../../../../contracts/workbench";
import { Icon, QueryState } from "../../../shared/ui";
import type { TodoWorkspaceController } from "../application/useTodoWorkspaceController";
import { TodoPreview } from "./TodoPreview";
import { TodoDetail } from "./TodoDetail";
import { CustomTodoForm } from "./CustomTodoForm";

export function TodoAttention({ controller: c, timezone, onPrimary, onAll }: { controller: TodoWorkspaceController; timezone: string; onPrimary: (action: PrimaryAction) => void; onAll: () => void }) {
  const [editing, setEditing] = useState<TodoAction | null>(null);
  const primary = (action: PrimaryAction) => { if (action.kind === "detail" && !action.participationId) c.select(action.resourceId); else onPrimary(action); };
  const rows = c.list.data?.groups.flatMap((group) => group.items) ?? [];
  return <section className="home-panel todo-attention" aria-label="近期待办">
    <div className="section-heading"><h2>近期待办</h2><button className="text-button" onClick={onAll}>查看全部 <Icon name="arrow" size={14} /></button></div>
    <QueryState {...c.list} hasData={!!c.list.data} retry={c.list.reload} label="近期待办">
      <div className="todo-preview-list">{rows.slice(0, 5).map((item) => <TodoPreview key={item.id} action={c.latest(item)} timezone={timezone} busy={c.command.busy} onPrimary={primary} onOpen={c.select} />)}</div>
      {rows.length === 0 && <div className="home-empty"><Icon name="check" size={22} /><p>近期没有要处理的事项。</p></div>}
    </QueryState>
    {c.command.error && !c.selectedId && <p className="form-error" role="alert">{c.command.error}</p>}
    {c.selectedId && !editing && <TodoDetail key={c.selectedId} action={c.selected} loading={c.detail.loading} loadError={c.detail.error} error={c.command.error} busy={c.command.busy} timezone={timezone} serverNow={c.detail.meta?.serverNow ?? c.list.meta?.serverNow ?? new Date().toISOString()} onClose={() => c.select(null)} onRetry={c.detail.reload} onPrimary={primary} onAct={c.act} onEdit={setEditing} />}
    {editing && <CustomTodoForm key={editing.id} initial={c.latest(editing)} cards={c.list.data?.cards ?? []} timezone={timezone} busy={c.command.busy} error={c.command.error} onSave={(draft) => c.save(draft, editing)} onClose={() => setEditing(null)} />}
  </section>;
}
