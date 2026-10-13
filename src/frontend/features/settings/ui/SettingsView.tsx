"use client";
import { FormEvent, useEffect, useMemo, useState } from "react";
import type { ApiUser, ApiCard, CardSummary, ApiCycle, ApiFeeEvent, ApiFeeEventHistory, ApiReminder, ApiReminderRule, ProgressEntry, ProgressData, CardDetail, CardDraft } from "../../../../contracts/mvp";
import { STATUS_LABEL, fmtDate, daysUntil, reminderOverdue, money, ruleText, cardLabel } from "../../../shared/display/legacy";
import { Icon, ModalShell } from "../../../shared/ui";
export function SettingsView(props: {
  profile: ApiUser | null;
  onSaveProfile: (name: string, timezone: string) => Promise<void>;
  onDelete: () => Promise<void>;
  reminderRules: ApiReminderRule[];
  onReminderRulesChange: (rules: ApiReminderRule[]) => Promise<void>;
}) {
  const [name, setName] = useState(props.profile?.name ?? "");
  const [timezone, setTimezone] = useState(props.profile?.timezone ?? "Asia/Shanghai");
  const [deleteText, setDeleteText] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [ruleDraft, setRuleDraft] = useState<ApiReminderRule[]>(props.reminderRules);
  const [ruleError, setRuleError] = useState("");
  const [ruleSaved, setRuleSaved] = useState(false);
  const [deletionAuditOpen, setDeletionAuditOpen] = useState(false);

  useEffect(() => {
    setRuleDraft(props.reminderRules);
  }, [props.reminderRules]);

  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await props.onSaveProfile(name, timezone);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2500);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存失败");
    }
  }

  async function requestDelete() {
    if (deleteText.trim() !== "DELETE") {
      setError("请输入 DELETE 确认删除账户");
      return;
    }
    if (!window.confirm("删除请求提交后将撤销所有会话，且只能通过管理员恢复。确认继续？")) return;
    setError("");
    try {
      await props.onDelete();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "删除请求提交失败");
    }
  }

  function updateRule(index: number, patch: Partial<ApiReminderRule>) {
    setRuleDraft((current) =>
      current.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)),
    );
  }

  function removeRule(index: number) {
    setRuleDraft((current) => current.filter((_, i) => i !== index));
  }

  function addRule() {
    setRuleDraft((current) => [
      ...current,
      { id: "", kind: "fee_event", daysBefore: 14, enabled: true },
    ]);
  }

  async function saveRules(event: FormEvent) {
    event.preventDefault();
    setRuleError("");
    setRuleSaved(false);
    if (ruleDraft.length === 0) {
      setRuleError("至少保留一个提醒节点");
      return;
    }
    const seen = new Set<number>();
    for (const rule of ruleDraft) {
      const daysBefore = Number(rule.daysBefore);
      if (!Number.isInteger(daysBefore) || daysBefore < 0 || daysBefore > 3650) {
        setRuleError("提前天数必须为 0 到 3650 的整数");
        return;
      }
      if (seen.has(daysBefore)) {
        setRuleError("提前天数不能重复");
        return;
      }
      seen.add(daysBefore);
    }
    try {
      await props.onReminderRulesChange(
        ruleDraft.map((rule) => ({ ...rule, daysBefore: Number(rule.daysBefore) })),
      );
      setRuleSaved(true);
      window.setTimeout(() => setRuleSaved(false), 2500);
    } catch (caught) {
      setRuleError(caught instanceof Error ? caught.message : "提醒规则保存失败");
    }
  }

  return (
    <>
      <div className="welcome-row">
        <div>
          <p className="eyebrow">设置</p>
          <h1>设置</h1>
          <p className="subline">管理个人时区、数据导出与账户。</p>
        </div>
      </div>
      <div className="settings-grid">
        <section className="section-block">
          <div className="section-heading">
            <div>
              <p className="section-kicker">个人资料</p>
              <h2>个人资料</h2>
            </div>
          </div>
          <form className="form-grid" onSubmit={saveProfile}>
            <label>
              称呼
              <input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如 林先生" />
            </label>
            <label>
              时区
              <select value={timezone} onChange={(event) => setTimezone(event.target.value)}>
                <option value="Asia/Shanghai">Asia/Shanghai</option>
                <option value="Asia/Hong_Kong">Asia/Hong_Kong</option>
                <option value="Asia/Tokyo">Asia/Tokyo</option>
                <option value="America/Los_Angeles">America/Los_Angeles</option>
                <option value="Europe/London">Europe/London</option>
              </select>
            </label>
            <label>
              邮箱（只读）
              <input value={props.profile?.email ?? ""} disabled />
            </label>
            {error && <p className="form-error" role="alert">{error}</p>}
            {saved && <p className="form-success" role="status">已保存</p>}
            <button className="primary-button" type="submit">保存设置</button>
          </form>
        </section>

        <section className="section-block">
          <div className="section-heading">
            <div>
              <p className="section-kicker">提醒</p>
              <h2>提醒规则</h2>
            </div>
          </div>
          <form className="form-grid" onSubmit={saveRules}>
            <div className="reminder-rule-list">
              {ruleDraft.map((rule, index) => (
                <div className="reminder-rule-row" key={rule.id || "new-" + index}>
                  <label className="reminder-rule-toggle">
                    <input
                      type="checkbox"
                      checked={rule.enabled}
                      onChange={(event) => updateRule(index, { enabled: event.target.checked })}
                    />
                    启用
                  </label>
                  <label>
                    提前天数
                    <input
                      type="number"
                      min={0}
                      max={3650}
                      step={1}
                      value={rule.daysBefore}
                      onChange={(event) => updateRule(index, { daysBefore: Number(event.target.value) })}
                    />
                  </label>
                  <button className="text-button" type="button" onClick={() => removeRule(index)}>
                    移除
                  </button>
                </div>
              ))}
              <button className="text-button" type="button" onClick={addRule}>
                <Icon name="plus" size={14} />
                添加提醒节点
              </button>
            </div>
            {ruleError && <p className="form-error full-width" role="alert">{ruleError}</p>}
            {ruleSaved && <p className="form-success full-width" role="status">已保存</p>}
            <button className="primary-button full-width" type="submit">保存提醒规则</button>
          </form>
        </section>

        <section className="section-block">
          <div className="section-heading">
            <div>
              <p className="section-kicker">数据管理</p>
              <h2>数据与账户</h2>
            </div>
          </div>
          <div className="data-actions">
            <div>
              <strong>导出全部数据</strong>
              <p>包含卡片、周期、进度、年费事件和提醒记录。</p>
              <button
                className="text-button"
                type="button"
                onClick={() => {
                  if (window.confirm("确认导出包含全部卡片、周期、进度和提醒记录的 JSON？")) {
                    window.location.href = "/api/v1/me/export";
                  }
                }}
              >
                下载 JSON <Icon name="arrow" size={15} />
              </button>
            </div>
            {props.profile && (props.profile.status !== "active" || props.profile.deletionRequestedAt) && (
              <div className="deletion-status">
                <strong>删除申请状态</strong>
                <dl>
                  <div>
                    <dt>状态</dt>
                    <dd>{STATUS_LABEL[props.profile.status] || props.profile.status}</dd>
                  </div>
                  <div>
                    <dt>申请时间</dt>
                    <dd>{fmtDate(props.profile.deletionRequestedAt)}</dd>
                  </div>
                  <div>
                    <dt>清理完成时间</dt>
                    <dd>{fmtDate(props.profile.deletionCleanupCompletedAt)}</dd>
                  </div>
                  <div>
                    <dt>重试次数</dt>
                    <dd>{props.profile.deletionRetryCount ?? 0}</dd>
                  </div>
                </dl>
                <button className="text-button" type="button" onClick={() => setDeletionAuditOpen(true)}>
                  查看删除审计 <Icon name="arrow" size={15} />
                </button>
              </div>
            )}
            <div className="danger-zone">
              <strong>删除账户</strong>
              <p>输入 DELETE 后提交删除请求，当前会话会被撤销。</p>
              <input value={deleteText} onChange={(event) => setDeleteText(event.target.value)} placeholder="DELETE" />
              <button className="danger-button" onClick={requestDelete}>提交删除请求</button>
            </div>
          </div>
        </section>
      </div>
      <ModalShell
        open={deletionAuditOpen && Boolean(props.profile)}
        onClose={() => setDeletionAuditOpen(false)}
        labelledBy="deletion-audit-title"
      >
        {props.profile && (
          <>
            <div className="modal-head">
              <div>
                <p className="section-kicker">删除记录</p>
                <h2 id="deletion-audit-title">账户删除审计</h2>
              </div>
              <button className="icon-button" onClick={() => setDeletionAuditOpen(false)} aria-label="关闭"><Icon name="close" size={17} /></button>
            </div>
            <dl className="audit-detail-list">
              <div>
                <dt>账户状态</dt>
                <dd>{STATUS_LABEL[props.profile.status] || props.profile.status}</dd>
              </div>
              <div>
                <dt>申请时间</dt>
                <dd>{fmtDate(props.profile.deletionRequestedAt)}</dd>
              </div>
              <div>
                <dt>清理完成时间</dt>
                <dd>{fmtDate(props.profile.deletionCleanupCompletedAt)}</dd>
              </div>
              <div>
                <dt>重试次数</dt>
                <dd>{props.profile.deletionRetryCount ?? 0}</dd>
              </div>
              <div>
                <dt>清理结果</dt>
                <dd><pre>{JSON.stringify(props.profile.deletionCleanupResult ?? {}, null, 2)}</pre></dd>
              </div>
            </dl>
          </>
        )}
      </ModalShell>
    </>
  );
}
