import { describe, expect, it } from "vitest";
import { recordAudit } from "../../shared/audit";
import { InMemoryReminderRepository } from "../reminders/repository";
import { actOnReminder, ensureFeeEventReminders } from "../reminders/service";
import { getFeeEventTimeline } from "./history";
import { InMemoryFeeEventRepository } from "./repository";

describe("fee event timeline", () => {
  it("returns fee event status history and linked reminder history", async () => {
    const events = new InMemoryFeeEventRepository();
    const reminders = new InMemoryReminderRepository();
    const userId = "timeline-user";
    const event = await events.create(userId, {
      cardId: "timeline-card",
      cycleId: "timeline-cycle",
      dueDate: "2026-08-20",
      expectedAmount: 1200,
      status: "pending",
    });

    await ensureFeeEventReminders(userId, event, "Asia/Shanghai", [7], reminders);
    const [reminder] = await reminders.list(userId, true);
    await actOnReminder(userId, reminder.id, { action: "complete" }, reminders);
    await recordAudit({
      userId,
      actorType: "user",
      actorId: userId,
      action: "fee_event.status_changed",
      entityType: "fee_event",
      entityId: event.id,
      metadata: { fromStatus: "pending", toStatus: "waived" },
    });

    const timeline = await getFeeEventTimeline(userId, event.id, events, reminders);

    expect(timeline.history).toHaveLength(1);
    expect(timeline.history[0]).toMatchObject({
      action: "fee_event.status_changed",
      entityId: event.id,
    });
    expect(timeline.reminders).toHaveLength(1);
    expect(timeline.reminders[0]).toMatchObject({
      status: "completed",
      feeEventId: event.id,
    });
    expect(timeline.reminders[0].history).toHaveLength(1);
    expect(timeline.reminders[0].history[0]).toMatchObject({
      action: "reminder.action",
      entityId: reminder.id,
    });
  });
});
