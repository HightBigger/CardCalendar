"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { addMonths, eachDayOfInterval, endOfMonth, format, startOfMonth } from "date-fns";
import { apiJson } from "./api";
import { Icon } from "./icons";
import { ModalShell } from "./modal";
import { Toast } from "./toast";

type ApiUser = {
  id: string;
  email: string;
  name?: string | null;
  timezone: string;
  status: string;
  deletedAt?: string | null;
  deletionRequestedAt?: string | null;
  deletionCleanupCompletedAt?: string | null;
  deletionCleanupResult?: Record<string, unknown> | null;
  deletionRetryCount?: number | null;
};

type ApiCard = {
  id: string;
  issuerName: string;
  name: string;
  last4: string;
  status: "active" | "suspended" | "archived";
  annualFeeAmount: number | string;
  currency: string;
  feeCycleType: "anniversary" | "fixed_date" | "custom";
  openedOn?: string | null;
  feeMonth?: number | null;
  feeDay?: number | null;
  nextFeeDate: string;
  waiveRuleType: string;
  targetCount?: number | null;
  targetAmount?: number | string | null;
  customRuleText?: string | null;
  notes?: string | null;
  progressPeriodStart?: string | null;
  progressPeriodEnd?: string | null;
  createdAt: string;
  updatedAt?: string;
};

type CardSummary = ApiCard & {
  nextEvent?: {
    id: string;
    dueDate: string;
    status: string;
  } | null;
  progress?: {
    qualified: boolean;
    percentage: number;
    count: number;
    amount: number;
    remainingCount?: number;
    remainingAmount?: number;
  } | null;
};

type ApiCycle = {
  id: string;
  cardId: string;
  periodStart: string;
  periodEnd: string;
  feeDueDate: string;
  waiveRuleType: string;
  targetCount?: number | null;
  targetAmount?: number | string | null;
  status: "open" | "qualified" | "closed";
};

type ApiFeeEvent = {
  id: string;
  cardId: string;
  cycleId: string;
  dueDate: string;
  expectedAmount: number | string;
  status: string;
  actualAmount?: number | string | null;
  occurredOn?: string | null;
  notes?: string | null;
};

type ApiFeeEventHistory = {
  id: string;
  action: string;
  occurredAt: string;
  metadata: {
    fromStatus?: string;
    toStatus?: string;
    actualAmount?: number | string | null;
    occurredOn?: string | null;
    notes?: string | null;
  };
};

type ApiFeeEventTimeline = {
  history: ApiFeeEventHistory[];
  reminders: ApiReminder[];
};

type ApiReminder = {
  id: string;
  cardId?: string | null;
  feeEventId?: string | null;
  feeCycleId?: string | null;
  kind: string;
  daysBefore: number;
  scheduledFor: string;
  status: string;
  snoozedUntil?: string | null;
  completedAt?: string | null;
};

type ApiReminderRule = {
  id: string;
  kind: string;
  daysBefore: number;
  enabled: boolean;
};

type ProgressEntry = {
  id: string;
  cycleId: string;
  entryDate: string;
  countDelta: number;
  amountDelta: number;
  note?: string | null;
  entryType?: "manual" | "correction" | "reversal";
  reversedAt?: string;
  createdAt?: string;
};

type ProgressData = {
  cycle: ApiCycle;
  entries: ProgressEntry[];
  progress: {
    count: number;
    amount: number;
    percentage: number;
    qualified: boolean;
    remainingCount?: number;
    remainingAmount?: number;
  };
};

type CardDetail = {
  card: ApiCard;
  cycles: ApiCycle[];
  progress: Record<string, ProgressData>;
  eventHistory: Record<string, ApiFeeEventHistory[]>;
  reminderTimeline: Record<string, ApiReminder[]>;
};

type CardDraft = {
  status?: "active" | "suspended" | "archived";
  currency?: string;
  notes?: string;
  progressPeriodStart?: string;
  progressPeriodEnd?: string;
  issuerName: string;
  name: string;
  last4: string;
  annualFeeAmount: number;
  nextFeeDate: string;
  feeCycleType: "anniversary" | "fixed_date" | "custom";
  openedOn?: string;
  feeMonth?: number;
  feeDay?: number;
  waiveRuleType: "none" | "count" | "amount" | "count_and_amount" | "custom";
  targetCount?: number;
  targetAmount?: number;
  customRuleText?: string;
};

type View = "overview" | "cards" | "calendar" | "reminders" | "settings";

const VIEW_LABEL: Record<View, string> = {
  overview: "概览",
  cards: "我的卡片",
  calendar: "年费日历",
  reminders: "提醒中心",
  settings: "设置",
};

const STATUS_LABEL: Record<string, string> = {
  pending: "待确认",
  waived: "已免除",
  charged: "已扣费",
  refunded: "已退费",
  not_applicable: "无需处理",
  open: "进行中",
  qualified: "已达标",
  closed: "已关闭",
  active: "使用中",
  suspended: "已停用",
  archived: "已归档",
  completed: "已完成",
  snoozed: "稍后处理",
  ignored: "已忽略",
};

function fmtDate(value: string | null | undefined): string {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

function daysUntil(value: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(value);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

function reminderOverdue(reminder: ApiReminder, now = new Date()): boolean {
  if (reminder.status !== "pending") return false;
  if (reminder.snoozedUntil && new Date(reminder.snoozedUntil).getTime() > now.getTime()) return false;
  return new Date(reminder.scheduledFor).getTime() <= now.getTime();
}

function money(value: number | string | null | undefined, currency = "CNY"): string {
  const n = Number(value ?? 0);
  return currency === "CNY" ? "¥" + n.toLocaleString("zh-CN") : n.toLocaleString("zh-CN") + " " + currency;
}

function ruleText(card: ApiCard): string {
  const rule = card.waiveRuleType;
  if (rule === "none") return "无条件免年费";
  if (rule === "custom") return card.customRuleText || "自定义规则";
  if (rule === "count") return "消费 " + String(card.targetCount ?? 0) + " 次";
  if (rule === "amount") return "消费 " + money(card.targetAmount) + " 免年费";
  if (rule === "count_and_amount") {
    return "消费 " + String(card.targetCount ?? 0) + " 次且满 " + money(card.targetAmount);
  }
  return "无免年费条件";
}

function cardLabel(cardId: string, cards: ApiCard[]): string {
  const card = cards.find((item) => item.id === cardId);
  return card ? card.issuerName + " · " + card.name : cardId.slice(0, 8);
}

export function CardCalendarApp() {
  const [profile, setProfile] = useState<ApiUser | null>(null);
  const [cards, setCards] = useState<ApiCard[]>([]);
  const [cardSummaries, setCardSummaries] = useState<CardSummary[]>([]);
  const [events, setEvents] = useState<ApiFeeEvent[]>([]);
  const [reminders, setReminders] = useState<ApiReminder[]>([]);
  const [reminderRules, setReminderRules] = useState<ApiReminderRule[]>([]);
  const [view, setView] = useState<View>("overview");
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [editingCard, setEditingCard] = useState<ApiCard | null>(null);
  const [activeCard, setActiveCard] = useState<ApiCard | null>(null);
  const [detail, setDetail] = useState<CardDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const noticeTimer = useRef<number | null>(null);
  const mobileMenuRef = useRef<HTMLButtonElement | null>(null);
  const sidebarRef = useRef<HTMLElement | null>(null);

  const closeMobileNavigation = useCallback((restoreFocus = false) => {
    setMobileNav(false);
    if (
      restoreFocus &&
      window.matchMedia("(max-width: 680px)").matches
    ) {
      window.requestAnimationFrame(() => mobileMenuRef.current?.focus());
    }
  }, []);

  const showNotice = useCallback((message: string) => {
    setNotice(message);
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(""), 3600);
  }, []);

  const dismissNotice = useCallback(() => {
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = null;
    setNotice("");
  }, []);

  const load = useCallback(async () => {
    try {
      const [meRes, cardRes, summaryRes, eventRes, reminderRes, ruleRes] = await Promise.all([
        apiJson<ApiUser>("/api/v1/me"),
        apiJson<ApiCard[]>("/api/v1/cards?all=true"),
        apiJson<CardSummary[]>("/api/v1/cards/summary?all=true"),
        apiJson<ApiFeeEvent[]>("/api/v1/fee-events"),
        apiJson<ApiReminder[]>("/api/v1/reminders?all=true"),
        apiJson<ApiReminderRule[]>("/api/v1/reminders/rules"),
      ]);
      setProfile(meRes.data);
      setCards(cardRes.data);
      setCardSummaries(summaryRes.data);
      setEvents(eventRes.data);
      setReminders(reminderRes.data);
      setReminderRules(ruleRes.data);
    } catch (caught) {
      if (caught instanceof Error && caught.message !== "请先登录") {
        showNotice(caught.message);
      }
    } finally {
      setLoading(false);
    }
  }, [showNotice]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    return () => {
      if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!mobileNav || !window.matchMedia("(max-width: 680px)").matches) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => {
      sidebarRef.current
        ?.querySelector<HTMLElement>(".nav-item.active, .nav-item")
        ?.focus();
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeMobileNavigation(true);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [closeMobileNavigation, mobileNav]);

  async function refresh() {
    await load();
  }

  async function saveCard(draft: CardDraft) {
    try {
      const body = JSON.stringify(draft);
      if (editingCard) {
        await apiJson<ApiCard>("/api/v1/cards/" + editingCard.id, {
          method: "PATCH",
          body,
        });
        showNotice("卡片已更新");
      } else {
        await apiJson<ApiCard>("/api/v1/cards", { method: "POST", body });
        showNotice("卡片已添加，提醒已创建");
      }
      setAddOpen(false);
      setEditingCard(null);
      await refresh();
    } catch (caught) {
      showNotice(caught instanceof Error ? caught.message : "卡片保存失败");
    }
  }

  async function saveReminderRules(rules: ApiReminderRule[]) {
    await apiJson<ApiReminderRule[]>("/api/v1/reminders/rules", {
      method: "PUT",
      body: JSON.stringify({
        rules: rules.map((rule) => ({ daysBefore: rule.daysBefore, enabled: rule.enabled })),
      }),
    });
    await refresh();
    showNotice("提醒规则已保存");
  }

  async function archiveCard(card: ApiCard) {
    if (!window.confirm("确认归档这张卡片？历史数据会保留，但不再产生新提醒。")) return;
    try {
      await apiJson<ApiCard>("/api/v1/cards/" + card.id, {
        method: "POST",
        body: JSON.stringify({ action: "archive" }),
      });
      setActiveCard(null);
      setDetail(null);
      showNotice("卡片已归档");
      await refresh();
    } catch (caught) {
      showNotice(caught instanceof Error ? caught.message : "归档失败");
    }
  }

  async function restoreCard(card: ApiCard) {
    if (!window.confirm("确认恢复这张卡片？历史数据会保留，并重新生成待处理提醒。")) return;
    try {
      await apiJson<ApiCard>("/api/v1/cards/" + card.id, {
        method: "POST",
        body: JSON.stringify({ action: "restore" }),
      });
      setActiveCard(null);
      setDetail(null);
      showNotice("卡片已恢复使用");
      await refresh();
    } catch (caught) {
      showNotice(caught instanceof Error ? caught.message : "恢复失败");
    }
  }

  async function openCard(card: ApiCard) {
    setActiveCard(card);
    setDetailLoading(true);
    try {
      const cycleRes = await apiJson<ApiCycle[]>("/api/v1/cards/" + card.id + "/cycles");
      const progress: Record<string, ProgressData> = {};
      for (const cycle of cycleRes.data) {
        const progressRes = await apiJson<ProgressData>(
          "/api/v1/cycles/" + cycle.id + "/progress-entries",
        );
        progress[cycle.id] = progressRes.data;
      }
      const cardEvents = events.filter((event) => event.cardId === card.id);
      const historyEntries = await Promise.all(
        cardEvents.map(async (event) => {
          const timelineRes = await apiJson<ApiFeeEventTimeline>(
            "/api/v1/fee-events/" + event.id + "/history",
          );
          return [event.id, timelineRes.data] as const;
        }),
      );
      setDetail({
        card,
        cycles: cycleRes.data,
        progress,
        eventHistory: Object.fromEntries(historyEntries.map(([id, timeline]) => [id, timeline.history])),
        reminderTimeline: Object.fromEntries(historyEntries.map(([id, timeline]) => [id, timeline.reminders])),
      });
    } catch (caught) {
      showNotice(caught instanceof Error ? caught.message : "卡片详情加载失败");
    } finally {
      setDetailLoading(false);
    }
  }

  async function addProgress(cycleId: string, entryDate: string, countDelta: number, amountDelta: number, note: string) {
    try {
      await apiJson<ProgressData>("/api/v1/cycles/" + cycleId + "/progress-entries", {
        method: "POST",
        body: JSON.stringify({ entryDate, countDelta, amountDelta, note }),
      });
      showNotice("进度已更新");
      if (activeCard) await openCard(activeCard);
    } catch (caught) {
      showNotice(caught instanceof Error ? caught.message : "进度更新失败");
    }
  }

  async function setProgressValue(cycleId: string, entryDate: string, count: number, amount: number, note: string) {
    try {
      await apiJson<ProgressData>("/api/v1/cycles/" + cycleId + "/progress-entries", {
        method: "POST",
        body: JSON.stringify({ mode: "cumulative", entryDate, currentCount: count, currentAmount: amount, note }),
      });
      showNotice("累计进度已更新");
      if (activeCard) await openCard(activeCard);
    } catch (caught) {
      showNotice(caught instanceof Error ? caught.message : "累计进度更新失败");
    }
  }

  async function editProgress(cycleId: string, entryId: string, entryDate: string, countDelta: number, amountDelta: number, note: string) {
    try {
      await apiJson<ProgressData>("/api/v1/cycles/" + cycleId + "/progress-entries/" + entryId, {
        method: "PATCH",
        body: JSON.stringify({ entryDate, countDelta, amountDelta, note }),
      });
      showNotice("进度记录已修改");
      if (activeCard) await openCard(activeCard);
    } catch (caught) {
      showNotice(caught instanceof Error ? caught.message : "进度修改失败");
    }
  }

  async function reverseProgress(cycleId: string, entryId: string) {
    try {
      await apiJson<ProgressData>(
        "/api/v1/cycles/" + cycleId + "/progress-entries/" + entryId + "/reverse",
        { method: "POST", body: JSON.stringify({}) },
      );
      showNotice("最近一条进度已撤销");
      if (activeCard) await openCard(activeCard);
    } catch (caught) {
      showNotice(caught instanceof Error ? caught.message : "撤销失败");
    }
  }

  async function updateEventStatus(
    event: ApiFeeEvent,
    status: string,
    actualAmount?: string,
    occurredOn?: string,
    notes?: string,
  ) {
    const body: Record<string, string> = { status };
    if (actualAmount) body.actualAmount = actualAmount;
    if (occurredOn) body.occurredOn = occurredOn;
    if (notes) body.notes = notes;
    try {
      await apiJson<ApiFeeEvent>("/api/v1/fee-events/" + event.id + "/status", {
        method: "POST",
        body: JSON.stringify(body),
      });
      showNotice("年费事件已更新");
      await refresh();
      if (activeCard) await openCard(activeCard);
    } catch (caught) {
      showNotice(caught instanceof Error ? caught.message : "事件更新失败");
    }
  }

  async function reminderAction(reminder: ApiReminder, action: string) {
    try {
      const body =
        action === "snooze"
          ? { action, snoozedUntil: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() }
          : { action };
      await apiJson<ApiReminder>("/api/v1/reminders/" + reminder.id + "/actions", {
        method: "POST",
        body: JSON.stringify(body),
      });
      await refresh();
    } catch (caught) {
      showNotice(caught instanceof Error ? caught.message : "提醒操作失败");
    }
  }

  const activeCards = useMemo(
    () => cards.filter((card) => card.status !== "archived"),
    [cards],
  );
  const activeCardIds = useMemo(() => new Set(activeCards.map((card) => card.id)), [activeCards]);
  const visibleEvents = useMemo(
    () => events.filter((event) => activeCardIds.has(event.cardId)),
    [events, activeCardIds],
  );
  const upcomingEvents = useMemo(() => {
    const now = new Date();
    const horizon = new Date(now.getTime() + 90 * 86400000);
    return visibleEvents
      .filter((event) => {
        const date = new Date(event.dueDate + "T00:00:00");
        return date >= now && date <= horizon;
      })
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  }, [visibleEvents]);

  const upcomingAmount = upcomingEvents.reduce((sum, event) => sum + Number(event.expectedAmount), 0);
  const pendingReminders = reminders.filter((reminder) => reminder.status === "pending" || reminder.status === "snoozed");
  const filteredSummaries = useMemo(() => {
    const value = query.trim().toLowerCase();
    if (!value) return cardSummaries;
    return cardSummaries.filter((card) =>
      (card.issuerName + " " + card.name + " " + card.last4).toLowerCase().includes(value),
    );
  }, [cardSummaries, query]);
  const attentionCards = useMemo(
    () =>
      cardSummaries
        .filter((card) => card.status !== "archived" && card.progress && !card.progress.qualified)
        .sort((a, b) => {
          const aRemaining = (a.progress?.remainingCount ?? 0) + (a.progress?.remainingAmount ?? 0);
          const bRemaining = (b.progress?.remainingCount ?? 0) + (b.progress?.remainingAmount ?? 0);
          return bRemaining - aRemaining;
        })
        .slice(0, 5),
    [cardSummaries],
  );

  if (loading) {
    return <main className="loading-page"><Icon name="calendar" size={30} /><span>正在加载你的年费日历...</span></main>;
  }

  const navItems: { key: View; label: string; icon: "grid" | "credit" | "calendar" | "bell" | "settings" }[] = [
    { key: "overview", label: "概览", icon: "grid" },
    { key: "cards", label: "我的卡片", icon: "credit" },
    { key: "calendar", label: "年费日历", icon: "calendar" },
    { key: "reminders", label: "提醒中心", icon: "bell" },
  ];

  return (
    <main className="app-frame">
      <button
        className={"sidebar-scrim" + (mobileNav ? " visible" : "")}
        aria-hidden="true"
        tabIndex={-1}
        onClick={() => closeMobileNavigation(true)}
      />
      <aside
        className={"sidebar" + (mobileNav ? " sidebar-open" : "")}
        id="app-sidebar"
        ref={sidebarRef}
      >
        <div className="brand">
          <span className="brand-mark"><Icon name="calendar" size={20} /></span>
          <span>卡片档案</span>
          <small>CARDFOLIO</small>
          <button
            className="icon-button sidebar-close"
            aria-label="关闭导航"
            onClick={() => closeMobileNavigation(true)}
          >
            <Icon name="close" size={18} />
          </button>
        </div>
        <nav className="nav-list" aria-label="主导航">
          {navItems.map((item) => (
            <button
              key={item.key}
              className={"nav-item" + (view === item.key ? " active" : "")}
              aria-current={view === item.key ? "page" : undefined}
              onClick={() => {
                setView(item.key);
                closeMobileNavigation(true);
              }}
            >
              <Icon name={item.icon} size={18} />
              <span>{item.label}</span>
              {item.key === "reminders" && pendingReminders.length > 0 && (
                <b className="nav-count">{pendingReminders.length}</b>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button
            className={"nav-item" + (view === "settings" ? " active" : "")}
            aria-current={view === "settings" ? "page" : undefined}
            onClick={() => {
              setView("settings");
              closeMobileNavigation(true);
            }}
          >
            <Icon name="settings" size={18} />
            <span>设置</span>
          </button>
          <div className="user-chip">
            <span className="avatar">{profile?.name?.[0] ?? "我"}</span>
            <span>
              <strong>{profile?.name || profile?.email || "个人账户"}</strong>
              <small>个人账户</small>
            </span>
          </div>
        </div>
      </aside>

      <section className="main-area">
        <header className="topbar">
          <button
            className="mobile-menu"
            ref={mobileMenuRef}
            aria-label="打开导航"
            aria-expanded={mobileNav}
            aria-controls="app-sidebar"
            onClick={() => setMobileNav((open) => !open)}
          >
            <Icon name="menu" />
          </button>
          <div className="topbar-title">{VIEW_LABEL[view]}</div>
          <div className="topbar-actions">
            <button
              className="icon-button"
              aria-label="提醒"
              title="提醒"
              onClick={() => setView("reminders")}
            >
              <Icon name="bell" size={19} />
              {pendingReminders.length > 0 && (
                <>
                  <span className="dot" aria-hidden="true" />
                  <span className="sr-only">{pendingReminders.length} 条待处理提醒</span>
                </>
              )}
            </button>
            <span className="topbar-date">{new Date().toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric", weekday: "short" })}</span>
            <button className="logout-button" onClick={logout}>退出</button>
          </div>
        </header>

        <div className="content">
          <Toast message={notice} onDismiss={dismissNotice} />

          {view === "overview" && (
            <Overview
              profile={profile}
              cards={activeCards}
              totalCards={cardSummaries.length}
              activeCards={activeCards.length}
              attentionCards={attentionCards}
              events={upcomingEvents}
              reminders={pendingReminders}
              upcomingAmount={upcomingAmount}
              onAdd={() => setAddOpen(true)}
              onOpenCard={openCard}
              onGoCards={() => setView("cards")}
              onGoReminders={() => setView("reminders")}
            />
          )}
         {view === "cards" && (
           <CardsView
              cards={filteredSummaries}
              query={query}
              onQueryChange={setQuery}
              onAdd={() => setAddOpen(true)}
              onEdit={(card) => {
                setEditingCard(card);
                setAddOpen(true);
              }}
              onOpenCard={openCard}
            />
          )}
          {view === "calendar" && <CalendarView events={visibleEvents} cards={activeCards} />}
          {view === "reminders" && (
            <RemindersView reminders={reminders} onAction={reminderAction} />
          )}
          {view === "settings" && (
            <SettingsView
              profile={profile}
              onProfileUpdated={(next) => {
                setProfile(next);
                showNotice("个人设置已保存");
              }}
              reminderRules={reminderRules}
              onReminderRulesChange={saveReminderRules}
            />
          )}
        </div>
      </section>

      <CardForm
        open={addOpen}
        initial={editingCard}
        onClose={() => {
          setAddOpen(false);
          setEditingCard(null);
        }}
        onSubmit={saveCard}
      />

      <CardDetailModal
        open={activeCard !== null}
        detail={detail}
        loading={detailLoading}
        events={events}
        onClose={() => {
          setActiveCard(null);
          setDetail(null);
        }}
        onEdit={() => {
          if (activeCard) {
            setEditingCard(activeCard);
            setAddOpen(true);
          }
        }}
        onArchive={() => activeCard && archiveCard(activeCard)}
        onRestore={() => activeCard && restoreCard(activeCard)}
        onAddProgress={addProgress}
        onEditProgress={editProgress}
        onReverseProgress={reverseProgress}
        onUpdateEvent={updateEventStatus}
        eventHistory={detail?.eventHistory ?? {}}
        reminderTimeline={detail?.reminderTimeline ?? {}}
        onSetProgressValue={setProgressValue}
      />
    </main>
  );

  async function logout() {
    await apiJson<{ status: string }>("/api/v1/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }
}

function Overview(props: {
  profile: ApiUser | null;
  cards: ApiCard[];
  totalCards: number;
  activeCards: number;
  attentionCards: CardSummary[];
  events: ApiFeeEvent[];
  reminders: ApiReminder[];
  upcomingAmount: number;
  onAdd: () => void;
  onOpenCard: (card: ApiCard | CardSummary) => void;
  onGoCards: () => void;
  onGoReminders: () => void;
}) {
  const overdueReminders = props.reminders.filter((reminder) => reminderOverdue(reminder));
  return (
    <>
      <div className="welcome-row">
        <div>
          <p className="eyebrow">OVERVIEW</p>
          <h1>{props.profile?.name ? props.profile.name + "，你好" : "欢迎回来"}</h1>
          <p className="subline">未来 90 天年费与免年费进度都在这里。</p>
        </div>
        <button className="primary-button" onClick={props.onAdd}>
          <Icon name="plus" size={17} />
          新增卡片
        </button>
      </div>

      <section className="metrics" aria-label="概览指标">
        <div className="metric">
          <span className="metric-label">总卡片</span>
          <strong>{props.totalCards}</strong>
          <span className="metric-note"><Icon name="credit" size={14} />全部状态</span>
        </div>
        <div className="metric">
          <span className="metric-label">使用中卡片</span>
          <strong>{props.activeCards}</strong>
          <span className="metric-note"><Icon name="check" size={14} />不含停用/归档</span>
        </div>
        <div className="metric">
          <span className="metric-label">待处理提醒</span>
          <strong>{props.reminders.length}</strong>
          <span className="metric-note warning"><Icon name="clock" size={14} />{overdueReminders.length ? overdueReminders.length + " 条已逾期" : "需要确认"}</span>
        </div>
        <div className="metric">
          <span className="metric-label">未来 90 天年费</span>
          <strong>{money(props.upcomingAmount)}</strong>
          <span className="metric-note">共 {props.events.length} 张卡</span>
        </div>
        <div className="metric accent">
          <span className="metric-label">待办事项</span>
          <strong>{props.events.length + props.reminders.length}</strong>
          <span className="metric-note success"><Icon name="check" size={14} />及时处理</span>
        </div>
      </section>

      <div className="dashboard-grid">
        <div className="primary-column">
          <section className="section-block">
            <div className="section-heading">
              <div>
                <p className="section-kicker">YOUR CARDS</p>
                <h2>我的卡片 <span>{props.cards.length}</span></h2>
              </div>
              <button className="text-button" onClick={props.onGoCards}>查看全部 <Icon name="arrow" size={15} /></button>
            </div>
            {props.cards.length ? (
              <div className="card-list">
                {props.cards.map((card, index) => (
                  <button key={card.id} className="card-row" onClick={() => props.onOpenCard(card)}>
                    <span className={"card-color " + ["green", "blue", "coral", "ink"][index % 4]} />
                    <span className="card-row-main">
                      <strong>{card.issuerName} · {card.name}</strong>
                      </span>
                    <span className="card-row-amount">{money(card.annualFeeAmount, card.currency)}</span>
                    <span className="card-row-rule">{ruleText(card)}</span>
                  </button>
                ))}
              </div>
            ) : (
              <EmptyState onAdd={props.onAdd} />
            )}
          </section>
        </div>
        <div className="secondary-column">
          <section className="section-block">
            <div className="section-heading">
              <div>
                <p className="section-kicker">UPCOMING</p>
                <h2>未来 90 天年费</h2>
              </div>
            </div>
            {props.events.length ? (
              <div className="event-list compact">
                {props.events.slice(0, 5).map((event) => (
                  <div className="event-row" key={event.id}>
                    <span className="event-date">{fmtDate(event.dueDate)}</span>
                    <span className="event-main">
                      <strong>{cardLabel(event.cardId, props.cards)}</strong>
                      <small>{money(event.expectedAmount, props.cards.find((card) => card.id === event.cardId)?.currency)}</small>
                    </span>
                    <span className="status-pill">{STATUS_LABEL[event.status] || event.status}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="empty-note">未来 90 天没有年费事件。</p>
            )}
          </section>
          <section className="section-block">
            <div className="section-heading">
              <div>
                <p className="section-kicker">NEEDS ATTENTION</p>
                <h2>需要关注</h2>
              </div>
              <button className="text-button" onClick={props.onGoCards}>查看全部 <Icon name="arrow" size={15} /></button>
            </div>
            {props.attentionCards.length ? (
              <div className="event-list compact">
                {props.attentionCards.map((card) => (
                  <button key={card.id} className="event-row attention-row" onClick={() => props.onOpenCard(card)}>
                    <span className="event-date">{fmtDate(card.nextEvent?.dueDate ?? card.nextFeeDate)}</span>
                    <span className="event-main">
                      <strong>{card.issuerName} · {card.name}</strong>
                      <small>{card.progress ? "剩余 " + (card.progress.remainingCount ?? 0) + " 次 · " + money(card.progress.remainingAmount ?? 0, card.currency) : "未设置进度"}</small>
                    </span>
                    <span className="status-pill">{Math.round(card.progress?.percentage ?? 0)}%</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="empty-note">暂无需要关注的免年费进度。</p>
            )}
          </section>
          <section className="section-block">
            <div className="section-heading">
              <div>
                <p className="section-kicker">REMINDERS</p>
                <h2>最近提醒</h2>
              </div>
              <button className="text-button" onClick={props.onGoReminders}>提醒中心 <Icon name="arrow" size={15} /></button>
            </div>
            {props.reminders.length ? (
              <div className="reminder-list compact">
                {overdueReminders.length > 0 && (
                  <p className="overdue-note"><Icon name="clock" size={15} />{overdueReminders.length} 条提醒已逾期，请尽快处理。</p>
                )}
                {props.reminders.slice(0, 4).map((reminder) => (
                  <div className={"reminder-row" + (reminderOverdue(reminder) ? " overdue" : "")} key={reminder.id}>
                    <Icon name="bell" size={16} />
                    <span>
                      <strong>{reminder.kind === "fee_event" ? "年费提醒" : "进度提醒"}</strong>
                      <small>{fmtDate(reminder.scheduledFor)} · 提前 {reminder.daysBefore} 天</small>
                    </span>
                    {reminderOverdue(reminder) && <b className="overdue-pill">已逾期</b>}
                  </div>
                ))}
              </div>
            ) : (
              <p className="empty-note">暂无待处理提醒。</p>
            )}
          </section>
        </div>
      </div>
    </>
  );
}

function CardsView(props: {
  cards: CardSummary[];
  query: string;
  onQueryChange: (value: string) => void;
  onAdd: () => void;
  onEdit: (card: CardSummary) => void;
  onOpenCard: (card: CardSummary) => void;
}) {
  const [statusFilter, setStatusFilter] = useState("all");
  const [feeStatusFilter, setFeeStatusFilter] = useState("all");
  const [qualifiedFilter, setQualifiedFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sortBy, setSortBy] = useState("due_date");
  const visibleCards = useMemo(() => {
    const filtered = props.cards.filter((card) =>
      (statusFilter === "all" || card.status === statusFilter) &&
      (feeStatusFilter === "all" || card.nextEvent?.status === feeStatusFilter) &&
      (qualifiedFilter === "all" || (card.progress?.qualified === (qualifiedFilter === "qualified"))) &&
      (!dateFrom || !card.nextFeeDate || card.nextFeeDate >= dateFrom) &&
      (!dateTo || !card.nextFeeDate || card.nextFeeDate <= dateTo),
    );
    return filtered.sort((a, b) => {
      if (sortBy === "remaining_count") return (a.progress?.remainingCount ?? 0) - (b.progress?.remainingCount ?? 0);
      if (sortBy === "remaining_amount") return (a.progress?.remainingAmount ?? 0) - (b.progress?.remainingAmount ?? 0);
      if (sortBy === "qualified") return (a.progress?.qualified ? 1 : 0) - (b.progress?.qualified ? 1 : 0);
      if (sortBy === "name") return (a.issuerName + a.name).localeCompare(b.issuerName + b.name);
      if (sortBy === "created_at") return b.createdAt.localeCompare(a.createdAt);
      return a.nextFeeDate.localeCompare(b.nextFeeDate);
    });
  }, [props.cards, statusFilter, feeStatusFilter, qualifiedFilter, dateFrom, dateTo, sortBy]);
  return (
    <>
      <div className="welcome-row">
        <div>
          <p className="eyebrow">MY CARDS</p>
          <h1>我的卡片</h1>
          <p className="subline">维护每张卡的年费规则与免年费目标。</p>
        </div>
        <button className="primary-button" onClick={props.onAdd}>
          <Icon name="plus" size={17} />
          新增卡片
        </button>
      </div>
      <section className="section-block">
        <div className="toolbar">
          <label className="search-field">
            <Icon name="search" size={16} />
            <input value={props.query} onChange={(event) => props.onQueryChange(event.target.value)} placeholder="搜索银行、卡名或尾号" />
          </label>
          <select
            className="filter-button"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            aria-label="按状态筛选"
          >
            <option value="all">全部状态</option>
            <option value="active">使用中</option>
            <option value="suspended">已停用</option>
            <option value="archived">已归档</option>
          </select>
          <select
            className="filter-button"
            value={feeStatusFilter}
            onChange={(event) => setFeeStatusFilter(event.target.value)}
            aria-label="按年费状态筛选"
          >
            <option value="all">全部年费状态</option>
            <option value="pending">待确认</option>
            <option value="waived">已免除</option>
            <option value="charged">已扣费</option>
            <option value="refunded">已退费</option>
            <option value="not_applicable">无需处理</option>
          </select>
          <select
            className="filter-button"
            value={qualifiedFilter}
            onChange={(event) => setQualifiedFilter(event.target.value)}
            aria-label="按达标状态筛选"
          >
            <option value="all">全部进度</option>
            <option value="qualified">已达标</option>
            <option value="not_qualified">未达标</option>
          </select>
          <input className="filter-button date-filter" type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} aria-label="年费起始日期" />
          <input className="filter-button date-filter" type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} aria-label="年费结束日期" />
          <select
            className="filter-button"
            value={sortBy}
            onChange={(event) => setSortBy(event.target.value)}
            aria-label="排序"
          >
            <option value="due_date">按年费日</option>
            <option value="remaining_count">按剩余次数</option>
            <option value="remaining_amount">按剩余金额</option>
            <option value="qualified">按达标状态</option>
            <option value="name">按卡片名称</option>
            <option value="created_at">按创建时间</option>
          </select>
        </div>
        {visibleCards.length ? (
          <div className="card-list">
            {visibleCards.map((card, index) => (
              <div className="card-row card-row-list" key={card.id}>
                <button className="card-row-main-button" onClick={() => props.onOpenCard(card)}>
                  <span className={"card-color " + ["green", "blue", "coral", "ink"][index % 4]} />
                  <span className="card-row-main">
                    <strong>{card.issuerName} · {card.name}</strong>
                    <small>尾号 {card.last4} · 下次年费 {fmtDate(card.nextFeeDate)}{card.nextEvent?.status ? " · " + (STATUS_LABEL[card.nextEvent.status] || card.nextEvent.status) : ""}</small>
                  </span>
                </button>
                <span className="card-row-amount">{money(card.annualFeeAmount, card.currency)}</span>
                <span className={"status-pill" + (card.progress?.qualified ? " success" : "")}>{card.progress ? (card.progress.qualified ? "已达标" : Math.round(card.progress.percentage) + "%") : STATUS_LABEL[card.status] || card.status}</span>
                <button className="icon-button" aria-label="编辑" title="编辑" onClick={() => props.onEdit(card)}>
                  <Icon name="more" size={17} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState onAdd={props.onAdd} />
        )}
      </section>
    </>
  );
}

function CalendarView(props: { events: ApiFeeEvent[]; cards: ApiCard[] }) {
  const [mode, setMode] = useState<"month" | "list">("month");
  const [cursor, setCursor] = useState(() => startOfMonth(new Date()));
  const groups = useMemo(() => {
    const map = new Map<string, ApiFeeEvent[]>();
    for (const event of [...props.events].sort((a, b) => a.dueDate.localeCompare(b.dueDate))) {
      const key = event.dueDate.slice(0, 7);
      map.set(key, [...(map.get(key) ?? []), event]);
    }
    return [...map.entries()];
  }, [props.events]);
  const eventsByDate = useMemo(() => {
    const map = new Map<string, ApiFeeEvent[]>();
    for (const event of props.events) {
      map.set(event.dueDate, [...(map.get(event.dueDate) ?? []), event]);
    }
    return map;
  }, [props.events]);
  const monthStart = startOfMonth(cursor);
  const monthDays = eachDayOfInterval({ start: monthStart, end: endOfMonth(cursor) });
  const leadingCells = (monthStart.getDay() + 6) % 7;
  const weekDays = ["一", "二", "三", "四", "五", "六", "日"];

  return (
    <>
      <div className="welcome-row">
        <div>
          <p className="eyebrow">FEE CALENDAR</p>
          <h1>年费日历</h1>
          <p className="subline">按月视图或列表查看未来年费事件与处理状态。</p>
        </div>
      </div>
      <div className="calendar-toolbar-row">
        <div className="segmented-control" role="tablist" aria-label="日历视图">
          <button
            id="calendar-month-tab"
            role="tab"
            aria-selected={mode === "month"}
            aria-controls="calendar-month-panel"
            tabIndex={mode === "month" ? 0 : -1}
            className={mode === "month" ? "active" : ""}
            onClick={() => setMode("month")}
          >
            月视图
          </button>
          <button
            id="calendar-list-tab"
            role="tab"
            aria-selected={mode === "list"}
            aria-controls="calendar-list-panel"
            tabIndex={mode === "list" ? 0 : -1}
            className={mode === "list" ? "active" : ""}
            onClick={() => setMode("list")}
          >
            列表视图
          </button>
        </div>
      </div>
      <section
        className="section-block"
        id={mode === "month" ? "calendar-month-panel" : "calendar-list-panel"}
        role="tabpanel"
        aria-labelledby={mode === "month" ? "calendar-month-tab" : "calendar-list-tab"}
      >
        {mode === "month" ? (
          <>
            <div className="calendar-toolbar">
              <button className="text-button" aria-label="上个月" onClick={() => setCursor((current) => addMonths(current, -1))}>上个月</button>
              <strong>{format(cursor, "yyyy 年 M 月")}</strong>
              <button className="text-button" aria-label="下个月" onClick={() => setCursor((current) => addMonths(current, 1))}>下个月</button>
            </div>
            <div className="calendar-weekdays" aria-hidden="true">
              {weekDays.map((day) => <span key={day}>{day}</span>)}
            </div>
            <div className="calendar-grid">
              {Array.from({ length: leadingCells }).map((_, index) => <div className="calendar-day empty" key={"empty-" + index} />)}
              {monthDays.map((day) => {
                const dayKey = format(day, "yyyy-MM-dd");
                const dayEvents = eventsByDate.get(dayKey) ?? [];
                return (
                  <div className={"calendar-day" + (dayEvents.length ? " has-events" : "")} key={dayKey}>
                    <span className="calendar-day-number">{format(day, "d")}</span>
                    <div className="calendar-day-events">
                      {dayEvents.slice(0, 2).map((event) => (
                        <span
                          className="calendar-event-dot"
                          key={event.id}
                          role="img"
                          title={cardLabel(event.cardId, props.cards) + " · " + money(event.expectedAmount)}
                          aria-label={cardLabel(event.cardId, props.cards) + " · " + money(event.expectedAmount)}
                        />
                      ))}
                      {dayEvents.length > 2 && <small>+{dayEvents.length - 2}</small>}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        ) : groups.length ? (
          <div className="calendar-list">
            {groups.map(([month, monthEvents]) => (
              <div className="month-group" key={month}>
                <h2>{month.replace("-", " 年 ")} 月</h2>
                {monthEvents.map((event) => (
                  <div className="event-row" key={event.id}>
                    <span className="event-date">{fmtDate(event.dueDate)}</span>
                    <span className="event-main">
                      <strong>{cardLabel(event.cardId, props.cards)}</strong>
                      <small>{money(event.expectedAmount)}</small>
                    </span>
                    <span className="status-pill">{STATUS_LABEL[event.status] || event.status}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        ) : (
          <p className="empty-note">还没有年费事件，先新增一张卡片。</p>
        )}
      </section>
    </>
  );
}

function RemindersView(props: {
  reminders: ApiReminder[];
  onAction: (reminder: ApiReminder, action: string) => void;
}) {
  const active = props.reminders.filter((item) => item.status === "pending" || item.status === "snoozed");
  const overdue = active.filter((item) => reminderOverdue(item));
  return (
    <>
      <div className="welcome-row">
        <div>
          <p className="eyebrow">REMINDERS</p>
          <h1>提醒中心</h1>
          <p className="subline">处理年费提醒，避免遗忘关键日期。</p>
        </div>
      </div>
      <section className="section-block">
        {active.length ? (
          <div className="reminder-list">
            {overdue.length > 0 && (
              <p className="overdue-note"><Icon name="clock" size={15} />{overdue.length} 条提醒已逾期，请尽快处理。</p>
            )}
            {active.map((reminder) => (
              <div className={"reminder-card" + (reminderOverdue(reminder) ? " overdue" : "")} key={reminder.id}>
                <div className="reminder-card-head">
                  <Icon name="bell" size={18} />
                  <div>
                    <strong>{reminder.kind === "fee_event" ? "年费提醒" : "进度提醒"}</strong>
                    <small>{fmtDate(reminder.scheduledFor)} · 提前 {reminder.daysBefore} 天</small>
                  </div>
                  {reminderOverdue(reminder) && <b className="overdue-pill">已逾期</b>}
                </div>
                <div className="reminder-actions">
                  <button className="primary-button" onClick={() => props.onAction(reminder, "complete")}>
                    <Icon name="check" size={15} />
                    完成
                  </button>
                  <button className="text-button" onClick={() => props.onAction(reminder, "snooze")}>稍后处理</button>
                  <button className="text-button" onClick={() => props.onAction(reminder, "ignore")}>忽略</button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="empty-note">没有待处理提醒。</p>
        )}
      </section>
    </>
  );
}

function SettingsView(props: {
  profile: ApiUser | null;
  onProfileUpdated: (user: ApiUser) => void;
  reminderRules: ApiReminderRule[];
  onReminderRulesChange: (rules: ApiReminderRule[]) => Promise<void>;
}) {
  const [name, setName] = useState(props.profile?.name ?? "");
  const [timezone, setTimezone] = useState(props.profile?.timezone ?? "Asia/Shanghai");
  const [deleteText, setDeleteText] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [ruleDraft, setRuleDraft] = useState<ApiReminderRule[]>(props.reminderRules);
  const [ruleError, setRuleError] = useState("");
  const [ruleSaved, setRuleSaved] = useState(false);
  const [deletionAuditOpen, setDeletionAuditOpen] = useState(false);

  useEffect(() => {
    setRuleDraft(props.reminderRules);
  }, [props.reminderRules]);

  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const res = await apiJson<ApiUser>("/api/v1/me", {
        method: "PATCH",
        body: JSON.stringify({ name, timezone }),
      });
      props.onProfileUpdated(res.data);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2500);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存失败");
    }
  }

  async function requestDelete() {
    if (deleteText.trim() !== "DELETE") {
      setError("请输入 DELETE 确认删除账户");
      return;
    }
    if (!window.confirm("删除请求提交后将撤销所有会话，且只能通过管理员恢复。确认继续？")) return;
    setError("");
    try {
      await apiJson<{ status: string }>("/api/v1/me/delete-request", {
        method: "POST",
        body: JSON.stringify({ confirmation: "DELETE" }),
      });
      window.location.href = "/login";
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "删除请求提交失败");
    }
  }

  function updateRule(index: number, patch: Partial<ApiReminderRule>) {
    setRuleDraft((current) =>
      current.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)),
    );
  }

  function removeRule(index: number) {
    setRuleDraft((current) => current.filter((_, i) => i !== index));
  }

  function addRule() {
    setRuleDraft((current) => [
      ...current,
      { id: "", kind: "fee_event", daysBefore: 14, enabled: true },
    ]);
  }

  async function saveRules(event: FormEvent) {
    event.preventDefault();
    setRuleError("");
    setRuleSaved(false);
    if (ruleDraft.length === 0) {
      setRuleError("至少保留一个提醒节点");
      return;
    }
    const seen = new Set<number>();
    for (const rule of ruleDraft) {
      const daysBefore = Number(rule.daysBefore);
      if (!Number.isInteger(daysBefore) || daysBefore < 0 || daysBefore > 3650) {
        setRuleError("提前天数必须为 0 到 3650 的整数");
        return;
      }
      if (seen.has(daysBefore)) {
        setRuleError("提前天数不能重复");
        return;
      }
      seen.add(daysBefore);
    }
    try {
      await props.onReminderRulesChange(
        ruleDraft.map((rule) => ({ ...rule, daysBefore: Number(rule.daysBefore) })),
      );
      setRuleSaved(true);
      window.setTimeout(() => setRuleSaved(false), 2500);
    } catch (caught) {
      setRuleError(caught instanceof Error ? caught.message : "提醒规则保存失败");
    }
  }

  return (
    <>
      <div className="welcome-row">
        <div>
          <p className="eyebrow">SETTINGS</p>
          <h1>设置</h1>
          <p className="subline">管理个人时区、数据导出与账户。</p>
        </div>
      </div>
      <div className="settings-grid">
        <section className="section-block">
          <div className="section-heading">
            <div>
              <p className="section-kicker">PROFILE</p>
              <h2>个人资料</h2>
            </div>
          </div>
          <form className="form-grid" onSubmit={saveProfile}>
            <label>
              称呼
              <input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如 林先生" />
            </label>
            <label>
              时区
              <select value={timezone} onChange={(event) => setTimezone(event.target.value)}>
                <option value="Asia/Shanghai">Asia/Shanghai</option>
                <option value="Asia/Hong_Kong">Asia/Hong_Kong</option>
                <option value="Asia/Tokyo">Asia/Tokyo</option>
                <option value="America/Los_Angeles">America/Los_Angeles</option>
                <option value="Europe/London">Europe/London</option>
              </select>
            </label>
            <label>
              邮箱（只读）
              <input value={props.profile?.email ?? ""} disabled />
            </label>
            {error && <p className="form-error" role="alert">{error}</p>}
            {saved && <p className="form-success" role="status">已保存</p>}
            <button className="primary-button" type="submit">保存设置</button>
          </form>
        </section>

        <section className="section-block">
          <div className="section-heading">
            <div>
              <p className="section-kicker">REMINDERS</p>
              <h2>提醒规则</h2>
            </div>
          </div>
          <form className="form-grid" onSubmit={saveRules}>
            <div className="reminder-rule-list">
              {ruleDraft.map((rule, index) => (
                <div className="reminder-rule-row" key={rule.id || "new-" + index}>
                  <label className="reminder-rule-toggle">
                    <input
                      type="checkbox"
                      checked={rule.enabled}
                      onChange={(event) => updateRule(index, { enabled: event.target.checked })}
                    />
                    启用
                  </label>
                  <label>
                    提前天数
                    <input
                      type="number"
                      min={0}
                      max={3650}
                      step={1}
                      value={rule.daysBefore}
                      onChange={(event) => updateRule(index, { daysBefore: Number(event.target.value) })}
                    />
                  </label>
                  <button className="text-button" type="button" onClick={() => removeRule(index)}>
                    移除
                  </button>
                </div>
              ))}
              <button className="text-button" type="button" onClick={addRule}>
                <Icon name="plus" size={14} />
                添加提醒节点
              </button>
            </div>
            {ruleError && <p className="form-error full-width" role="alert">{ruleError}</p>}
            {ruleSaved && <p className="form-success full-width" role="status">已保存</p>}
            <button className="primary-button full-width" type="submit">保存提醒规则</button>
          </form>
        </section>

        <section className="section-block">
          <div className="section-heading">
            <div>
              <p className="section-kicker">DATA</p>
              <h2>数据与账户</h2>
            </div>
          </div>
          <div className="data-actions">
            <div>
              <strong>导出全部数据</strong>
              <p>包含卡片、周期、进度、年费事件和提醒记录。</p>
              <button
                className="text-button"
                type="button"
                onClick={() => {
                  if (window.confirm("确认导出包含全部卡片、周期、进度和提醒记录的 JSON？")) {
                    window.location.href = "/api/v1/me/export";
                  }
                }}
              >
                下载 JSON <Icon name="arrow" size={15} />
              </button>
            </div>
            {props.profile && (props.profile.status !== "active" || props.profile.deletionRequestedAt) && (
              <div className="deletion-status">
                <strong>删除申请状态</strong>
                <dl>
                  <div>
                    <dt>状态</dt>
                    <dd>{STATUS_LABEL[props.profile.status] || props.profile.status}</dd>
                  </div>
                  <div>
                    <dt>申请时间</dt>
                    <dd>{fmtDate(props.profile.deletionRequestedAt)}</dd>
                  </div>
                  <div>
                    <dt>清理完成时间</dt>
                    <dd>{fmtDate(props.profile.deletionCleanupCompletedAt)}</dd>
                  </div>
                  <div>
                    <dt>重试次数</dt>
                    <dd>{props.profile.deletionRetryCount ?? 0}</dd>
                  </div>
                </dl>
                <button className="text-button" type="button" onClick={() => setDeletionAuditOpen(true)}>
                  查看删除审计 <Icon name="arrow" size={15} />
                </button>
              </div>
            )}
            <div className="danger-zone">
              <strong>删除账户</strong>
              <p>输入 DELETE 后提交删除请求，当前会话会被撤销。</p>
              <input value={deleteText} onChange={(event) => setDeleteText(event.target.value)} placeholder="DELETE" />
              <button className="danger-button" onClick={requestDelete}>提交删除请求</button>
            </div>
          </div>
        </section>
      </div>
      <ModalShell
        open={deletionAuditOpen && Boolean(props.profile)}
        onClose={() => setDeletionAuditOpen(false)}
        labelledBy="deletion-audit-title"
      >
        {props.profile && (
          <>
            <div className="modal-head">
              <div>
                <p className="section-kicker">DELETION AUDIT</p>
                <h2 id="deletion-audit-title">账户删除审计</h2>
              </div>
              <button className="icon-button" onClick={() => setDeletionAuditOpen(false)} aria-label="关闭"><Icon name="close" size={17} /></button>
            </div>
            <dl className="audit-detail-list">
              <div>
                <dt>账户状态</dt>
                <dd>{STATUS_LABEL[props.profile.status] || props.profile.status}</dd>
              </div>
              <div>
                <dt>申请时间</dt>
                <dd>{fmtDate(props.profile.deletionRequestedAt)}</dd>
              </div>
              <div>
                <dt>清理完成时间</dt>
                <dd>{fmtDate(props.profile.deletionCleanupCompletedAt)}</dd>
              </div>
              <div>
                <dt>重试次数</dt>
                <dd>{props.profile.deletionRetryCount ?? 0}</dd>
              </div>
              <div>
                <dt>清理结果</dt>
                <dd><pre>{JSON.stringify(props.profile.deletionCleanupResult ?? {}, null, 2)}</pre></dd>
              </div>
            </dl>
          </>
        )}
      </ModalShell>
    </>
  );
}

function CardForm(props: {
  open: boolean;
  initial: ApiCard | null;
  onClose: () => void;
  onSubmit: (draft: CardDraft) => void;
}) {
  const [issuerName, setName_issuer] = useState(props.initial?.issuerName ?? "");
  const [name, setName] = useState(props.initial?.name ?? "");
  const [last4, setLast4] = useState(props.initial?.last4 ?? "");
  const [fee, setFee] = useState(String(props.initial?.annualFeeAmount ?? ""));
  const [date, setDate] = useState(props.initial?.nextFeeDate ?? "");
  const [cycleType, setCycleType] = useState<CardDraft["feeCycleType"]>(props.initial?.feeCycleType ?? "custom");
  const [openedOn, setOpenedOn] = useState(props.initial?.openedOn ?? "");
  const [feeMonth, setFeeMonth] = useState(String(props.initial?.feeMonth ?? ""));
  const [feeDay, setFeeDay] = useState(String(props.initial?.feeDay ?? ""));
  const [ruleType, setRuleType] = useState<CardDraft["waiveRuleType"]>(props.initial?.waiveRuleType as CardDraft["waiveRuleType"] ?? "none");
  const [targetCount, setTargetCount] = useState(String(props.initial?.targetCount ?? ""));
  const [targetAmount, setTargetAmount] = useState(String(props.initial?.targetAmount ?? ""));
  const [customRule, setCustomRule] = useState(props.initial?.customRuleText ?? "");
  const [status, setStatus] = useState<CardDraft["status"]>(props.initial?.status ?? "active");
  const [currency, setCurrency] = useState(props.initial?.currency ?? "CNY");
  const [notes, setNotes] = useState(props.initial?.notes ?? "");
  const [progressPeriodStart, setProgressPeriodStart] = useState(props.initial?.progressPeriodStart ?? "");
  const [progressPeriodEnd, setProgressPeriodEnd] = useState(props.initial?.progressPeriodEnd ?? "");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!props.open) return;
    setName_issuer(props.initial?.issuerName ?? "");
    setName(props.initial?.name ?? "");
    setLast4(props.initial?.last4 ?? "");
    setFee(String(props.initial?.annualFeeAmount ?? ""));
    setDate(props.initial?.nextFeeDate ?? "");
    setCycleType(props.initial?.feeCycleType ?? "custom");
    setOpenedOn(props.initial?.openedOn ?? "");
    setFeeMonth(String(props.initial?.feeMonth ?? ""));
    setFeeDay(String(props.initial?.feeDay ?? ""));
    setRuleType(props.initial?.waiveRuleType as CardDraft["waiveRuleType"] ?? "none");
    setTargetCount(String(props.initial?.targetCount ?? ""));
    setTargetAmount(String(props.initial?.targetAmount ?? ""));
    setCustomRule(props.initial?.customRuleText ?? "");
    setStatus(props.initial?.status ?? "active");
    setCurrency(props.initial?.currency ?? "CNY");
    setNotes(props.initial?.notes ?? "");
    setProgressPeriodStart(props.initial?.progressPeriodStart ?? "");
    setProgressPeriodEnd(props.initial?.progressPeriodEnd ?? "");
    setError("");
  }, [props.open, props.initial]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!issuerName.trim() || !name.trim() || !/^\d{4}$/.test(last4) || !fee || !date) {
      setError("请填写所有必填项，尾号需为 4 位数字");
      return;
    }
    if (cycleType === "anniversary" && !openedOn) {
      setError("周年规则需要填写开卡日期");
      return;
    }
    const month = Number(feeMonth);
    const day = Number(feeDay);
    if (cycleType === "fixed_date" && (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(day) || day < 1 || day > 31)) {
      setError("固定日期规则需要有效的月份和日期");
      return;
    }
    const count = Number(targetCount);
    const amount = Number(targetAmount);
    if ((ruleType === "count" || ruleType === "count_and_amount") && (!Number.isInteger(count) || count <= 0)) {
      setError("次数规则需要填写大于 0 的目标次数");
      return;
    }
    if ((ruleType === "amount" || ruleType === "count_and_amount") && (!Number.isFinite(amount) || amount <= 0)) {
      setError("金额规则需要填写大于 0 的目标金额");
      return;
    }
    if (ruleType === "custom" && !customRule.trim()) {
      setError("自定义规则需要填写说明");
      return;
    }
    const normalizedCurrency = currency.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(normalizedCurrency)) {
      setError("币种需要填写三位 ISO 代码，例如 CNY、USD、HKD");
      return;
    }
    if (progressPeriodStart && progressPeriodEnd && progressPeriodEnd < progressPeriodStart) {
      setError("进度周期结束日期不能早于开始日期");
      return;
    }
    props.onSubmit({
      status: status ?? "active",
      issuerName: issuerName.trim(),
      name: name.trim(),
      last4,
      annualFeeAmount: Number(fee),
      currency: normalizedCurrency,
      nextFeeDate: date,
      feeCycleType: cycleType,
      openedOn: cycleType === "anniversary" ? openedOn : undefined,
      feeMonth: cycleType === "fixed_date" ? month : undefined,
      feeDay: cycleType === "fixed_date" ? day : undefined,
      waiveRuleType: ruleType,
      targetCount: ruleType === "count" || ruleType === "count_and_amount" ? count : undefined,
      targetAmount: ruleType === "amount" || ruleType === "count_and_amount" ? amount : undefined,
      customRuleText: ruleType === "custom" ? customRule.trim() : undefined,
      notes: notes.trim() || undefined,
      progressPeriodStart: progressPeriodStart || undefined,
      progressPeriodEnd: progressPeriodEnd || undefined,
    });
  }

  return (
    <ModalShell open={props.open} onClose={props.onClose} labelledBy="card-form-title" className="modal-wide">
        <div className="modal-head">
          <div>
            <p className="section-kicker">{props.initial ? "EDIT CARD" : "NEW CARD"}</p>
            <h2 id="card-form-title">{props.initial ? "编辑卡片" : "新增卡片"}</h2>
          </div>
          <button className="icon-button" onClick={props.onClose} aria-label="关闭"><Icon name="close" size={17} /></button>
        </div>
        <form className="form-grid two-columns" onSubmit={submit}>
          <label>发卡银行<input value={issuerName} onChange={(event) => setName_issuer(event.target.value)} placeholder="例如 招商银行" /></label>
          <label>卡片名称<input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如 经典白金卡" /></label>
          <label>卡号后四位<input value={last4} onChange={(event) => setLast4(event.target.value)} placeholder="0000" maxLength={4} inputMode="numeric" /></label>
          <label>年费金额<input type="number" min="0" step="0.01" value={fee} onChange={(event) => setFee(event.target.value)} placeholder="0" /></label>
          <label>
            卡片状态
            <select value={status} onChange={(event) => setStatus(event.target.value as CardDraft["status"])}>
              <option value="active">使用中</option>
              <option value="suspended">已停用</option>
              <option value="archived">已归档</option>
            </select>
          </label>
          <label>币种<input value={currency} onChange={(event) => setCurrency(event.target.value)} maxLength={3} placeholder="CNY" /></label>
          <label>进度周期开始<input type="date" value={progressPeriodStart} onChange={(event) => setProgressPeriodStart(event.target.value)} /></label>
          <label>进度周期结束<input type="date" value={progressPeriodEnd} onChange={(event) => setProgressPeriodEnd(event.target.value)} /></label>
          <label className="full-width">备注<textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} placeholder="可选，例如账单日、权益备注" /></label>
          <label>下次年费日期<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
          <label>
            年费周期
            <select value={cycleType} onChange={(event) => setCycleType(event.target.value as CardDraft["feeCycleType"])}>
              <option value="anniversary">按开卡日周年</option>
              <option value="fixed_date">固定日期</option>
              <option value="custom">自定义日期</option>
            </select>
          </label>
          {cycleType === "anniversary" && (
            <label>开卡日期<input type="date" value={openedOn} onChange={(event) => setOpenedOn(event.target.value)} /></label>
          )}
          {cycleType === "fixed_date" && (
            <>
              <label>年费月份<input type="number" min="1" max="12" step="1" value={feeMonth} onChange={(event) => setFeeMonth(event.target.value)} placeholder="1-12" /></label>
              <label>年费日期<input type="number" min="1" max="31" step="1" value={feeDay} onChange={(event) => setFeeDay(event.target.value)} placeholder="1-31" /></label>
            </>
          )}
          <label>
            免年费规则
            <select value={ruleType} onChange={(event) => setRuleType(event.target.value as CardDraft["waiveRuleType"])}>
              <option value="none">无条件</option>
              <option value="count">刷卡次数</option>
              <option value="amount">消费金额</option>
              <option value="count_and_amount">次数与金额同时满足</option>
              <option value="custom">自定义说明</option>
            </select>
          </label>
          {(ruleType === "count" || ruleType === "count_and_amount") && (
            <label>目标次数<input type="number" min="1" step="1" value={targetCount} onChange={(event) => setTargetCount(event.target.value)} placeholder="例如 12" /></label>
          )}
          {(ruleType === "amount" || ruleType === "count_and_amount") && (
            <label>目标金额<input type="number" min="0" step="0.01" value={targetAmount} onChange={(event) => setTargetAmount(event.target.value)} placeholder="例如 100000" /></label>
          )}
          {ruleType === "custom" && (
            <label className="full-width">自定义规则<input value={customRule} onChange={(event) => setCustomRule(event.target.value)} placeholder="例如 每年生日月双倍积分" /></label>
          )}
          {error && <p className="form-error full-width" role="alert">{error}</p>}
          <div className="modal-actions full-width">
            <button className="text-button" type="button" onClick={props.onClose}>取消</button>
            <button className="primary-button" type="submit"><Icon name="check" size={16} />保存卡片</button>
          </div>
        </form>
    </ModalShell>
  );
}

function CardDetailModal(props: {
  open: boolean;
  detail: CardDetail | null;
  loading: boolean;
  events: ApiFeeEvent[];
  eventHistory: Record<string, ApiFeeEventHistory[]>;
  reminderTimeline: Record<string, ApiReminder[]>;
  onClose: () => void;
  onEdit: () => void;
  onArchive: () => void;
  onRestore: () => void;
  onAddProgress: (cycleId: string, entryDate: string, countDelta: number, amountDelta: number, note: string) => void;
  onEditProgress: (cycleId: string, entryId: string, entryDate: string, countDelta: number, amountDelta: number, note: string) => void;
  onReverseProgress: (cycleId: string, entryId: string) => void;
  onSetProgressValue: (cycleId: string, entryDate: string, count: number, amount: number, note: string) => void;
  onUpdateEvent: (event: ApiFeeEvent, status: string, actualAmount?: string, occurredOn?: string, notes?: string) => void;
}) {
  return (
    <ModalShell open={props.open} onClose={props.onClose} labelledBy="detail-title" className="modal-detail">
        <div className="modal-head">
          <div>
            <p className="section-kicker">CARD DETAIL</p>
            <h2 id="detail-title">{props.detail?.card.name ?? "卡片详情"}</h2>
          </div>
          <div className="modal-actions">
            <button className="text-button" onClick={props.onEdit}>编辑</button>
            {props.detail?.card.status === "archived" ? (
              <button className="text-button" onClick={props.onRestore}>恢复使用</button>
            ) : (
              <button className="text-button danger-text" onClick={props.onArchive}>归档</button>
            )}
            <button className="icon-button" onClick={props.onClose} aria-label="关闭"><Icon name="close" size={17} /></button>
          </div>
        </div>
        {props.loading || !props.detail ? (
          <p className="loading-inline" role="status">正在加载详情...</p>
        ) : (
          <div className="detail-scroll">
            <div className="detail-hero">
              <div>
                <strong>{props.detail.card.issuerName} · {props.detail.card.name}</strong>
                <p>尾号 {props.detail.card.last4} · {STATUS_LABEL[props.detail.card.status] || props.detail.card.status} · {ruleText(props.detail.card)}</p>
                {props.detail.card.notes && <small className="detail-note">{props.detail.card.notes}</small>}
              </div>
              <span className="detail-fee">{money(props.detail.card.annualFeeAmount, props.detail.card.currency)}</span>
            </div>
            <div className="detail-grid">
              {props.detail.cycles.map((cycle) => {
                const progress = props.detail?.progress[cycle.id];
                const event = props.events.find((item) => item.cycleId === cycle.id);
                return (
                  <CyclePanel
                    key={cycle.id}
                    cycle={cycle}
                    progress={progress}
                    event={event}
                    eventHistory={event ? props.eventHistory[event.id] ?? [] : []}
                    onAddProgress={props.onAddProgress}
                    onEditProgress={props.onEditProgress}
                    onReverseProgress={props.onReverseProgress}
                    onSetProgressValue={props.onSetProgressValue}
                    onUpdateEvent={props.onUpdateEvent}
                    reminders={event ? props.reminderTimeline[event.id] ?? [] : []}
                  />
                );
              })}
            </div>
          </div>
        )}
    </ModalShell>
  );
}

function CyclePanel(props: {
  cycle: ApiCycle;
  progress?: ProgressData;
  event?: ApiFeeEvent;
  eventHistory: ApiFeeEventHistory[];
  reminders: ApiReminder[];
  onAddProgress: (cycleId: string, entryDate: string, countDelta: number, amountDelta: number, note: string) => void;
  onEditProgress: (cycleId: string, entryId: string, entryDate: string, countDelta: number, amountDelta: number, note: string) => void;
  onReverseProgress: (cycleId: string, entryId: string) => void;
  onSetProgressValue: (cycleId: string, entryDate: string, count: number, amount: number, note: string) => void;
  onUpdateEvent: (event: ApiFeeEvent, status: string, actualAmount?: string, occurredOn?: string, notes?: string) => void;
}) {
  const [entryDate, setEntryDate] = useState(new Date().toISOString().slice(0, 10));
  const [inputMode, setInputMode] = useState<"delta" | "cumulative">("delta");
  const [countDelta, setCountDelta] = useState("");
  const [amountDelta, setAmountDelta] = useState("");
  const [note, setNote] = useState("");
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [status, setStatus] = useState(props.event?.status ?? "pending");
  const [actualAmount, setActualAmount] = useState("");
  const [occurredOn, setOccurredOn] = useState("");
  const [eventNote, setEventNote] = useState("");

  function submitProgress() {
    const count = Number(countDelta) || 0;
    const amount = Number(amountDelta) || 0;
    if (inputMode === "cumulative") {
      if (count === 0 && amount === 0) return;
      props.onSetProgressValue(props.cycle.id, entryDate, count, amount, note);
    } else if (editingEntryId) {
      props.onEditProgress(props.cycle.id, editingEntryId, entryDate, count, amount, note);
    } else {
      if (count <= 0 && amount <= 0) return;
      props.onAddProgress(props.cycle.id, entryDate, count, amount, note);
    }
    setEditingEntryId(null);
    setCountDelta("");
    setAmountDelta("");
    setNote("");
  }

  function switchInputMode(mode: "delta" | "cumulative") {
    setInputMode(mode);
    if (mode === "cumulative") setEditingEntryId(null);
  }

  function startEdit(entry: ProgressEntry) {
    setEditingEntryId(entry.id);
    setEntryDate(entry.entryDate);
    setCountDelta(String(entry.countDelta));
    setAmountDelta(String(entry.amountDelta));
    setNote(entry.note ?? "");
  }

  function cancelEdit() {
    setEditingEntryId(null);
    setEntryDate(new Date().toISOString().slice(0, 10));
    setCountDelta("");
    setAmountDelta("");
    setNote("");
  }

  function submitEvent() {
    if (!props.event) return;
    props.onUpdateEvent(props.event, status, actualAmount || undefined, occurredOn || undefined, eventNote || undefined);
  }

  return (
    <section className="cycle-panel">
      <div className="cycle-head">
        <div>
          <strong>{fmtDate(props.cycle.periodStart)} - {fmtDate(props.cycle.periodEnd)}</strong>
          <p>年费日 {fmtDate(props.cycle.feeDueDate)} · {STATUS_LABEL[props.cycle.status] || props.cycle.status}</p>
        </div>
        {props.progress && (
          <span className={"status-pill" + (props.progress.progress.qualified ? " success" : "")}>
            {props.progress.progress.qualified ? "已达标" : "待达标"}
          </span>
        )}
      </div>
      {props.progress && (
        <div className="progress-box">
          <div className="progress-label">
            <span>当前进度</span>
            <strong>{Math.min(100, Math.round(props.progress.progress.percentage))}%</strong>
          </div>
          <div className="progress-track"><span style={{ width: Math.min(100, Math.round(props.progress.progress.percentage)) + "%" }} /></div>
          <div className="progress-values">
            <span>{props.progress.progress.count} 次</span>
            <span>{money(props.progress.progress.amount)}</span>
          </div>
          {props.progress.entries.length > 0 && (
            <div className="progress-entry-list">
              <span className="progress-entry-heading">最近记录</span>
              {props.progress.entries.slice(0, 5).map((entry) => (
                <div className="progress-entry-row" key={entry.id}>
                  <span>{fmtDate(entry.entryDate)}</span>
                  <strong>{entry.countDelta > 0 ? entry.countDelta + " 次" : ""}{entry.amountDelta > 0 ? (entry.countDelta > 0 ? " · " : "") + money(entry.amountDelta) : ""}</strong>
                  <span>{entry.note || (entry.entryType === "reversal" ? "撤销" : "进度")}</span>
                  {entry.entryType !== "reversal" && !entry.reversedAt && (
                    <button className="text-button" type="button" onClick={() => startEdit(entry)}>编辑</button>
                  )}
                </div>
              ))}
            </div>
          )}
          {props.progress.entries[0] && props.progress.entries[0].entryType !== "reversal" && !props.progress.entries[0].reversedAt && (
            <button
              className="text-button"
              type="button"
              onClick={() =>
                props.onReverseProgress(
                  props.cycle.id,
                  props.progress?.entries[0].id ?? "",
                )
              }
            >
              撤销最近一条
            </button>
          )}
        </div>
      )}
      <div className="form-grid">
        <div className="progress-mode-switch full-width">
          <button
            type="button"
            className={inputMode === "delta" ? "active" : ""}
            onClick={() => switchInputMode("delta")}
          >
            追加增量
          </button>
          <button
            type="button"
            className={inputMode === "cumulative" ? "active" : ""}
            onClick={() => switchInputMode("cumulative")}
          >
            设置累计值
          </button>
        </div>
        <label>日期<input type="date" value={entryDate} onChange={(event) => setEntryDate(event.target.value)} /></label>
        <label>{inputMode === "cumulative" ? "当前次数" : "次数增量"}<input type="number" min="0" step="1" value={countDelta} onChange={(event) => setCountDelta(event.target.value)} placeholder="0" /></label>
        <label>{inputMode === "cumulative" ? "当前金额" : "金额增量"}<input type="number" min="0" step="0.01" value={amountDelta} onChange={(event) => setAmountDelta(event.target.value)} placeholder="0" /></label>
        <label>备注<input value={note} onChange={(event) => setNote(event.target.value)} placeholder="可选" /></label>
        <button className="secondary-button" onClick={submitProgress} type="button">{inputMode === "cumulative" ? "保存累计值" : editingEntryId ? "保存修改" : "追加进度"}</button>
        {editingEntryId && <button className="text-button" type="button" onClick={cancelEdit}>取消编辑</button>}
      </div>
      {props.event && (
        <div className="event-handler">
          <div className="event-handler-head">
            <strong>年费事件</strong>
            <span>{fmtDate(props.event.dueDate)} · {money(props.event.expectedAmount)}</span>
          </div>
          <div className="form-grid">
            <label>
              处理状态
              <select value={status} onChange={(event) => setStatus(event.target.value)}>
                <option value="pending">待确认</option>
                <option value="waived">已免除</option>
                <option value="charged">已扣费</option>
                <option value="refunded">已退费</option>
                <option value="not_applicable">无需处理</option>
              </select>
            </label>
            {(status === "charged" || status === "refunded") && (
              <>
                <label>实际金额<input type="number" min="0" step="0.01" value={actualAmount} onChange={(event) => setActualAmount(event.target.value)} /></label>
                <label>发生日期<input type="date" value={occurredOn} onChange={(event) => setOccurredOn(event.target.value)} /></label>
              </>
            )}
            <label>备注<input value={eventNote} onChange={(event) => setEventNote(event.target.value)} /></label>
            <button className="secondary-button" onClick={submitEvent} type="button">保存事件状态</button>
          </div>
          {props.eventHistory.length > 0 && (
            <div className="event-history">
              <span className="progress-entry-heading">处理历史</span>
              {props.eventHistory.slice(0, 6).map((item) => (
                <div className="event-history-row" key={item.id}>
                  <span>{fmtDate(item.occurredAt)}</span>
                  <strong>
                    {STATUS_LABEL[item.metadata.fromStatus ?? "pending"] ?? item.metadata.fromStatus ?? "待确认"}
                    {" → "}
                    {STATUS_LABEL[item.metadata.toStatus ?? "pending"] ?? item.metadata.toStatus ?? "待确认"}
                  </strong>
                  <span>{item.metadata.notes || "状态更新"}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {props.reminders.length > 0 && (
        <div className="reminder-history">
          <span className="progress-entry-heading">关联提醒</span>
          {props.reminders.slice(0, 6).map((reminder) => (
            <div className="event-history-row" key={reminder.id}>
              <span>{fmtDate(reminder.scheduledFor)}</span>
              <strong>{reminder.kind === "fee_event" ? "年费提醒" : "进度提醒"} · 提前 {reminder.daysBefore} 天</strong>
              <span>
                {STATUS_LABEL[reminder.status] || reminder.status}
                {reminder.completedAt ? " · " + fmtDate(reminder.completedAt) : ""}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function EmptyState(props: { onAdd: () => void }) {
  return (
    <div className="empty-state">
      <Icon name="credit" size={26} />
      <strong>还没有信用卡</strong>
      <p>录入第一张卡，开始跟踪年费与免年费进度。</p>
      <button className="primary-button" onClick={props.onAdd}><Icon name="plus" size={16} />新增第一张卡</button>
    </div>
  );
}
