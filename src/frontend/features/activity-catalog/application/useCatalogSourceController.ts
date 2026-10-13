"use client";
import { useState } from "react";
import type { ActivityDetail } from "../../../../contracts/activities";
import { useRemoteQuery, useFeatureCommand } from "../../../shared/query";
import { catalogApi } from "../api/catalog-api";
export function useCatalogSourceController(
  detail: ActivityDetail,
  scope: string,
) {
  const id = detail.activity.id;
  const query = useRemoteQuery({
    scope,
    resource: "activities",
    queryKey: "catalog-source:" + id,
    load: (signal) => catalogApi.source(id, signal),
  });
  const data = query.data;
  const diff = useRemoteQuery({
    scope,
    resource: "activities",
    queryKey: "catalog-diff:" + id + ":" + data?.source.latestReleaseId,
    enabled:
      !!data?.source.latestReleaseId &&
      data.source.latestReleaseId !== data.source.boundReleaseId,
    load: (signal) =>
      catalogApi.diff(id, data!.source.latestReleaseId!, signal),
  });
  const command = useFeatureCommand(
    scope,
    [
      "activities",
      "spend-tasks",
      "rewards",
      "todos",
      "notifications",
      "activity-catalog",
    ],
    id,
  );
  const [future, setFuture] = useState<string[]>([]),
    [decisions, setDecisions] = useState<
      Record<string, "keep_frozen" | "create_review_revision">
    >({}),
    [note, setNote] = useState(""),
    [tracking, setTracking] = useState<"continue" | "stop_future">("continue"),
    [rewardPolicy, setRewardPolicy] = useState<
      "continue" | "stop" | "needs_confirmation"
    >("continue"),
    [confirmed, setConfirmed] = useState(false),
    [queued, setQueued] = useState<string | null>(null);
  async function send(path: string, input: unknown) {
    const r = await command.run(path, input, (key, signal) =>
      catalogApi.personalCommand(id, path, input, key, signal),
    );
    if (r?.kind === "queued") setQueued(r.jobId);
    if (r?.kind === "committed") {
      setConfirmed(false);
      setNote("");
    }
  }
  const today = query.meta?.serverNow
    ? new Intl.DateTimeFormat("sv-SE", {
        timeZone: query.meta.timezone,
      }).format(new Date(query.meta.serverNow))
    : "";
  return {
    query,
    data,
    diff,
    command,
    future,
    setFuture,
    decisions,
    setDecisions,
    note,
    setNote,
    tracking,
    setTracking,
    rewardPolicy,
    setRewardPolicy,
    confirmed,
    setConfirmed,
    queued,
    send,
    today,
  };
}
