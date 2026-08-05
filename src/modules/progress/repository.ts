import { ISODate } from "../../shared/time";
import { getMemoryStore } from "../../shared/store/memory";
import { createDrizzleRepositories } from "../../shared/db/repositories";
import { getDatabase } from "../../shared/db/client";

export interface ProgressEntry { id: string; userId: string; cardId: string; cycleId: string; entryDate: ISODate; countDelta: number; amountDelta: number; note?: string; createdAt: string; entryType?: "manual" | "correction" | "reversal"; reversedAt?: string; }
export type ProgressEntryUpdate = Partial<Pick<ProgressEntry, "entryDate" | "countDelta" | "amountDelta" | "note">>;
export interface ProgressRepository { list(userId: string, cycleId: string): Promise<ProgressEntry[]>; get(userId: string, cycleId: string, entryId: string): Promise<ProgressEntry | undefined>; markReversed(userId: string, cycleId: string, entryId: string): Promise<ProgressEntry | undefined>; add(entry: Omit<ProgressEntry, "id" | "createdAt">): Promise<ProgressEntry>; update(userId: string, cycleId: string, entryId: string, patch: ProgressEntryUpdate): Promise<ProgressEntry | undefined>; }

export class InMemoryProgressRepository implements ProgressRepository {
  private readonly entries = getMemoryStore().progressEntries as Map<string, ProgressEntry>;
  async list(userId: string, cycleId: string) { return [...this.entries.values()].filter((e) => e.userId === userId && e.cycleId === cycleId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
  async get(userId: string, cycleId: string, entryId: string) { const entry = this.entries.get(entryId); return entry?.userId === userId && entry.cycleId === cycleId ? entry : undefined; }
  async markReversed(userId: string, cycleId: string, entryId: string) {
    const entry = await this.get(userId, cycleId, entryId);
    if (!entry || entry.reversedAt) return undefined;
    const updated = { ...entry, reversedAt: new Date().toISOString() };
    this.entries.set(entryId, updated);
    return updated;
  }
  async add(input: Omit<ProgressEntry, "id" | "createdAt">) { const entry: ProgressEntry = { ...input, id: crypto.randomUUID(), createdAt: new Date().toISOString() }; this.entries.set(entry.id, entry); return entry; }
  async update(userId: string, cycleId: string, entryId: string, patch: ProgressEntryUpdate) { const entry = await this.get(userId, cycleId, entryId); if (!entry) return undefined; const updated = { ...entry, ...patch, createdAt: entry.createdAt }; this.entries.set(entryId, updated); return updated; }
}

function createDefaultRepository(): ProgressRepository {
  if (process.env.USE_DATABASE === "true") {
    return createDrizzleRepositories(getDatabase().db).progress;
  }
  return new InMemoryProgressRepository();
}

export const progressRepository: ProgressRepository = createDefaultRepository();
