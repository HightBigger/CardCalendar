import { AppError } from "../../shared/errors";
import { cycleRepository, CycleRepository } from "./repository";

export async function listCycles(userId: string, cardId: string, repository: CycleRepository = cycleRepository) { return repository.listByCard(userId, cardId); }
export async function getCycle(userId: string, id: string, repository: CycleRepository = cycleRepository) { const cycle = await repository.get(userId, id); if (!cycle) throw new AppError("NOT_FOUND", "年费周期不存在"); return cycle; }

