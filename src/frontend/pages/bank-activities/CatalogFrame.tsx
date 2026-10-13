"use client";
import { Suspense, ReactNode } from "react";
import { SessionBoundary, useSession } from "../../app/SessionBoundary";
import { AppShell, viewPaths, WorkbenchView } from "../../app/AppShell";
import { useCatalogCapabilities } from "../../app/useCatalogCapabilities";
import { QueryState } from "../../shared/ui";
import type { FeatureGates } from "../../../contracts/feature-gates";
import "../../features/activity-catalog/styles/catalog.css";
function Frame({
  manage,
  gates,
  children,
}: {
  manage: boolean;
  gates: FeatureGates;
  children: ReactNode;
}) {
  const session = useSession(),
    caps = useCatalogCapabilities(session.scope);
  return (
    <AppShell
      profile={session.profile}
      view={manage ? "catalog-admin" : "bank-activities"}
      gates={gates}
      catalogCapabilities={caps.data}
      onNavigate={(v: WorkbenchView) => window.location.assign(viewPaths[v])}
    >
      <QueryState
        {...caps}
        hasData={!!caps.data}
        retry={caps.reload}
        label="权限"
      />
      {caps.data &&
      (manage ? caps.data.canManageCatalog : caps.data.canReadCatalog)
        ? children
        : caps.data && (
            <div className="empty-state" role="alert">
              <h1>{manage ? "没有活动管理权限" : "银行活动尚未开放"}</h1>
              <p>如权限刚被撤销，旧会话也不能继续访问管理内容。</p>
              <a href="/">返回工作台</a>
            </div>
          )}
    </AppShell>
  );
}
export function CatalogFrame({
  manage = false,
  gates,
  children,
}: {
  manage?: boolean;
  gates: FeatureGates;
  children: ReactNode;
}) {
  return (
    <Suspense fallback={<main className="loading-page">正在加载…</main>}>
      <SessionBoundary>
        <Frame manage={manage} gates={gates}>
          {children}
        </Frame>
      </SessionBoundary>
    </Suspense>
  );
}
