"use client";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import type { ActivityFilter, ActivitySummary } from "../../../contracts/activities";
import type { PrimaryAction } from "../../../contracts/workbench";
import type { FeatureGates } from "../../../contracts/feature-gates";
import { useSession } from "../../app/SessionBoundary";
import type { WorkbenchPorts } from "../../app/ports";
import { useActivitiesController, ActivityList, ActivityEditor, EnrollmentForm, NodePreferences, PeriodPlanForm, StopTrackingDialog } from "../../features/activities";
import { RewardEditor, useRewardCreateController } from "../../features/rewards";
import { QueryState } from "../../shared/ui";
import { CatalogSourcePanel } from "../../features/activity-catalog";
import { businessDate } from "../../shared/display/business";

function RewardCreate({ detail, ports, onClose }: { detail: NonNullable<ReturnType<typeof useActivitiesController>["detail"]["data"]>; ports?: WorkbenchPorts; onClose: () => void }) { const session = useSession(); const c = useRewardCreateController(session.scope, detail.activity.id, ports?.rewards); return <RewardEditor detail={detail} timezone={session.profile.timezone} busy={c.command.busy} error={c.command.error} onSave={c.save} onClose={onClose} />; }
export function ActivitiesPage({ gates, ports, onPrimary, initialId }: { gates: FeatureGates; ports?: WorkbenchPorts; onPrimary: (action: PrimaryAction) => void; initialId?: string }) {
  const session = useSession(); const search = useSearchParams();
  const state = search.get("activityState");
  const filter: ActivityFilter = { cardId: search.get("activityCardId") ?? "", state: state && ["active", "planned", "ended", "cancelled", "unclaimed"].includes(state) ? state as ActivityFilter["state"] : "all", q: search.get("activityQ") ?? "" };
  const selectedId = search.get("participation") ?? initialId ?? null;
  const c = useActivitiesController(session.scope, session.profile.timezone, filter, selectedId, ports?.activities);
  const [editor, setEditor] = useState<ActivitySummary | "new" | null>(null);
  const [rewardEditor, setRewardEditor] = useState(false);
  const [stopping, setStopping] = useState(false);
  function update(patch: Partial<ActivityFilter>, id?: string | null) { const params = new URLSearchParams(search.toString()); for (const [key, value] of Object.entries(patch)) params.set({ cardId: "activityCardId", state: "activityState", q: "activityQ" }[key]!, String(value)); if (id !== undefined) { if (id) params.set("participation", id); else params.delete("participation"); } window.history.pushState(null, "", (id === null && initialId ? "/activities" : "") + "?" + params.toString()); }
  const detail = c.detail.data;
  return <div className="activities-workspace">{selectedId ? <><button className="text-button" onClick={() => update({}, null)}>← 全部卡片活动</button><QueryState {...c.detail} hasData={!!detail} retry={c.detail.reload} label="活动详情">{detail && <>
    <div className="welcome-row"><div><p className="eyebrow">{detail.activity.card.bank} · {detail.activity.card.name} · 尾号 {detail.activity.card.last4}</p><h1>{detail.activity.name}</h1><p>{businessDate(detail.activity.start, session.profile.timezone)} — {businessDate(detail.activity.end, session.profile.timezone)}</p></div><button className="secondary-button" disabled={!detail.activity.allowedCommands.find((command) => command.kind === "edit")?.enabled} onClick={() => setEditor(detail.activity)}>记录规则修订</button></div>
    <section className="section-block"><h2>来源与规则</h2><p>{detail.activity.source.label} · 最后核对：{detail.activity.source.verifiedAt ?? "未核对"}</p><p>{detail.activity.rulesText}</p></section>
    {detail.catalogSource && <CatalogSourcePanel detail={detail} scope={session.scope} />}
    <EnrollmentForm detail={detail} busy={c.command.busy} error={c.command.error} onSave={(scope, kind, status, note, attemptId) => c.check(detail.activity.id, scope, kind, status, note, detail.activity.version, attemptId)} />
    <section className="section-block"><h2>周期目标与历史</h2><p>每期事实独立，确定达到后仍须人工核对；超额不结转。</p>{detail.periods.map((period) => <article className="period-card" key={period.id}><h3>{period.label} · {{ planned: "待开始", active: "进行中", ended: "已结束", cancelled: "已取消" }[period.phase]}</h3><p>{period.startOn} — {period.endOn} · {period.timezone}</p><strong>{period.targetText}</strong><p>确定进度：{period.confirmedText}</p><p>预计进度：{period.pendingText}</p><p>剩余：{period.remainingText} · {period.qualificationText}</p>{period.taskId && <><button className="secondary-button" disabled={!period.allowedCommands.find((command) => command.kind === "progress")?.enabled} title={period.allowedCommands.find((command) => command.kind === "progress")?.reason} onClick={() => onPrimary({ kind: "progress", resourceId: period.taskId!, participationId: detail.activity.id, label: "更新进度／核对达标", enabled: true })}>更新进度／核对达标</button>{!period.allowedCommands.find((command) => command.kind === "progress")?.enabled && <button className="text-button" onClick={() => onPrimary({ kind: "progress", resourceId: period.taskId!, participationId: detail.activity.id, label: "查看进度与核对历史", enabled: true })}>查看进度与核对历史</button>}</>}</article>)}</section>
    <section className="section-block"><div className="section-heading"><h2>周期与最终奖励</h2><button className="text-button" disabled={!detail.activity.allowedCommands.find((command) => command.kind === "reward_create")?.enabled} onClick={() => setRewardEditor(true)}>新增奖励组件</button></div>{detail.activity.rewards.map((reward) => <article className="reward-card" key={reward.id}><h3>{reward.name} · {reward.valueText}</h3><p>{reward.scopeLabel} · {reward.conditionText}</p><p>领取：{reward.claimText} · 到账：{reward.receiptText}</p><button className="secondary-button" onClick={() => onPrimary({ ...reward.primaryAction, participationId: detail.activity.id })}>查看奖励／处理记录</button></article>)}{detail.activity.rewards.length === 0 && <p>暂无奖励组件，可独立记录奖励条件与领取窗口。</p>}</section>
    {!detail.catalogSource && <PeriodPlanForm key={"period-plan:" + detail.activity.id} detail={detail} multiPeriod={gates.activityPeriods} busy={c.command.busy} error={c.command.error} job={c.job?.data} jobId={c.jobId} jobError={c.job?.error} onJobRefresh={() => c.job?.reload()} onSave={(draft) => c.plan(detail.activity.id, draft)} />}
    {!detail.catalogSource && <NodePreferences key={"node-preferences:" + detail.activity.id} initial={detail.nodePreferences} busy={c.command.busy} error={c.command.error} onSave={(prefs) => c.preferences(detail.activity.id, prefs, detail.activity.version)} />}
    <section className="section-block"><h2>活动处理历史</h2>{detail.history.map((entry) => <p key={entry.id}>{entry.label} · {businessDate({ kind: "instant", value: entry.occurredAt, timezone: session.profile.timezone }, session.profile.timezone)} · {entry.note}</p>)}</section>
    {rewardEditor && <RewardCreate detail={detail} ports={ports} onClose={() => setRewardEditor(false)} />}
    {detail.activity.allowedCommands.some((command) => command.kind === "cancel") && <button className="text-button danger-text" disabled={!detail.activity.allowedCommands.find((command) => command.kind === "cancel")?.enabled} title={detail.activity.allowedCommands.find((command) => command.kind === "cancel")?.reason} onClick={() => { c.command.clearError(); setStopping(true); }}>取消活动跟踪</button>}
    {stopping && <StopTrackingDialog kind="activity" name={detail.activity.name} error={c.command.error} onClose={() => setStopping(false)} onSave={(policy, note) => c.stop(detail.activity, policy, note)} />}
  </>}</QueryState></> : <QueryState {...c.list} hasData={!!c.list.data} retry={c.list.reload} label="活动"><ActivityList data={c.list.data ?? { items: [], cards: [], total: 0 }} filter={filter} update={update} timezone={session.profile.timezone} onOpen={(id) => update({}, id)} onAdd={() => { c.command.clearError(); setEditor("new"); }} /></QueryState>}
  {editor && <ActivityEditor key={editor === "new" ? "new" : editor.id} initial={editor === "new" ? undefined : c.latest(editor)} cards={c.list.data?.cards ?? []} cardId={filter.cardId} busy={c.command.busy} error={c.command.error} onSave={(draft) => c.save(draft, editor === "new" ? undefined : editor)} onClose={() => setEditor(null)} />}
  </div>;
}
