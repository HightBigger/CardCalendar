"use client";
import { ReactNode } from "react";
import Link from "next/link";
import { useWorkspace, WorkspaceFrame } from "../../app/WorkspaceFrame";
import { QueryState } from "../../shared/ui";
import type { FeatureGates } from "../../../contracts/feature-gates";
import "../../features/activity-catalog/styles/catalog.css";
function Frame({
  manage,
  children,
}: {
  manage: boolean;
  children: ReactNode;
}) {
  const { capabilities: caps } = useWorkspace();
  return (
    <>
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
              <Link href="/">返回工作台</Link>
            </div>
          )}
    </>
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
    <WorkspaceFrame gates={gates} initialView={manage ? "catalog-admin" : "bank-activities"}>
      <Frame manage={manage}>{children}</Frame>
    </WorkspaceFrame>
  );
}
