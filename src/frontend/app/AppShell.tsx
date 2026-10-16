"use client";
import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import type { CatalogCapabilities } from "../../contracts/activity-catalog";
import type { ApiUser } from "../../contracts/mvp";
import type { FeatureGates } from "../../contracts/feature-gates";
import { Icon } from "../shared/ui";

export type WorkbenchView = "overview" | "cards" | "calendar" | "notifications" | "settings" | "todos" | "activities" | "bank-activities" | "catalog-admin";
export const viewPaths: Record<WorkbenchView, string> = { overview: "/", cards: "/cards", calendar: "/calendar", notifications: "/notifications", settings: "/settings", todos: "/todos", activities: "/activities", "bank-activities": "/bank-activities", "catalog-admin": "/admin/bank-activities" };
export function viewForPath(path: string, fallback: WorkbenchView = "overview"): WorkbenchView {
  return (Object.entries(viewPaths).find(([, url]) => path === url || (url !== "/" && path.startsWith(url + "/")))?.[0] as WorkbenchView | undefined) ?? fallback;
}
export function AppShell({ profile, view, gates, notifications = 0, onNavigate, onLogout, catalogCapabilities, children }: {
  profile: ApiUser; view: WorkbenchView; gates: FeatureGates; notifications?: number; onNavigate: (view: WorkbenchView) => void; onLogout?: () => unknown; catalogCapabilities?: CatalogCapabilities; children: ReactNode;
}) {
  const [mobileNav, setMobileNav] = useState(false);
  const [moreOpen, setMoreOpen] = useState(() => view === "activities" || view === "bank-activities" || view === "catalog-admin");
  const mobileMenuRef = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const close = useCallback((restore = true) => {
    setMobileNav(false);
    if (restore && window.matchMedia("(max-width: 680px)").matches) window.requestAnimationFrame(() => mobileMenuRef.current?.focus());
  }, []);
  useEffect(() => {
    if (!mobileNav || !window.matchMedia("(max-width: 680px)").matches) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = requestAnimationFrame(() => sidebarRef.current?.querySelector<HTMLElement>(".nav-item.active, .nav-item")?.focus());
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); close(); }
      if (event.key === "Tab") {
        const controls = Array.from(sidebarRef.current?.querySelectorAll<HTMLElement>("button, a[href], summary") ?? [])
          .filter((element) => element.getClientRects().length > 0 && !element.matches(":disabled"));
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener("keydown", keydown);
    return () => { cancelAnimationFrame(frame); document.body.style.overflow = previous; document.removeEventListener("keydown", keydown); };
  }, [mobileNav, close]);
  const nav: { key: WorkbenchView; label: string; icon: "grid" | "credit" | "calendar" | "bell" | "settings" }[] = [
    { key: "overview", label: "首页", icon: "grid" }, { key: "cards", label: "我的卡片", icon: "credit" },
    ...(gates.todos ? [{ key: "todos" as const, label: "待办", icon: "calendar" as const }] : [{ key: "calendar" as const, label: "年费日历", icon: "calendar" as const }, { key: "notifications" as const, label: "提醒中心", icon: "bell" as const }]),
  ];
  const moreNav = [
    ...(gates.activities ? [{ key: "activities" as const, label: "我的活动" }] : []),
    ...(catalogCapabilities?.canReadCatalog ? [{ key: "bank-activities" as const, label: "银行活动" }] : []),
    ...(catalogCapabilities?.canManageCatalog ? [{ key: "catalog-admin" as const, label: "活动管理" }] : []),
  ];
  const title = { overview: "首页", cards: "我的卡片", calendar: "年费日历", notifications: gates.todos ? "通知历史" : "提醒中心", settings: "设置", todos: "待办", activities: "我的活动", "bank-activities": "银行活动", "catalog-admin": "活动管理" }[view];
  function navigate(next: WorkbenchView) { onNavigate(next); close(); }
  return <main className="app-frame">
    <a className="skip-link" href="#workspace-content">跳到内容</a>
    <button className={"sidebar-scrim" + (mobileNav ? " visible" : "")} aria-hidden="true" tabIndex={-1} onClick={() => close()} />
    <aside className={"sidebar" + (mobileNav ? " sidebar-open" : "")} id="app-sidebar" ref={sidebarRef}>
      <div className="brand"><span className="brand-mark"><Icon name="credit" size={20} /></span><span>卡片档案</span><button className="icon-button sidebar-close" aria-label="关闭导航" onClick={() => close()}><Icon name="close" size={18} /></button></div>
      <nav className="nav-list" aria-label="主导航">
        {nav.map((item) => <button key={item.key} className={"nav-item" + (view === item.key ? " active" : "")} aria-current={view === item.key ? "page" : undefined} onClick={() => navigate(item.key)}><Icon name={item.icon} size={18} /><span>{item.label}</span></button>)}
      </nav>
      {moreNav.length > 0 && <details className="nav-more" open={moreOpen} onToggle={(event) => setMoreOpen(event.currentTarget.open)}><summary>更多 <Icon name="chevronDown" size={14} /></summary><nav className="nav-list" aria-label="更多功能">{moreNav.map((item) => <button key={item.key} className={"nav-item" + (view === item.key ? " active" : "")} aria-current={view === item.key ? "page" : undefined} onClick={() => navigate(item.key)}>{item.label}</button>)}</nav></details>}
      <div className="sidebar-bottom"><button className={"user-chip user-menu" + (view === "settings" ? " active" : "")} onClick={() => navigate("settings")}><span className="avatar">{profile.name?.[0] ?? "我"}</span><span><strong>{profile.name || "我的账户"}</strong><small>设置</small></span><Icon name="settings" size={16} /></button>{onLogout && <button className="text-button sidebar-logout" onClick={() => onLogout()}>退出登录</button>}</div>
    </aside>
    <section className="main-area"><header className="topbar"><button className="mobile-menu" ref={mobileMenuRef} aria-label="打开导航" aria-expanded={mobileNav} aria-controls="app-sidebar" onClick={() => setMobileNav((open) => !open)}><Icon name="menu" /></button><div className="topbar-title">{title}</div><div className="topbar-actions"><span className="topbar-date">{new Date().toLocaleDateString("zh-CN", { timeZone: profile.timezone, year: "numeric", month: "long", day: "numeric", weekday: "short" })}</span><button className="icon-button" aria-label="提醒" title="通知历史" onClick={() => navigate("notifications")}><Icon name="bell" size={19} />{notifications > 0 && <><span className="dot" aria-hidden="true" /><span className="sr-only">{notifications} 条待处理提醒</span></>}</button></div></header>
      <div className="content" id="workspace-content" tabIndex={-1}>{children}</div>
    </section>
  </main>;
}
