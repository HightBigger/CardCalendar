import { Card, CardStatus, CreateCardInput } from "./domain";
import { getMemoryStore } from "../../shared/store/memory";
import { createDrizzleRepositories } from "../../shared/db/repositories";
import { getDatabase } from "../../shared/db/client";

export interface CardRepository {
  listAll(userId: string): Promise<Card[]>;
  list(userId: string, includeArchived?: boolean): Promise<Card[]>;
  get(userId: string, cardId: string): Promise<Card | undefined>;
  create(userId: string, input: CreateCardInput): Promise<Card>;
  update(userId: string, cardId: string, patch: Partial<CreateCardInput> & { status?: CardStatus }): Promise<Card | undefined>;
  createWithCycleAndEvent?(userId: string, input: CreateCardInput): Promise<Card>;
}

export class InMemoryCardRepository implements CardRepository {
  private readonly cards = getMemoryStore().cards as Map<string, Card>;
  async listAll(userId: string): Promise<Card[]> { return [...this.cards.values()].filter((card) => card.userId === userId); }
  async list(userId: string, includeArchived = false): Promise<Card[]> { return [...this.cards.values()].filter((card) => card.userId === userId && (includeArchived || card.status !== "archived")); }
  async get(userId: string, cardId: string): Promise<Card | undefined> { const card = this.cards.get(cardId); return card?.userId === userId ? card : undefined; }
  async create(userId: string, input: CreateCardInput): Promise<Card> {
    const now = new Date().toISOString(); const card: Card = { ...input, id: crypto.randomUUID(), userId, status: "active", annualFeeAmount: input.annualFeeAmount ?? 0, currency: input.currency ?? "CNY", waiveRuleType: input.waiveRuleType ?? "none", createdAt: now, updatedAt: now };
    this.cards.set(card.id, card); return card;
  }
  async update(userId: string, cardId: string, patch: Partial<CreateCardInput> & { status?: CardStatus }): Promise<Card | undefined> {
    const current = await this.get(userId, cardId); if (!current) return undefined;
    const updated = { ...current, ...patch, updatedAt: new Date().toISOString(), ...(patch.status === "archived" ? { archivedAt: new Date().toISOString() } : {}) };
    this.cards.set(cardId, updated); return updated;
  }
}

function createDefaultRepository(): CardRepository {
  if (process.env.USE_DATABASE === "true") {
    return createDrizzleRepositories(getDatabase().db).cards;
  }
  return new InMemoryCardRepository();
}

export const cardRepository: CardRepository = createDefaultRepository();
