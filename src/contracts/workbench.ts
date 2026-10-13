export type Resource = "cards" | "annual-fees" | "notifications" | "settings" | "todos" | "activities" | "spend-tasks" | "rewards" | "jobs" | "activity-catalog" | "catalog-admin" | "session-capabilities";
export type QueryMeta = {
  serverNow: string;
  timezone: string;
  nextBoundaryAt?: string | null;
  asOf: string;
  sourceVersion?: number;
  nextCursor?: string | null;
};
export type Envelope<T> = { data: T; meta?: QueryMeta };
export type CommandResult<T> =
  | { kind: "committed"; data: T; meta?: QueryMeta }
  | { kind: "queued"; jobId: string; status: "queued"; meta?: QueryMeta };
export type Job = { id: string; status: "queued" | "running" | "succeeded" | "failed"; progress: number; message?: string; retryable?: boolean };
export type DateValue =
  | { kind: "date"; value: string; timezone: string }
  | { kind: "instant"; value: string; timezone: string }
  | { kind: "unknown"; reason: string };
export type CardIdentity = { id: string; bank: string; name: string; last4: string };
export type AllowedCommand = { kind: string; enabled: boolean; reason?: string };
export type PrimaryAction = {
  kind: "annual_fee" | "progress" | "qualification" | "enrollment" | "reward_conditions" | "claim" | "claim_result" | "receipt" | "detail";
  resourceId: string;
  label: string;
  enabled: boolean;
  reason?: string;
  officialUrl?: string;
  participationId?: string;
};
