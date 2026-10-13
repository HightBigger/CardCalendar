"use client";
import type { ReactNode } from "react";
import type { ApiUser, ApiCard, CardSummary, ApiCycle, ApiFeeEvent, ApiFeeEventHistory, ApiReminder, ApiReminderRule, ProgressEntry, ProgressData, CardDetail, CardDraft } from "../../../contracts/mvp";
import { STATUS_LABEL, fmtDate, daysUntil, reminderOverdue, money, ruleText, cardLabel } from "../../shared/display/legacy";
import { Icon, ModalShell } from "../../shared/ui";
import { CyclePanel } from "../../features/annual-fees";
export function CardDetailModal(props: {
  open: boolean;
  detail: CardDetail | null;
  loading: boolean;
  error?: Error;
  onRetry?: () => unknown;
  events: ApiFeeEvent[];
  eventHistory: Record<string, ApiFeeEventHistory[]>;
  reminderTimeline: Record<string, ApiReminder[]>;
  onClose: () => void;
  onActivities?: () => void;
  activities?: ReactNode;
  onEdit: () => void;
  onArchive: () => void;
  onRestore: () => void;
  onAddProgress: (cycleId: string, entryDate: string, countDelta: number, amountDelta: number, note: string) => Promise<void> | void;
  onEditProgress: (cycleId: string, entryId: string, entryDate: string, countDelta: number, amountDelta: number, note: string) => Promise<void> | void;
  onReverseProgress: (cycleId: string, entryId: string) => Promise<void> | void;
  onSetProgressValue: (cycleId: string, entryDate: string, count: number, amount: number, note: string) => Promise<void> | void;
  onUpdateEvent: (event: ApiFeeEvent, status: string, actualAmount?: string, occurredOn?: string, notes?: string) => Promise<void> | void;
}) {
  return (
    <ModalShell open={props.open} onClose={props.onClose} labelledBy="detail-title" className="modal-detail">
        <div className="modal-head">
          <div>
            <p className="section-kicker">卡片详情</p>
            <h2 id="detail-title">{props.detail?.card.name ?? "卡片详情"}</h2>
          </div>
          <div className="modal-actions">
            {props.onActivities && <button className="text-button" onClick={props.onActivities}>卡片活动</button>}
            <button className="text-button" onClick={props.onEdit}>编辑</button>
            {props.detail?.card.status === "archived" ? (
              <button className="text-button" onClick={props.onRestore}>恢复使用</button>
            ) : (
              <button className="text-button danger-text" onClick={props.onArchive}>归档</button>
            )}
            <button className="icon-button" onClick={props.onClose} aria-label="关闭"><Icon name="close" size={17} /></button>
          </div>
        </div>
        {props.error ? (<p role="alert" className="form-error">{props.error.message} <button onClick={() => props.onRetry?.()}>重新加载详情</button></p>) : !props.detail ? (
          <p className="loading-inline" role="status">正在加载详情...</p>
        ) : (
          <div className="detail-scroll">
            {props.loading && <p role="status">正在更新详情…</p>}
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
                    progressReadOnly={props.detail?.card.status === "archived"}
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
            {props.activities}
          </div>
        )}
    </ModalShell>
  );
}
