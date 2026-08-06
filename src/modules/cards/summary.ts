import { formatISODate } from "../../shared/time";
import { cycleRepository, CycleRepository } from "../cycles";
import { feeEventRepository, FeeEventRepository } from "../fee-events";
import { applyProgressEntry, calculateProgress, progressRepository, ProgressRepository } from "../progress";
import { Card } from "./domain";
import { cardRepository, CardRepository } from "./repository";

export interface CardSummary extends Card {
  nextEvent?: { id: string; dueDate: string; status: string } | null;
  progress?: {
    qualified: boolean;
    percentage: number;
    count: number;
    amount: number;
    remainingCount?: number;
    remainingAmount?: number;
  } | null;
}

export type CardSummaryQuery = {
  search?: string;
  status?: Card["status"];
  feeStatus?: string;
  qualified?: boolean;
  dateFrom?: string;
  dateTo?: string;
  sortBy?: "due_date" | "remaining_count" | "remaining_amount" | "qualified" | "name" | "created_at";
  sortOrder?: "asc" | "desc";
};

export interface DashboardData {
  totalCards: number;
  activeCards: number;
  suspendedCards: number;
  archivedCards: number;
  pendingFeeEvents: number;
  upcomingFees: number;
  qualifiedCards: number;
  attentionCards: CardSummary[];
  cards: CardSummary[];
}

export async function listCardSummaries(
  userId: string,
  includeArchived = false,
  cards: CardRepository = cardRepository,
  cycles: CycleRepository = cycleRepository,
  events: FeeEventRepository = feeEventRepository,
  entries: ProgressRepository = progressRepository,
  query: CardSummaryQuery = {},
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
        remainingCount: calculated.remainingCount,
        remainingAmount: calculated.remainingAmount,
      };
    }

    result.push({
      ...card,
      nextEvent: nextEvent ? { id: nextEvent.id, dueDate: nextEvent.dueDate, status: nextEvent.status } : null,
      progress,
    });
  }

  const normalizedSearch = query.search?.trim().toLocaleLowerCase();
  const filtered = result.filter((card) => {
    if (query.status && card.status !== query.status) return false;
    if (query.feeStatus && card.nextEvent?.status !== query.feeStatus) return false;
    if (query.qualified !== undefined && Boolean(card.progress?.qualified) !== query.qualified) return false;
    if (query.dateFrom && (card.nextEvent?.dueDate ?? card.nextFeeDate) < query.dateFrom) return false;
    if (query.dateTo && (card.nextEvent?.dueDate ?? card.nextFeeDate) > query.dateTo) return false;
    if (
      normalizedSearch &&
      ![card.issuerName, card.name, card.last4].some((value) =>
        value.toLocaleLowerCase().includes(normalizedSearch),
      )
    ) {
      return false;
    }
    return true;
  });
  const direction = query.sortOrder === "desc" ? -1 : 1;
  const sortBy = query.sortBy ?? "due_date";
  return filtered.sort((a, b) => {
    let av: number | string;
    let bv: number | string;
    if (sortBy === "remaining_count") {
      av = a.progress?.remainingCount ?? 0;
      bv = b.progress?.remainingCount ?? 0;
    } else if (sortBy === "remaining_amount") {
      av = a.progress?.remainingAmount ?? 0;
      bv = b.progress?.remainingAmount ?? 0;
    } else if (sortBy === "qualified") {
      av = a.progress?.qualified ? 1 : 0;
      bv = b.progress?.qualified ? 1 : 0;
    } else if (sortBy === "name") {
      av = a.issuerName + a.name;
      bv = b.issuerName + b.name;
    } else if (sortBy === "created_at") {
      av = a.createdAt;
      bv = b.createdAt;
    } else {
      av = a.nextEvent?.dueDate ?? a.nextFeeDate;
      bv = b.nextEvent?.dueDate ?? b.nextFeeDate;
    }
    return (av < bv ? -1 : av > bv ? 1 : 0) * direction;
  });
}

export async function getDashboard(
  userId: string,
  includeArchived = false,
  cards: CardRepository = cardRepository,
  cycles: CycleRepository = cycleRepository,
  events: FeeEventRepository = feeEventRepository,
  entries: ProgressRepository = progressRepository,
): Promise<DashboardData> {
  const summaries = await listCardSummaries(userId, includeArchived, cards, cycles, events, entries);
  const today = formatISODate(new Date());
  const activeCards = summaries.filter((card) => card.status === "active");
  const attentionCards = summaries
    .filter((card) => card.status !== "archived" && card.progress && !card.progress.qualified)
    .sort((a, b) => {
      const aRemaining = (a.progress?.remainingCount ?? 0) + (a.progress?.remainingAmount ?? 0);
      const bRemaining = (b.progress?.remainingCount ?? 0) + (b.progress?.remainingAmount ?? 0);
      return bRemaining - aRemaining;
    })
    .slice(0, 6);
  return {
    totalCards: summaries.length,
    activeCards: activeCards.length,
    suspendedCards: summaries.filter((card) => card.status === "suspended").length,
    archivedCards: summaries.filter((card) => card.status === "archived").length,
    pendingFeeEvents: summaries.filter((card) => card.nextEvent?.status === "pending").length,
    upcomingFees: summaries.filter((card) => (card.nextEvent?.dueDate ?? card.nextFeeDate) >= today).length,
    qualifiedCards: summaries.filter((card) => card.progress?.qualified).length,
    attentionCards,
    cards: summaries,
  };
}
