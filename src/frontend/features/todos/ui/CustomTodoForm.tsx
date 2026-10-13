"use client";
import { FormEvent, useState } from "react";
import type { CustomTodoDraft, TodoAction } from "../../../../contracts/todos";
import type { CardIdentity } from "../../../../contracts/workbench";
import { fromDateDraft, toDateDraft } from "../../../shared/display/date-draft";
import { DateField, ModalShell } from "../../../shared/ui";
export function CustomTodoForm({ initial, cards, timezone, busy, error, onSave, onClose }: { initial?: TodoAction; cards: CardIdentity[]; timezone: string; busy: boolean; error?: string; onSave: (draft: CustomTodoDraft) => Promise<boolean>; onClose: () => void }) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [cardId, setCardId] = useState(initial?.card?.id ?? "");
  const [priority, setPriority] = useState<"normal" | "important">(initial?.priority ?? "normal");
  const [deadline, setDeadline] = useState(toDateDraft(initial?.deadline ?? { kind: "unknown", reason: "" }, timezone));
  const [planned, setPlanned] = useState(toDateDraft(initial?.plannedFor ?? { kind: "unknown", reason: "" }, timezone));
  const [validation, setValidation] = useState("");
  async function submit(event: FormEvent) { event.preventDefault(); if (busy) return; setValidation(""); if (!title.trim()) { setValidation("请填写待办标题"); return; } try { const draft = { title: title.trim(), description, cardId: cardId || undefined, priority, deadline: fromDateDraft(deadline, timezone), plannedFor: fromDateDraft(planned, timezone) }; if (await onSave(draft)) onClose(); } catch (caught) { setValidation(caught instanceof Error ? caught.message : "日期无效"); } }
  return <ModalShell open onClose={onClose} labelledBy="custom-todo-title"><div className="modal-head"><h2 id="custom-todo-title">{initial ? "编辑自定义待办" : "新增自定义待办"}</h2><button className="text-button" onClick={onClose}>关闭</button></div>{initial && <p>当前服务端版本 {initial.version}；草稿保留在下方。最新说明：{initial.description}</p>}<form className="form-grid" onSubmit={submit}><label>待办标题<input required maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} aria-describedby={validation || error ? "custom-todo-error" : undefined} /></label><label>说明<textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} /></label><label>关联卡片<select value={cardId} onChange={(event) => setCardId(event.target.value)}><option value="">不关联卡片</option>{cards.map((card) => <option key={card.id} value={card.id}>{card.bank} · {card.name} · {card.last4}</option>)}</select></label><label>优先级<select value={priority} onChange={(event) => setPriority(event.target.value as "normal" | "important")}><option value="normal">普通</option><option value="important">重要</option></select></label><DateField label="计划处理" draft={planned} onChange={setPlanned} timezone={timezone} /><DateField label="硬性截止" draft={deadline} onChange={setDeadline} timezone={timezone} />{(validation || error) && <p id="custom-todo-error" role="alert" className="form-error">{validation || error}</p>}<div className="modal-actions"><button className="text-button" type="button" onClick={onClose}>取消</button><button className="primary-button" type="submit" disabled={busy} aria-busy={busy}>保存待办</button></div></form></ModalShell>;
}
