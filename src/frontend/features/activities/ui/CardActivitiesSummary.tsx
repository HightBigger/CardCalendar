"use client";
import type { PrimaryAction } from "../../../../contracts/workbench";
import { QueryState } from "../../../shared/ui";
import { useActivitiesController } from "../application/useActivitiesController";
import { ActivitySummaryCard } from "./ActivitySummaryCard";

export function CardActivitiesSummary({ scope, timezone, cardId, api, onOpen, onPrimary }: { scope: string; timezone: string; cardId: string; api?: Parameters<typeof useActivitiesController>[4]; onOpen: (id: string) => void; onPrimary: (action: PrimaryAction) => void }) {
  const c = useActivitiesController(scope, timezone, { cardId, state: "all", q: "" }, null, api);
  return <section className="section-block" aria-label="卡片活动摘要"><h2>这张卡的活动</h2><QueryState {...c.list} hasData={!!c.list.data} retry={c.list.reload} label="卡片活动摘要">
    <p>共 {c.list.data?.total ?? 0} 项，各活动进度与奖励分别记录。</p>
    {c.list.data?.items.map((activity) => <ActivitySummaryCard key={activity.id} activity={activity} timezone={timezone} onOpen={onOpen} onPrimary={onPrimary} />)}
    {c.list.data?.total === 0 && <p className="empty-note">这张卡尚未记录活动。</p>}
  </QueryState></section>;
}
