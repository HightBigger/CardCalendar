import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  char,
  check,
  customType,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/** PostgreSQL citext keeps email uniqueness case-insensitive at the database boundary. */
const citext = customType<{ data: string }>({ dataType: () => "citext" });

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .defaultNow()
    .notNull(),
};

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    email: citext("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    name: text("name"),
    timezone: text("timezone").notNull().default("Asia/Shanghai"),
    status: text("status").notNull().default("active"),
    ...timestamps,
    deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" }),
    deletionRequestedAt: timestamp("deletion_requested_at", { withTimezone: true, mode: "date" }),
    deletionCleanupCompletedAt: timestamp("deletion_cleanup_completed_at", { withTimezone: true, mode: "date" }),
    deletionCleanupResult: jsonb("deletion_cleanup_result")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    deletionRetryCount: integer("deletion_retry_count").notNull().default(0),
  },
  (table) => ({
    emailUnique: uniqueIndex("users_email_unique").on(table.email),
    statusCheck: check(
      "users_status_check",
      sql`${table.status} in ('active', 'deletion_requested', 'anonymized')`,
    ),
  }),
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: char("token_hash", { length: 64 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true, mode: "date" }),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
    ...timestamps,
    createdIpHash: text("created_ip_hash"),
  },
  (table) => ({
    tokenHashUnique: uniqueIndex("sessions_token_hash_unique").on(table.tokenHash),
    activeByUser: index("sessions_user_active_idx")
      .on(table.userId, table.expiresAt)
      .where(sql`${table.revokedAt} is null`),
    expiryCheck: check("sessions_expiry_check", sql`${table.expiresAt} > ${table.createdAt}`),
    tokenHashCheck: check("sessions_token_hash_check", sql`${table.tokenHash} ~ '^[0-9a-f]{64}$'`),
  }),
);

export const cards = pgTable(
  "cards",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    issuerName: text("issuer_name").notNull(),
    name: text("name").notNull(),
    last4: char("last4", { length: 4 }).notNull(),
    status: text("status").notNull().default("active"),
    annualFeeAmount: numeric("annual_fee_amount", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    currency: char("currency", { length: 3 }).notNull().default("CNY"),
    feeCycleType: text("fee_cycle_type").notNull(),
    openedOn: date("opened_on", { mode: "string" }),
    feeMonth: integer("fee_month"),
    feeDay: integer("fee_day"),
    nextFeeDate: date("next_fee_date", { mode: "string" }).notNull(),
    waiveRuleType: text("waive_rule_type").notNull().default("none"),
    targetCount: integer("target_count"),
    targetAmount: numeric("target_amount", { precision: 14, scale: 2 }),
    progressPeriodStart: date("progress_period_start", { mode: "string" }),
    progressPeriodEnd: date("progress_period_end", { mode: "string" }),
    customRuleText: text("custom_rule_text"),
    notes: text("notes"),
    ...timestamps,
    archivedAt: timestamp("archived_at", { withTimezone: true, mode: "date" }),
  },
  (table) => ({
    userStatus: index("cards_user_status_idx").on(table.userId, table.status, table.createdAt),
    userFeeDate: index("cards_user_fee_date_idx")
      .on(table.userId, table.nextFeeDate)
      .where(sql`${table.status} <> 'archived'`),
    userSearch: index("cards_user_search_idx").on(
      table.userId,
      table.issuerName,
      table.name,
      table.last4,
    ),
    last4Check: check("cards_last4_check", sql`${table.last4} ~ '^[0-9]{4}$'`),
    issuerCheck: check("cards_issuer_name_check", sql`length(trim(${table.issuerName})) between 1 and 100`),
    nameCheck: check("cards_name_check", sql`length(trim(${table.name})) between 1 and 120`),
    statusCheck: check(
      "cards_status_check",
      sql`${table.status} in ('active', 'suspended', 'archived')`,
    ),
    feeAmountCheck: check("cards_fee_amount_check", sql`${table.annualFeeAmount} >= 0`),
    currencyCheck: check("cards_currency_check", sql`${table.currency} ~ '^[A-Z]{3}$'`),
    cycleCheck: check(
      "cards_cycle_check",
      sql`(${table.feeCycleType} = 'anniversary' and ${table.openedOn} is not null)
        or (${table.feeCycleType} = 'fixed_date' and ${table.feeMonth} between 1 and 12 and ${table.feeDay} between 1 and 31)
        or (${table.feeCycleType} = 'custom')`,
    ),
    ruleTypeCheck: check(
      "cards_waive_rule_type_check",
      sql`${table.waiveRuleType} in ('none', 'count', 'amount', 'count_and_amount', 'custom')`,
    ),
    targetCountCheck: check(
      "cards_target_count_check",
      sql`${table.targetCount} is null or ${table.targetCount} >= 0`,
    ),
    targetAmountCheck: check(
      "cards_target_amount_check",
      sql`${table.targetAmount} is null or ${table.targetAmount} >= 0`,
    ),
    periodCheck: check(
      "cards_progress_period_check",
      sql`${table.progressPeriodStart} is null or ${table.progressPeriodEnd} is null or ${table.progressPeriodEnd} >= ${table.progressPeriodStart}`,
    ),
    ruleTargetCheck: check(
      "cards_rule_target_check",
      sql`(${table.waiveRuleType} not in ('count', 'count_and_amount') or ${table.targetCount} is not null)
        and (${table.waiveRuleType} not in ('amount', 'count_and_amount') or ${table.targetAmount} is not null)
        and (${table.waiveRuleType} <> 'custom' or nullif(trim(${table.customRuleText}), '') is not null)`,
    ),
  }),
);

export const feeCycles = pgTable(
  "fee_cycles",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    cardId: uuid("card_id")
      .notNull()
      .references(() => cards.id, { onDelete: "restrict" }),
    periodStart: date("period_start", { mode: "string" }).notNull(),
    periodEnd: date("period_end", { mode: "string" }).notNull(),
    feeDueDate: date("fee_due_date", { mode: "string" }).notNull(),
    waiveRuleType: text("waive_rule_type").notNull(),
    targetCount: integer("target_count"),
    targetAmount: numeric("target_amount", { precision: 14, scale: 2 }),
    customRuleText: text("custom_rule_text"),
    status: text("status").notNull().default("open"),
    ...timestamps,
  },
  (table) => ({
    cardPeriodUnique: uniqueIndex("fee_cycles_card_period_unique").on(
      table.cardId,
      table.periodStart,
      table.periodEnd,
    ),
    userPeriod: index("fee_cycles_user_period_idx").on(table.userId, table.periodStart),
    periodCheck: check("fee_cycles_period_check", sql`${table.periodEnd} >= ${table.periodStart}`),
    statusCheck: check(
      "fee_cycles_status_check",
      sql`${table.status} in ('open', 'qualified', 'closed')`,
    ),
    ruleTypeCheck: check(
      "fee_cycles_rule_type_check",
      sql`${table.waiveRuleType} in ('none', 'count', 'amount', 'count_and_amount', 'custom')`,
    ),
    targetCountCheck: check(
      "fee_cycles_target_count_check",
      sql`${table.targetCount} is null or ${table.targetCount} >= 0`,
    ),
    targetAmountCheck: check(
      "fee_cycles_target_amount_check",
      sql`${table.targetAmount} is null or ${table.targetAmount} >= 0`,
    ),
    customRuleCheck: check(
      "fee_cycles_custom_rule_check",
      sql`${table.waiveRuleType} <> 'custom' or nullif(trim(${table.customRuleText}), '') is not null`,
    ),
    ruleTargetCheck: check(
      "fee_cycles_rule_target_check",
      sql`(${table.waiveRuleType} not in ('count', 'count_and_amount') or ${table.targetCount} is not null)
        and (${table.waiveRuleType} not in ('amount', 'count_and_amount') or ${table.targetAmount} is not null)`,
    ),
  }),
);

export const feeEvents = pgTable(
  "fee_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    cardId: uuid("card_id")
      .notNull()
      .references(() => cards.id, { onDelete: "restrict" }),
    feeCycleId: uuid("fee_cycle_id")
      .notNull()
      .references(() => feeCycles.id, { onDelete: "restrict" }),
    dueDate: date("due_date", { mode: "string" }).notNull(),
    expectedAmount: numeric("expected_amount", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    status: text("status").notNull().default("pending"),
    actualAmount: numeric("actual_amount", { precision: 14, scale: 2 }),
    occurredOn: date("occurred_on", { mode: "string" }),
    notes: text("notes"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true, mode: "date" }),
    ...timestamps,
  },
  (table) => ({
    cycleUnique: uniqueIndex("fee_events_cycle_unique").on(table.feeCycleId),
    userDue: index("fee_events_user_due_idx").on(table.userId, table.dueDate, table.status),
    cardDue: index("fee_events_card_due_idx").on(table.cardId, table.dueDate),
    statusCheck: check(
      "fee_events_status_check",
      sql`${table.status} in ('pending', 'waived', 'charged', 'refunded', 'not_applicable')`,
    ),
    amountCheck: check(
      "fee_events_actual_amount_check",
      sql`${table.actualAmount} is null or ${table.actualAmount} >= 0`,
    ),
    resolutionCheck: check(
      "fee_events_resolution_check",
      sql`(${table.status} not in ('charged', 'refunded') or (${table.actualAmount} is not null and ${table.occurredOn} is not null))
        and (${table.status} in ('pending', 'waived') or ${table.resolvedAt} is not null)`,
    ),
  }),
);

export const progressEntries = pgTable(
  "progress_entries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    cardId: uuid("card_id")
      .notNull()
      .references(() => cards.id, { onDelete: "restrict" }),
    feeCycleId: uuid("fee_cycle_id")
      .notNull()
      .references(() => feeCycles.id, { onDelete: "restrict" }),
    entryDate: date("entry_date", { mode: "string" }).notNull(),
    countDelta: integer("count_delta").notNull().default(0),
    amountDelta: numeric("amount_delta", { precision: 14, scale: 2 }).notNull().default("0"),
    entryType: text("entry_type").notNull().default("manual"),
    note: text("note"),
    ...timestamps,
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    reversedAt: timestamp("reversed_at", { withTimezone: true, mode: "date" }),
  },
  (table) => ({
    cycleDate: index("progress_entries_cycle_date_idx").on(
      table.feeCycleId,
      table.entryDate,
      table.createdAt,
    ),
    userCard: index("progress_entries_user_card_idx").on(
      table.userId,
      table.cardId,
      table.entryDate,
    ),
    deltaCheck: check(
      "progress_entries_delta_check",
      sql`${table.countDelta} <> 0 or ${table.amountDelta} <> 0`,
    ),
    typeCheck: check(
      "progress_entries_type_check",
      sql`${table.entryType} in ('manual', 'correction', 'reversal')`,
    ),
  }),
);

export const reminderRules = pgTable(
  "reminder_rules",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    cardId: uuid("card_id").references(() => cards.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    daysBefore: integer("days_before").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    ...timestamps,
  },
  (table) => ({
    ruleUnique: uniqueIndex("reminder_rules_scope_unique").on(
      table.userId,
      table.cardId,
      table.kind,
      table.daysBefore,
    ),
    kindCheck: check("reminder_rules_kind_check", sql`${table.kind} in ('fee_event', 'progress')`),
    daysCheck: check("reminder_rules_days_check", sql`${table.daysBefore} between 0 and 3650`),
  }),
);

export const reminders = pgTable(
  "reminders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    cardId: uuid("card_id").references(() => cards.id, { onDelete: "cascade" }),
    feeEventId: uuid("fee_event_id").references(() => feeEvents.id, { onDelete: "cascade" }),
    feeCycleId: uuid("fee_cycle_id").references(() => feeCycles.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    daysBefore: integer("days_before").notNull().default(0),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true, mode: "date" }).notNull(),
    status: text("status").notNull().default("pending"),
    snoozedUntil: timestamp("snoozed_until", { withTimezone: true, mode: "date" }),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
    ...timestamps,
  },
  (table) => ({
    eventScheduleUnique: uniqueIndex("reminders_event_schedule_unique")
      .on(table.feeEventId, table.scheduledFor, table.kind)
      .where(sql`${table.feeEventId} is not null`),
    cycleScheduleUnique: uniqueIndex("reminders_cycle_schedule_unique")
      .on(table.feeCycleId, table.scheduledFor, table.kind)
      .where(sql`${table.feeCycleId} is not null`),
    inbox: index("reminders_user_inbox_idx").on(table.userId, table.status, table.scheduledFor),
    kindCheck: check("reminders_kind_check", sql`${table.kind} in ('fee_event', 'progress')`),
    targetCheck: check(
      "reminders_target_check",
      sql`(${table.kind} = 'fee_event' and ${table.feeEventId} is not null and ${table.feeCycleId} is null)
        or (${table.kind} = 'progress' and ${table.feeCycleId} is not null and ${table.feeEventId} is null)`,
    ),
    statusCheck: check(
      "reminders_status_check",
      sql`${table.status} in ('pending', 'completed', 'snoozed', 'ignored', 'cancelled')`,
    ),
    completedCheck: check(
      "reminders_completed_check",
      sql`${table.status} <> 'completed' or ${table.completedAt} is not null`,
    ),
  }),
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    actorType: text("actor_type").notNull(),
    actorId: uuid("actor_id"),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id"),
    requestId: text("request_id"),
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    ipHash: text("ip_hash"),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
  },
  (table) => ({
    userTime: index("audit_logs_user_time_idx").on(table.userId, table.occurredAt),
    entity: index("audit_logs_entity_idx").on(table.entityType, table.entityId, table.occurredAt),
    actorCheck: check(
      "audit_logs_actor_type_check",
      sql`${table.actorType} in ('user', 'system', 'admin')`,
    ),
  }),
);

export const workerHeartbeats = pgTable(
  "worker_heartbeats",
  {
    name: text("name").primaryKey(),
    instanceId: uuid("instance_id").notNull(),
    status: text("status").notNull().default("running"),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }).notNull(),
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true, mode: "date" }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    statusCheck: check("worker_heartbeats_status_check", sql`${table.status} in ('running', 'stopped')`),
    heartbeat: index("worker_heartbeats_heartbeat_idx").on(table.status, table.heartbeatAt),
  }),
);

export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type Card = typeof cards.$inferSelect;
export type FeeCycle = typeof feeCycles.$inferSelect;
export type FeeEvent = typeof feeEvents.$inferSelect;
export type ProgressEntry = typeof progressEntries.$inferSelect;
export type ReminderRule = typeof reminderRules.$inferSelect;
export type Reminder = typeof reminders.$inferSelect;
export type AuditLog = typeof auditLogs.$inferSelect;
export type WorkerHeartbeat = typeof workerHeartbeats.$inferSelect;
