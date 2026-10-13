"use client";
import type { ActivitySummary } from "../../../../contracts/activities";
import type { PrimaryAction } from "../../../../contracts/workbench";
import { businessDate } from "../../../shared/display/business";

export function ActivitySummaryCard({ activity, timezone, onOpen, onPrimary }: { activity: ActivitySummary; timezone: string; onOpen: (id: string) => void; onPrimary?: (action: PrimaryAction) => void }) {
  return <article className="activity-card" data-participation-id={activity.id}>
    <div className="section-heading"><h2><button className="todo-title" onClick={() => onOpen(activity.id)}>{activity.name}</button></h2><span className="status-pill">{{ active: "进行中", planned: "待开始", ended: "已结束", cancelled: "已取消" }[activity.lifecycle]}</span></div>
    <p>{activity.card.bank} · {activity.card.name} · 尾号 {activity.card.last4}</p><p>{businessDate(activity.start, timezone)} — {businessDate(activity.end, timezone)}</p>
    {activity.currentPeriod ? <div className="activity-progress"><strong>{activity.currentPeriod.label} · {activity.currentPeriod.targetText}</strong><p>确定：{activity.currentPeriod.confirmedText}</p><p>预计：{activity.currentPeriod.pendingText}</p><p>剩余：{activity.currentPeriod.remainingText}</p></div> : <p>本周期目标待核对</p>}
    {activity.rewards.length ? activity.rewards.map((reward) => <div key={reward.id} className="activity-reward-summary"><p>{reward.name} · {reward.valueText} · {reward.conditionText}</p><p>领取：{reward.claimText} · 到账：{reward.receiptText}</p>{onPrimary && <button className="text-button" disabled={!reward.primaryAction.enabled} title={reward.primaryAction.reason} onClick={() => onPrimary({ ...reward.primaryAction, participationId: activity.id })}>查看{reward.name}</button>}</div>) : <p>奖励待核对</p>}
    <p>下一行动：{activity.nextAction?.label ?? "查看详情"} · {businessDate(activity.nextActionDate, timezone)}</p>
    <button className="secondary-button" onClick={() => onOpen(activity.id)}>查看活动</button>
  </article>;
}
