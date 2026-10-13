import type { ApiCard, CardDraft, CardSummary } from "../../../../contracts/mvp";
import { apiJson } from "../../../shared/http";
export const cardsApi = {
  list: (signal: AbortSignal) => apiJson<ApiCard[]>("/api/v1/cards?all=true", { signal }),
  summaries: (signal: AbortSignal) => apiJson<CardSummary[]>("/api/v1/cards/summary?all=true", { signal }),
  save: (draft: CardDraft, id?: string) => apiJson<ApiCard>("/api/v1/cards" + (id ? "/" + encodeURIComponent(id) : ""), { method: id ? "PATCH" : "POST", body: JSON.stringify(draft) }),
  lifecycle: (id: string, action: "archive" | "restore", rewardReminderPolicy?: "keep" | "stop", note?: string, signal?: AbortSignal, key?: string) => apiJson<ApiCard>("/api/v1/cards/" + encodeURIComponent(id), { method: "POST", signal, ...(key ? { headers: { "Idempotency-Key": key } } : {}), body: JSON.stringify({ action, ...(rewardReminderPolicy ? { rewardReminderPolicy } : {}), ...(note?.trim() ? { note: note.trim() } : {}) }) }),
};
