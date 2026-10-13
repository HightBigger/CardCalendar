import type * as C from "../../../../contracts/activity-catalog";
import { apiJson, apiCommand, ApiError } from "../../../shared/http";
import type { BankOption, CatalogCard } from "../model/types";
export const catalogAccessRevoked = () => {
  window.dispatchEvent(new Event("catalog-access-changed"));
};
export async function catalogRequest<T>(
  path: string,
  options: RequestInit = {},
) {
  try {
    return await apiJson<T>(path, options);
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) catalogAccessRevoked();
    throw e;
  }
}
export function filterQuery(filter: C.CatalogAdminFilter) {
  const p = new URLSearchParams();
  for (const [key, value] of Object.entries(filter)) {
    if (Array.isArray(value)) value.forEach((v) => p.append(key, v));
    else if (value !== undefined && value !== false && value !== "")
      p.set(key, String(value));
  }
  return p;
}
export const catalogApi = {
  cards: (signal: AbortSignal) =>
    catalogRequest<CatalogCard[]>("/api/v1/catalog-cards", { signal }),
  associate: (cardId: string, bankId: string, key: string) =>
    apiCommand(
      "/api/v1/catalog-cards/" + cardId + "/bank-association",
      { bankId, note: "成员在加入预览明确核对该卡所属银行" },
      key,
    ),
  source: (id: string, signal: AbortSignal) =>
    catalogRequest<{
      source: C.CatalogParticipationSource;
      release: C.CatalogRelease;
    }>("/api/v1/activity-participations/" + id + "/catalog-source", { signal }),
  diff: (id: string, releaseId: string, signal: AbortSignal) =>
    catalogRequest<C.CatalogRuleDiff>(
      "/api/v1/activity-participations/" +
        id +
        "/catalog-diff?targetReleaseId=" +
        releaseId,
      { signal },
    ),
  personalCommand: (
    id: string,
    path: string,
    input: unknown,
    key: string,
    signal: AbortSignal,
  ) =>
    apiCommand("/api/v1/activity-participations/" + id + path, input, key, {
      signal,
    }),
  list: (filter: C.CatalogFilter, signal: AbortSignal) =>
    catalogRequest<C.CatalogList>(
      "/api/v1/bank-activities?" + filterQuery(filter),
      { signal },
    ),
  detail: (id: string, signal: AbortSignal) =>
    catalogRequest<C.CatalogDetail>("/api/v1/bank-activities/" + id, {
      signal,
    }),
  banks: (signal: AbortSignal) =>
    catalogRequest<BankOption[]>("/api/v1/banks", { signal }),
  capabilities: (signal: AbortSignal) =>
    apiJson<C.CatalogCapabilities>("/api/v1/me/capabilities", { signal }),
  joinPreview: (
    id: string,
    input: C.PreviewCatalogJoinInput,
    signal: AbortSignal,
  ) =>
    catalogRequest<C.CatalogJoinPreview>(
      "/api/v1/bank-activities/" + id + "/join-preview",
      { method: "POST", body: JSON.stringify(input), signal },
    ),
  join: (
    id: string,
    input: C.JoinCatalogActivityInput,
    key: string,
    signal: AbortSignal,
  ) =>
    apiCommand<C.CatalogJoinCommit>(
      "/api/v1/bank-activities/" + id + "/join",
      input,
      key,
      { signal },
    ),
};
