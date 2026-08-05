import { describe, expect, it } from "vitest";
import type { Reminder } from "./domain";
import type { ReminderRepository } from "./repository";
import { ensureFeeEventReminders } from "./service";

function createRepository() {
  const store = new Map<string, Reminder>();
  const repository: ReminderRepository = {
    async list(userId, pendingOnly = true) {
      return [...store.values()]
        .filter(
          (reminder) =>
            reminder.userId === userId &&
            (!pendingOnly || reminder.status === "pending" || reminder.status === "snoozed"),
        )
        .sort((a, b) => a.scheduledFor.getTime() - b.scheduledFor.getTime());
    },
    async get(userId, id) {
      const reminder = store.get(id);
      return reminder?.userId === userId ? reminder : undefined;
    },
    async save(reminder) {
      store.set(reminder.id, reminder);
      return reminder;
    },
  };
  return repository;
}

describe("ensureFeeEventReminders", () => {
  it("creates 30/7/1 day reminders once and is idempotent", async () => {
    const repository = createRepository();
    const event = {
      id: "event-1",
      cardId: "card-1",
      cycleId: "cycle-1",
      dueDate: "2026-08-15",
    };

    const first = await ensureFeeEventReminders(
      "user-1",
      event,
      "Asia/Shanghai",
      [30, 7, 1],
      repository,
    );
    expect(first).toHaveLength(3);
    expect(new Set(first.map((item) => item.daysBefore))).toEqual(new Set([30, 7, 1]));
    expect(first.every((item) => item.feeEventId === "event-1" && item.feeCycleId === undefined)).toBe(true);

    const second = await ensureFeeEventReminders(
      "user-1",
      event,
      "Asia/Shanghai",
      [30, 7, 1],
      repository,
    );
    expect(second).toHaveLength(3);
  });
});
