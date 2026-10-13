// Existing MVP wire contracts; independent of React and server modules.
export type ApiUser = {
  id: string;
  email: string;
  name?: string | null;
  timezone: string;
  status: string;
  deletedAt?: string | null;
  deletionRequestedAt?: string | null;
  deletionCleanupCompletedAt?: string | null;
  deletionCleanupResult?: Record<string, unknown> | null;
  deletionRetryCount?: number | null;
};

export type ApiCard = {
  id: string;
  issuerName: string;
  name: string;
  last4: string;
  status: "active" | "suspended" | "archived";
  annualFeeAmount: number | string;
  currency: string;
  feeCycleType: "anniversary" | "fixed_date" | "custom";
  openedOn?: string | null;
  feeMonth?: number | null;
  feeDay?: number | null;
  nextFeeDate: string;
  waiveRuleType: string;
  targetCount?: number | null;
  targetAmount?: number | string | null;
  customRuleText?: string | null;
  notes?: string | null;
  progressPeriodStart?: string | null;
  progressPeriodEnd?: string | null;
  createdAt: string;
  updatedAt?: string;
};

export type CardSummary = ApiCard & {
  nextEvent?: {
    id: string;
    dueDate: string;
    status: string;
  } | null;
  progress?: {
    qualified: boolean;
    percentage: number;
    count: number;
    amount: number;
    remainingCount?: number;
    remainingAmount?: number;
  } | null;
};

export type ApiCycle = {
  id: string;
  cardId: string;
  periodStart: string;
  periodEnd: string;
  feeDueDate: string;
  waiveRuleType: string;
  targetCount?: number | null;
  targetAmount?: number | string | null;
  status: "open" | "qualified" | "closed";
};

export type ApiFeeEvent = {
  id: string;
  cardId: string;
  cycleId: string;
  dueDate: string;
  expectedAmount: number | string;
  status: string;
  actualAmount?: number | string | null;
  occurredOn?: string | null;
  notes?: string | null;
};

export type ApiFeeEventHistory = {
  id: string;
  action: string;
  occurredAt: string;
  metadata: {
    fromStatus?: string;
    toStatus?: string;
    actualAmount?: number | string | null;
    occurredOn?: string | null;
    notes?: string | null;
  };
};

export type ApiFeeEventTimeline = {
  history: ApiFeeEventHistory[];
  reminders: ApiReminder[];
};

export type ApiReminder = {
  id: string;
  cardId?: string | null;
  feeEventId?: string | null;
  feeCycleId?: string | null;
  kind: string;
  daysBefore: number;
  scheduledFor: string;
  status: string;
  snoozedUntil?: string | null;
  completedAt?: string | null;
};

export type ApiReminderRule = {
  id: string;
  kind: string;
  daysBefore: number;
  enabled: boolean;
};

export type ProgressEntry = {
  id: string;
  cycleId: string;
  entryDate: string;
  countDelta: number;
  amountDelta: number;
  note?: string | null;
  entryType?: "manual" | "correction" | "reversal";
  reversedAt?: string;
  createdAt?: string;
};

export type ProgressData = {
  cycle: ApiCycle;
  entries: ProgressEntry[];
  progress: {
    count: number;
    amount: number;
    percentage: number;
    qualified: boolean;
    remainingCount?: number;
    remainingAmount?: number;
  };
};

export type CardDetail = {
  card: ApiCard;
  cycles: ApiCycle[];
  progress: Record<string, ProgressData>;
  eventHistory: Record<string, ApiFeeEventHistory[]>;
  reminderTimeline: Record<string, ApiReminder[]>;
};

export type CardDraft = {
  // Archive and restore use dedicated lifecycle commands.
  status?: "active" | "suspended";
  currency?: string;
  notes?: string;
  progressPeriodStart?: string;
  progressPeriodEnd?: string;
  issuerName: string;
  name: string;
  last4: string;
  annualFeeAmount: number;
  nextFeeDate: string;
  feeCycleType: "anniversary" | "fixed_date" | "custom";
  openedOn?: string;
  feeMonth?: number;
  feeDay?: number;
  waiveRuleType: "none" | "count" | "amount" | "count_and_amount" | "custom";
  targetCount?: number;
  targetAmount?: number;
  customRuleText?: string;
};
