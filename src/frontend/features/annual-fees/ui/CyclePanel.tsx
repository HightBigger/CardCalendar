"use client";
import { useRef, useState } from "react";
import type { ApiCycle, ApiFeeEvent, ApiFeeEventHistory, ApiReminder, ProgressEntry, ProgressData } from "../../../../contracts/mvp";
import { STATUS_LABEL, fmtDate, money } from "../../../shared/display/legacy";
export function CyclePanel(props: {
  cycle: ApiCycle;
  progress?: ProgressData;
  progressReadOnly?: boolean;
  event?: ApiFeeEvent;
  eventHistory: ApiFeeEventHistory[];
  reminders: ApiReminder[];
  onAddProgress: (cycleId: string, entryDate: string, countDelta: number, amountDelta: number, note: string) => Promise<void> | void;
  onEditProgress: (cycleId: string, entryId: string, entryDate: string, countDelta: number, amountDelta: number, note: string) => Promise<void> | void;
  onReverseProgress: (cycleId: string, entryId: string) => Promise<void> | void;
  onSetProgressValue: (cycleId: string, entryDate: string, count: number, amount: number, note: string) => Promise<void> | void;
  onUpdateEvent: (event: ApiFeeEvent, status: string, actualAmount?: string, occurredOn?: string, notes?: string) => Promise<void> | void;
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
  const submitting = useRef(false);
  const [busy, setBusy] = useState(false);
  const [progressError, setProgressError] = useState("");
  const [eventError, setEventError] = useState("");

  async function submitProgress() {
    if (submitting.current || props.progressReadOnly) return;
    const count = Number(countDelta) || 0;
    const amount = Number(amountDelta) || 0;
    if ((inputMode === "cumulative" && count === 0 && amount === 0) || (inputMode === "delta" && !editingEntryId && count <= 0 && amount <= 0)) return;
    submitting.current = true; setBusy(true); setProgressError("");
    try {
    if (inputMode === "cumulative") {
      await props.onSetProgressValue(props.cycle.id, entryDate, count, amount, note);
    } else if (editingEntryId) {
      await props.onEditProgress(props.cycle.id, editingEntryId, entryDate, count, amount, note);
    } else {
      await props.onAddProgress(props.cycle.id, entryDate, count, amount, note);
    }
    setEditingEntryId(null);
    setCountDelta("");
    setAmountDelta("");
    setNote("");
    } catch (error) { setProgressError(error instanceof Error ? error.message : "进度保存失败，可重试"); }
    finally { submitting.current = false; setBusy(false); }
  }

  function switchInputMode(mode: "delta" | "cumulative") {
    setInputMode(mode);
    if (mode === "cumulative") setEditingEntryId(null);
  }

  function startEdit(entry: ProgressEntry) {
    if (props.progressReadOnly) return;
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

  async function submitEvent() {
    if (!props.event || submitting.current) return;
    submitting.current = true; setBusy(true); setEventError("");
    try { await props.onUpdateEvent(props.event, status, actualAmount || undefined, occurredOn || undefined, eventNote || undefined); }
    catch (error) { setEventError(error instanceof Error ? error.message : "年费状态保存失败，可重试"); }
    finally { submitting.current = false; setBusy(false); }
  }

  async function reverseProgress(entryId: string) {
    if (submitting.current || props.progressReadOnly) return;
    submitting.current = true; setBusy(true); setProgressError("");
    try { await props.onReverseProgress(props.cycle.id, entryId); }
    catch (error) { setProgressError(error instanceof Error ? error.message : "撤销失败，可重试"); }
    finally { submitting.current = false; setBusy(false); }
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
                  {!props.progressReadOnly && entry.entryType !== "reversal" && !entry.reversedAt && (
                    <button className="text-button" type="button" disabled={busy} onClick={() => startEdit(entry)}>编辑</button>
                  )}
                </div>
              ))}
            </div>
          )}
          {!props.progressReadOnly && props.progress.entries[0] && props.progress.entries[0].entryType !== "reversal" && !props.progress.entries[0].reversedAt && (
            <button
              className="text-button"
              type="button"
              disabled={busy}
              onClick={() => reverseProgress(props.progress?.entries[0].id ?? "")}
            >
              撤销最近一条
            </button>
          )}
        </div>
      )}
      {props.progressReadOnly ? <p className="muted">卡片已归档，消费进度仅供查看。历史记录与年费处理保留。</p> : <div className="form-grid">
        <div className="progress-mode-switch full-width">
          <button
            type="button"
            className={inputMode === "delta" ? "active" : ""}
            disabled={busy}
            onClick={() => switchInputMode("delta")}
          >
            追加增量
          </button>
          <button
            type="button"
            className={inputMode === "cumulative" ? "active" : ""}
            disabled={busy}
            onClick={() => switchInputMode("cumulative")}
          >
            设置累计值
          </button>
        </div>
        <label>日期<input disabled={busy} type="date" value={entryDate} onChange={(event) => setEntryDate(event.target.value)} /></label>
        <label>{inputMode === "cumulative" ? "当前次数" : "次数增量"}<input disabled={busy} type="number" min="0" step="1" value={countDelta} onChange={(event) => setCountDelta(event.target.value)} placeholder="0" /></label>
        <label>{inputMode === "cumulative" ? "当前金额" : "金额增量"}<input disabled={busy} type="number" min="0" step="0.01" value={amountDelta} onChange={(event) => setAmountDelta(event.target.value)} placeholder="0" /></label>
        <label>备注<input disabled={busy} value={note} onChange={(event) => setNote(event.target.value)} placeholder="可选" /></label>
        <button className="secondary-button" disabled={busy} aria-busy={busy} onClick={submitProgress} type="button">{inputMode === "cumulative" ? "保存累计值" : editingEntryId ? "保存修改" : "追加进度"}</button>
        {editingEntryId && <button className="text-button" disabled={busy} type="button" onClick={cancelEdit}>取消编辑</button>}
      </div>}
      {progressError && <p className="form-error" role="alert">{progressError}</p>}
      {props.event && (
        <div className="event-handler">
          <div className="event-handler-head">
            <strong>年费事件</strong>
            <span>{fmtDate(props.event.dueDate)} · {money(props.event.expectedAmount)}</span>
          </div>
          <div className="form-grid">
            <label>
              处理状态
              <select disabled={busy} value={status} onChange={(event) => setStatus(event.target.value)}>
                <option value="pending">待确认</option>
                <option value="waived">已免除</option>
                <option value="charged">已扣费</option>
                <option value="refunded">已退费</option>
                <option value="not_applicable">无需处理</option>
              </select>
            </label>
            {(status === "charged" || status === "refunded") && (
              <>
                <label>实际金额<input disabled={busy} type="number" min="0" step="0.01" value={actualAmount} onChange={(event) => setActualAmount(event.target.value)} /></label>
                <label>发生日期<input disabled={busy} type="date" value={occurredOn} onChange={(event) => setOccurredOn(event.target.value)} /></label>
              </>
            )}
            <label>备注<input disabled={busy} value={eventNote} onChange={(event) => setEventNote(event.target.value)} /></label>
            <button className="secondary-button" disabled={busy} aria-busy={busy} onClick={submitEvent} type="button">保存事件状态</button>
          </div>
          {eventError && <p className="form-error" role="alert">{eventError}</p>}
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
