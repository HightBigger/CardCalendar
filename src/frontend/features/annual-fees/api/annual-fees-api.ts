import type { ApiCard, ApiCycle, ApiFeeEvent, ApiFeeEventTimeline, CardDetail, ProgressData } from "../../../../contracts/mvp";
import { apiJson } from "../../../shared/http";
export const annualFeesApi = {
  events: (signal: AbortSignal) => apiJson<ApiFeeEvent[]>("/api/v1/fee-events", { signal }),
  async detail(card: ApiCard, events: ApiFeeEvent[], signal: AbortSignal) {
    const cycles = (await apiJson<ApiCycle[]>("/api/v1/cards/" + encodeURIComponent(card.id) + "/cycles", { signal })).data;
    const progress = await Promise.all(cycles.map(async (cycle) => [cycle.id, (await apiJson<ProgressData>("/api/v1/cycles/" + encodeURIComponent(cycle.id) + "/progress-entries", { signal })).data] as const));
    const history = await Promise.all(events.filter((event) => event.cardId === card.id).map(async (event) => [event.id, (await apiJson<ApiFeeEventTimeline>("/api/v1/fee-events/" + encodeURIComponent(event.id) + "/history", { signal })).data] as const));
    return { data: { card, cycles, progress: Object.fromEntries(progress), eventHistory: Object.fromEntries(history.map(([id, timeline]) => [id, timeline.history])), reminderTimeline: Object.fromEntries(history.map(([id, timeline]) => [id, timeline.reminders])) } satisfies CardDetail };
  },
  progress: (cycleId: string, payload: unknown, entryId?: string, reverse = false) => apiJson<ProgressData>("/api/v1/cycles/" + encodeURIComponent(cycleId) + "/progress-entries" + (entryId ? "/" + encodeURIComponent(entryId) : "") + (reverse ? "/reverse" : ""), { method: entryId && !reverse ? "PATCH" : "POST", body: JSON.stringify(payload) }),
  status: (event: ApiFeeEvent, status: string, actualAmount?: string, occurredOn?: string, notes?: string) => apiJson<ApiFeeEvent>("/api/v1/fee-events/" + encodeURIComponent(event.id) + "/status", { method: "POST", body: JSON.stringify({ status, actualAmount, occurredOn, notes }) }),
};
