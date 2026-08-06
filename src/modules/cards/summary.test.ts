import { describe, expect, it } from "vitest";
import { InMemoryCardRepository } from "./repository";
import { InMemoryCycleRepository } from "../cycles/repository";
import { InMemoryFeeEventRepository } from "../fee-events/repository";
import { InMemoryProgressRepository } from "../progress/repository";
import { getDashboard, listCardSummaries } from "./summary";

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

describe("dashboard aggregation", () => {
  it("counts statuses, qualified cards and returns attention cards sorted by remaining progress", async () => {
    const cards = new InMemoryCardRepository();
    const cycles = new InMemoryCycleRepository();
    const events = new InMemoryFeeEventRepository();
    const entries = new InMemoryProgressRepository();
    const userId = "dashboard-user";

    const qualified = await cards.create(userId, {
      issuerName: "银行A",
      name: "达标卡",
      last4: "1111",
      annualFeeAmount: 1000,
      currency: "CNY",
      feeCycleType: "custom",
      nextFeeDate: "2099-01-01",
      waiveRuleType: "count",
      targetCount: 10,
    });
    await cycles.save({
      id: "cycle-qualified",
      userId,
      cardId: qualified.id,
      periodStart: "2098-01-01",
      periodEnd: "2099-01-01",
      feeDueDate: "2099-01-01",
      waiveRuleType: "count",
      targetCount: 10,
      status: "open",
    });
    await events.create(userId, {
      cardId: qualified.id,
      cycleId: "cycle-qualified",
      dueDate: "2099-01-01",
      expectedAmount: 1000,
      status: "pending",
    });
    await entries.add({
      userId,
      cardId: qualified.id,
      cycleId: "cycle-qualified",
      entryDate: "2098-06-01",
      countDelta: 10,
      amountDelta: 0,
      note: "qualified",
      entryType: "manual",
    });

    const attention = await cards.create(userId, {
      issuerName: "银行B",
      name: "待关注卡",
      last4: "2222",
      annualFeeAmount: 800,
      currency: "CNY",
      feeCycleType: "custom",
      nextFeeDate: "2099-02-01",
      waiveRuleType: "count",
      targetCount: 10,
    });
    await cycles.save({
      id: "cycle-attention",
      userId,
      cardId: attention.id,
      periodStart: "2098-02-01",
      periodEnd: "2099-02-01",
      feeDueDate: "2099-02-01",
      waiveRuleType: "count",
      targetCount: 10,
      status: "open",
    });
    await events.create(userId, {
      cardId: attention.id,
      cycleId: "cycle-attention",
      dueDate: "2099-02-01",
      expectedAmount: 800,
      status: "pending",
    });
    await entries.add({
      userId,
      cardId: attention.id,
      cycleId: "cycle-attention",
      entryDate: "2098-06-02",
      countDelta: 3,
      amountDelta: 0,
      note: "in progress",
      entryType: "manual",
    });

    const archived = await cards.create(userId, {
      issuerName: "银行C",
      name: "归档卡",
      last4: "3333",
      annualFeeAmount: 500,
      currency: "CNY",
      feeCycleType: "custom",
      nextFeeDate: "2099-03-01",
      waiveRuleType: "none",
    });
    await cards.update(userId, archived.id, { status: "archived" });

    const dashboard = await getDashboard(userId, true, cards, cycles, events, entries);
    expect(dashboard).toMatchObject({
      totalCards: 3,
      activeCards: 2,
      archivedCards: 1,
      qualifiedCards: 1,
    });
    expect(dashboard.attentionCards).toHaveLength(1);
    expect(dashboard.attentionCards[0].id).toBe(attention.id);

    const sorted = await listCardSummaries(userId, true, cards, cycles, events, entries, {
      sortBy: "remaining_count",
      sortOrder: "desc",
    });
    expect(sorted.map((card) => card.id)).toEqual([attention.id, qualified.id, archived.id]);
  });
});
