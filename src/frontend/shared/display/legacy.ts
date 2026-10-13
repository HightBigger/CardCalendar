import type { ApiCard, ApiReminder } from "../../../contracts/mvp";
export const STATUS_LABEL: Record<string, string> = {
  pending: "待确认",
  waived: "已免除",
  charged: "已扣费",
  refunded: "已退费",
  not_applicable: "无需处理",
  open: "进行中",
  qualified: "已达标",
  closed: "已关闭",
  active: "使用中",
  suspended: "已停用",
  archived: "已归档",
  completed: "已完成",
  snoozed: "稍后处理",
  ignored: "已忽略",
};

export function fmtDate(value: string | null | undefined): string {
  if (!value) return "-";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value.replaceAll("-", "/");
  return new Date(value).toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

export function daysUntil(value: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(value);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

export function reminderOverdue(reminder: ApiReminder, now = new Date()): boolean {
  if (reminder.status !== "pending") return false;
  if (reminder.snoozedUntil && new Date(reminder.snoozedUntil).getTime() > now.getTime()) return false;
  return new Date(reminder.scheduledFor).getTime() <= now.getTime();
}

export function money(value: number | string | null | undefined, currency = "CNY"): string {
  const n = Number(value ?? 0);
  return currency === "CNY" ? "¥" + n.toLocaleString("zh-CN") : n.toLocaleString("zh-CN") + " " + currency;
}

export function ruleText(card: ApiCard): string {
  const rule = card.waiveRuleType;
  if (rule === "none") return "无条件免年费";
  if (rule === "custom") return card.customRuleText || "自定义规则";
  if (rule === "count") return "消费 " + String(card.targetCount ?? 0) + " 次";
  if (rule === "amount") return "消费 " + money(card.targetAmount) + " 免年费";
  if (rule === "count_and_amount") {
    return "消费 " + String(card.targetCount ?? 0) + " 次且满 " + money(card.targetAmount);
  }
  return "无免年费条件";
}

export function cardLabel(cardId: string, cards: ApiCard[]): string {
  const card = cards.find((item) => item.id === cardId);
  return card ? card.issuerName + " · " + card.name : cardId.slice(0, 8);
}
