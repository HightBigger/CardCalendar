import { AppError } from "../../shared/errors";
import { WaiveRuleType } from "../fee-rules";

export interface ProgressRule { type: WaiveRuleType; targetCount?: number; targetAmount?: number; }
export interface ProgressValue { count: number; amount: number; }
export interface ProgressResult extends ProgressValue { remainingCount?: number; remainingAmount?: number; percentage: number; qualified: boolean; }

function condition(rule: ProgressRule, value: ProgressValue, kind: "count" | "amount"): boolean {
  return kind === "count" ? (rule.targetCount === undefined || value.count >= rule.targetCount) : (rule.targetAmount === undefined || value.amount >= rule.targetAmount);
}

export function calculateProgress(rule: ProgressRule, value: ProgressValue): ProgressResult {
  if (!Number.isFinite(value.count) || value.count < 0 || !Number.isFinite(value.amount) || value.amount < 0) throw new AppError("VALIDATION_ERROR", "进度值必须为非负数字");
  const hasCount = rule.type === "count" || rule.type === "count_and_amount";
  const hasAmount = rule.type === "amount" || rule.type === "count_and_amount";
  const countPct = hasCount && rule.targetCount ? value.count / rule.targetCount : 1;
  const amountPct = hasAmount && rule.targetAmount ? value.amount / rule.targetAmount : 1;
  const qualified = rule.type === "none" ? true : rule.type === "custom" ? false : (rule.type === "count_and_amount" ? condition(rule, value, "count") && condition(rule, value, "amount") : hasCount ? condition(rule, value, "count") : condition(rule, value, "amount"));
  const percentage = rule.type === "none" ? 100 : rule.type === "custom" ? 0 : rule.type === "count_and_amount" ? Math.min(countPct, amountPct) : hasCount ? countPct : amountPct;
  return {
    count: value.count, amount: value.amount,
    ...(hasCount && rule.targetCount !== undefined ? { remainingCount: Math.max(0, rule.targetCount - value.count) } : {}),
    ...(hasAmount && rule.targetAmount !== undefined ? { remainingAmount: Math.max(0, rule.targetAmount - value.amount) } : {}),
    percentage: Math.min(100, Math.round(percentage * 100)), qualified,
  };
}

export function applyProgressEntry(current: ProgressValue, delta: ProgressValue): ProgressValue {
  if (!Number.isInteger(delta.count) || !Number.isFinite(delta.amount)) throw new AppError("VALIDATION_ERROR", "增量必须为数字");
  return { count: current.count + delta.count, amount: Number((current.amount + delta.amount).toFixed(2)) };
}
