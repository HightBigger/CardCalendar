"use client";
import { createContext, ReactNode, useContext, useEffect, useState } from "react";
import type { ApiUser } from "../../contracts/mvp";
import { apiJson, subscribeUnauthorized } from "../shared/http";
import { QueryState } from "../shared/ui";
import { useRemoteQuery } from "../shared/query";

type Session = { profile: ApiUser; scope: string; updateProfile: (profile: ApiUser) => void };
const SessionContext = createContext<Session | null>(null);
export function useSession() {
  const session = useContext(SessionContext);
  if (!session) throw new Error("SessionBoundary is required");
  return session;
}
function SessionProvider({ profile, children }: { profile: ApiUser; children: ReactNode }) {
  const [current, setCurrent] = useState(profile);
  useEffect(() => setCurrent(profile), [profile]);
  return <SessionContext.Provider value={{ profile: current, scope: current.id, updateProfile: setCurrent }}>{children}</SessionContext.Provider>;
}
export function FixtureSession({ children }: { children: ReactNode }) {
  return <SessionProvider profile={{ id: "acceptance-fixture", email: "fixture@example.invalid", name: "验收示例", timezone: "Asia/Shanghai", status: "active" }}>{children}</SessionProvider>;
}
export function SessionBoundary({ children }: { children: ReactNode }) {
  const query = useRemoteQuery({ scope: "session", resource: "settings", queryKey: "profile", load: (signal) => apiJson<ApiUser>("/api/v1/me", { signal }) });
  useEffect(() => {
    const exit = () => window.location.assign("/login");
    const cleanup = subscribeUnauthorized(exit);
    // No account data is shared across tabs; this channel only invalidates session.
    const channel = typeof BroadcastChannel === "undefined" ? undefined : new BroadcastChannel("cardfolio-session");
    if (channel) channel.onmessage = () => { void query.reload(); };
    return () => { cleanup(); channel?.close(); };
  }, [query.reload]);
  // The first /me may fail before the subscription effect is installed.
  useEffect(() => {
    if (query.error && "status" in query.error && query.error.status === 401) window.location.assign("/login");
  }, [query.error]);
  if (!query.data) return <main className="loading-page"><QueryState loading={query.loading} error={query.error} hasData={false} retry={query.reload} label="账户" /></main>;
  return <SessionProvider key={query.data.id} profile={query.data}>{children}</SessionProvider>;
}
