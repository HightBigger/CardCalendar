"use client";
import { useRef, useState } from "react";
import { ModalShell } from "../../../shared/ui";

export function StopTrackingDialog({ kind, name, onSave, onClose, error }: { kind: "activity" | "card"; name: string; onSave: (policy: "keep" | "stop", note: string) => Promise<boolean>; onClose: () => void; error?: string }) {
  const [policy, setPolicy] = useState<"" | "keep" | "stop">("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const [localError, setLocalError] = useState("");
  const title = kind === "card" ? "归档卡片" : "取消活动跟踪";
  async function save() {
    if (locked.current || !policy) return;
    locked.current = true; setBusy(true); setLocalError("");
    try { if (await onSave(policy, note.trim())) onClose(); }
    catch (caught) { setLocalError(caught instanceof Error ? caught.message : "保存失败，选择已保留"); }
    finally { locked.current = false; setBusy(false); }
  }
  return <ModalShell open onClose={onClose} labelledBy="stop-tracking-title"><div className="modal-head"><h2 id="stop-tracking-title">{title}</h2><button className="text-button" onClick={onClose}>关闭</button></div>
    <p>{name}：停止生成新的消费行动，已有进度、处理历史和未领取奖励继续保留。</p>
    <p>请选择未领取奖励是否继续提醒。停止提醒只改变通知安排，领取与到账记录仍可核对。</p>
    <div className="form-grid"><label>未领取奖励提醒<select aria-label="未领取奖励提醒" value={policy} disabled={busy} onChange={(event) => setPolicy(event.target.value as typeof policy)}><option value="">请选择提醒安排</option><option value="keep">继续提醒领取及到账核对</option><option value="stop">停止奖励通知，保留奖励记录</option></select></label><label>原因或说明<textarea value={note} disabled={busy} onChange={(event) => setNote(event.target.value)} /></label></div>
    {(localError || error) && <p className="form-error" role="alert">{localError || error}</p>}
    <div className="modal-actions"><button className="text-button" disabled={busy} onClick={onClose}>暂不更改</button><button className="primary-button" disabled={busy || !policy} aria-busy={busy} onClick={save}>确认{title}</button></div>
  </ModalShell>;
}
