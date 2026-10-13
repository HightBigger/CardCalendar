"use client";
import type { TodoFilters as Filters, TodoList, TodoStatus, TodoType } from "../../../../contracts/todos";
import { typeLabels } from "../model/filters";
export function TodoFilters({ filters, cards, update }: { filters: Filters; cards: TodoList["cards"]; update: (patch: Partial<Filters>) => void }) {
  return <form className="todo-filters" aria-label="待办筛选" onSubmit={(event) => event.preventDefault()}>
    <label className="todo-search">搜索<input type="search" placeholder="标题、卡名或活动" value={filters.q} onChange={(event) => update({ q: event.target.value })} /></label>
    <label>卡片<select value={filters.cardIds.length === 1 ? filters.cardIds[0] : ""} onChange={(event) => update({ cardIds: event.target.value ? [event.target.value] : [] })}><option value="">全部卡片{filters.cardIds.length > 1 ? "（已选 " + filters.cardIds.length + " 张）" : ""}</option>{cards.map((card) => <option key={card.id} value={card.id}>{card.bank} · {card.name} · {card.last4}</option>)}</select></label>
    <label>类型<select value={filters.types.length === 1 ? filters.types[0] : ""} onChange={(event) => update({ types: event.target.value ? [event.target.value as TodoType] : [] })}><option value="">全部类型{filters.types.length > 1 ? "（多选）" : ""}</option>{Object.entries(typeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    <label>处理状态<select value={filters.status} onChange={(event) => update({ status: event.target.value as TodoStatus })}><option value="pending">待处理</option><option value="completed">已完成</option><option value="ignored">已忽略</option><option value="cancelled">已取消</option></select></label>
    <label>日期从<input type="date" value={filters.from} onChange={(event) => update({ from: event.target.value })} /></label><label>日期至<input type="date" value={filters.to} min={filters.from || undefined} onChange={(event) => update({ to: event.target.value })} /></label>
    <label className="checkbox-label"><input type="checkbox" checked={filters.includeUndated} onChange={(event) => update({ includeUndated: event.target.checked })} />包含未定日期</label>
  </form>;
}
