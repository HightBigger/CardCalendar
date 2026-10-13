"use client";
import { useId } from "react";
import type { DateDraft } from "../display/date-draft";
export function DateField({ label, draft, onChange, timezone }: { label: string; draft: DateDraft; onChange: (draft: DateDraft) => void; timezone: string }) {
  const id = useId();
  return <fieldset className="date-field"><legend>{label}</legend><label className="sr-only" htmlFor={id + "-precision"}>{label}精度</label><select id={id + "-precision"} value={draft.kind} onChange={(event) => onChange({ kind: event.target.value as DateDraft["kind"], value: "" })}><option value="unknown">未定日期</option><option value="date">日期</option><option value="instant">具体时间</option></select>{draft.kind !== "unknown" && <><label className="sr-only" htmlFor={id}>{label}</label><input id={id} type={draft.kind === "date" ? "date" : "datetime-local"} required value={draft.value} onChange={(event) => onChange({ ...draft, value: event.target.value })} /></>}<small>时区：{timezone}</small></fieldset>;
}
