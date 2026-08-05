import { addYears, compareDates, ISODate } from "../../shared/time";
import { FeeRule, WaiveRuleType } from "../fee-rules";

export interface FeeCycle {
  id: string;
  cardId: string;
  periodStart: ISODate;
  periodEnd: ISODate;
  feeDueDate: ISODate;
  waiveRuleType: WaiveRuleType;
  targetCount?: number;
  targetAmount?: number;
  status: "open" | "qualified" | "closed";
}

export function cycleForFeeDate(cardId: string, feeDate: ISODate, rule: Pick<FeeRule, "cycleType" | "openedOn"> & { waiveRuleType: WaiveRuleType; targetCount?: number; targetAmount?: number }, id = crypto.randomUUID()): FeeCycle {
  const periodEnd = feeDate;
  const periodStart = rule.cycleType === "anniversary" && rule.openedOn ? addYears(feeDate, -1) : addYears(feeDate, -1);
  return { id, cardId, periodStart, periodEnd, feeDueDate: feeDate, waiveRuleType: rule.waiveRuleType, targetCount: rule.targetCount, targetAmount: rule.targetAmount, status: "open" };
}

export function cycleContains(cycle: FeeCycle, date: ISODate): boolean {
  return compareDates(date, cycle.periodStart) >= 0 && compareDates(date, cycle.periodEnd) < 0;
}

export function nextCycle(cycle: FeeCycle): FeeCycle {
  const start = addYears(cycle.periodStart, 1); const end = addYears(cycle.periodEnd, 1);
  return { ...cycle, id: crypto.randomUUID(), periodStart: start, periodEnd: end, feeDueDate: end, status: "open" };
}

