import { AppError } from "../../shared/errors";
import { ISODate } from "../../shared/time";

export type FeeEventStatus = "pending" | "waived" | "charged" | "refunded" | "not_applicable";
export interface FeeEvent { id: string; userId: string; cardId: string; cycleId: string; dueDate: ISODate; expectedAmount: number; status: FeeEventStatus; actualAmount?: number; occurredOn?: ISODate; notes?: string; resolvedAt?: string; createdAt: string; updatedAt: string; }

export interface FeeEventStatusInput { status: FeeEventStatus; actualAmount?: number; occurredOn?: ISODate; notes?: string; }

export function validateFeeEventStatus(input: FeeEventStatusInput): FeeEventStatusInput {
  if (!["pending", "waived", "charged", "refunded", "not_applicable"].includes(input.status)) throw new AppError("VALIDATION_ERROR", "年费状态无效");
  if ((input.status === "charged" || input.status === "refunded") && (input.actualAmount === undefined || input.occurredOn === undefined)) throw new AppError("VALIDATION_ERROR", "已扣费或已退费必须填写实际金额和发生日期");
  if (input.actualAmount !== undefined && (!Number.isFinite(input.actualAmount) || input.actualAmount < 0)) throw new AppError("VALIDATION_ERROR", "实际金额必须为非负数字");
  return input;
}

