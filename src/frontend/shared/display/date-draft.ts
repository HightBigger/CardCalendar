import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import type { DateValue } from "../../../contracts/workbench";
export type DateDraft = { kind: DateValue["kind"]; value: string };
export function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + "T00:00:00Z");
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function toDateDraft(value: DateValue, timezone: string): DateDraft {
  return { kind: value.kind, value: value.kind === "unknown" ? "" : value.kind === "date" ? value.value : formatInTimeZone(value.value, timezone, "yyyy-MM-dd'T'HH:mm") };
}
export function fromDateDraft(draft: DateDraft, timezone: string): DateValue {
  if (draft.kind === "unknown" || !draft.value) return { kind: "unknown", reason: "未设置日期" };
  if (draft.kind === "date") {
    const date = new Date(draft.value + "T00:00:00Z");
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== draft.value) throw new Error("请填写有效日期");
    return { kind: "date", value: draft.value, timezone };
  }
  const instant = fromZonedTime(draft.value, timezone);
  if (Number.isNaN(instant.getTime()) || formatInTimeZone(instant, timezone, "yyyy-MM-dd'T'HH:mm") !== draft.value) throw new Error("此日期时间无效，或处于夏令时跳过的时段，请重新选择");
  return { kind: "instant", value: instant.toISOString(), timezone };
}
export function tomorrowDate(serverNow: string, timezone: string): DateValue {
  const today = formatInTimeZone(serverNow, timezone, "yyyy-MM-dd");
  const date = new Date(today + "T00:00:00Z"); date.setUTCDate(date.getUTCDate() + 1);
  return { kind: "date", value: date.toISOString().slice(0, 10), timezone };
}
