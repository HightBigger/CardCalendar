import { FeeEvent, FeeEventStatusInput } from "./domain";
import { ISODate } from "../../shared/time";
import { getMemoryStore } from "../../shared/store/memory";
import { createDrizzleRepositories } from "../../shared/db/repositories";
import { getDatabase } from "../../shared/db/client";

export interface FeeEventUpdate {
  cycleId?: string;
  dueDate?: ISODate;
  expectedAmount?: number;
}

export interface FeeEventRepository { list(userId: string, range?: { from?: ISODate; to?: ISODate }): Promise<FeeEvent[]>; get(userId: string, id: string): Promise<FeeEvent | undefined>; create(userId: string, input: Omit<FeeEvent, "id" | "userId" | "createdAt" | "updatedAt">): Promise<FeeEvent>; updateDetails(userId: string, id: string, patch: FeeEventUpdate): Promise<FeeEvent | undefined>; updateStatus(userId: string, id: string, input: FeeEventStatusInput): Promise<FeeEvent | undefined>; }

export class InMemoryFeeEventRepository implements FeeEventRepository {
  private readonly events = getMemoryStore().feeEvents as Map<string, FeeEvent>;
  async list(userId: string, range?: { from?: ISODate; to?: ISODate }): Promise<FeeEvent[]> { return [...this.events.values()].filter((e) => e.userId === userId && (!range?.from || e.dueDate >= range.from) && (!range?.to || e.dueDate <= range.to)).sort((a, b) => a.dueDate.localeCompare(b.dueDate)); }
  async get(userId: string, id: string): Promise<FeeEvent | undefined> { const event = this.events.get(id); return event?.userId === userId ? event : undefined; }
  async create(userId: string, input: Omit<FeeEvent, "id" | "userId" | "createdAt" | "updatedAt">): Promise<FeeEvent> { const now = new Date().toISOString(); const event: FeeEvent = { ...input, id: crypto.randomUUID(), userId, createdAt: now, updatedAt: now }; this.events.set(event.id, event); return event; }
  async updateStatus(userId: string, id: string, input: FeeEventStatusInput): Promise<FeeEvent | undefined> { const current = await this.get(userId, id); if (!current) return undefined; const updated: FeeEvent = { ...current, ...input, resolvedAt: input.status === "pending" ? undefined : new Date().toISOString(), updatedAt: new Date().toISOString() }; this.events.set(id, updated); return updated; }
  async updateDetails(userId: string, id: string, patch: FeeEventUpdate): Promise<FeeEvent | undefined> { const current = await this.get(userId, id); if (!current) return undefined; const updated: FeeEvent = { ...current, ...patch, updatedAt: new Date().toISOString() }; this.events.set(id, updated); return updated; }
}

function createDefaultRepository(): FeeEventRepository {
  if (process.env.USE_DATABASE === "true") {
    return createDrizzleRepositories(getDatabase().db).feeEvents;
  }
  return new InMemoryFeeEventRepository();
}

export const feeEventRepository: FeeEventRepository = createDefaultRepository();
