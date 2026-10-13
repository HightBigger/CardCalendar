import type * as C from "../../../../contracts/activity-catalog";
import { apiCommand, ApiError } from "../../../shared/http";
import {
  catalogAccessRevoked,
  catalogRequest,
  filterQuery,
} from "../../activity-catalog";
export const adminApi = {
  list: (filter: C.CatalogAdminFilter, signal: AbortSignal) =>
    catalogRequest<{ items: C.CatalogAdminSummary[]; total: number }>(
      "/api/v1/admin/bank-activities?" + filterQuery(filter),
      { signal },
    ),
  detail: (id: string, signal: AbortSignal) =>
    catalogRequest<C.CatalogAdminDetail>(
      "/api/v1/admin/bank-activities/" + id,
      { signal },
    ),
  preview: (id: string, draftId: string, signal: AbortSignal) =>
    catalogRequest<C.CatalogDraftPreview>(
      "/api/v1/admin/bank-activities/" + id + "/drafts/" + draftId + "/preview",
      { signal },
    ),
  async command<T>(
    path: string,
    input: unknown,
    key: string,
    signal: AbortSignal,
    method = "POST",
  ) {
    try {
      return await apiCommand<T>(
        "/api/v1/admin/bank-activities" + path,
        input,
        key,
        { signal, method },
      );
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) catalogAccessRevoked();
      throw e;
    }
  },
};
