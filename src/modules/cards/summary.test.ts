import { describe, expect, it } from "vitest";
import { InMemoryCardRepository } from "./repository";
import { InMemoryCycleRepository } from "../cycles/repository";
import { InMemoryFeeEventRepository } from "../fee-events/repository";
import { InMemoryProgressRepository } from "../progress/repository";
import { listCardSummaries } from "./summary";

describe("card summary", () => {
  it("attaches next fee event status and current progress to each card", async () => {
    const cards = new InMemoryCardRepository();
    const cycles = new InMemoryCycleRepository();
    const events = new InMemoryFeeEventRepository();
    const entries = new InMemoryProgressRepository();

    const card = await cards.create("user-1", {
      issuerName: "招商银行",
      name: "经典白金",
      last4: "1234",
      annualFeeAmount: 3600,
      currency: "CNY",
      feeCycleType: "anniversary",
      openedOn: "2025-08-06",
      nextFeeDate: "2026-08-06",
      waiveRuleType: "count",
      targetCount: 12,
    });
    await cycles.save({
      id: "cycle-1",
      userId: "user-1",
      cardId: card.id,
      periodStart: "2025-08-06",
      periodEnd: "2026-08-06",
      feeDueDate: "2026-08-06",
      waiveRuleType: "count",
      targetCount: 12,
      status: "open",
    });
    await events.create("user-1", {
      cardId: card.id,
      cycleId: "cycle-1",
      dueDate: "2026-08-06",
      expectedAmount: 3600,
      status: "pending",
    });
    await entries.add({
      userId: "user-1",
      cardId: card.id,
      cycleId: "cycle-1",
      entryDate: "2026-08-06",
      countDelta: 5,
      amountDelta: 0,
      note: "manual",
      entryType: "manual",
    });

    const result = await listCardSummaries("user-1", true, cards, cycles, events, entries);

    expect(result).toHaveLength(1);
    expect(result[0].nextEvent).toMatchObject({ status: "pending", dueDate: "2026-08-06" });
    expect(result[0].progress).toMatchObject({ qualified: false, percentage: 42, count: 5, amount: 0 });
  });
});
