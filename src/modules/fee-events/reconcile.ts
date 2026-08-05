import { compareDates, formatISODate } from "../../shared/time";
import { authRepository } from "../auth/repository";
import { cardRepository, CardRepository } from "../cards/repository";
import { cycleForFeeDate } from "../cycles/domain";
import { cycleRepository, CycleRepository } from "../cycles/repository";
import { generateFeeDates } from "../fee-rules";
import { reminderRepository, ReminderRepository } from "../reminders/repository";
import { ensureFeeEventReminders } from "../reminders/service";
import { feeEventRepository, FeeEventRepository } from "./repository";

export interface ReconcileRepositories {
  cards?: CardRepository;
  cycles?: CycleRepository;
  events?: FeeEventRepository;
  reminders?: ReminderRepository;
}

export async function reconcileCardEvents(
  userId: string,
  cardId: string,
  timezone = "Asia/Shanghai",
  repositories: ReconcileRepositories = {},
) {
  const cards = repositories.cards ?? cardRepository;
  const cycles = repositories.cycles ?? cycleRepository;
  const events = repositories.events ?? feeEventRepository;
  const reminders = repositories.reminders ?? reminderRepository;
  const card = await cards.get(userId, cardId);
  if (!card || card.status === "archived") return 0;

  const existing = new Set(
    (await events.list(userId))
      .filter((event) => event.cardId === cardId)
      .map((event) => event.dueDate),
  );
  const today = formatISODate(new Date());
  const cardCycles = await cycles.listByCard(userId, cardId);
  for (const cycle of cardCycles) {
    if (
      (cycle.status === "open" || cycle.status === "qualified") &&
      compareDates(cycle.periodEnd, today) < 0
    ) {
      await cycles.save({ ...cycle, status: "closed" });
    }
  }
  const dates = generateFeeDates(
    {
      cycleType: card.feeCycleType,
      openedOn: card.openedOn,
      feeMonth: card.feeMonth,
      feeDay: card.feeDay,
      nextFeeDate: card.nextFeeDate,
    },
    today,
    12,
  );

  let created = 0;
  for (const dueDate of dates) {
    if (existing.has(dueDate)) continue;
    const cycle = cycleForFeeDate(cardId, dueDate, {
      cycleType: card.feeCycleType,
      openedOn: card.openedOn,
      waiveRuleType: card.waiveRuleType,
      targetCount: card.targetCount,
      targetAmount: card.targetAmount,
    });
    await cycles.save({ ...cycle, userId });
    const event = await events.create(userId, {
      cardId,
      cycleId: cycle.id,
      dueDate,
      expectedAmount: card.annualFeeAmount,
      status: "pending",
    });
    await ensureFeeEventReminders(userId, event, timezone, undefined, reminders);
    created += 1;
  }
  return created;
}

export async function runCalendarReconcile(
  repositories: ReconcileRepositories = {},
) {
  const cards = repositories.cards ?? cardRepository;
  const users = await authRepository.listActiveUsers();
  let cardCount = 0;
  let createdEvents = 0;
  for (const user of users) {
    const userCards = await cards.list(user.id);
    cardCount += userCards.length;
    for (const card of userCards) {
      createdEvents += await reconcileCardEvents(
        user.id,
        card.id,
        user.timezone,
        repositories,
      );
    }
  }
  return { users: users.length, cards: cardCount, createdEvents };
}
