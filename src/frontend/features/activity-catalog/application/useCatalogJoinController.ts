"use client";
import { useState } from "react";
import type * as C from "../../../../contracts/activity-catalog";
import { useRemoteQuery, useFeatureCommand } from "../../../shared/query";
import { catalogApi } from "../api/catalog-api";
export function useCatalogJoinController(
  detail: C.CatalogDetail,
  scope: string,
  onJoined: (ids: string[]) => void,
) {
  const cards = useRemoteQuery({
    scope,
    resource: "cards",
    queryKey: "catalog-owned",
    load: catalogApi.cards,
  });
  const [selected, setSelected] = useState<string[]>([]),
    [ack, setAck] = useState(false),
    [boundaries, setBoundaries] = useState<
      Record<string, C.CatalogJoinSelection["boundaries"]>
    >({}),
    [preview, setPreview] = useState<C.CatalogJoinPreview | null>(null),
    [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [calendar, setCalendar] = useState(true),
    [todo, setTodo] = useState(true),
    [notifyDays, setNotifyDays] = useState<number[]>([]);
  const command = useFeatureCommand(
    scope,
    [
      "activities",
      "cards",
      "activity-catalog",
      "todos",
      "rewards",
      "spend-tasks",
    ],
    detail.summary.id,
  );
  const selection = (): C.CatalogJoinSelection[] =>
    selected.map((cardId) => ({
      cardId,
      acknowledgedUnknownCodes: ack
        ? (preview?.items
            .find((i) => i.card.id === cardId)
            ?.issues.filter((i) => i.severity === "blocks_execution")
            .map((i) => i.code) ?? [])
        : [],
      boundaries: boundaries[cardId] ?? [],
      nodePreferences: [
        { nodeKind: "spend_period", label: "周期消费" },
        { nodeKind: "spend_qualification", label: "官方达标核对" },
        { nodeKind: "reward_claim", label: "奖励领取" },
        { nodeKind: "reward_receipt", label: "实际到账核对" },
        { nodeKind: "eligibility", label: "资格及报名" },
        { nodeKind: "catalog_review", label: "目录来源核对" },
      ].map((node) => ({
        ...node,
        showInCalendar: calendar,
        createTodo: todo,
        notifyDaysBefore: notifyDays,
      })),
    }));
  const change = () => {
    setPreview(null);
    setAck(false);
    setError(null);
  };
  async function review() {
    setBusy(true);
    setError(null);
    try {
      setPreview(
        (
          await catalogApi.joinPreview(
            detail.summary.id,
            { releaseId: detail.release.id, selections: selection() },
            new AbortController().signal,
          )
        ).data,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "预览失败");
    } finally {
      setBusy(false);
    }
  }
  async function join() {
    if (!preview) return;
    const input = {
      releaseId: detail.release.id,
      expectedCatalogVersion: preview.catalogVersion,
      selections: selection(),
    };
    const result = await command.run(
      "join:" + detail.summary.id,
      input,
      (key, signal) => catalogApi.join(detail.summary.id, input, key, signal),
    );
    if (result?.kind === "committed")
      onJoined(result.data.items.map((i) => i.participationId));
    if (result?.kind === "queued")
      setError("计划已排队，尚未生成完整周期。请查看后台任务：" + result.jobId);
  }
  async function associate(cardId: string) {
    setBusy(true);
    setError(null);
    try {
      const r = await catalogApi.associate(
        cardId,
        detail.summary.bank.id,
        crypto.randomUUID(),
      );
      if (r.kind === "committed") {
        await cards.reload();
        change();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "关联失败");
    } finally {
      setBusy(false);
    }
  }
  const needsBoundaries = ["billing", "custom"].includes(
    detail.release.content.periodTemplate.type,
  );
  return {
    cards,
    selected,
    setSelected,
    ack,
    setAck,
    boundaries,
    setBoundaries,
    preview,
    error,
    busy,
    calendar,
    setCalendar,
    todo,
    setTodo,
    notifyDays,
    setNotifyDays,
    command,
    change,
    review,
    join,
    associate,
    needsBoundaries,
  };
}
