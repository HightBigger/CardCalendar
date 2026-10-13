import type { AllowedCommand, Resource } from "./workbench";
export type SpendTask = {
  id: string; version: number; participationId: string; periodId: string | null; cardId: string; name: string; currency: string;
  mode: "snapshot" | "entries"; modeLocked: boolean; targetText: string; countingBasisText: string; startOn: string; endOn: string; timezone: string;
  confirmed: { count: number; amount: string; text: string }; pending: { count: number; amount: string; text: string };
  remaining: { count: number | null; amount: string | null; text: string }; progressStatus: string; progressStatusText: string; qualificationStatus: string; qualificationText: string; reviewText: string;
  entries: { id: string; occurredOn: string; postedOn?: string; settledOn?: string; count: number; amount: string; stage: string; note: string; evaluatedTaskIds: string[] }[];
  qualificationScope: { scope: "participation" | "period"; periodId?: string };
  availableFacts: { id: string; label: string }[];
  observations: { id: string; observedOn: string; count: number; amount: string; stage?: "unknown" | "occurred" | "posted" | "settled"; note: string }[];
  allowedCommands: AllowedCommand[]; canLinkFacts: boolean; linkDisabledReason?: string;
};
export type SpendWrite = { task: SpendTask; invalidated?: Resource[] };
export type SpendDraft = { count: number; amount: string; occurredOn: string; stage: "occurred" | "posted" | "settled"; note: string; postedOn?: string; settledOn?: string; channel?: string };
