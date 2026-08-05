import { getDatabase } from "../../shared/db/client";
import { createDrizzleRepositories } from "../../shared/db/repositories";
import { getMemoryStore } from "../../shared/store/memory";
import type { ReminderKind } from "./domain";

export const DEFAULT_FEE_EVENT_DAYS = [30, 7, 1] as const;

export interface ReminderRule {
  id: string;
  userId: string;
  cardId?: string;
  kind: ReminderKind;
  daysBefore: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ReminderRuleInput {
  id?: string;
  cardId?: string;
  kind: ReminderKind;
  daysBefore: number;
  enabled: boolean;
}

export interface ReminderRuleRepository {
  list(userId: string, kind?: ReminderKind): Promise<ReminderRule[]>;
  listGlobal(userId: string, kind?: ReminderKind): Promise<ReminderRule[]>;
  save(userId: string, input: ReminderRuleInput): Promise<ReminderRule>;
  remove(userId: string, id: string): Promise<boolean>;
}

export class InMemoryReminderRuleRepository implements ReminderRuleRepository {
  private readonly rules = getMemoryStore().reminderRules as Map<string, ReminderRule>;

  async list(userId: string, kind?: ReminderKind): Promise<ReminderRule[]> {
    return [...this.rules.values()]
      .filter((rule) => rule.userId === userId && (!kind || rule.kind === kind))
      .sort((a, b) => a.daysBefore - b.daysBefore);
  }

  async listGlobal(userId: string, kind?: ReminderKind): Promise<ReminderRule[]> {
    return (await this.list(userId, kind)).filter((rule) => !rule.cardId);
  }

  async save(userId: string, input: ReminderRuleInput): Promise<ReminderRule> {
    const existingId =
      input.id ??
      [...this.rules.values()].find(
        (rule) =>
          rule.userId === userId &&
          !rule.cardId &&
          rule.kind === input.kind &&
          rule.daysBefore === input.daysBefore,
      )?.id;
    const now = new Date().toISOString();
    const current = existingId ? this.rules.get(existingId) : undefined;
    const rule: ReminderRule = {
      ...(current ?? {
        id: existingId ?? crypto.randomUUID(),
        userId,
        createdAt: now,
      }),
      cardId: undefined,
      kind: input.kind,
      daysBefore: input.daysBefore,
      enabled: input.enabled,
      updatedAt: now,
    };
    this.rules.set(rule.id, rule);
    return rule;
  }

  async remove(userId: string, id: string): Promise<boolean> {
    const rule = this.rules.get(id);
    if (!rule || rule.userId !== userId) return false;
    this.rules.delete(id);
    return true;
  }
}

function createDefaultRepository(): ReminderRuleRepository {
  if (process.env.USE_DATABASE === "true") {
    return createDrizzleRepositories(getDatabase().db).reminderRules;
  }
  return new InMemoryReminderRuleRepository();
}

export const reminderRuleRepository: ReminderRuleRepository = createDefaultRepository();

export async function seedDefaultFeeEventRules(
  userId: string,
  repository: ReminderRuleRepository = reminderRuleRepository,
): Promise<ReminderRule[]> {
  const existing = await repository.listGlobal(userId, "fee_event");
  if (existing.length > 0) return existing;
  const saved: ReminderRule[] = [];
  for (const daysBefore of DEFAULT_FEE_EVENT_DAYS) {
    saved.push(await repository.save(userId, { kind: "fee_event", daysBefore, enabled: true }));
  }
  return saved;
}

export async function getFeeEventReminderDays(
  userId: string,
  repository: ReminderRuleRepository = reminderRuleRepository,
): Promise<number[]> {
  const rules =
    (await repository.listGlobal(userId, "fee_event")).length > 0
      ? await repository.listGlobal(userId, "fee_event")
      : await seedDefaultFeeEventRules(userId, repository);
  return rules
    .filter((rule) => rule.enabled)
    .map((rule) => rule.daysBefore)
    .sort((a, b) => b - a);
}
