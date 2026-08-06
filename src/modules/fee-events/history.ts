import { AuditLog, listAuditLogs } from "../../shared/audit";
import { Reminder, ReminderRepository, reminderRepository } from "../reminders";
import { FeeEventRepository, feeEventRepository } from "./repository";
import { getFeeEvent } from "./service";

export interface FeeEventReminderTimeline extends Reminder {
  history: AuditLog[];
}

export interface FeeEventTimeline {
  history: AuditLog[];
  reminders: FeeEventReminderTimeline[];
}

export async function getFeeEventTimeline(
  userId: string,
  eventId: string,
  events: FeeEventRepository = feeEventRepository,
  reminders: ReminderRepository = reminderRepository,
): Promise<FeeEventTimeline> {
  await getFeeEvent(userId, eventId, events);
  const history = await listAuditLogs(userId, "fee_event", eventId);
  const linked = (await reminders.list(userId, false)).filter(
    (reminder) => reminder.feeEventId === eventId,
  );
  const reminderHistory = await listAuditLogs(userId, "reminder");
  const reminderById = new Map(linked.map((reminder) => [reminder.id, reminder]));
  return {
    history,
    reminders: [...reminderById.values()].map((reminder) => ({
      ...reminder,
      history: reminderHistory.filter((log) => log.entityId === reminder.id),
    })),
  };
}
