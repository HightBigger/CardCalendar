import { AppError } from "../../shared/errors";
import { assertRecord, nonNegativeInteger } from "../../shared/validation";
import { authRepository, AuthRepository } from "../auth";
import { feeEventRepository, FeeEventRepository } from "../fee-events";
import type { ReminderKind } from "./domain";
import {
  ReminderRule,
  ReminderRuleRepository,
  reminderRuleRepository,
  seedDefaultFeeEventRules,
} from "./rules";
import { reminderRepository, ReminderRepository } from "./repository";
import { ensureFeeEventReminders } from "./service";
import { recordAudit } from "../../shared/audit";

export async function listReminderRules(
  userId: string,
  kind: ReminderKind = "fee_event",
  repository: ReminderRuleRepository = reminderRuleRepository,
): Promise<ReminderRule[]> {
  if (kind === "fee_event") await seedDefaultFeeEventRules(userId, repository);
  return repository.listGlobal(userId, kind);
}

export async function saveFeeEventReminderRules(
  userId: string,
  value: unknown,
  repository: ReminderRuleRepository = reminderRuleRepository,
  reminders: ReminderRepository = reminderRepository,
  events: FeeEventRepository = feeEventRepository,
  auth: AuthRepository = authRepository,
): Promise<ReminderRule[]> {
  const body = assertRecord(value);
  const rawValue = body.rules;
  if (!Array.isArray(rawValue) || rawValue.length > 50) {
    throw new AppError("VALIDATION_ERROR", "rules 必须是不超过 50 项的数组");
  }
  let rawRules: unknown[] = rawValue;
  if (rawRules.length === 0) {
    rawRules = [30, 7, 1].map((daysBefore) => ({ daysBefore, enabled: false }));
  }

  const parsed = rawRules.map((item) => {
    const record = assertRecord(item);
    const daysBefore = nonNegativeInteger(record.daysBefore, "daysBefore");
    if (daysBefore > 3650) {
      throw new AppError("VALIDATION_ERROR", "提前天数必须在 0 到 3650 之间");
    }
    if (typeof record.enabled !== "boolean") {
      throw new AppError("VALIDATION_ERROR", "enabled 必须是布尔值");
    }
    return { kind: "fee_event" as const, daysBefore, enabled: record.enabled };
  });
  if (new Set(parsed.map((rule) => rule.daysBefore)).size !== parsed.length) {
    throw new AppError("VALIDATION_ERROR", "提前天数不能重复");
  }

  const existing = await repository.listGlobal(userId, "fee_event");
  const existingByDay = new Map(existing.map((rule) => [rule.daysBefore, rule]));
  for (const rule of existing) {
    if (!parsed.some((item) => item.daysBefore === rule.daysBefore)) {
      await repository.remove(userId, rule.id);
    }
  }

  const saved: ReminderRule[] = [];
  for (const item of parsed) {
    saved.push(
      await repository.save(userId, {
        id: existingByDay.get(item.daysBefore)?.id,
        kind: item.kind,
        daysBefore: item.daysBefore,
        enabled: item.enabled,
      }),
    );
  }

  const enabledDays = new Set(parsed.filter((rule) => rule.enabled).map((rule) => rule.daysBefore));
  const linked = await reminders.list(userId, false);
  await Promise.all(
    linked
      .filter(
        (reminder) =>
          reminder.kind === "fee_event" &&
          (reminder.status === "pending" || reminder.status === "snoozed") &&
          !enabledDays.has(reminder.daysBefore),
      )
      .map((reminder) =>
        reminders.save({ ...reminder, status: "cancelled", snoozedUntil: undefined }),
      ),
  );

  const profile = await auth.findUserById(userId);
  const timezone = profile?.timezone ?? "Asia/Shanghai";
  const pendingEvents = (await events.list(userId)).filter((event) => event.status === "pending");
  for (const event of pendingEvents) {
    await ensureFeeEventReminders(userId, event, timezone, [...enabledDays], reminders);
  }
  await recordAudit({
    userId,
    actorType: "user",
    actorId: userId,
    action: "reminder_rules.updated",
    entityType: "user",
    entityId: userId,
    metadata: { daysBefore: parsed.map((rule) => rule.daysBefore), enabledDays: [...enabledDays] },
  });
  return saved;
}
