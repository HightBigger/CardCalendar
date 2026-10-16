"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { ActivityDraft, ActivitySummary } from "../../../../contracts/activities";
import type { CardIdentity } from "../../../../contracts/workbench";
import { Icon, ModalShell } from "../../../shared/ui";

export function ActivityEditor({ initial, cards, cardId, busy, error, onSave, onClose }: {
  initial?: ActivitySummary;
  cards: CardIdentity[];
  cardId?: string;
  busy: boolean;
  error?: string;
  onSave: (draft: ActivityDraft) => Promise<boolean>;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<ActivityDraft>(initial?.editorDraft ?? {
    cardId: initial?.card.id ?? (cardId || (cards.length === 1 ? cards[0].id : "")),
    name: initial?.name ?? "",
    startOn: initial?.start.kind === "date" ? initial.start.value : "",
    endOn: initial?.end.kind === "date" ? initial.end.value : "",
    sourceLabel: initial?.source.label ?? "用户录入 · 待官方核对",
    sourceUrl: initial?.source.url ?? "",
    rulesText: initial?.rulesText ?? "",
    enrollmentRequired: "unknown",
    channel: "",
    cycleType: "once",
    targetKind: "custom",
    currency: "CNY",
    countingBasis: "unknown",
    rewardText: "",
  });
  const [validation, setValidation] = useState("");
  const [moreOpen, setMoreOpen] = useState(false);
  useEffect(() => { if (error) setMoreOpen(true); }, [error]);
  function patch(patch: Partial<ActivityDraft>) { setDraft((old) => ({ ...old, ...patch })); }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setValidation("");
    if (!draft.name.trim() || !draft.cardId) { setValidation("请填写名称并选择卡片"); return; }
    if (draft.startOn && draft.endOn && draft.startOn > draft.endOn) { setValidation("活动结束不能早于开始"); return; }
    if (initial && !initial.editorDraft) { setValidation("尚缺完整规则编辑数据，请刷新后再修改"); return; }
    if (await onSave({ ...draft, name: draft.name.trim() })) onClose();
  }
  const countTarget = ["count", "count_and_amount", "count_or_amount"].includes(draft.targetKind);
  const amountTarget = ["amount", "count_and_amount", "count_or_amount"].includes(draft.targetKind);

  return <ModalShell open onClose={onClose} labelledBy="activity-editor-title" className="modal-wide activity-editor">
    <div className="modal-head"><h2 id="activity-editor-title">{initial ? "记录活动规则修订" : "新增卡片活动"}</h2><button className="icon-button" onClick={onClose} aria-label="关闭"><Icon name="close" size={17} /></button></div>
    {cards.length === 0 && !initial ? <div className="activity-empty"><p>先添加一张卡片，再记下它的活动。</p><a className="primary-button" href="/cards?new=1">新增卡片</a></div> :
      <form className="form-grid two-columns" onSubmit={submit}>
        {error && initial && <p className="full-width">当前规则版本：{initial.ruleVersion}。填写内容已保留，可核对后重试。</p>}
        <label>活动名称<input disabled={busy} required value={draft.name} onChange={(event) => patch({ name: event.target.value })} placeholder="例如 每月刷卡返现" aria-describedby={validation || error ? "activity-editor-error" : undefined} /></label>
        <label>活动所属卡片<select aria-label="活动所属卡片" required disabled={busy || !!initial} value={draft.cardId} onChange={(event) => patch({ cardId: event.target.value })}><option value="">选择卡片</option>{cards.map((card) => <option key={card.id} value={card.id}>{card.bank} · {card.name} · {card.last4}</option>)}</select></label>
        <label>活动开始<input disabled={busy} type="date" value={draft.startOn ?? ""} onChange={(event) => patch({ startOn: event.target.value || undefined })} /></label>
        <label>活动结束<input disabled={busy} type="date" value={draft.endOn ?? ""} onChange={(event) => patch({ endOn: event.target.value || undefined })} /></label>
        <label className="full-width">规则原文<textarea disabled={busy} value={draft.rulesText} onChange={(event) => patch({ rulesText: event.target.value })} rows={3} placeholder="粘贴活动规则，也可以之后补充" /></label>
        <label className="full-width">奖励与获得条件说明<textarea disabled={busy} value={draft.rewardText} onChange={(event) => patch({ rewardText: event.target.value })} rows={2} placeholder="例如 每月满 5 笔可领 20 元返现" /></label>
        <details className="form-disclosure full-width" open={moreOpen} onToggle={(event) => setMoreOpen(event.currentTarget.open)} onInvalidCapture={(event) => { event.preventDefault(); setMoreOpen(true); setValidation("请检查更多规则中的链接、币种与目标数值"); }}>
          <summary>更多规则<span>报名、消费目标与来源</span><Icon name="chevronDown" size={16} /></summary>
          <div className="form-grid two-columns">
            <label>是否需要报名<select aria-label="是否需要报名" disabled={busy} value={draft.enrollmentRequired} onChange={(event) => patch({ enrollmentRequired: event.target.value as ActivityDraft["enrollmentRequired"] })}><option value="unknown">待核对</option><option value="yes">需要报名</option><option value="no">无需报名</option></select></label>
            <label>计入消费渠道<input disabled={busy} value={draft.channel} onChange={(event) => patch({ channel: event.target.value })} placeholder="未知可留空" /></label>
            <label>周期类型<select aria-label="周期类型" disabled={busy} value={draft.cycleType} onChange={(event) => patch({ cycleType: event.target.value as ActivityDraft["cycleType"] })}><option value="month">自然月</option><option value="billing">账单周期</option><option value="custom">自定义周期</option><option value="once">整个活动期一次性</option></select></label>
            <label>目标关系<select aria-label="目标关系" disabled={busy} value={draft.targetKind} onChange={(event) => patch({ targetKind: event.target.value as ActivityDraft["targetKind"] })}><option value="custom">按规则原文，待核对</option><option value="count">笔数</option><option value="amount">金额</option><option value="count_and_amount">笔数与金额同时满足</option><option value="count_or_amount">笔数或金额满足其一</option></select></label>
            {countTarget && <label>周期目标笔数<input disabled={busy} type="number" min="1" step="1" value={draft.targetCount ?? ""} onChange={(event) => patch({ targetCount: event.target.value ? Number(event.target.value) : undefined })} /></label>}
            {amountTarget && <label>周期目标金额<input disabled={busy} inputMode="decimal" pattern="[0-9]+(\.[0-9]{1,2})?" value={draft.targetAmount ?? ""} onChange={(event) => patch({ targetAmount: event.target.value || undefined })} /></label>}
            <label>活动币种<input disabled={busy} pattern="[A-Z]{3}" value={draft.currency} onChange={(event) => patch({ currency: event.target.value.toUpperCase() })} /></label>
            <label>计入口径<select aria-label="计入口径" disabled={busy} value={draft.countingBasis} onChange={(event) => patch({ countingBasis: event.target.value as ActivityDraft["countingBasis"] })}><option value="unknown">待核对</option><option value="occurred">发生</option><option value="posted">入账</option><option value="settled">清算</option></select></label>
            <label>规则来源<input disabled={busy} value={draft.sourceLabel} onChange={(event) => patch({ sourceLabel: event.target.value })} /></label>
            <label>官方来源链接<input disabled={busy} type="url" value={draft.sourceUrl ?? ""} onChange={(event) => patch({ sourceUrl: event.target.value || undefined })} placeholder="https://" /></label>
          </div>
        </details>
        {(validation || error) && <p id="activity-editor-error" role="alert" className="form-error full-width">{validation || error}</p>}
        <div className="modal-actions full-width"><button className="text-button" type="button" onClick={onClose}>取消</button><button className="primary-button" disabled={busy} aria-busy={busy}>保存活动规则</button></div>
      </form>}
  </ModalShell>;
}
