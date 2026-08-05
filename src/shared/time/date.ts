import { AppError } from "../errors";

export type ISODate = `${number}-${number}-${number}`;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isISODate(value: unknown): value is ISODate {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

export function assertISODate(value: unknown, field = "date"): ISODate {
  if (!isISODate(value)) throw new AppError("VALIDATION_ERROR", `${field} 必须是有效的 YYYY-MM-DD 日期`, 400, [{ field }]);
  return value;
}

export function parseISODate(value: string): Date {
  assertISODate(value);
  const [y, m, d] = value.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function formatISODate(value: Date): ISODate {
  return `${value.getUTCFullYear().toString().padStart(4, "0")}-${(value.getUTCMonth() + 1).toString().padStart(2, "0")}-${value.getUTCDate().toString().padStart(2, "0")}` as ISODate;
}

export function addDays(value: ISODate, days: number): ISODate {
  const d = parseISODate(value); d.setUTCDate(d.getUTCDate() + days); return formatISODate(d);
}

export function addYears(value: ISODate, years: number): ISODate {
  const d = parseISODate(value); const month = d.getUTCMonth(); const day = d.getUTCDate();
  d.setUTCDate(1); d.setUTCFullYear(d.getUTCFullYear() + years); d.setUTCMonth(month);
  const maxDay = new Date(Date.UTC(d.getUTCFullYear(), month + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, maxDay)); return formatISODate(d);
}

export function addMonths(value: ISODate, months: number): ISODate {
  const source = parseISODate(value); const day = source.getUTCDate();
  const target = new Date(Date.UTC(source.getUTCFullYear(), source.getUTCMonth() + months, 1));
  const maxDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, maxDay)); return formatISODate(target);
}

export function compareDates(a: ISODate, b: ISODate): number { return parseISODate(a).getTime() - parseISODate(b).getTime(); }
export function daysBetween(start: ISODate, end: ISODate): number { return Math.round((parseISODate(end).getTime() - parseISODate(start).getTime()) / 86400000); }
export function maxDate(a: ISODate, b: ISODate): ISODate { return compareDates(a, b) >= 0 ? a : b; }
export function minDate(a: ISODate, b: ISODate): ISODate { return compareDates(a, b) <= 0 ? a : b; }

/** Convert a local date/time to an instant while honoring the IANA timezone. */
export function localDateTimeToInstant(date: ISODate, hour: number, timezone: string): Date {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw new RangeError("hour must be 0..23");
  // Iteratively resolve the offset using Intl; this avoids a date-library dependency for the MVP.
  let utc = parseISODate(date).getTime() + hour * 3600000;
  for (let i = 0; i < 3; i += 1) {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23", minute: "2-digit" }).formatToParts(new Date(utc));
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
    const localAsUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
    utc += parseISODate(date).getTime() + hour * 3600000 - localAsUtc;
  }
  return new Date(utc);
}

export function todayInTimezone(timezone: string, now = new Date()): ISODate {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}` as ISODate;
}
