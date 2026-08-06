import { AppError } from "../../shared/errors";
import { assertISODate } from "../../shared/time";
import { assertRecord, last4, nonNegativeInteger, nonNegativeNumber, optionalString, requiredString } from "../../shared/validation";
import { Card, CardStatus, CreateCardInput } from "./domain";
import { cardRepository, CardRepository } from "./repository";
import { cycleForFeeDate, cycleRepository, CycleRepository } from "../cycles";
import { feeEventRepository, FeeEventRepository, reconcileCardEvents } from "../fee-events";
import { ensureFeeEventReminders, getFeeEventReminderDays, reminderRepository, ReminderRepository, reminderSchedule } from "../reminders";
import { authRepository, AuthRepository } from "../auth";
import { recordAudit } from "../../shared/audit";

export function parseCreateCardInput(value: unknown): CreateCardInput {
  const body = assertRecord(value);
  const cycleType = body.feeCycleType;
  if (cycleType !== "anniversary" && cycleType !== "fixed_date" && cycleType !== "custom") throw new AppError("VALIDATION_ERROR", "feeCycleType 无效");
  const waive = body.waiveRuleType ?? "none";
  if (!["none", "count", "amount", "count_and_amount", "custom"].includes(String(waive))) throw new AppError("VALIDATION_ERROR", "waiveRuleType 无效");
  const input: CreateCardInput = { issuerName: requiredString(body.issuerName, "issuerName", 100), name: requiredString(body.name, "name", 120), last4: last4(body.last4), feeCycleType: cycleType, nextFeeDate: assertISODate(body.nextFeeDate, "nextFeeDate"), annualFeeAmount: body.annualFeeAmount === undefined ? 0 : nonNegativeNumber(body.annualFeeAmount, "annualFeeAmount"), currency: (body.currency === undefined ? "CNY" : requiredString(body.currency, "currency", 3)).toUpperCase(), waiveRuleType: waive as CreateCardInput["waiveRuleType"], openedOn: body.openedOn === undefined ? undefined : assertISODate(body.openedOn, "openedOn"), feeMonth: body.feeMonth === undefined ? undefined : nonNegativeInteger(body.feeMonth, "feeMonth"), feeDay: body.feeDay === undefined ? undefined : nonNegativeInteger(body.feeDay, "feeDay"), targetCount: body.targetCount === undefined ? undefined : nonNegativeInteger(body.targetCount, "targetCount"), targetAmount: body.targetAmount === undefined ? undefined : nonNegativeNumber(body.targetAmount, "targetAmount"), progressPeriodStart: body.progressPeriodStart === undefined ? undefined : assertISODate(body.progressPeriodStart, "progressPeriodStart"), progressPeriodEnd: body.progressPeriodEnd === undefined ? undefined : assertISODate(body.progressPeriodEnd, "progressPeriodEnd"), customRuleText: optionalString(body.customRuleText, "customRuleText", 1000), notes: optionalString(body.notes, "notes", 2000) };
  if (input.waiveRuleType === "count" || input.waiveRuleType === "count_and_amount") if (input.targetCount === undefined) throw new AppError("VALIDATION_ERROR", "次数规则必须提供 targetCount");
  if (input.waiveRuleType === "amount" || input.waiveRuleType === "count_and_amount") if (input.targetAmount === undefined) throw new AppError("VALIDATION_ERROR", "金额规则必须提供 targetAmount");
  if (input.feeCycleType === "anniversary" && !input.openedOn) throw new AppError("VALIDATION_ERROR", "周年规则必须提供 openedOn");
  if (input.feeCycleType === "fixed_date" && (!input.feeMonth || !input.feeDay || input.feeMonth > 12 || input.feeDay > 31)) throw new AppError("VALIDATION_ERROR", "固定日期规则需要有效月份和日期");
  if (input.progressPeriodStart && input.progressPeriodEnd && input.progressPeriodEnd < input.progressPeriodStart) throw new AppError("VALIDATION_ERROR", "progressPeriodEnd 不能早于 progressPeriodStart");
  return input;
}

function parseCardStatus(value: unknown): CardStatus | undefined {
  if (value === undefined) return undefined;
  if (value === "active" || value === "suspended" || value === "archived") return value;
  throw new AppError("VALIDATION_ERROR", "卡片状态无效");
}

export async function createCard(userId: string, value: unknown, repository: CardRepository = cardRepository, cycles: CycleRepository = cycleRepository, events: FeeEventRepository = feeEventRepository): Promise<Card> {
  const input = parseCreateCardInput(value);
  if (repository.createWithCycleAndEvent) {
    const card = await repository.createWithCycleAndEvent(userId, input);
    await ensureCreatedCardReminders(userId, card.id, events);
    const profile = await authRepository.findUserById(userId);
    await reconcileCardEvents(userId, card.id, profile?.timezone ?? "Asia/Shanghai", {
      cards: repository,
      cycles,
      events,
    });
    await recordAudit({
      userId,
      actorType: "user",
      actorId: userId,
      action: "card.created",
      entityType: "card",
      entityId: card.id,
      metadata: { status: card.status },
    });
    return card;
  }
  const card = await repository.create(userId, input);
  const cycle = await cycles.save({ ...cycleForFeeDate(card.id, card.nextFeeDate, { cycleType: card.feeCycleType, openedOn: card.openedOn, waiveRuleType: card.waiveRuleType, targetCount: card.targetCount, targetAmount: card.targetAmount }), userId });
  const event = await events.create(userId, { cardId: card.id, cycleId: cycle.id, dueDate: card.nextFeeDate, expectedAmount: card.annualFeeAmount, status: "pending" });
  const profile = await authRepository.findUserById(userId);
  await ensureFeeEventReminders(userId, event, profile?.timezone ?? "Asia/Shanghai");
  await reconcileCardEvents(userId, card.id, profile?.timezone ?? "Asia/Shanghai", {
    cards: repository,
    cycles,
    events,
  });
  await recordAudit({
    userId,
    actorType: "user",
    actorId: userId,
    action: "card.created",
    entityType: "card",
    entityId: card.id,
    metadata: { status: card.status },
  });
  return card;
}

async function ensureCreatedCardReminders(userId: string, cardId: string, events: FeeEventRepository) {
  const cardEvents = await events.list(userId);
  const event = cardEvents.find((item) => item.cardId === cardId);
  if (!event) return;
  const profile = await authRepository.findUserById(userId);
  await ensureFeeEventReminders(
    userId,
    {
      id: event.id,
      cardId: event.cardId,
      cycleId: event.cycleId,
      dueDate: event.dueDate,
    },
    profile?.timezone ?? "Asia/Shanghai",
  );
}
export async function listCards(
  userId: string,
  includeArchived = false,
  repository: CardRepository = cardRepository,
): Promise<Card[]> {
  return includeArchived ? repository.listAll(userId) : repository.list(userId);
}
export async function getCard(userId: string, cardId: string, repository: CardRepository = cardRepository): Promise<Card> { const card = await repository.get(userId, cardId); if (!card) throw new AppError("NOT_FOUND", "卡片不存在"); return card; }
export async function updateCard(
  userId: string,
  cardId: string,
  value: unknown,
  repository: CardRepository = cardRepository,
  cycles: CycleRepository = cycleRepository,
  events: FeeEventRepository = feeEventRepository,
  reminders: ReminderRepository = reminderRepository,
  auth: AuthRepository = authRepository,
): Promise<Card> {
  const current = await getCard(userId, cardId, repository);
  const patch = assertRecord(value);
  const input = parseCreateCardInput({ ...current, ...patch });
  const status = parseCardStatus(patch.status);
  const updated = await repository.update(userId, cardId, { ...input, ...(status ? { status } : {}) });
  if (!updated) throw new AppError("NOT_FOUND", "卡片不存在");
  await syncCardScheduleAfterUpdate(userId, current, input, cycles, events, reminders, auth);
  await recordAudit({
    userId,
    actorType: "user",
    actorId: userId,
    action: "card.updated",
    entityType: "card",
    entityId: cardId,
    metadata: { changedFields: Object.keys(patch).filter((field) => field !== "last4") },
  });
  return updated;
}
export async function archiveCard(
  userId: string,
  cardId: string,
  repository: CardRepository = cardRepository,
  reminders: ReminderRepository = reminderRepository,
): Promise<Card> {
  const card = await repository.update(userId, cardId, { status: "archived" });
  if (!card) throw new AppError("NOT_FOUND", "卡片不存在");
  const linked = await reminders.list(userId, false);
  await Promise.all(
    linked
      .filter((reminder) => reminder.cardId === cardId && (reminder.status === "pending" || reminder.status === "snoozed"))
      .map((reminder) => reminders.save({ ...reminder, status: "cancelled", snoozedUntil: undefined })),
  );
  await recordAudit({
    userId,
    actorType: "user",
    actorId: userId,
    action: "card.archived",
    entityType: "card",
    entityId: cardId,
    metadata: { status: "archived" },
  });
  return card;
}

export async function restoreCard(
  userId: string,
  cardId: string,
  repository: CardRepository = cardRepository,
  events: FeeEventRepository = feeEventRepository,
  reminders: ReminderRepository = reminderRepository,
  auth: AuthRepository = authRepository,
  cycles: CycleRepository = cycleRepository,
): Promise<Card> {
  const current = await getCard(userId, cardId, repository);
  if (current.status !== "archived") throw new AppError("CONFLICT", "该卡片未归档");
  const restored = await repository.update(userId, cardId, { status: "active" });
  if (!restored) throw new AppError("NOT_FOUND", "卡片不存在");

  const pendingEvents = (await events.list(userId)).filter(
    (event) => event.cardId === cardId && event.status === "pending",
  );
  const profile = await auth.findUserById(userId);
  const timezone = profile?.timezone ?? "Asia/Shanghai";
  const days = await getFeeEventReminderDays(userId);
  const daySet = new Set(days);
  const linked = await reminders.list(userId, false);
  const eventById = new Map(pendingEvents.map((event) => [event.id, event]));
  await Promise.all(
    linked
      .filter(
        (reminder) =>
          reminder.feeEventId &&
          eventById.has(reminder.feeEventId) &&
          reminder.status === "cancelled" &&
          daySet.has(reminder.daysBefore),
      )
      .map(async (reminder) => {
        const event = eventById.get(reminder.feeEventId!)!;
        const schedule = reminderSchedule(event.dueDate, timezone, [reminder.daysBefore])[0];
        return reminders.save({
          ...reminder,
          status: "pending",
          snoozedUntil: undefined,
          scheduledFor: schedule.scheduledFor,
        });
      }),
  );
  for (const event of pendingEvents) {
    await ensureFeeEventReminders(userId, event, timezone, days, reminders);
  }
  await reconcileCardEvents(userId, cardId, timezone, {
    cards: repository,
    cycles,
    events,
    reminders,
  });
  await recordAudit({
    userId,
    actorType: "user",
    actorId: userId,
    action: "card.restored",
    entityType: "card",
    entityId: cardId,
    metadata: { status: restored.status },
  });
  return restored;
}

async function syncCardScheduleAfterUpdate(
  userId: string,
  current: Card,
  input: CreateCardInput,
  cycles: CycleRepository,
  events: FeeEventRepository,
  reminders: ReminderRepository,
  auth: AuthRepository,
) {
  const cardCycles = await cycles.listByCard(userId, current.id);
  const activeCycles = cardCycles
    .filter((cycle) => cycle.status === "open" || cycle.status === "qualified")
    .sort((a, b) => a.periodStart.localeCompare(b.periodStart));
  if (activeCycles.length === 0) return;

  const pendingEvents = (await events.list(userId))
    .filter((event) => event.cardId === current.id && event.status === "pending")
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const activeCycleIds = new Set(activeCycles.map((cycle) => cycle.id));
  const event = pendingEvents.find((item) => activeCycleIds.has(item.cycleId)) ?? pendingEvents[0];
  const cycle = event
    ? activeCycles.find((item) => item.id === event.cycleId) ?? activeCycles[0]
    : activeCycles[0];

  const rule = {
    cycleType: input.feeCycleType,
    openedOn: input.openedOn,
    waiveRuleType: input.waiveRuleType ?? "none",
    targetCount: input.targetCount,
    targetAmount: input.targetAmount,
  };
  const syncedCycle = await cycles.save({
    ...cycleForFeeDate(current.id, input.nextFeeDate, rule),
    id: cycle.id,
    userId,
    status: cycle.status,
  });

  if (!event) return;
  const updatedEvent = await events.updateDetails(userId, event.id, {
    cycleId: syncedCycle.id,
    dueDate: input.nextFeeDate,
    expectedAmount: input.annualFeeAmount ?? 0,
  });
  if (!updatedEvent) throw new AppError("NOT_FOUND", "年费事件不存在");

  const profile = await auth.findUserById(userId);
  const timezone = profile?.timezone ?? "Asia/Shanghai";
  const linked = await reminders.list(userId, false);
  await Promise.all(
    linked
      .filter((reminder) => reminder.feeEventId === updatedEvent.id && (reminder.status === "pending" || reminder.status === "snoozed"))
      .map(async (reminder) => {
        const next = reminderSchedule(input.nextFeeDate, timezone, [reminder.daysBefore])[0];
        return reminders.save({
          ...reminder,
          scheduledFor: next.scheduledFor,
          status: "pending",
          snoozedUntil: undefined,
        });
      }),
  );
  await ensureFeeEventReminders(userId, updatedEvent, timezone, undefined, reminders);
}
