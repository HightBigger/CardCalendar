"use client";
import { useState } from "react";
import type { CalendarEntry, TodoAction, TodoFilters } from "../../../../contracts/todos";
import type { PrimaryAction } from "../../../../contracts/workbench";
import { adjacentMonth, monthCells } from "../model/filters";
export function TodoCalendar({ filters, entries, undated, update, onOpen, onPrimary, latest }: { filters: TodoFilters; entries: CalendarEntry[]; undated: number; update: (patch: Partial<TodoFilters>) => void; onOpen: (id: string) => void; onPrimary: (action: PrimaryAction) => void; latest: (action: TodoAction) => TodoAction }) {
  const [selected, setSelected] = useState<string | null>(null);
  const cells = monthCells(filters.month);
  return <section className="todo-calendar" aria-label="待办日历">
    <div className="calendar-toolbar"><button className="text-button" aria-label="上个月" onClick={() => update({ month: adjacentMonth(filters.month, -1) })}>←</button><label>显示月份<input type="month" value={filters.month} onChange={(event) => { if (event.target.value) { setSelected(null); update({ month: event.target.value }); } }} /></label><button className="text-button" aria-label="下个月" onClick={() => update({ month: adjacentMonth(filters.month, 1) })}>→</button><span>行动可处理 · 日期标记仅供查看</span></div>
    {undated > 0 && <button className="undated-link text-button" onClick={() => update({ view: "list" })}>{undated} 条未定日期待办 · 到列表核对</button>}
    <div className="todo-month" role="grid" aria-label={filters.month + " 月历"}><div role="row" className="todo-weekdays">{["一", "二", "三", "四", "五", "六", "日"].map((day) => <div key={day} role="columnheader">{day}</div>)}</div>{Array.from({ length: 6 }, (_, week) => <div className="todo-week" role="row" key={week}>{cells.slice(week * 7, week * 7 + 7).map((date) => {
      const dayEntries = entries.filter((entry) => entry.date === date);
      return <div role="gridcell" className={"todo-cell" + (!date.startsWith(filters.month) ? " outside-month" : "")} key={date}><button className="todo-day" aria-label={date + "，" + dayEntries.length + " 项"} aria-pressed={selected === date} onClick={() => setSelected(date)}>{Number(date.slice(8))}<small>{dayEntries.length > 0 ? dayEntries.length + " 项" : ""}</small></button><div className="todo-cell-events">{dayEntries.slice(0, 3).map((entry) => <button key={entry.id} className={"todo-calendar-entry " + entry.kind} data-action-id={entry.kind === "action" ? entry.action.id : undefined} data-version={entry.kind === "action" ? latest(entry.action).version : undefined} onClick={() => entry.kind === "action" ? onOpen(entry.action.id) : onPrimary(entry.primaryAction)}>{entry.kind === "marker" ? "日期标记 · " + entry.title : ({ pending: "待处理", completed: "已处理", ignored: "已忽略", cancelled: "已取消" }[latest(entry.action).status] + " · " + latest(entry.action).title)}</button>)}{dayEntries.length > 3 && <small>另有 {dayEntries.length - 3} 项</small>}</div></div>;
    })}</div>)}</div>
    {selected && <section className="calendar-day-detail" aria-label={selected + " 当天事项"}><h2>{selected} · 当天事项</h2>{entries.filter((entry) => entry.date === selected).length === 0 && <p>当天没有事项。</p>}{entries.filter((entry) => entry.date === selected).map((entry) => <div className="calendar-day-row" key={entry.id}><span>{entry.kind === "marker" ? "业务日期标记" : "待办行动"}</span><strong>{entry.kind === "marker" ? entry.title : latest(entry.action).title}</strong><button className="text-button" onClick={() => entry.kind === "action" ? onOpen(entry.action.id) : onPrimary(entry.primaryAction)}>查看详情</button></div>)}</section>}
  </section>;
}
