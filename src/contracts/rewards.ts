import type { RewardSummary } from "./activities";
import type { AllowedCommand, DateValue, Resource } from "./workbench";
export type Reward = RewardSummary & {
  participationId: string; periodId: string | null; currency: string; quantity: string | null; unit: string;
  acquisition: "manual" | "automatic" | "unknown"; windowStatus: "not_open" | "open" | "closed" | "unknown";
  claimStart: DateValue; claimDeadline: DateValue; channel: string; officialUrl?: string; instructions: string;
  expectedReceipt: DateValue; receiptRuleText: string; receivedText: string; remainingText: string;
  conditions: { label: string; status: "unknown" | "not_met" | "met"; reason?: string; periodId?: string; taskId?: string }[];
  claimAttempts: { id: string; version: number; status: string; occurredAt: string; note: string }[];
  receipts: { id: string; receivedOn: string; quantity: string; note: string }[];
  allowedCommands: AllowedCommand[];
};
export type RewardWrite = { reward: Reward; invalidated?: Resource[] };
export type RewardDraft = { name: string; type: "cashback" | "points" | "gift" | "other"; quantity: string | null; unit: string; currency: string; scope: "period" | "all_periods" | "overall"; periodId?: string; requiredPeriodIds: string[]; overallTaskId?: string; acquisition: Reward["acquisition"]; claimStart: DateValue; claimDeadline: DateValue; expectedReceipt: DateValue; channel: string; officialUrl?: string; instructions: string; receiptRuleText: string; participationVersion: number; ruleVersionId: string };
