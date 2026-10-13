import type { AllowedCommand, CardIdentity, DateValue, PrimaryAction, Resource } from "./workbench";
export const TODO_TYPES = ["annual_fee", "enrollment", "spend_period", "reward_claim", "reward_receipt", "custom"] as const;
export type TodoType = typeof TODO_TYPES[number];
export type TodoStatus = "pending" | "completed" | "ignored" | "cancelled";
export type TodoGroupKey = "overdue" | "today" | "week" | "later" | "undated";
export type TodoHistoryEntry = { id: string; command: string; occurredAt: string; note?: string; actor: string };
export type TodoAction = {
  id: string; version: number; title: string; description: string; type: TodoType; status: TodoStatus;
  card: CardIdentity | null; participationId?: string; activityName?: string; periodLabel?: string; rewardLabel?: string;
  deadline: DateValue; plannedFor: DateValue; expectedReceipt: DateValue; snoozedUntil: DateValue;
  group: TodoGroupKey; urgency: { label: string; overdueDays?: number }; priority: "normal" | "important";
  summary: string[]; primaryAction: PrimaryAction; allowedCommands: AllowedCommand[];
  source?: { label: string; url?: string; verifiedAt?: string | null }; history: TodoHistoryEntry[];
};
export type TodoFilters = {
  view: "list" | "calendar"; cardIds: string[]; types: TodoType[]; status: TodoStatus; q: string;
  from: string; to: string; includeUndated: boolean; month: string;
};
export type TodoList = { canCreateCustom?: boolean; coverage?: "catalog_only"; groups: { key: TodoGroupKey; count: number; items: TodoAction[] }[]; total: number; cards: CardIdentity[]; nextCursor?: string | null };
export type CalendarEntry =
  | { kind: "action"; id: string; date: string; action: TodoAction }
  | { kind: "marker"; id: string; date: string; title: string; card: CardIdentity | null; primaryAction: PrimaryAction; description: string };
export type TodoCalendar = { entries: CalendarEntry[]; undatedCount: number; total: number };
export type TodoCommit = { action: TodoAction; invalidated?: Resource[] };
export type CustomTodoDraft = { title: string; description: string; cardId?: string; deadline: DateValue; plannedFor: DateValue; priority: "normal" | "important" };
export type TodoCommand = { command: "complete" | "ignore" | "restore" | "snooze"; expectedVersion: number; snoozedUntil?: DateValue; note?: string };
