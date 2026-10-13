"use client";
import { FormEvent, useEffect, useMemo, useState } from "react";
import type { ApiUser, ApiCard, CardSummary, ApiCycle, ApiFeeEvent, ApiFeeEventHistory, ApiReminder, ApiReminderRule, ProgressEntry, ProgressData, CardDetail, CardDraft } from "../../../../contracts/mvp";
import { STATUS_LABEL, fmtDate, daysUntil, reminderOverdue, money, ruleText, cardLabel } from "../../../shared/display/legacy";
import { Icon, ModalShell } from "../../../shared/ui";
export function RemindersView(props: {
  reminders: ApiReminder[];
  onAction: (reminder: ApiReminder, action: string) => void;
}) {
  const active = props.reminders.filter((item) => item.status === "pending" || item.status === "snoozed");
  const overdue = active.filter((item) => reminderOverdue(item));
  return (
    <>
      <div className="welcome-row">
        <div>
          <p className="eyebrow">提醒</p>
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
