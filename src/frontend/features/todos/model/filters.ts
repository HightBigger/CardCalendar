import { TODO_TYPES, TodoFilters, TodoGroupKey, TodoType } from "../../../../contracts/todos";
export const groupLabels: Record<TodoGroupKey, string> = { overdue: "已逾期", today: "今天", week: "未来 7 天", later: "更晚", undated: "未定日期" };
export const typeLabels: Record<TodoType, string> = { annual_fee: "年费", enrollment: "报名", spend_period: "刷卡周期", reward_claim: "领奖", reward_receipt: "到账核对", custom: "自定义" };
export function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + "T00:00:00Z");
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function parseTodoFilters(params: URLSearchParams, defaultMonth: string): TodoFilters {
  const csv = (key: string) => Array.from(new Set((params.get(key) ?? "").split(",").filter(Boolean))).sort();
  const month = params.get("month") ?? defaultMonth;
  const status = params.get("status");
  return { view: params.get("view") === "calendar" ? "calendar" : "list", cardIds: csv("cardIds"), types: csv("types").filter((type): type is TodoType => TODO_TYPES.includes(type as TodoType)), status: status === "completed" || status === "ignored" || status === "cancelled" ? status : "pending", q: (params.get("q") ?? "").slice(0, 200), from: validDate(params.get("from") ?? "") ? params.get("from")! : "", to: validDate(params.get("to") ?? "") ? params.get("to")! : "", includeUndated: params.get("includeUndated") !== "false", month: /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : defaultMonth };
}
export function todoParams(filters: TodoFilters, calendar = false): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.cardIds.length) params.set("cardIds", [...filters.cardIds].sort().join(","));
  if (filters.types.length) params.set("types", [...filters.types].sort().join(","));
  params.set("status", filters.status);
  if (filters.q) params.set("q", filters.q);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  params.set("includeUndated", String(filters.includeUndated));
  if (calendar) params.set("month", filters.month);
  return params;
}
export function todoUrl(filters: TodoFilters, existing = new URLSearchParams()) {
  const params = new URLSearchParams(existing);
  for (const key of ["view", "cardIds", "types", "status", "q", "from", "to", "includeUndated", "month"]) params.delete(key);
  todoParams(filters, true).forEach((value, key) => params.set(key, value));
  params.set("view", filters.view);
  return "?" + params.toString();
}
// Gregorian cell layout only; grouping/urgency/date projection comes from the API.
export function monthCells(month: string): string[] {
  const first = new Date(month + "-01T00:00:00Z");
  const start = first.getUTCDate() - (first.getUTCDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(first); day.setUTCDate(start + index); return day.toISOString().slice(0, 10);
  });
}
export function adjacentMonth(month: string, delta: number) {
  const date = new Date(month + "-01T00:00:00Z"); date.setUTCMonth(date.getUTCMonth() + delta); return date.toISOString().slice(0, 7);
}
