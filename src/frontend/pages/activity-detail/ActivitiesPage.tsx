"use client";

import { useCallback, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { ActivityDetail, ActivityFilter, ActivityPeriod, ActivitySummary } from "../../../contracts/activities";
import type { DateValue, PrimaryAction } from "../../../contracts/workbench";
import type { FeatureGates } from "../../../contracts/feature-gates";
import { useSession } from "../../app/SessionBoundary";
import type { WorkbenchPorts } from "../../app/ports";
import { useActivitiesController, ActivityList, ActivityEditor, EnrollmentForm, ParticipationNotice, NodePreferences, PeriodPlanForm, StopTrackingDialog } from "../../features/activities";
import { RewardEditor, useRewardCreateController } from "../../features/rewards";
import { ModalShell, QueryState } from "../../shared/ui";
import { CatalogSourcePanel } from "../../features/activity-catalog";
import { businessDate } from "../../shared/display/business";

function activityDate(value: DateValue, timezone: string) {
  return value.kind === "date" && value.timezone === timezone ? value.value : businessDate(value, timezone);
}

function RewardCreate({ detail, ports, onClose }: { detail: ActivityDetail; ports?: WorkbenchPorts; onClose: () => void }) {
  const session = useSession();
  const c = useRewardCreateController(session.scope, detail.activity.id, ports?.rewards);
  return <RewardEditor detail={detail} timezone={session.profile.timezone} busy={c.command.busy} error={c.command.error} onSave={c.save} onClose={onClose} />;
}

function PeriodProgress({ period, detail, onPrimary, onParticipation }: { period: ActivityPeriod; detail: ActivityDetail; onPrimary: (action: PrimaryAction) => void; onParticipation: () => void }) {
  const permission = period.allowedCommands.find((command) => command.kind === "progress");
  return <article className="period-card activity-period" data-period-id={period.id}>
    <div className="period-heading"><h3>{period.label}</h3><span>{{ planned: "待开始", active: "进行中", ended: "已结束", cancelled: "已取消" }[period.phase]}</span></div>
    <p className="period-deadline" title={period.timezone}>{period.endOn} 截止</p>
    <p className="period-target">目标：{period.targetText}</p>
    <p className="period-remaining"><small>剩余：</small><strong>{period.remainingText}</strong></p>
    <div className="period-facts"><p>确定进度：{period.confirmedText}</p><p>预计进度：{period.pendingText}</p></div>
    <p className="period-qualification">银行达标结果：{period.qualificationText}</p>
    {period.taskId && <div className="period-actions">
      <button className="primary-button" disabled={!permission?.enabled} onClick={() => onPrimary({ kind: "progress", resourceId: period.taskId!, participationId: detail.activity.id, label: "更新进度", enabled: true })}>更新进度</button>
      {!permission?.enabled && <button className="text-button" onClick={() => onPrimary({ kind: "progress", resourceId: period.taskId!, participationId: detail.activity.id, label: "查看进度", enabled: true })}>查看进度</button>}
    </div>}
    {!permission?.enabled && permission?.reason && <p className="period-qualification">{permission.reason}</p>}
    <ParticipationNotice detail={detail} periodId={period.id} onOpen={onParticipation} />
  </article>;
}

export function ActivitiesPage({ gates, ports, onPrimary, initialId }: { gates: FeatureGates; ports?: WorkbenchPorts; onPrimary: (action: PrimaryAction) => void; initialId?: string }) {
  const session = useSession();
  const search = useSearchParams();
  const state = search.get("activityState");
  const filter: ActivityFilter = { cardId: search.get("activityCardId") ?? "", state: state && ["active", "planned", "ended", "cancelled", "unclaimed"].includes(state) ? state as ActivityFilter["state"] : "all", q: search.get("activityQ") ?? "" };
  const selectedId = search.get("participation") ?? initialId ?? null;
  const c = useActivitiesController(session.scope, session.profile.timezone, filter, selectedId, ports?.activities);
  const [editor, setEditor] = useState<ActivitySummary | "new" | null>(null);
  const [rewardEditor, setRewardEditor] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [participation, setParticipation] = useState<{ periodId?: string } | null>(null);
  const [rulesOpenFor, setRulesOpenFor] = useState<string | null>(null);
  const showRuleNotice = useCallback((needsAttention: boolean) => { if (needsAttention) setRulesOpenFor(selectedId); }, [selectedId]);

  function update(patch: Partial<ActivityFilter>, id?: string | null) {
    const params = new URLSearchParams(search.toString());
    for (const [key, value] of Object.entries(patch)) params.set({ cardId: "activityCardId", state: "activityState", q: "activityQ" }[key]!, String(value));
    if (id !== undefined) { if (id) params.set("participation", id); else params.delete("participation"); }
    window.history.pushState(null, "", (id === null && initialId ? "/activities" : "") + "?" + params.toString());
  }
  function reviewParticipation(periodId?: string) { c.command.clearError(); setParticipation({ periodId }); }

  const detail = c.detail.data;
  const current = detail?.periods.find((period) => period.id === detail.activity.currentPeriod?.id)
    ?? detail?.periods.find((period) => period.phase === "active")
    ?? detail?.periods.find((period) => period.phase === "planned")
    ?? detail?.periods.at(-1);
  const others = detail?.periods.filter((period) => period.id !== current?.id) ?? [];

  return <div className="activities-workspace">{selectedId ? <>
    <button className="text-button activity-back" onClick={() => update({}, null)}>← 全部卡片活动</button>
    <QueryState {...c.detail} hasData={!!detail} retry={c.detail.reload} label="活动详情">{detail && <div className="activity-detail" key={detail.activity.id}>
      <header className="activity-detail-heading">
        <p>{detail.activity.card.bank} · {detail.activity.card.name} · 尾号 {detail.activity.card.last4}</p>
        <h1>{detail.activity.name}</h1>
        <p>{activityDate(detail.activity.start, session.profile.timezone)} — {activityDate(detail.activity.end, session.profile.timezone)}</p>
      </header>
      <div className="activity-detail-main">
        <section className="activity-progress-section" aria-label="活动进度">
          <h2>{current?.phase === "planned" ? "下一期目标" : current?.phase === "ended" || current?.phase === "cancelled" ? "最近一期" : "本期进度"}</h2>
          {current ? <PeriodProgress period={current} detail={detail} onPrimary={onPrimary} onParticipation={() => reviewParticipation(current.id)} /> : <p className="activity-empty">尚未设置消费目标，可在活动设置中添加。</p>}
          <ParticipationNotice detail={detail} onOpen={() => reviewParticipation()} />
          {others.length > 0 && <details className="activity-disclosure other-periods"><summary>其他周期（{others.length}）</summary><div>{others.map((period) => <PeriodProgress key={period.id} period={period} detail={detail} onPrimary={onPrimary} onParticipation={() => reviewParticipation(period.id)} />)}</div></details>}
        </section>
        <section className="activity-rewards-section" aria-label="活动奖励">
          <div className="section-heading"><h2>能拿什么奖励</h2><button className="text-button" disabled={!detail.activity.allowedCommands.find((command) => command.kind === "reward_create" || command.kind === "create_reward")?.enabled} onClick={() => { c.command.clearError(); setRewardEditor(true); }}>添加奖励</button></div>
          {detail.activity.rewards.map((reward) => <article className="reward-card activity-reward" key={reward.id}>
            <h3>{reward.name}</h3><strong className="reward-value">{reward.valueText}</strong>
            <p>{reward.scopeLabel} · {reward.conditionText}</p>
            <p>领取：{reward.claimText}<br />到账：{reward.receiptText}</p>
            <button className="text-button" onClick={() => onPrimary({ ...reward.primaryAction, participationId: detail.activity.id })}>查看奖励／处理记录</button>
          </article>)}
          {detail.activity.rewards.length === 0 && <p className="activity-empty">还没有记录奖励。</p>}
        </section>
      </div>
      <div className="activity-detail-secondary">
        <details className="activity-disclosure" open={rulesOpenFor === detail.activity.id} onToggle={(event) => { if (event.currentTarget.open) setRulesOpenFor(detail.activity.id); else setRulesOpenFor((id) => id === detail.activity.id ? null : id); }}><summary>规则与来源</summary><div className="activity-disclosure-body">
          <p>{detail.activity.rulesText}</p>
          <p className="activity-source">{detail.activity.source.label} · 最后核对：{detail.activity.source.verifiedAt ?? "未核对"}</p>
          <button className="text-button" disabled={!detail.activity.allowedCommands.find((command) => command.kind === "edit")?.enabled} onClick={() => { c.command.clearError(); setEditor(detail.activity); }}>修改活动规则</button>
          {detail.catalogSource && <CatalogSourcePanel detail={detail} scope={session.scope} onNotice={showRuleNotice} />}
        </div></details>
        <details className="activity-disclosure activity-settings"><summary>活动设置</summary><div className="activity-disclosure-body">
          {!detail.catalogSource && <>
            <PeriodPlanForm key={"period-plan:" + detail.activity.id} detail={detail} multiPeriod={gates.activityPeriods} busy={c.command.busy} error={c.command.error} job={c.job?.data} jobId={c.jobId} jobError={c.job?.error} onJobRefresh={() => c.job?.reload()} onSave={(draft) => c.plan(detail.activity.id, draft)} />
            <NodePreferences key={"node-preferences:" + detail.activity.id} initial={detail.nodePreferences} busy={c.command.busy} error={c.command.error} onSave={(prefs) => c.preferences(detail.activity.id, prefs, detail.activity.version)} />
          </>}
          {detail.activity.allowedCommands.some((command) => command.kind === "cancel") && <button className="text-button danger-text" disabled={!detail.activity.allowedCommands.find((command) => command.kind === "cancel")?.enabled} title={detail.activity.allowedCommands.find((command) => command.kind === "cancel")?.reason} onClick={() => { c.command.clearError(); setStopping(true); }}>取消活动跟踪</button>}
        </div></details>
        <details className="activity-disclosure activity-history"><summary>处理记录（{detail.history.length}）</summary><div className="activity-disclosure-body">
          {detail.history.length ? detail.history.map((entry) => <p key={entry.id}>{entry.label} · {businessDate({ kind: "instant", value: entry.occurredAt, timezone: session.profile.timezone }, session.profile.timezone)} · {entry.note}</p>) : <p>还没有处理记录。</p>}
        </div></details>
      </div>
      {participation && <ModalShell open onClose={() => setParticipation(null)} labelledBy="participation-title"><div className="modal-head"><h2 id="participation-title">{participation.periodId ? detail.periods.find((period) => period.id === participation.periodId)?.label + " · 参与信息" : "参与信息"}</h2><button className="text-button" onClick={() => setParticipation(null)}>关闭</button></div><EnrollmentForm detail={detail} periodId={participation.periodId} busy={c.command.busy} error={c.command.error} onSave={(scope, kind, status, note, attemptId) => c.check(detail.activity.id, scope, kind, status, note, detail.activity.version, attemptId)} /></ModalShell>}
      {rewardEditor && <RewardCreate detail={detail} ports={ports} onClose={() => setRewardEditor(false)} />}
      {stopping && <StopTrackingDialog kind="activity" name={detail.activity.name} error={c.command.error} onClose={() => setStopping(false)} onSave={(policy, note) => c.stop(detail.activity, policy, note)} />}
    </div>}</QueryState>
  </> : <QueryState {...c.list} hasData={!!c.list.data} retry={c.list.reload} label="活动"><ActivityList data={c.list.data ?? { items: [], cards: [], total: 0 }} filter={filter} update={update} timezone={session.profile.timezone} onOpen={(id) => update({}, id)} onAdd={() => { c.command.clearError(); setEditor("new"); }} /></QueryState>}
    {editor && <ActivityEditor key={editor === "new" ? "new" : editor.id} initial={editor === "new" ? undefined : c.latest(editor)} cards={c.list.data?.cards ?? []} cardId={filter.cardId} busy={c.command.busy} error={c.command.error} onSave={(draft) => c.save(draft, editor === "new" ? undefined : editor)} onClose={() => setEditor(null)} />}
  </div>;
}
