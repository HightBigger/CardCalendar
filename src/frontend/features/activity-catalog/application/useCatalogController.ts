"use client";
import { useState } from "react";
import type { CatalogFilter } from "../../../../contracts/activity-catalog";
import { useRemoteQuery } from "../../../shared/query";
import { catalogApi } from "../api/catalog-api";
export function useCatalogController(scope: string, id?: string) {
  const [filter, setFilter] = useState<CatalogFilter>({ phase: "current" });
  const list = useRemoteQuery({
    scope,
    resource: "activity-catalog",
    queryKey: JSON.stringify(filter),
    enabled: !id,
    load: (signal) => catalogApi.list(filter, signal),
  });
  const detail = useRemoteQuery({
    scope,
    resource: "activity-catalog",
    queryKey: id ?? "none",
    enabled: !!id,
    load: (signal) => catalogApi.detail(id!, signal),
  });
  const banks = useRemoteQuery({
    scope,
    resource: "activity-catalog",
    queryKey: "banks",
    load: catalogApi.banks,
  });
  return { filter, setFilter, list, detail, banks };
}
