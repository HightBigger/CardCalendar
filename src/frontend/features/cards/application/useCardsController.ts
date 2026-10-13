"use client";
import type { ApiCard, CardDraft } from "../../../../contracts/mvp";
import { invalidate, useFeatureCommand, useRemoteQuery } from "../../../shared/query";
import { cardsApi } from "../api/cards-api";
const cardResources = ["cards", "annual-fees", "notifications", "todos", "activities", "spend-tasks", "rewards"] as const;
export function useCardsController(scope: string) {
  const cards = useRemoteQuery({ scope, resource: "cards", queryKey: "list", load: cardsApi.list });
  const summaries = useRemoteQuery({ scope, resource: "cards", queryKey: "summaries", load: cardsApi.summaries });
  const changed = () => invalidate(scope, cardResources);
  const lifecycleCommand = useFeatureCommand(scope, cardResources);
  async function save(draft: CardDraft, id?: string) {
    if (draft.status !== undefined && draft.status !== "active" && draft.status !== "suspended") throw new Error("请从卡片详情归档，并选择奖励提醒安排");
    if (id && cards.data?.find((card) => card.id === id)?.status === "archived" && draft.status !== undefined) throw new Error("请先从卡片详情恢复使用，再修改卡片状态");
    await cardsApi.save(draft, id); changed();
  }
  async function lifecycle(card: ApiCard, action: "archive" | "restore", rewardReminderPolicy?: "keep" | "stop", note?: string) {
    const result = await lifecycleCommand.run(card.id + "/" + action, { action, rewardReminderPolicy, note }, async (key, signal) => ({ kind: "committed" as const, ...(await cardsApi.lifecycle(card.id, action, rewardReminderPolicy, note, signal, key)) }));
    return result?.kind === "committed";
  }
  return { cards, summaries, save, lifecycle, lifecycleCommand };
}
