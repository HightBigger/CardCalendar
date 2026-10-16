"use client";
import { createContext, ReactNode, Suspense, useContext, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { FeatureGates } from "../../contracts/feature-gates";
import { useNotificationsController } from "../features/notifications";
import { useSettingsController } from "../features/settings";
import { Toast } from "../shared/ui";
import { AppShell, viewForPath, viewPaths, WorkbenchView } from "./AppShell";
import { SessionBoundary, useSession } from "./SessionBoundary";
import { useCatalogCapabilities } from "./useCatalogCapabilities";

type Workspace = {
  capabilities: ReturnType<typeof useCatalogCapabilities>;
  notifications: ReturnType<typeof useNotificationsController>;
  navigate: (view: WorkbenchView) => void;
};
const WorkspaceContext = createContext<Workspace | null>(null);
export function useWorkspace() {
  const workspace = useContext(WorkspaceContext);
  if (!workspace) throw new Error("WorkspaceFrame is required");
  return workspace;
}

function Frame({ gates, initialView, children }: { gates: FeatureGates; initialView?: WorkbenchView; children: ReactNode }) {
  const session = useSession();
  const path = usePathname();
  const router = useRouter();
  const capabilities = useCatalogCapabilities(session.scope);
  const notifications = useNotificationsController(session.scope);
  const settings = useSettingsController(session.scope, session.updateProfile);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const pending = (notifications.history.data ?? []).filter((item) => item.status === "pending" || item.status === "snoozed");
  const navigate = (view: WorkbenchView) => router.push(viewPaths[view]);
  async function logout() {
    try { await settings.logout(); }
    catch (error) { setLogoutError(error instanceof Error ? error.message : "退出失败，请重试"); }
  }
  return <WorkspaceContext.Provider value={{ capabilities, notifications, navigate }}>
    <AppShell profile={session.profile} gates={gates} view={viewForPath(path, initialView)} catalogCapabilities={capabilities.data} notifications={pending.length} onNavigate={navigate} onLogout={logout}>
      <Toast message={logoutError} onDismiss={() => setLogoutError(null)} />
      {children}
    </AppShell>
  </WorkspaceContext.Provider>;
}

export function WorkspaceFrame({ gates, initialView, children }: { gates: FeatureGates; initialView?: WorkbenchView; children: ReactNode }) {
  const workspace = useContext(WorkspaceContext);
  // Standalone development entries need a frame; route pages reuse the persistent layout.
  if (workspace) return <>{children}</>;
  return <Suspense fallback={<main className="loading-page">正在加载工作台…</main>}>
    <SessionBoundary><Frame gates={gates} initialView={initialView}>{children}</Frame></SessionBoundary>
  </Suspense>;
}
