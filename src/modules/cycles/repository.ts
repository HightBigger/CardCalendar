import { FeeCycle } from "./domain";
import { getMemoryStore } from "../../shared/store/memory";
import { createDrizzleRepositories } from "../../shared/db/repositories";
import { getDatabase } from "../../shared/db/client";

export type OwnedFeeCycle = FeeCycle & { userId: string };
export interface CycleRepository { listByCard(userId: string, cardId: string): Promise<OwnedFeeCycle[]>; get(userId: string, id: string): Promise<OwnedFeeCycle | undefined>; save(cycle: OwnedFeeCycle): Promise<OwnedFeeCycle>; }

export class InMemoryCycleRepository implements CycleRepository {
  private readonly cycles = getMemoryStore().cycles as Map<string, OwnedFeeCycle>;
  async listByCard(userId: string, cardId: string) { return [...this.cycles.values()].filter((c) => c.userId === userId && c.cardId === cardId).sort((a, b) => b.periodStart.localeCompare(a.periodStart)); }
  async get(userId: string, id: string) { const cycle = this.cycles.get(id); return cycle?.userId === userId ? cycle : undefined; }
  async save(cycle: OwnedFeeCycle) { this.cycles.set(cycle.id, cycle); return cycle; }
}

function createDefaultRepository(): CycleRepository {
  if (process.env.USE_DATABASE === "true") {
    return createDrizzleRepositories(getDatabase().db).cycles;
  }
  return new InMemoryCycleRepository();
}

export const cycleRepository: CycleRepository = createDefaultRepository();
