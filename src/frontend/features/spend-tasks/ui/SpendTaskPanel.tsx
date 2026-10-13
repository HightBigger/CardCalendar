"use client";
import { useState } from "react";
import type { SpendTaskController } from "../application/useSpendTaskController";
import type { SpendDraft } from "../../../../contracts/spend-tasks";
import { QueryState } from "../../../shared/ui";
import { displayAmount } from "../../../shared/display/business";
export function SpendTaskPanel({ controller: c, initialAction }: { controller: SpendTaskController; initialAction?: string }) {
  const task = c.query.data;
  const [count, setCount] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState("");
  const [stage, setStage] = useState<SpendDraft["stage"]>("occurred");
  const [note, setNote] = useState("");
  const [factId, setFactId] = useState("");
  const [status, setStatus] = useState("unknown");
  const [qualificationNote, setQualificationNote] = useState("");
  const [validation, setValidation] = useState("");
  const allowed = (kind: string) => task?.allowedCommands.find((entry) => entry.kind === kind);
  const spendWrite = allowed(task?.mode === "snapshot" ? "observation" : "create_entry");
  const spendLocked = c.command.busy || !spendWrite?.enabled;
  return <QueryState {...c.query} hasData={!!task} retry={c.query.reload} label="周期任务">{task && <div className="spend-task-panel"><h3>{task.name}</h3><p>{task.startOn} — {task.endOn} · {task.timezone} · {task.countingBasisText}</p><p><strong>目标：{task.targetText}</strong></p><dl className="progress-facts"><dt>确定进度</dt><dd>{task.confirmed.text}</dd><dt>预计进度（含待确认）</dt><dd>{task.pending.text}</dd><dt>还差</dt><dd>{task.remaining.text}</dd><dt>目标状态</dt><dd>{task.progressStatusText}</dd><dt>人工达标核对</dt><dd>{task.qualificationText}</dd><dt>核对信息</dt><dd>{task.reviewText}</dd></dl>
    <p>录入模式：{task.mode === "snapshot" ? "累计快照" : "逐条记录"}。{task.modeLocked ? "已有记录，切换模式须明确迁移和核对。" : "模式由任务计划确定。"}两种进度不会相加。</p>
    {!spendWrite?.enabled && <p>当前消费记录只供查看。{spendWrite?.reason}</p>}
    <form className="form-grid two-columns" onSubmit={async (event) => { event.preventDefault(); if (spendLocked) return; setValidation(""); if (!date || !/^\d+$/.test(count) || !/^\d+(\.\d{1,2})?$/.test(amount)) { setValidation("请填写有效日期、非负整数笔数和金额"); return; } if (await c.save({ count: Number(count), amount, occurredOn: date, stage, note })) { setCount(""); setAmount(""); setNote(""); } }}><label>{task.mode === "snapshot" ? "累计观察日期" : "消费发生日期"}<input disabled={spendLocked} type="date" required value={date} onChange={(event) => setDate(event.target.value)} /></label><label>消费阶段<select disabled={spendLocked} value={stage} onChange={(event) => setStage(event.target.value as SpendDraft["stage"])}><option value="occurred">发生 · 待确认</option><option value="posted">已入账</option><option value="settled">已清算</option></select></label><label>{task.mode === "snapshot" ? "累计笔数" : "此记录笔数"}<input disabled={spendLocked} required type="number" min="0" step="1" value={count} onChange={(event) => setCount(event.target.value)} /></label><label>{task.mode === "snapshot" ? "累计金额" : "此记录金额"}（{task.currency}）<input disabled={spendLocked} required inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} /></label><label className="full-width">消费依据与备注<textarea disabled={spendLocked} value={note} onChange={(event) => setNote(event.target.value)} rows={2} /></label><button className="secondary-button" disabled={c.command.busy || !allowed(task.mode === "snapshot" ? "observation" : "create_entry")?.enabled} aria-busy={c.command.busy}>{task.mode === "snapshot" ? "保存累计观察" : "保存新消费记录"}</button></form>
    {task.mode === "entries" && <fieldset><legend>关联已有消费事实</legend><p>同一笔消费只保存一次，关联另一个任务会单独核对其计入规则。</p><label>已有消费记录<select disabled={!task.canLinkFacts} value={factId} onChange={(event) => setFactId(event.target.value)}><option value="">选择已有记录</option>{task.availableFacts.map((fact) => <option key={fact.id} value={fact.id}>{fact.label}</option>)}</select></label><button className="secondary-button" disabled={c.command.busy || !factId || !task.canLinkFacts || !allowed("evaluate")?.enabled} onClick={() => c.link(factId)}>关联此记录</button>{!task.canLinkFacts && <p>{task.linkDisabledReason ?? "消费关联尚未开放，请勿复制同一消费金额。"}</p>}</fieldset>}
    <section className="qualification-form" data-initial-action={initialAction}><h3>独立核对达标结果</h3><p>目标达到仍须核对资格及银行认定；此表单不会记录领取或到账。</p><label>达标核对结果<select disabled={c.command.busy || !allowed("qualification")?.enabled} value={status} onChange={(event) => setStatus(event.target.value)}><option value="unknown">待核对</option><option value="met">官方已确认达标</option><option value="not_met">官方未确认达标</option></select></label><label>达标核对依据<textarea disabled={c.command.busy || !allowed("qualification")?.enabled} required value={qualificationNote} onChange={(event) => setQualificationNote(event.target.value)} rows={2} /></label><button className="secondary-button" disabled={c.command.busy || !allowed("qualification")?.enabled || !qualificationNote.trim()} onClick={async () => { if (await c.qualify(status, qualificationNote)) setQualificationNote(""); }}>记录达标核对</button></section>
    {(validation || c.command.error) && <p className="form-error" role="alert">{validation || c.command.error}</p>}<section><h3>进度历史</h3>{task.observations.map((entry) => <p key={entry.id}>{entry.observedOn} · 累计 {entry.count} 笔 · {displayAmount(entry.amount, task.currency)} · 阶段：{{ unknown: "未知，待核对", occurred: "发生，待确认", posted: "已入账", settled: "已清算" }[entry.stage ?? "unknown"]} · {entry.note}</p>)}{task.entries.map((entry) => <p key={entry.id}>{entry.occurredOn} · {entry.count} 笔 · {displayAmount(entry.amount, task.currency)} · {entry.stage} · {entry.note}</p>)}</section>
  </div>}</QueryState>;
}
