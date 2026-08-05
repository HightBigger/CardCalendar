import { AppError } from "../../shared/errors";
import { assertISODate } from "../../shared/time";
import { assertRecord } from "../../shared/validation";
import { canTransitionReminder, Reminder, ReminderStatus, reminderSchedule } from "./domain";
import { reminderRepository, ReminderRepository } from "./repository";
import {
  getFeeEventReminderDays,
  reminderRuleRepository,
  ReminderRuleRepository,
} from "./rules";

export type ReminderAction = "complete" | "ignore" | "snooze";

export async function listReminders(
  userId: string,
  pendingOnly = true,
  repository: ReminderRepository = reminderRepository,
) {
  return repository.list(userId, pendingOnly);
}

export async function createReminder(
  input: Omit<Reminder, "id" | "status" | "kind"> & {
    kind?: Reminder["kind"];
    status?: ReminderStatus;
  },
  repository: ReminderRepository = reminderRepository,
) {
  return repository.save({
    ...input,
    id: crypto.randomUUID(),
    kind: input.kind ?? "fee_event",
    status: input.status ?? "pending",
  });
}

export async function ensureFeeEventReminders(
  userId: string,
  event: { id: string; cardId: string; cycleId: string; dueDate: string },
  timezone = "Asia/Shanghai",
  daysBefore?: number[],
  repository: ReminderRepository = reminderRepository,
  rules: ReminderRuleRepository = reminderRuleRepository,
) {
  const existing = await repository.list(userId, false);
  const existingDays = new Set(
    existing
      .filter(
        (reminder) =>
          reminder.feeEventId === event.id &&
          (reminder.status === "pending" || reminder.status === "snoozed"),
      )
      .map((reminder) => reminder.daysBefore),
  );
  const effectiveDays = daysBefore ?? (await getFeeEventReminderDays(userId, rules));
  for (const schedule of reminderSchedule(assertISODate(event.dueDate, "dueDate"), timezone, effectiveDays)) {
    if (existingDays.has(schedule.daysBefore)) continue;
    await createReminder(
      {
        userId,
        cardId: event.cardId,
        feeEventId: event.id,
        kind: "fee_event",
        daysBefore: schedule.daysBefore,
        scheduledFor: schedule.scheduledFor,
      },
      repository,
    );
  }
  return repository.list(userId, true);
}

export async function actOnReminder(
  userId: string,
  id: string,
  value: unknown,
  repository: ReminderRepository = reminderRepository,
) {
  const body = assertRecord(value);
  const action = body.action;
  if (action !== "complete" && action !== "ignore" && action !== "snooze") {
    throw new AppError("VALIDATION_ERROR", "action 必须是 complete、ignore 或 snooze");
  }

  const current = await repository.get(userId, id);
  if (!current) throw new AppError("NOT_FOUND", "提醒不存在");

  const status: ReminderStatus =
    action === "complete" ? "completed" : action === "ignore" ? "ignored" : "snoozed";
  if (!canTransitionReminder(current.status, status)) {
    throw new AppError("CONFLICT", "当前提醒状态不能执行该操作");
  }

  let snoozedUntil: Date | undefined;
  if (action === "snooze") {
    if (typeof body.snoozedUntil !== "string" || !Number.isFinite(Date.parse(body.snoozedUntil))) {
      throw new AppError("VALIDATION_ERROR", "稍后处理必须提供有效的 snoozedUntil");
    }
    snoozedUntil = new Date(body.snoozedUntil);
    if (snoozedUntil.getTime() <= Date.now()) {
      throw new AppError("VALIDATION_ERROR", "snoozedUntil 必须晚于当前时间");
    }
  }

  return repository.save({
    ...current,
    status,
    snoozedUntil,
    completedAt: action === "complete" ? new Date() : current.completedAt,
  });
}
