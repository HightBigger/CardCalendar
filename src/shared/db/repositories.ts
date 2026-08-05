import { and, desc, eq, gte, isNull, lte, ne } from "drizzle-orm";
import { cards, feeCycles, feeEvents, progressEntries, reminderRules, reminders } from "../../../db/schema";
import type { Database } from "./client";
import type { Card, CardStatus, CreateCardInput } from "../../modules/cards/domain";
import type { CardRepository } from "../../modules/cards/repository";
import { cycleForFeeDate } from "../../modules/cycles/domain";
import type { CycleRepository, OwnedFeeCycle } from "../../modules/cycles/repository";
import type { FeeEvent, FeeEventStatusInput } from "../../modules/fee-events/domain";
import type { FeeEventUpdate } from "../../modules/fee-events/repository";
import type { FeeEventRepository } from "../../modules/fee-events/repository";
import type { ProgressEntry, ProgressEntryUpdate, ProgressRepository } from "../../modules/progress/repository";
import type { Reminder, ReminderStatus } from "../../modules/reminders/domain";
import type { ReminderRepository } from "../../modules/reminders/repository";
import type { ReminderRule, ReminderRuleRepository } from "../../modules/reminders/rules";
import type { ISODate } from "../time";

type CardRow = typeof cards.$inferSelect;
type CycleRow = typeof feeCycles.$inferSelect;
type FeeEventRow = typeof feeEvents.$inferSelect;
type ProgressRow = typeof progressEntries.$inferSelect;
type ReminderRuleRow = typeof reminderRules.$inferSelect;
type ReminderRow = typeof reminders.$inferSelect;

function toCard(row: CardRow): Card {
  return {
    id: row.id,
    userId: row.userId,
    issuerName: row.issuerName,
    name: row.name,
    last4: row.last4,
    status: row.status as CardStatus,
    annualFeeAmount: Number(row.annualFeeAmount),
    currency: row.currency,
    feeCycleType: row.feeCycleType as Card["feeCycleType"],
    openedOn: (row.openedOn ?? undefined) as ISODate | undefined,
    feeMonth: row.feeMonth ?? undefined,
    feeDay: row.feeDay ?? undefined,
    nextFeeDate: row.nextFeeDate as ISODate,
    waiveRuleType: row.waiveRuleType as Card["waiveRuleType"],
    targetCount: row.targetCount ?? undefined,
    targetAmount: row.targetAmount === null ? undefined : Number(row.targetAmount),
    customRuleText: row.customRuleText ?? undefined,
    notes: row.notes ?? undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    archivedAt: row.archivedAt?.toISOString(),
  };
}

function cardValues(userId: string, input: CreateCardInput): typeof cards.$inferInsert {
  return {
    userId,
    issuerName: input.issuerName,
    name: input.name,
    last4: input.last4,
    status: "active",
    annualFeeAmount: String(input.annualFeeAmount ?? 0),
    currency: input.currency ?? "CNY",
    feeCycleType: input.feeCycleType,
    openedOn: input.openedOn ?? null,
    feeMonth: input.feeMonth ?? null,
    feeDay: input.feeDay ?? null,
    nextFeeDate: input.nextFeeDate,
    waiveRuleType: input.waiveRuleType ?? "none",
    targetCount: input.targetCount ?? null,
    targetAmount: input.targetAmount === undefined ? null : String(input.targetAmount),
    progressPeriodStart: null,
    progressPeriodEnd: null,
    customRuleText: input.customRuleText ?? null,
    notes: input.notes ?? null,
  };
}

function toCycle(row: CycleRow): OwnedFeeCycle {
  return {
    id: row.id,
    userId: row.userId,
    cardId: row.cardId,
    periodStart: row.periodStart as ISODate,
    periodEnd: row.periodEnd as ISODate,
    feeDueDate: row.feeDueDate as ISODate,
    waiveRuleType: row.waiveRuleType as OwnedFeeCycle["waiveRuleType"],
    targetCount: row.targetCount ?? undefined,
    targetAmount: row.targetAmount === null ? undefined : Number(row.targetAmount),
    status: row.status as OwnedFeeCycle["status"],
  };
}

function cycleValues(cycle: OwnedFeeCycle): typeof feeCycles.$inferInsert {
  return {
    id: cycle.id,
    userId: cycle.userId,
    cardId: cycle.cardId,
    periodStart: cycle.periodStart,
    periodEnd: cycle.periodEnd,
    feeDueDate: cycle.feeDueDate,
    waiveRuleType: cycle.waiveRuleType,
    targetCount: cycle.targetCount ?? null,
    targetAmount: cycle.targetAmount === undefined ? null : String(cycle.targetAmount),
    customRuleText: cycle.waiveRuleType === "custom" ? "自定义规则" : null,
    status: cycle.status,
  };
}

function toFeeEvent(row: FeeEventRow): FeeEvent {
  return {
    id: row.id,
    userId: row.userId,
    cardId: row.cardId,
    cycleId: row.feeCycleId,
    dueDate: row.dueDate as ISODate,
    expectedAmount: Number(row.expectedAmount),
    status: row.status as FeeEvent["status"],
    actualAmount: row.actualAmount === null ? undefined : Number(row.actualAmount),
    occurredOn: (row.occurredOn ?? undefined) as ISODate | undefined,
    notes: row.notes ?? undefined,
    resolvedAt: row.resolvedAt?.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toProgressEntry(row: ProgressRow): ProgressEntry {
  return {
    id: row.id,
    userId: row.userId,
    cardId: row.cardId,
    cycleId: row.feeCycleId,
    entryDate: row.entryDate as ISODate,
    countDelta: row.countDelta,
    amountDelta: Number(row.amountDelta),
    note: row.note ?? undefined,
    entryType: row.entryType as ProgressEntry["entryType"],
    reversedAt: row.reversedAt?.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

function toReminder(row: ReminderRow): Reminder {
  return {
    id: row.id,
    userId: row.userId,
    cardId: row.cardId ?? undefined,
    feeEventId: row.feeEventId ?? undefined,
    feeCycleId: row.feeCycleId ?? undefined,
    kind: row.kind as Reminder["kind"],
    daysBefore: row.daysBefore,
    scheduledFor: row.scheduledFor,
    status: row.status as ReminderStatus,
    snoozedUntil: row.snoozedUntil ?? undefined,
    completedAt: row.completedAt ?? undefined,
  };
}

function toReminderRule(row: ReminderRuleRow): ReminderRule {
  return {
    id: row.id,
    userId: row.userId,
    cardId: row.cardId ?? undefined,
    kind: row.kind as ReminderRule["kind"],
    daysBefore: row.daysBefore,
    enabled: row.enabled,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export interface DrizzleRepositories {
  cards: CardRepository;
  cycles: CycleRepository;
  feeEvents: FeeEventRepository;
  progress: ProgressRepository;
  reminderRules: ReminderRuleRepository;
  reminders: ReminderRepository;
}

export function createDrizzleRepositories(db: Database): DrizzleRepositories {
  return {
    cards: {
      async listAll(userId: string): Promise<Card[]> {
        const rows = await db
          .select()
          .from(cards)
          .where(eq(cards.userId, userId))
          .orderBy(desc(cards.createdAt));
        return rows.map(toCard);
      },
      async list(userId: string, includeArchived = false): Promise<Card[]> {
        const conditions = [eq(cards.userId, userId)];
        if (!includeArchived) conditions.push(ne(cards.status, "archived"));
        const rows = await db
          .select()
          .from(cards)
          .where(and(...conditions))
          .orderBy(desc(cards.createdAt));
        return rows.map(toCard);
      },
      async get(userId: string, cardId: string): Promise<Card | undefined> {
        const rows = await db
          .select()
          .from(cards)
          .where(and(eq(cards.id, cardId), eq(cards.userId, userId)))
          .limit(1);
        return rows[0] ? toCard(rows[0]) : undefined;
      },
      async create(userId: string, input: CreateCardInput): Promise<Card> {
        const id = crypto.randomUUID();
        await db.insert(cards).values({ ...cardValues(userId, input), id });
        const rows = await db
          .select()
          .from(cards)
          .where(and(eq(cards.id, id), eq(cards.userId, userId)))
          .limit(1);
        return toCard(rows[0]);
      },
      async createWithCycleAndEvent(userId: string, input: CreateCardInput): Promise<Card> {
        const cardId = crypto.randomUUID();
        const cycleId = crypto.randomUUID();
        const cycle = cycleForFeeDate(cardId, input.nextFeeDate, {
          cycleType: input.feeCycleType,
          openedOn: input.openedOn,
          waiveRuleType: input.waiveRuleType ?? "none",
          targetCount: input.targetCount,
          targetAmount: input.targetAmount,
        });

        await db.transaction(async (tx) => {
          await tx.insert(cards).values({ ...cardValues(userId, input), id: cardId });
          await tx.insert(feeCycles).values(cycleValues({ ...cycle, id: cycleId, userId }));
          await tx.insert(feeEvents).values({
            id: crypto.randomUUID(),
            userId,
            cardId,
            feeCycleId: cycleId,
            dueDate: input.nextFeeDate,
            expectedAmount: String(input.annualFeeAmount ?? 0),
            status: "pending",
          });
        });

        const rows = await db
          .select()
          .from(cards)
          .where(and(eq(cards.id, cardId), eq(cards.userId, userId)))
          .limit(1);
        return toCard(rows[0]);
      },
      async update(
        userId: string,
        cardId: string,
        patch: Partial<CreateCardInput> & { status?: CardStatus },
      ): Promise<Card | undefined> {
        const current = await this.get(userId, cardId);
        if (!current) return undefined;
        const next = { ...current, ...patch };
        await db
          .update(cards)
          .set({
            issuerName: next.issuerName,
            name: next.name,
            last4: next.last4,
            status: next.status ?? current.status,
            annualFeeAmount: String(next.annualFeeAmount),
            currency: next.currency ?? current.currency,
            feeCycleType: next.feeCycleType ?? current.feeCycleType,
            openedOn: next.openedOn ?? null,
            feeMonth: next.feeMonth ?? null,
            feeDay: next.feeDay ?? null,
            nextFeeDate: next.nextFeeDate ?? current.nextFeeDate,
            waiveRuleType: next.waiveRuleType ?? current.waiveRuleType,
            targetCount: next.targetCount ?? null,
            targetAmount: next.targetAmount === undefined ? null : String(next.targetAmount),
            customRuleText: next.customRuleText ?? null,
            notes: next.notes ?? null,
            archivedAt: next.status === "archived" ? new Date() : current.archivedAt ? new Date(current.archivedAt) : null,
            updatedAt: new Date(),
          })
          .where(and(eq(cards.id, cardId), eq(cards.userId, userId)));
        return this.get(userId, cardId);
      },
    },
    cycles: {
      async listByCard(userId: string, cardId: string): Promise<OwnedFeeCycle[]> {
        const rows = await db
          .select()
          .from(feeCycles)
          .where(and(eq(feeCycles.userId, userId), eq(feeCycles.cardId, cardId)))
          .orderBy(desc(feeCycles.periodStart));
        return rows.map(toCycle);
      },
      async get(userId: string, id: string): Promise<OwnedFeeCycle | undefined> {
        const rows = await db
          .select()
          .from(feeCycles)
          .where(and(eq(feeCycles.id, id), eq(feeCycles.userId, userId)))
          .limit(1);
        return rows[0] ? toCycle(rows[0]) : undefined;
      },
      async save(cycle: OwnedFeeCycle): Promise<OwnedFeeCycle> {
        const existing = await db
          .select({ id: feeCycles.id })
          .from(feeCycles)
          .where(and(eq(feeCycles.id, cycle.id), eq(feeCycles.userId, cycle.userId)))
          .limit(1);
        if (existing[0]) {
          await db
            .update(feeCycles)
            .set({
              cardId: cycle.cardId,
              periodStart: cycle.periodStart,
              periodEnd: cycle.periodEnd,
              feeDueDate: cycle.feeDueDate,
              waiveRuleType: cycle.waiveRuleType,
              targetCount: cycle.targetCount ?? null,
              targetAmount: cycle.targetAmount === undefined ? null : String(cycle.targetAmount),
              status: cycle.status,
              updatedAt: new Date(),
            })
            .where(and(eq(feeCycles.id, cycle.id), eq(feeCycles.userId, cycle.userId)));
        } else {
          await db.insert(feeCycles).values(cycleValues(cycle));
        }
        return cycle;
      },
    },
    feeEvents: {
      async list(
        userId: string,
        range?: { from?: ISODate; to?: ISODate },
      ): Promise<FeeEvent[]> {
        const conditions = [eq(feeEvents.userId, userId)];
        if (range?.from) conditions.push(gte(feeEvents.dueDate, range.from));
        if (range?.to) conditions.push(lte(feeEvents.dueDate, range.to));
        const rows = await db
          .select()
          .from(feeEvents)
          .where(and(...conditions))
          .orderBy(desc(feeEvents.dueDate));
        return rows.map(toFeeEvent);
      },
      async get(userId: string, id: string): Promise<FeeEvent | undefined> {
        const rows = await db
          .select()
          .from(feeEvents)
          .where(and(eq(feeEvents.id, id), eq(feeEvents.userId, userId)))
          .limit(1);
        return rows[0] ? toFeeEvent(rows[0]) : undefined;
      },
      async create(
        userId: string,
        input: Omit<FeeEvent, "id" | "userId" | "createdAt" | "updatedAt">,
      ): Promise<FeeEvent> {
        const rows = await db
          .insert(feeEvents)
          .values({
            id: crypto.randomUUID(),
            userId,
            cardId: input.cardId,
            feeCycleId: input.cycleId,
            dueDate: input.dueDate,
            expectedAmount: String(input.expectedAmount),
            status: input.status,
            actualAmount: input.actualAmount === undefined ? null : String(input.actualAmount),
            occurredOn: input.occurredOn ?? null,
            notes: input.notes ?? null,
            resolvedAt: input.resolvedAt ? new Date(input.resolvedAt) : null,
          })
          .returning();
        return toFeeEvent(rows[0]);
      },
      async updateStatus(
        userId: string,
        id: string,
        input: FeeEventStatusInput,
      ): Promise<FeeEvent | undefined> {
        const current = await this.get(userId, id);
        if (!current) return undefined;
        const rows = await db
          .update(feeEvents)
          .set({
            status: input.status,
            actualAmount: input.actualAmount === undefined ? null : String(input.actualAmount),
            occurredOn: input.occurredOn ?? null,
            notes: input.notes ?? null,
            resolvedAt: input.status === "pending" ? null : new Date(),
            updatedAt: new Date(),
          })
          .where(and(eq(feeEvents.id, id), eq(feeEvents.userId, userId)))
          .returning();
        return rows[0] ? toFeeEvent(rows[0]) : undefined;
      },
      async updateDetails(
        userId: string,
        id: string,
        patch: FeeEventUpdate,
      ): Promise<FeeEvent | undefined> {
        const rows = await db
          .update(feeEvents)
          .set({
            feeCycleId: patch.cycleId ?? undefined,
            dueDate: patch.dueDate ?? undefined,
            expectedAmount: patch.expectedAmount === undefined ? undefined : String(patch.expectedAmount),
            updatedAt: new Date(),
          })
          .where(and(eq(feeEvents.id, id), eq(feeEvents.userId, userId)))
          .returning();
        return rows[0] ? toFeeEvent(rows[0]) : undefined;
      },
    },
    progress: {
      async list(userId: string, cycleId: string): Promise<ProgressEntry[]> {
        const rows = await db
          .select()
          .from(progressEntries)
          .where(and(eq(progressEntries.userId, userId), eq(progressEntries.feeCycleId, cycleId)))
          .orderBy(desc(progressEntries.createdAt));
        return rows.map(toProgressEntry);
      },
      async get(userId: string, cycleId: string, entryId: string): Promise<ProgressEntry | undefined> {
        const rows = await db
          .select()
          .from(progressEntries)
          .where(and(eq(progressEntries.userId, userId), eq(progressEntries.feeCycleId, cycleId), eq(progressEntries.id, entryId)))
          .limit(1);
        return rows[0] ? toProgressEntry(rows[0]) : undefined;
      },
      async markReversed(userId: string, cycleId: string, entryId: string): Promise<ProgressEntry | undefined> {
        const rows = await db
          .update(progressEntries)
          .set({ reversedAt: new Date(), updatedAt: new Date() })
          .where(and(eq(progressEntries.userId, userId), eq(progressEntries.feeCycleId, cycleId), eq(progressEntries.id, entryId), isNull(progressEntries.reversedAt)))
          .returning();
        return rows[0] ? toProgressEntry(rows[0]) : undefined;
      },
      async add(entry: Omit<ProgressEntry, "id" | "createdAt">): Promise<ProgressEntry> {
        const rows = await db
          .insert(progressEntries)
          .values({
            id: crypto.randomUUID(),
            userId: entry.userId,
            cardId: entry.cardId,
            feeCycleId: entry.cycleId,
            entryDate: entry.entryDate,
            countDelta: entry.countDelta,
            amountDelta: String(entry.amountDelta),
            entryType: entry.entryType ?? "manual",
            note: entry.note ?? null,
            createdBy: entry.userId,
          })
          .returning();
        return toProgressEntry(rows[0]);
      },
      async update(
        userId: string,
        cycleId: string,
        entryId: string,
        patch: ProgressEntryUpdate,
      ): Promise<ProgressEntry | undefined> {
        const rows = await db
          .update(progressEntries)
          .set({
            entryDate: patch.entryDate ?? undefined,
            countDelta: patch.countDelta ?? undefined,
            amountDelta: patch.amountDelta === undefined ? undefined : String(patch.amountDelta),
            note: patch.note === undefined ? undefined : patch.note ?? null,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(progressEntries.userId, userId),
              eq(progressEntries.feeCycleId, cycleId),
              eq(progressEntries.id, entryId),
            ),
          )
          .returning();
        return rows[0] ? toProgressEntry(rows[0]) : undefined;
      },
    },
    reminders: {
      async list(userId: string, pendingOnly = true): Promise<Reminder[]> {
        const rows = await db
          .select()
          .from(reminders)
          .where(
            pendingOnly
              ? and(
                  eq(reminders.userId, userId),
                  ne(reminders.status, "completed"),
                  ne(reminders.status, "ignored"),
                  ne(reminders.status, "cancelled"),
                )
              : eq(reminders.userId, userId),
          )
          .orderBy(desc(reminders.scheduledFor));
        return rows.map(toReminder);
      },
      async get(userId: string, id: string): Promise<Reminder | undefined> {
        const rows = await db
          .select()
          .from(reminders)
          .where(and(eq(reminders.id, id), eq(reminders.userId, userId)))
          .limit(1);
        return rows[0] ? toReminder(rows[0]) : undefined;
      },
      async save(reminder: Reminder): Promise<Reminder> {
        let existing = await db
          .select({ id: reminders.id })
          .from(reminders)
          .where(and(eq(reminders.id, reminder.id), eq(reminders.userId, reminder.userId)))
          .limit(1);
        if (!existing[0] && reminder.feeEventId) {
          existing = await db
            .select({ id: reminders.id })
            .from(reminders)
            .where(and(eq(reminders.userId, reminder.userId), eq(reminders.feeEventId, reminder.feeEventId), eq(reminders.daysBefore, reminder.daysBefore)))
            .limit(1);
        }
        if (!existing[0] && reminder.feeCycleId && !reminder.feeEventId) {
          existing = await db
            .select({ id: reminders.id })
            .from(reminders)
            .where(and(eq(reminders.userId, reminder.userId), eq(reminders.feeCycleId, reminder.feeCycleId), eq(reminders.kind, reminder.kind), eq(reminders.daysBefore, reminder.daysBefore)))
            .limit(1);
        }
        const values = {
          userId: reminder.userId,
          cardId: reminder.cardId ?? null,
          feeEventId: reminder.feeEventId ?? null,
          feeCycleId: reminder.feeCycleId ?? null,
          kind: reminder.kind,
          daysBefore: reminder.daysBefore,
          scheduledFor: reminder.scheduledFor,
          status: reminder.status,
          snoozedUntil: reminder.snoozedUntil ?? null,
          completedAt: reminder.completedAt ?? null,
        };
        if (existing[0]) {
          const existingId = existing[0].id;
          await db
            .update(reminders)
            .set({ ...values, updatedAt: new Date() })
            .where(and(eq(reminders.id, existingId), eq(reminders.userId, reminder.userId)));
          return { ...reminder, id: existingId };
        } else {
          await db.insert(reminders).values({ id: reminder.id, ...values });
        }
        return reminder;
      },
    },
    reminderRules: {
      async list(userId: string, kind?: ReminderRule["kind"]): Promise<ReminderRule[]> {
        const conditions = [eq(reminderRules.userId, userId)];
        if (kind) conditions.push(eq(reminderRules.kind, kind));
        const rows = await db
          .select()
          .from(reminderRules)
          .where(and(...conditions))
          .orderBy(reminderRules.daysBefore);
        return rows.map(toReminderRule);
      },
      async listGlobal(userId: string, kind?: ReminderRule["kind"]): Promise<ReminderRule[]> {
        const rules = await this.list(userId, kind);
        return rules.filter((rule) => !rule.cardId);
      },
      async save(
        userId: string,
        input: { id?: string; cardId?: string; kind: ReminderRule["kind"]; daysBefore: number; enabled: boolean },
      ): Promise<ReminderRule> {
        const existing = await db
          .select({ id: reminderRules.id })
          .from(reminderRules)
          .where(
            and(
              eq(reminderRules.userId, userId),
              eq(reminderRules.kind, input.kind),
              eq(reminderRules.daysBefore, input.daysBefore),
              input.cardId ? eq(reminderRules.cardId, input.cardId) : isNull(reminderRules.cardId),
            ),
          )
          .limit(1);
        const id = input.id ?? existing[0]?.id ?? crypto.randomUUID();
        const values = {
          userId,
          cardId: input.cardId ?? null,
          kind: input.kind,
          daysBefore: input.daysBefore,
          enabled: input.enabled,
        };
        if (existing[0]) {
          await db
            .update(reminderRules)
            .set({ ...values, updatedAt: new Date() })
            .where(and(eq(reminderRules.id, existing[0].id), eq(reminderRules.userId, userId)));
        } else {
          await db.insert(reminderRules).values({ id, ...values });
        }
        const rows = await db
          .select()
          .from(reminderRules)
          .where(and(eq(reminderRules.id, id), eq(reminderRules.userId, userId)))
          .limit(1);
        return toReminderRule(rows[0]);
      },
      async remove(userId: string, id: string): Promise<boolean> {
        await db
          .delete(reminderRules)
          .where(and(eq(reminderRules.id, id), eq(reminderRules.userId, userId)));
        return true;
      },
    },
  };
}
