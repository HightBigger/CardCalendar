import { describe, expect, it } from "vitest";
import { InMemoryAuthRepository } from "../auth/repository";
import { InMemoryCardRepository } from "../cards/repository";
import { InMemoryCycleRepository } from "../cycles/repository";
import { InMemoryFeeEventRepository } from "../fee-events/repository";
import { InMemoryReminderRepository } from "./repository";
import { getFeeEventReminderDays, InMemoryReminderRuleRepository } from "./rules";
import { saveFeeEventReminderRules } from "./rules-service";
import { ensureFeeEventReminders } from "./service";

describe("reminder rules", () => {
  it("seeds the default 30/7/1 fee event days", async () => {
    const rules = new InMemoryReminderRuleRepository();

    const days = await getFeeEventReminderDays("user-1", rules);
    expect(days).toEqual([30, 7, 1]);
    expect(await rules.listGlobal("user-1", "fee_event")).toHaveLength(3);
  });

  it("replaces nodes and keeps existing reminders aligned after saving", async () => {
    const rules = new InMemoryReminderRuleRepository();
    const reminders = new InMemoryReminderRepository();
    const events = new InMemoryFeeEventRepository();
    const cycles = new InMemoryCycleRepository();
    const cards = new InMemoryCardRepository();
    const auth = new InMemoryAuthRepository();
    const user = await auth.createUser({
      email: "rules@example.com",
      passwordHash: "test-only",
      timezone: "Asia/Shanghai",
    });
    const card = await cards.create(user.id, {
      issuerName: "测试银行",
      name: "白金卡",
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

    await saveFeeEventReminderRules(
      user.id,
      { rules: [{ daysBefore: 60, enabled: true }, { daysBefore: 1, enabled: true }] },
      rules,
      reminders,
      events,
      auth,
    );

    const stored = await rules.listGlobal(user.id, "fee_event");
    expect(stored.map((rule) => rule.daysBefore).sort((a, b) => a - b)).toEqual([1, 60]);
    expect(stored.every((rule) => rule.enabled)).toBe(true);

    const all = await reminders.list(user.id, false);
    const byDay = new Map(all.map((reminder) => [reminder.daysBefore, reminder]));
    expect(byDay.get(30)?.status).toBe("cancelled");
    expect(byDay.get(7)?.status).toBe("cancelled");
    expect(byDay.get(1)?.status).toBe("pending");
    expect(byDay.get(60)?.status).toBe("pending");
  });
});
