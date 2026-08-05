import { addMonths, addYears, assertISODate, compareDates, ISODate, parseISODate, formatISODate } from "../../shared/time";

export type FeeCycleType = "anniversary" | "fixed_date" | "custom";
export type WaiveRuleType = "none" | "count" | "amount" | "count_and_amount" | "custom";

export interface FeeRule {
  cycleType: FeeCycleType;
  openedOn?: ISODate;
  feeMonth?: number;
  feeDay?: number;
  nextFeeDate: ISODate;
}

export function feeDateForYear(month: number, day: number, year: number): ISODate {
  if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(day) || day < 1 || day > 31) {
    throw new RangeError("年费月份和日期无效");
  }
  const max = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return formatISODate(new Date(Date.UTC(year, month - 1, Math.min(day, max))));
}

export function feeDueDateOnOrAfter(rule: FeeRule, date: ISODate): ISODate {
  assertISODate(date); assertISODate(rule.nextFeeDate);
  if (rule.cycleType === "custom") {
    let result = rule.nextFeeDate;
    while (compareDates(result, date) < 0) result = addYears(result, 1);
    return result;
  }
  if (rule.cycleType === "anniversary") {
    if (!rule.openedOn) throw new RangeError("周年年费规则必须提供开卡日期");
    const opened = parseISODate(rule.openedOn);
    const target = parseISODate(date);
    let result = addYears(rule.openedOn, target.getUTCFullYear() - opened.getUTCFullYear());
    if (compareDates(result, date) < 0) result = addYears(result, 1);
    return result;
  }
  if (!rule.feeMonth || !rule.feeDay) throw new RangeError("固定日期规则必须提供月份和日期");
  const year = parseISODate(date).getUTCFullYear();
  let result = feeDateForYear(rule.feeMonth, rule.feeDay, year);
  if (compareDates(result, date) < 0) result = feeDateForYear(rule.feeMonth, rule.feeDay, year + 1);
  return result;
}

export function generateFeeDates(rule: FeeRule, from: ISODate, months = 12): ISODate[] {
  if (months < 1 || months > 120) throw new RangeError("months 必须在 1 到 120 之间");
  const result: ISODate[] = []; const horizon = addMonths(from, months); let cursor = feeDueDateOnOrAfter(rule, from);
  while (compareDates(cursor, horizon) <= 0) { result.push(cursor); cursor = addYears(cursor, 1); }
  return result;
}
