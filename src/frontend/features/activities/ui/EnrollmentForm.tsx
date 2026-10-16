"use client";

import { useId, useState } from "react";
import type { ActivityDetail, CheckScope, ParticipationCheck } from "../../../../contracts/activities";

type CheckKind = "record_eligibility" | "record_enrollment" | "record_quota";
type CheckItem = { kind: CheckKind; label: string; value: string; confirmed: string; failed: string };
type SaveCheck = (scope: CheckScope, kind: string, status: string, note: string, attemptId?: string) => Promise<boolean>;

function requirements(detail: ActivityDetail) {
  return detail.requirements ?? {
    enrollmentRequired: detail.activity.editorDraft?.enrollmentRequired ?? "unknown",
    enrollmentScope: detail.activity.editorDraft?.enrollmentScope ?? (detail.checks.some((check) => check.scope === "period") ? "period" : "participation"),
    quotaRequired: detail.activity.editorDraft?.quotaRequired ?? false,
  };
}

function checkFor(detail: ActivityDetail, periodId?: string) {
  const perPeriod = requirements(detail).enrollmentScope === "period";
  return detail.checks.find((check) => perPeriod ? check.scope === "period" && check.periodId === periodId : check.scope === "participation");
}

function checkStatus(value: string) {
  if (["confirmed", "已官方核对", "已确认"].includes(value)) return "confirmed";
  if (["not_met", "未确认／失败", "不符合／失败"].includes(value)) return "not_met";
  return "unknown";
}

function itemsFor(detail: ActivityDetail, check: ParticipationCheck): CheckItem[] {
  const rules = requirements(detail);
  return [
    { kind: "record_eligibility" as const, label: "参与资格", value: check.eligibility, confirmed: "符合参与条件", failed: "不符合参与条件" },
    ...(rules.enrollmentRequired !== "no" ? [{ kind: "record_enrollment" as const, label: "活动报名", value: check.enrollment, confirmed: "报名成功", failed: "报名失败" }] : []),
    ...(rules.quotaRequired ? [{ kind: "record_quota" as const, label: "活动名额", value: check.quota, confirmed: "已获得名额", failed: "未获得名额" }] : []),
  ];
}

function itemStatus(item: CheckItem) {
  return checkStatus(item.value) === "confirmed" ? item.confirmed : checkStatus(item.value) === "not_met" ? item.failed : "尚未确认";
}

// The page shows one contextual entry. Scope and command selection stay out of its main flow.
export function ParticipationNotice({ detail, periodId, onOpen }: { detail: ActivityDetail; periodId?: string; onOpen: () => void }) {
  if ((requirements(detail).enrollmentScope === "period") !== !!periodId) return null;
  const check = checkFor(detail, periodId);
  if (!check) return null;
  const items = itemsFor(detail, check);
  const pending = items.find((item) => checkStatus(item.value) !== "confirmed");
  return <div className="participation-notice">
    <p>{pending ? `${pending.label}：${itemStatus(pending)}` : "参与信息已确认"}</p>
    <button className="text-button" onClick={onOpen}>{pending?.kind === "record_enrollment" ? "记录报名" : pending ? "确认参与信息" : "查看参与信息"}</button>
  </div>;
}

export function EnrollmentForm({ detail, periodId, busy, error, onSave }: { detail: ActivityDetail; periodId?: string; busy: boolean; error?: string; onSave: SaveCheck }) {
  const perPeriod = requirements(detail).enrollmentScope === "period";
  const [selectedPeriod, setSelectedPeriod] = useState(periodId ?? detail.activity.currentPeriod?.id ?? detail.periods.find((period) => period.phase === "active")?.id ?? detail.periods[0]?.id);
  const check = checkFor(detail, perPeriod ? periodId ?? selectedPeriod : undefined);
  const [selectedKind, setSelectedKind] = useState<CheckKind | null>(null);
  if (!check) return <p>暂无可记录的参与信息，请先查看活动规则。</p>;
  const items = itemsFor(detail, check);
  const active = items.find((item) => item.kind === selectedKind) ?? items.find((item) => checkStatus(item.value) !== "confirmed") ?? items[0];
  return <div className="participation-panel">
    {perPeriod && !periodId && <label className="participation-period">选择报名周期<select disabled={busy} value={selectedPeriod} onChange={(event) => { setSelectedPeriod(event.target.value); setSelectedKind(null); }}>{detail.periods.filter((period) => detail.checks.some((check) => check.periodId === period.id)).map((period) => <option key={period.id} value={period.id}>{period.label}</option>)}</select></label>}
    <p className="participation-context">{perPeriod ? check.label : "整个活动只需记录一次"} · 以银行显示的结果为准</p>
    <div className="participation-steps">{items.map((item) => <button type="button" className="secondary-button" key={item.kind} aria-pressed={active.kind === item.kind} disabled={busy} onClick={() => setSelectedKind(item.kind)}><span>{item.label}</span><small>{itemStatus(item)}</small></button>)}</div>
    <CheckForm key={`${check.scope}:${check.periodId ?? "all"}:${active.kind}`} check={check} item={active} busy={busy} error={error} onSave={onSave} onSaved={() => setSelectedKind(active.kind)} />
  </div>;
}

function CheckForm({ check, item, busy, error, onSave, onSaved }: { check: ParticipationCheck; item: CheckItem; busy: boolean; error?: string; onSave: SaveCheck; onSaved: () => void }) {
  const resultLabel = useId();
  const noteLabel = useId();
  const [status, setStatus] = useState(checkStatus(item.value));
  const [note, setNote] = useState("");
  const [saved, setSaved] = useState(false);
  const permission = check.allowedCommands.find((command) => command.kind === item.kind);
  return <form className="form-grid participation-form" onSubmit={async (event) => {
    event.preventDefault();
    if (!permission?.enabled || busy || !note.trim()) return;
    setSaved(false);
    if (await onSave({ scope: check.scope, ...(check.scope === "period" ? { periodId: check.periodId } : {}) }, item.kind, status, note.trim(), check.attemptId)) { setSaved(true); onSaved(); }
  }}>
    <label><span id={resultLabel}>{item.label}结果</span><select aria-labelledby={resultLabel} disabled={busy} value={status} onChange={(event) => { setStatus(event.target.value); setSaved(false); }}><option value="unknown">尚未确认</option><option value="confirmed">{item.confirmed}</option><option value="not_met">{item.failed}</option></select></label>
    <label><span id={noteLabel}>银行反馈或备注</span><textarea aria-labelledby={noteLabel} required maxLength={4000} disabled={busy} value={note} onChange={(event) => { setNote(event.target.value); setSaved(false); }} rows={2} placeholder="填写银行页面或客服给出的结果" /></label>
    {(check.reason || permission?.reason) && <p>{check.reason || permission?.reason}</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {saved && !error && <p role="status">已保存{item.label}结果</p>}
    <button className="primary-button" disabled={busy || !permission?.enabled || !note.trim()} aria-busy={busy}>保存{item.label}结果</button>
  </form>;
}
