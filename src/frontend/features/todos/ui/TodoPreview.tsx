"use client";

import type { TodoAction } from "../../../../contracts/todos";
import type { PrimaryAction } from "../../../../contracts/workbench";
import { businessDate } from "../../../shared/display/business";
import { typeLabels } from "../model/filters";

export function TodoPreview({ action, timezone, busy, onOpen, onPrimary }: {
  action: TodoAction;
  timezone: string;
  busy: boolean;
  onOpen: (id: string) => void;
  onPrimary: (action: PrimaryAction) => void;
}) {
  const date = action.deadline.kind !== "unknown" ? action.deadline : action.plannedFor;
  const dateLabel = date.kind === "unknown" ? "" : date.kind === "date"
    ? date.value.slice(5).replace("-", "/")
    : new Intl.DateTimeFormat("zh-CN", { timeZone: timezone, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(date.value));
  const context = action.card ? `${action.card.bank} · ${action.card.name}` : typeLabels[action.type];
  return <article className={`todo-preview${action.group === "overdue" ? " todo-preview-overdue" : ""}`} data-action-id={action.id} data-version={action.version}>
    <div className="todo-preview-main">
      <button className="todo-title" onClick={() => onOpen(action.id)}>{action.title}</button>
      <p><span>{context}</span>{dateLabel && <span title={businessDate(date, timezone)}>{dateLabel} {action.deadline.kind !== "unknown" ? "截止" : "计划"}</span>}</p>
      <span className="todo-preview-urgency">{action.urgency.label}</span>
    </div>
    <button className="text-button todo-preview-action" disabled={busy || !action.primaryAction.enabled} title={action.primaryAction.reason} onClick={() => onPrimary(action.primaryAction)}>{action.primaryAction.label}</button>
  </article>;
}
