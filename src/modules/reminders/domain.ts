import { addDays, ISODate, localDateTimeToInstant } from "../../shared/time";

export type ReminderStatus = "pending" | "completed" | "snoozed" | "ignored" | "cancelled";
export type ReminderKind = "fee_event" | "progress";

export interface ReminderSchedule {
  daysBefore: number;
  scheduledFor: Date;
}

export interface Reminder {
  id: string;
  userId: string;
  cardId?: string;
  feeEventId?: string;
  feeCycleId?: string;
  kind: ReminderKind;
  daysBefore: number;
  scheduledFor: Date;
  status: ReminderStatus;
  snoozedUntil?: Date;
  completedAt?: Date;
}

export function reminderSchedule(
  feeDate: ISODate,
  timezone: string,
  daysBefore: number[],
  hour = 9,
): ReminderSchedule[] {
  const unique = [...new Set(daysBefore)]
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 3650)
    .sort((a, b) => b - a);
  return unique.map((offset) => ({
    daysBefore: offset,
    scheduledFor: localDateTimeToInstant(addDays(feeDate, -offset), hour, timezone),
  }));
}

export function canTransitionReminder(
  from: ReminderStatus,
  to: ReminderStatus,
): boolean {
  if (from !== "pending" && from !== "snoozed") return false;
  return (
    to === "completed" ||
    to === "ignored" ||
    to === "snoozed" ||
    to === "cancelled"
  );
}
