import { Reminder } from "./domain";
import { getMemoryStore } from "../../shared/store/memory";
import { createDrizzleRepositories } from "../../shared/db/repositories";
import { getDatabase } from "../../shared/db/client";

export interface ReminderRepository { list(userId: string, pendingOnly?: boolean): Promise<Reminder[]>; get(userId: string, id: string): Promise<Reminder | undefined>; save(reminder: Reminder): Promise<Reminder>; }
export class InMemoryReminderRepository implements ReminderRepository {
  private readonly reminders = getMemoryStore().reminders as Map<string, Reminder>;
  async list(userId: string, pendingOnly = true) { return [...this.reminders.values()].filter((r) => r.userId === userId && (!pendingOnly || r.status === "pending" || r.status === "snoozed")).sort((a, b) => a.scheduledFor.getTime() - b.scheduledFor.getTime()); }
  async get(userId: string, id: string) { const reminder = this.reminders.get(id); return reminder?.userId === userId ? reminder : undefined; }
  async save(reminder: Reminder) { this.reminders.set(reminder.id, reminder); return reminder; }
}
function createDefaultRepository(): ReminderRepository {
  if (process.env.USE_DATABASE === "true") {
    return createDrizzleRepositories(getDatabase().db).reminders;
  }
  return new InMemoryReminderRepository();
}

export const reminderRepository: ReminderRepository = createDefaultRepository();
