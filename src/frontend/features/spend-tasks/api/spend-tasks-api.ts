import type { SpendDraft, SpendTask, SpendWrite } from "../../../../contracts/spend-tasks";
import type { CommandResult, Envelope } from "../../../../contracts/workbench";
import { apiCommand, apiJson } from "../../../shared/http";
export interface SpendTasksApi {
  detail(id: string, signal: AbortSignal): Promise<Envelope<SpendTask>>;
  observation(task: SpendTask, draft: SpendDraft, key: string, signal: AbortSignal): Promise<CommandResult<SpendWrite>>;
  entry(task: SpendTask, draft: SpendDraft, key: string, signal: AbortSignal): Promise<CommandResult<SpendWrite>>;
  link(task: SpendTask, factId: string, key: string, signal: AbortSignal): Promise<CommandResult<SpendWrite>>;
  qualify(task: SpendTask, status: string, note: string, key: string, signal: AbortSignal): Promise<CommandResult<SpendWrite>>;
}
export const spendTasksApi: SpendTasksApi = {
  detail: (id, signal) => apiJson("/api/v1/spend-tasks/" + encodeURIComponent(id), { signal }),
  observation: (task, draft, key, signal) => apiCommand("/api/v1/spend-tasks/" + encodeURIComponent(task.id) + "/observations", { ...draft, expectedVersion: task.version }, key, { signal }),
  entry: (task, draft, key, signal) => apiCommand("/api/v1/activity-participations/" + encodeURIComponent(task.participationId) + "/spend-entries", { ...draft, taskVersion: task.version, evaluateTaskIds: [task.id] }, key, { signal }),
  link: (task, spendFactId, key, signal) => apiCommand("/api/v1/spend-tasks/" + encodeURIComponent(task.id) + "/evaluations", { spendFactId, expectedVersion: task.version }, key, { signal }),
  qualify: (task, status, note, key, signal) => apiCommand("/api/v1/spend-tasks/" + encodeURIComponent(task.id) + "/qualification", { status, note, ...task.qualificationScope, expectedVersion: task.version }, key, { signal }),
};
