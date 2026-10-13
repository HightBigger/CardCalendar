"use client";
import { useState } from "react";
import type * as C from "../../../../contracts/activity-catalog";
import { useRemoteQuery, useFeatureCommand } from "../../../shared/query";
import { adminApi } from "../api/admin-api";
import { catalogApi } from "../../activity-catalog";
export function useAdminCatalogController(scope: string, id?: string) {
  const [filter, setFilter] = useState<C.CatalogAdminFilter>({});
  const list = useRemoteQuery({
    scope,
    resource: "catalog-admin",
    queryKey: JSON.stringify(filter),
    enabled: !id,
    load: (signal) => adminApi.list(filter, signal),
  });
  const detail = useRemoteQuery({
    scope,
    resource: "catalog-admin",
    queryKey: id ?? "new",
    enabled: !!id && id !== "new",
    load: (signal) => adminApi.detail(id!, signal),
  });
  const banks = useRemoteQuery({
    scope,
    resource: "activity-catalog",
    queryKey: "banks",
    load: catalogApi.banks,
  });
  const command = useFeatureCommand(
    scope,
    ["catalog-admin", "activity-catalog"],
    id ?? "list",
  );
  const [preview, setPreview] = useState<C.CatalogDraftPreview | null>(null),
    [previewError, setPreviewError] = useState<string | null>(null),
    [previewBusy, setPreviewBusy] = useState(false),
    [queued, setQueued] = useState<string | null>(null);
  async function run<T>(path: string, payload: unknown, method = "POST") {
    const result = await command.run(path, payload, (key, signal) =>
      adminApi.command<T>(path, payload, key, signal, method),
    );
    if (result?.kind === "queued") {
      setQueued(result.jobId);
      return;
    }
    if (result?.kind === "committed") {
      setPreview(null);
      return result.data;
    }
  }
  async function review(draftId: string) {
    setPreviewBusy(true);
    setPreviewError(null);
    try {
      setPreview(
        (await adminApi.preview(id!, draftId, new AbortController().signal))
          .data,
      );
    } catch (e) {
      setPreviewError(e instanceof Error ? e.message : "预览失败");
    } finally {
      setPreviewBusy(false);
    }
  }
  return {
    filter,
    setFilter,
    list,
    detail,
    banks,
    command,
    run,
    review,
    preview,
    setPreview,
    previewBusy,
    previewError,
    queued,
  };
}
