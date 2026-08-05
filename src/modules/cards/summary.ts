import { formatISODate } from "../../shared/time";
import { cycleRepository, CycleRepository } from "../cycles";
import { feeEventRepository, FeeEventRepository } from "../fee-events";
import { applyProgressEntry, calculateProgress, progressRepository, ProgressRepository } from "../progress";
import { Card } from "./domain";
import { cardRepository, CardRepository } from "./repository";

export interface CardSummary extends Card {
  nextEvent?: { id: string; dueDate: string; status: string } | null;
  progress?: { qualified: boolean; percentage: number; count: number; amount: number } | null;
}

export async function listCardSummaries(
  userId: string,
  includeArchived = false,
  cards: CardRepository = cardRepository,
  cycles: CycleRepository = cycleRepository,
  events: FeeEventRepository = feeEventRepository,
  entries: ProgressRepository = progressRepository,
): Promise<CardSummary[]> {
  const allCards = await cards.list(userId, includeArchived);
  const userEvents = await events.list(userId);
  const today = formatISODate(new Date());
  const result: CardSummary[] = [];

  for (const card of allCards) {
    const cardEvents = userEvents
      .filter((event) => event.cardId === card.id)
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    const nextEvent = cardEvents.find((event) => event.dueDate >= today) ?? cardEvents[cardEvents.length - 1];

    const cardCycles = await cycles.listByCard(userId, card.id);
    const activeCycle =
      cardCycles.find((cycle) => cycle.status === "open" || cycle.status === "qualified") ??
      cardCycles[0];
    let progress: CardSummary["progress"] = null;
    if (activeCycle) {
      const all = await entries.list(userId, activeCycle.id);
      const value = all.reduce(
        (sum, item) => applyProgressEntry(sum, { count: item.countDelta, amount: item.amountDelta }),
        { count: 0, amount: 0 },
      );
      const calculated = calculateProgress(
        { type: activeCycle.waiveRuleType, targetCount: activeCycle.targetCount, targetAmount: activeCycle.targetAmount },
        value,
      );
      progress = {
        qualified: calculated.qualified,
        percentage: calculated.percentage,
        count: calculated.count,
        amount: calculated.amount,
      };
    }

    result.push({
      ...card,
      nextEvent: nextEvent ? { id: nextEvent.id, dueDate: nextEvent.dueDate, status: nextEvent.status } : null,
      progress,
    });
  }

  return result;
}
