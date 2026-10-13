"use client";
import { FormEvent, useEffect, useMemo, useState } from "react";
import type { ApiUser, ApiCard, CardSummary, ApiCycle, ApiFeeEvent, ApiFeeEventHistory, ApiReminder, ApiReminderRule, ProgressEntry, ProgressData, CardDetail, CardDraft } from "../../../../contracts/mvp";
import { STATUS_LABEL, fmtDate, daysUntil, reminderOverdue, money, ruleText, cardLabel } from "../../../shared/display/legacy";
import { Icon, ModalShell } from "../../../shared/ui";
import { addMonths, eachDayOfInterval, endOfMonth, format, startOfMonth } from "date-fns";
export function CalendarView(props: { events: ApiFeeEvent[]; cards: ApiCard[] }) {
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
          <p className="eyebrow">年费日历</p>
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
