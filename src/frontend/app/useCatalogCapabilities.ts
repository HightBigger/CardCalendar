"use client";
import { useEffect } from "react";
import { catalogApi } from "../features/activity-catalog/api/catalog-api";
import { useRemoteQuery } from "../shared/query";
export function useCatalogCapabilities(scope: string) {
  const query = useRemoteQuery({
    scope,
    resource: "session-capabilities",
    queryKey: "current",
    enabled: scope !== "acceptance-fixture",
    load: catalogApi.capabilities,
  });
  useEffect(() => {
    const changed = () => {
      void query.reload();
    };
    window.addEventListener("catalog-access-changed", changed);
    return () => window.removeEventListener("catalog-access-changed", changed);
  }, [query.reload]);
  return query;
}
