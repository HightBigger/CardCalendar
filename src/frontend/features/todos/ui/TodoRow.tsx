"use client";
import type { TodoAction, TodoCommand } from "../../../../contracts/todos";
import type { PrimaryAction } from "../../../../contracts/workbench";
import { businessDate } from "../../../shared/display/business";
import { typeLabels } from "../model/filters";
const labels: Record<string, string> = { complete: "标记已处理", ignore: "忽略", restore: "恢复待办", snooze: "稍后处理" };
export function TodoRow({ action, timezone, busy, onOpen, onPrimary, onCommand }: {
  action: TodoAction; timezone: string; busy: boolean; onOpen: (id: string) => void; onPrimary: (action: PrimaryAction) => void; onCommand: (action: TodoAction, kind: TodoCommand["command"]) => void;
}) {
  return <article className={"todo-row " + (action.group === "overdue" && action.status === "pending" ? "todo-overdue" : "")} data-action-id={action.id} data-version={action.version}>
    <div className="todo-identity"><span className="todo-type">{typeLabels[action.type]}</span><button className="todo-title" onClick={() => onOpen(action.id)}>{action.title}</button><p>{[action.card ? action.card.bank + " · " + action.card.name + " · 尾号 " + action.card.last4 : "个人待办", action.activityName, action.periodLabel, action.rewardLabel].filter(Boolean).join(" / ")}</p><p className="todo-summary">{action.summary.join(" · ")}</p></div>
    <div className="todo-date"><strong>{action.urgency.label}</strong>{action.deadline.kind !== "unknown" && <span>硬性截止：{businessDate(action.deadline, timezone)}</span>}{action.plannedFor.kind !== "unknown" && <span>计划处理：{businessDate(action.plannedFor, timezone)}</span>}{action.deadline.kind === "unknown" && action.plannedFor.kind === "unknown" && <span>日期待核对</span>}{action.snoozedUntil.kind !== "unknown" && <span>下次提示：{businessDate(action.snoozedUntil, timezone)}</span>}<small>{action.priority === "important" ? "重要" : "普通"} · {{ pending: "待处理", completed: "已处理", ignored: "已忽略", cancelled: "已取消" }[action.status]}</small></div>
    <div className="todo-actions"><button className="secondary-button" disabled={busy || !action.primaryAction.enabled} title={action.primaryAction.reason} onClick={() => onPrimary(action.primaryAction)}>{action.primaryAction.label}</button>{!action.primaryAction.enabled && action.primaryAction.reason && <small>{action.primaryAction.reason}</small>}<details className="todo-more"><summary>更多操作</summary><div>{action.allowedCommands.filter((entry) => labels[entry.kind]).map((entry) => <button key={entry.kind} className="text-button" disabled={busy || !entry.enabled} title={entry.reason} onClick={() => onCommand(action, entry.kind as TodoCommand["command"])}>{labels[entry.kind]}</button>)}<button className="text-button" onClick={() => onOpen(action.id)}>来源与历史</button></div></details></div>
  </article>;
}
