import type { DateValue } from "../../../contracts/workbench";
export function businessDate(value: DateValue, displayTimezone: string): string {
  if (value.kind === "unknown") return "待核对" + (value.reason ? " · " + value.reason : "");
  if (value.kind === "date") return value.value + "（" + value.timezone + "）";
  return new Intl.DateTimeFormat("zh-CN", { timeZone: displayTimezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value.value)) + "（" + displayTimezone + "）";
}
export function displayAmount(value: string | null, currency: string) {
  if (value === null) return "金额待核对";
  return currency === "CNY" ? "¥" + value : value + " " + currency;
}
export function safeOfficialUrl(value?: string): string | undefined {
  if (!value) return;
  try { const url = new URL(value); if (url.protocol === "https:" && !url.username && !url.password) return url.href; } catch { /* Invalid links are displayed as text only. */ }
}
