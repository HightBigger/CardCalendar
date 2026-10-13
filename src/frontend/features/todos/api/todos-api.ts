import type { CustomTodoDraft, TodoAction, TodoCalendar, TodoCommand, TodoCommit, TodoFilters, TodoList } from "../../../../contracts/todos";
import type { CommandResult, Envelope } from "../../../../contracts/workbench";
import { apiCommand, apiJson } from "../../../shared/http";
import { todoParams } from "../model/filters";
export interface TodosApi {
  attention(signal: AbortSignal): Promise<Envelope<TodoList>>;
  list(filters: TodoFilters, signal: AbortSignal, cursor?: string, asOf?: string): Promise<Envelope<TodoList>>;
  calendar(filters: TodoFilters, signal: AbortSignal): Promise<Envelope<TodoCalendar>>;
  detail(id: string, signal: AbortSignal): Promise<Envelope<TodoAction>>;
  command(id: string, command: TodoCommand, key: string, signal: AbortSignal): Promise<CommandResult<TodoCommit>>;
  create(draft: CustomTodoDraft, key: string, signal: AbortSignal): Promise<CommandResult<TodoCommit>>;
  update(id: string, draft: CustomTodoDraft & { expectedVersion: number }, key: string, signal: AbortSignal): Promise<CommandResult<TodoCommit>>;
}
export const todosApi: TodosApi = {
  attention: (signal) => apiJson("/api/v1/workbench/attention?limit=5", { signal }),
  list: (filters, signal, cursor, asOf) => { const params = todoParams(filters); if (cursor) params.set("cursor", cursor); if (asOf) params.set("asOf", asOf); return apiJson("/api/v1/todos?" + params, { signal }); },
  calendar: (filters, signal) => apiJson("/api/v1/calendar-entries?" + todoParams(filters, true), { signal }),
  detail: (id, signal) => apiJson("/api/v1/todos/" + encodeURIComponent(id), { signal }),
  command: (id, command, key, signal) => apiCommand("/api/v1/todos/" + encodeURIComponent(id) + "/actions", command, key, { signal }),
  create: (draft, key, signal) => apiCommand("/api/v1/todos", draft, key, { signal }),
  update: (id, draft, key, signal) => apiCommand("/api/v1/todos/" + encodeURIComponent(id), draft, key, { method: "PATCH", signal }),
};
