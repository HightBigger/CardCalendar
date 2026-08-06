import { FeeCycleType, WaiveRuleType } from "../fee-rules";
import { ISODate } from "../../shared/time";

export type CardStatus = "active" | "suspended" | "archived";
export interface Card {
  id: string; userId: string; issuerName: string; name: string; last4: string; status: CardStatus;
  annualFeeAmount: number; currency: string; feeCycleType: FeeCycleType; openedOn?: ISODate;
  feeMonth?: number; feeDay?: number; nextFeeDate: ISODate; waiveRuleType: WaiveRuleType;
  targetCount?: number; targetAmount?: number; customRuleText?: string; notes?: string;
  progressPeriodStart?: ISODate; progressPeriodEnd?: ISODate;
  createdAt: string; updatedAt: string; archivedAt?: string;
}

export interface CreateCardInput {
  issuerName: string; name: string; last4: string; annualFeeAmount?: number; currency?: string;
  feeCycleType: FeeCycleType; openedOn?: ISODate; feeMonth?: number; feeDay?: number;
  nextFeeDate: ISODate; waiveRuleType?: WaiveRuleType; targetCount?: number; targetAmount?: number;
  customRuleText?: string; notes?: string; progressPeriodStart?: ISODate; progressPeriodEnd?: ISODate;
}
