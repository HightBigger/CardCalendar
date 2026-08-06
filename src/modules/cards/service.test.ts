import { describe, expect, it } from "vitest";
import { InMemoryAuthRepository } from "../auth/repository";
import { InMemoryCycleRepository } from "../cycles/repository";
import { InMemoryFeeEventRepository } from "../fee-events/repository";
import { reminderSchedule } from "../reminders/domain";
import { InMemoryReminderRepository } from "../reminders/repository";
import { ensureFeeEventReminders } from "../reminders/service";
import { InMemoryCardRepository } from "./repository";
import { archiveCard, restoreCard, updateCard } from "./service";

async function createFixture() {
  const cards = new InMemoryCardRepository();
  const cycles = new InMemoryCycleRepository();
  const events = new InMemoryFeeEventRepository();
  const reminders = new InMemoryReminderRepository();
  const auth = new InMemoryAuthRepository();
  const user = await auth.createUser({
    email: "card-sync@example.com",
    passwordHash: "test-only",
    timezone: "Asia/Shanghai",
  });
  const card = await cards.create(user.id, {
    issuerName: "测试银行",
    name: "经典白金卡",
    last4: "1234",
    annualFeeAmount: 1000,
    currency: "CNY",
    feeCycleType: "anniversary",
    openedOn: "2024-08-15",
    nextFeeDate: "2026-08-15",
    waiveRuleType: "none",
  });
  await cycles.save({
    id: "cycle-1",
    userId: user.id,
    cardId: card.id,
    periodStart: "2025-08-15",
    periodEnd: "2026-08-15",
    feeDueDate: "2026-08-15",
    waiveRuleType: "none",
    status: "open",
  });
  const event = await events.create(user.id, {
    cardId: card.id,
    cycleId: "cycle-1",
    dueDate: "2026-08-15",
    expectedAmount: 1000,
    status: "pending",
  });
  await ensureFeeEventReminders(user.id, event, "Asia/Shanghai", [30, 7, 1], reminders);
  return { auth, cards, cycles, events, reminders, user, card, event };
}

describe("card schedule sync", () => {
  it("updates the open cycle, pending fee event and reminders when card details change", async () => {
    const fixture = await createFixture();

    const updated = await updateCard(
      fixture.user.id,
      fixture.card.id,
      { nextFeeDate: "2027-08-20", annualFeeAmount: 1200 },
      fixture.cards,
      fixture.cycles,
      fixture.events,
      fixture.reminders,
      fixture.auth,
    );

    expect(updated.nextFeeDate).toBe("2027-08-20");
    expect(updated.annualFeeAmount).toBe(1200);

    const [cycle] = await fixture.cycles.listByCard(fixture.user.id, fixture.card.id);
    expect(cycle).toMatchObject({
      id: "cycle-1",
      periodStart: "2026-08-20",
      periodEnd: "2027-08-20",
      feeDueDate: "2027-08-20",
    });

    const event = (await fixture.events.list(fixture.user.id)).find(
      (item) => item.id === fixture.event.id,
    );
    expect(event).toMatchObject({ dueDate: "2027-08-20", expectedAmount: 1200 });

    const active = await fixture.reminders.list(fixture.user.id, true);
    expect(active).toHaveLength(3);
    for (const reminder of active) {
      const [schedule] = reminderSchedule("2027-08-20", "Asia/Shanghai", [
        reminder.daysBefore,
      ]);
      expect(reminder.scheduledFor.toISOString()).toBe(schedule.scheduledFor.toISOString());
    }
  });

  it("cancels pending card reminders after archiving", async () => {
    const fixture = await createFixture();

    const archived = await archiveCard(
      fixture.user.id,
      fixture.card.id,
      fixture.cards,
      fixture.reminders,
    );

    expect(archived.status).toBe("archived");
    const all = await fixture.reminders.list(fixture.user.id, false);
    const cardReminders = all.filter((reminder) => reminder.cardId === fixture.card.id);
    expect(cardReminders).toHaveLength(3);
    expect(cardReminders.every((reminder) => reminder.status === "cancelled")).toBe(true);
  });

  it("restores an archived card and recreates pending reminders", async () => {
    const fixture = await createFixture();
    await archiveCard(fixture.user.id, fixture.card.id, fixture.cards, fixture.reminders);

    const restored = await restoreCard(
      fixture.user.id,
      fixture.card.id,
      fixture.cards,
      fixture.events,
      fixture.reminders,
      fixture.auth,
    );

    expect(restored.status).toBe("active");
    const all = await fixture.reminders.list(fixture.user.id, false);
    const cardReminders = all.filter((reminder) => reminder.cardId === fixture.card.id);
    expect(cardReminders).toHaveLength(3);
    expect(cardReminders.every((reminder) => reminder.status === "pending")).toBe(true);
  });

  it("updates card status, currency, notes and progress period", async () => {
    const fixture = await createFixture();

    const updated = await updateCard(
      fixture.user.id,
      fixture.card.id,
      {
        status: "suspended",
        currency: "USD",
        notes: "海外消费卡",
        progressPeriodStart: "2026-08-01",
        progressPeriodEnd: "2026-08-31",
      },
      fixture.cards,
      fixture.cycles,
      fixture.events,
      fixture.reminders,
      fixture.auth,
    );

    expect(updated).toMatchObject({
      status: "suspended",
      currency: "USD",
      notes: "海外消费卡",
      progressPeriodStart: "2026-08-01",
      progressPeriodEnd: "2026-08-31",
    });

    const archived = await updateCard(
      fixture.user.id,
      fixture.card.id,
      { status: "archived" },
      fixture.cards,
      fixture.cycles,
      fixture.events,
      fixture.reminders,
      fixture.auth,
    );
    expect(archived.status).toBe("archived");
  });
});
