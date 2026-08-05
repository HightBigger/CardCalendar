import { describe, expect, it } from "vitest";
import { addDays, addYears, formatISODate } from "../../shared/time";
import { InMemoryCardRepository } from "../cards/repository";
import { InMemoryCycleRepository } from "../cycles/repository";
import { InMemoryReminderRepository } from "../reminders/repository";
import { reconcileCardEvents } from "./reconcile";
import { InMemoryFeeEventRepository } from "./repository";

describe("fee event reconcile", () => {
  it("creates the next annual fee event after the current date", async () => {
    const cards = new InMemoryCardRepository();
    const cycles = new InMemoryCycleRepository();
    const events = new InMemoryFeeEventRepository();
    const reminders = new InMemoryReminderRepository();
    const today = formatISODate(new Date());
    const card = await cards.create("user-1", {
      issuerName: "测试银行",
      name: "白金卡",
      last4: "1234",
      annualFeeAmount: 1000,
      currency: "CNY",
      feeCycleType: "anniversary",
      openedOn: addYears(today, -1),
      nextFeeDate: today,
      waiveRuleType: "none",
    });

    const created = await reconcileCardEvents("user-1", card.id, "Asia/Shanghai", {
      cards,
      cycles,
      events,
      reminders,
    });

    const dueDates = (await events.list("user-1")).map((event) => event.dueDate);
    expect(created).toBeGreaterThanOrEqual(1);
    expect(dueDates).toContain(addYears(today, 1));
    expect((await reminders.list("user-1", false)).length).toBeGreaterThan(0);
  });

  it("closes expired cycles while reconciling", async () => {
    const cards = new InMemoryCardRepository();
    const cycles = new InMemoryCycleRepository();
    const events = new InMemoryFeeEventRepository();
    const reminders = new InMemoryReminderRepository();
    const today = formatISODate(new Date());
    const yesterday = addDays(today, -1);
    const card = await cards.create("user-1", {
      issuerName: "测试银行",
      name: "白金卡",
      last4: "1234",
      annualFeeAmount: 1000,
      currency: "CNY",
      feeCycleType: "anniversary",
      openedOn: addYears(today, -1),
      nextFeeDate: today,
      waiveRuleType: "none",
    });
    await cycles.save({
      id: "old-cycle",
      userId: "user-1",
      cardId: card.id,
      periodStart: addYears(yesterday, -1),
      periodEnd: yesterday,
      feeDueDate: yesterday,
      waiveRuleType: "none",
      status: "open",
    });

    await reconcileCardEvents("user-1", card.id, "Asia/Shanghai", {
      cards,
      cycles,
      events,
      reminders,
    });

    const cardCycles = await cycles.listByCard("user-1", card.id);
    expect(cardCycles.find((cycle) => cycle.id === "old-cycle")?.status).toBe("closed");
  });
});
