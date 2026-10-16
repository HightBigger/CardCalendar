"use client";
import { useEffect, useState, type ComponentProps, type FormEvent } from "react";
import type { ApiCard, CardDraft } from "../../../../contracts/mvp";
import { Icon, ModalShell } from "../../../shared/ui";

const currencies = [
  { value: "CNY", label: "人民币（CNY）" },
  { value: "USD", label: "美元（USD）" },
  { value: "HKD", label: "港币（HKD）" },
  { value: "EUR", label: "欧元（EUR）" },
  { value: "JPY", label: "日元（JPY）" },
  { value: "GBP", label: "英镑（GBP）" },
];

function CardSelectField({ id, label, ...props }: ComponentProps<"select"> & { id: string; label: string }) {
  return <div className="card-form-field"><label htmlFor={id}>{label}</label><span className="card-form-select"><select id={id} {...props} /><Icon name="chevronDown" size={16} /></span></div>;
}

export function CardForm(props: {
  open: boolean;
  initial: ApiCard | null;
  onClose: () => void;
  onSubmit: (draft: CardDraft) => Promise<void>;
}) {
  const [issuerName, setName_issuer] = useState(props.initial?.issuerName ?? "");
  const [name, setName] = useState(props.initial?.name ?? "");
  const [last4, setLast4] = useState(props.initial?.last4 ?? "");
  const [fee, setFee] = useState(String(props.initial?.annualFeeAmount ?? ""));
  const [date, setDate] = useState(props.initial?.nextFeeDate ?? "");
  const [cycleType, setCycleType] = useState<CardDraft["feeCycleType"]>(props.initial?.feeCycleType ?? "custom");
  const [openedOn, setOpenedOn] = useState(props.initial?.openedOn ?? "");
  const [feeMonth, setFeeMonth] = useState(String(props.initial?.feeMonth ?? ""));
  const [feeDay, setFeeDay] = useState(String(props.initial?.feeDay ?? ""));
  const [ruleType, setRuleType] = useState<CardDraft["waiveRuleType"]>(props.initial?.waiveRuleType as CardDraft["waiveRuleType"] ?? "none");
  const [targetCount, setTargetCount] = useState(String(props.initial?.targetCount ?? ""));
  const [targetAmount, setTargetAmount] = useState(String(props.initial?.targetAmount ?? ""));
  const [customRule, setCustomRule] = useState(props.initial?.customRuleText ?? "");
  const [status, setStatus] = useState<ApiCard["status"]>(props.initial?.status ?? "active");
  const [currency, setCurrency] = useState(props.initial?.currency ?? "CNY");
  const [customCurrency, setCustomCurrency] = useState(!currencies.some((item) => item.value === (props.initial?.currency ?? "CNY")));
  const [notes, setNotes] = useState(props.initial?.notes ?? "");
  const [progressPeriodStart, setProgressPeriodStart] = useState(props.initial?.progressPeriodStart ?? "");
  const [progressPeriodEnd, setProgressPeriodEnd] = useState(props.initial?.progressPeriodEnd ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => {
    if (!props.open) return;
    setName_issuer(props.initial?.issuerName ?? "");
    setName(props.initial?.name ?? "");
    setLast4(props.initial?.last4 ?? "");
    setFee(String(props.initial?.annualFeeAmount ?? ""));
    setDate(props.initial?.nextFeeDate ?? "");
    setCycleType(props.initial?.feeCycleType ?? "custom");
    setOpenedOn(props.initial?.openedOn ?? "");
    setFeeMonth(String(props.initial?.feeMonth ?? ""));
    setFeeDay(String(props.initial?.feeDay ?? ""));
    setRuleType(props.initial?.waiveRuleType as CardDraft["waiveRuleType"] ?? "none");
    setTargetCount(String(props.initial?.targetCount ?? ""));
    setTargetAmount(String(props.initial?.targetAmount ?? ""));
    setCustomRule(props.initial?.customRuleText ?? "");
    setStatus(props.initial?.status ?? "active");
    setCurrency(props.initial?.currency ?? "CNY");
    setCustomCurrency(!currencies.some((item) => item.value === (props.initial?.currency ?? "CNY")));
    setNotes(props.initial?.notes ?? "");
    setProgressPeriodStart(props.initial?.progressPeriodStart ?? "");
    setProgressPeriodEnd(props.initial?.progressPeriodEnd ?? "");
    setError("");
    setMoreOpen(false);
  }, [props.open, props.initial]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!issuerName.trim() || !name.trim() || !/^\d{4}$/.test(last4) || !fee || !date) {
      setError("请填写所有必填项，尾号需为 4 位数字");
      return;
    }
    if (cycleType === "anniversary" && !openedOn) {
      setMoreOpen(true);
      setError("周年规则需要填写开卡日期");
      return;
    }
    const month = Number(feeMonth);
    const day = Number(feeDay);
    if (cycleType === "fixed_date" && (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(day) || day < 1 || day > 31)) {
      setMoreOpen(true);
      setError("固定日期规则需要有效的月份和日期");
      return;
    }
    const count = Number(targetCount);
    const amount = Number(targetAmount);
    if ((ruleType === "count" || ruleType === "count_and_amount") && (!Number.isInteger(count) || count <= 0)) {
      setError("次数规则需要填写大于 0 的目标次数");
      return;
    }
    if ((ruleType === "amount" || ruleType === "count_and_amount") && (!Number.isFinite(amount) || amount <= 0)) {
      setError("金额规则需要填写大于 0 的目标金额");
      return;
    }
    if (ruleType === "custom" && !customRule.trim()) {
      setError("自定义规则需要填写说明");
      return;
    }
    const normalizedCurrency = currency.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(normalizedCurrency)) {
      setMoreOpen(true);
      setError("币种需要填写三位 ISO 代码，例如 CNY、USD、HKD");
      return;
    }
    if (progressPeriodStart && progressPeriodEnd && progressPeriodEnd < progressPeriodStart) {
      setMoreOpen(true);
      setError("进度周期结束日期不能早于开始日期");
      return;
    }
    if (busy) return;
    setBusy(true); setError("");
    try {
    await props.onSubmit({
      ...((status === "active" || status === "suspended") && (!props.initial || status !== props.initial.status) ? { status } : {}),
      issuerName: issuerName.trim(),
      name: name.trim(),
      last4,
      annualFeeAmount: Number(fee),
      currency: normalizedCurrency,
      nextFeeDate: date,
      feeCycleType: cycleType,
      openedOn: cycleType === "anniversary" ? openedOn : undefined,
      feeMonth: cycleType === "fixed_date" ? month : undefined,
      feeDay: cycleType === "fixed_date" ? day : undefined,
      waiveRuleType: ruleType,
      targetCount: ruleType === "count" || ruleType === "count_and_amount" ? count : undefined,
      targetAmount: ruleType === "amount" || ruleType === "count_and_amount" ? amount : undefined,
      customRuleText: ruleType === "custom" ? customRule.trim() : undefined,
      notes: notes.trim() || undefined,
      progressPeriodStart: progressPeriodStart || undefined,
      progressPeriodEnd: progressPeriodEnd || undefined,
    });
    } catch (caught) { setError(caught instanceof Error ? caught.message : "保存失败"); }
    finally { setBusy(false); }
  }

  return (
    <ModalShell open={props.open} onClose={props.onClose} labelledBy="card-form-title" className="modal-wide card-form">
        <div className="modal-head">
          <div>
            <h2 id="card-form-title">{props.initial ? "编辑卡片" : "新增卡片"}</h2>
          </div>
          <button className="icon-button" onClick={props.onClose} aria-label="关闭"><Icon name="close" size={17} /></button>
        </div>
        <form className="form-grid two-columns" onSubmit={submit}>
          <label>发卡银行<input value={issuerName} onChange={(event) => setName_issuer(event.target.value)} placeholder="例如 招商银行" /></label>
          <label>卡片名称<input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如 经典白金卡" /></label>
          <label>卡号后四位<input value={last4} onChange={(event) => setLast4(event.target.value)} placeholder="0000" maxLength={4} inputMode="numeric" /></label>
          <label>年费金额<input type="number" min="0" step="0.01" value={fee} onChange={(event) => setFee(event.target.value)} placeholder="0" /></label>
          <label>下次年费日期<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
          <CardSelectField id="card-waive-rule" label="免年费规则" value={ruleType} onChange={(event) => setRuleType(event.target.value as CardDraft["waiveRuleType"])}>
            <option value="none">无条件</option>
            <option value="count">刷卡次数</option>
            <option value="amount">消费金额</option>
            <option value="count_and_amount">次数与金额同时满足</option>
            <option value="custom">自定义说明</option>
          </CardSelectField>
          {(ruleType === "count" || ruleType === "count_and_amount") && (
            <label>目标次数<input type="number" min="1" step="1" value={targetCount} onChange={(event) => setTargetCount(event.target.value)} placeholder="例如 12" /></label>
          )}
          {(ruleType === "amount" || ruleType === "count_and_amount") && (
            <label>目标金额<input type="number" min="0" step="0.01" value={targetAmount} onChange={(event) => setTargetAmount(event.target.value)} placeholder="例如 100000" /></label>
          )}
          {ruleType === "custom" && (
            <label className="full-width">自定义规则<input value={customRule} onChange={(event) => setCustomRule(event.target.value)} placeholder="例如 每年生日月双倍积分" /></label>
          )}
          <details className="card-more-settings full-width" open={moreOpen} onToggle={(event) => setMoreOpen(event.currentTarget.open)} onInvalidCapture={(event) => { event.preventDefault(); setMoreOpen(true); setError("请检查更多设置中的日期与数值"); }}>
            <summary aria-label="更多设置"><span>更多设置</span><small>{currencies.find((item) => item.value === currency)?.label ?? currency} · 周期 · 备注</small><Icon name="chevronDown" size={16} /></summary>
            <div className="form-grid two-columns">
              <CardSelectField id="card-currency" label="币种" value={customCurrency ? "custom" : currency} onChange={(event) => { const custom = event.target.value === "custom"; setCustomCurrency(custom); setCurrency(custom ? "" : event.target.value); }}>
                {currencies.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                <option value="custom">其他币种</option>
              </CardSelectField>
              {customCurrency && <label>其他币种<input value={currency} onChange={(event) => setCurrency(event.target.value.toUpperCase())} maxLength={3} placeholder="三位币种代码，例如 AUD" autoCapitalize="characters" /></label>}
              {props.initial && <CardSelectField id="card-status" label="卡片状态" disabled={busy || props.initial.status === "archived"} value={status} onChange={(event) => { const value = event.target.value; if (value === "active" || value === "suspended") setStatus(value); }} aria-describedby="card-lifecycle-help">
                {props.initial.status === "archived" ? <option value="archived">已归档</option> : <><option value="active">使用中</option><option value="suspended">已停用</option></>}
              </CardSelectField>}
              {props.initial && <p id="card-lifecycle-help" className="full-width muted">归档或恢复使用请到卡片详情操作。</p>}
              <CardSelectField id="card-fee-cycle" label="年费周期" value={cycleType} onChange={(event) => setCycleType(event.target.value as CardDraft["feeCycleType"])}>
                <option value="anniversary">按开卡日周年</option>
                <option value="fixed_date">固定日期</option>
                <option value="custom">自定义日期</option>
              </CardSelectField>
              {cycleType === "anniversary" && <label>开卡日期<input type="date" value={openedOn} onChange={(event) => setOpenedOn(event.target.value)} /></label>}
              {cycleType === "fixed_date" && <>
                <label>年费月份<input type="number" min="1" max="12" step="1" value={feeMonth} onChange={(event) => setFeeMonth(event.target.value)} placeholder="1-12" /></label>
                <label>年费日期<input type="number" min="1" max="31" step="1" value={feeDay} onChange={(event) => setFeeDay(event.target.value)} placeholder="1-31" /></label>
              </>}
              <label>进度周期开始<input type="date" value={progressPeriodStart} onChange={(event) => setProgressPeriodStart(event.target.value)} /></label>
              <label>进度周期结束<input type="date" value={progressPeriodEnd} onChange={(event) => setProgressPeriodEnd(event.target.value)} /></label>
              <label className="full-width">备注<textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={2} placeholder="选填" /></label>
            </div>
          </details>
          {error && <p className="form-error full-width" role="alert">{error}</p>}
          <div className="modal-actions full-width">
            <button className="text-button" type="button" onClick={props.onClose}>取消</button>
            <button className="primary-button" type="submit" disabled={busy} aria-busy={busy}><Icon name="check" size={16} />保存卡片</button>
          </div>
        </form>
    </ModalShell>
  );
}
