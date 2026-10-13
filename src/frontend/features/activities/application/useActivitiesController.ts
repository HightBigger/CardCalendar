"use client";
import { useEffect, useRef, useState } from "react";
import type { ActivityDraft, ActivityFilter, ActivitySummary, CheckScope, NodePreference, PeriodPlanDraft } from "../../../../contracts/activities";
import { invalidate, useFeatureCommand, useRemoteQuery } from "../../../shared/query";
import { ActivitiesApi, activitiesApi } from "../api/activities-api";
export function useActivitiesController(scope: string, timezone: string, filter: ActivityFilter, selectedId: string | null, api: ActivitiesApi = activitiesApi) {
  const identity = JSON.stringify([timezone, filter]);
  const list = useRemoteQuery({ scope, resource: "activities", queryKey: identity, load: (signal) => api.list(filter, signal) });
  const detail = useRemoteQuery({ scope, resource: "activities", queryKey: "detail:" + selectedId + timezone, enabled: !!selectedId, load: (signal) => api.detail(selectedId!, signal) });
  const command = useFeatureCommand(scope, ["activities", "spend-tasks", "rewards", "todos", "notifications"], identity + selectedId);
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobOwner, setJobOwner] = useState<string | null>(null);
  const finished = useRef(new Set<string>());
  const job = useRemoteQuery({ scope, resource: "jobs", queryKey: "job:" + jobId, enabled: !!jobId, load: (signal) => api.job(jobId!, signal) });
  useEffect(() => {
    if (job.data?.status === "succeeded") { if (!finished.current.has(job.data.id)) { finished.current.add(job.data.id); invalidate(scope, ["activities", "spend-tasks", "rewards", "todos", "notifications"]); } return; }
    if (job.data?.status === "queued" || job.data?.status === "running") { const timer = setTimeout(() => { void job.reload(); }, 1500); return () => clearTimeout(timer); }
  }, [job.data, job.reload, scope]);
  function latest(activity: ActivitySummary) {
    const current = [detail.data?.activity, ...list.data?.items ?? []].filter((item): item is ActivitySummary => item?.id === activity.id);
    return current.reduce((newest, item) => item.ruleVersion > newest.ruleVersion || (item.ruleVersion === newest.ruleVersion && item.version > newest.version) ? item : newest, activity);
  }
  async function save(draft: ActivityDraft, context?: ActivitySummary) {
    const current = context ? latest(context) : undefined;
    const payload = { ...draft, ...(current ? { expectedVersion: current.ruleVersion } : {}) };
    const result = await command.run("activity:" + (context?.id ?? "new"), payload, (key, signal) => api.save(draft, current, key, signal)); return result?.kind === "committed";
  }
  async function check(id: string, scopeData: CheckScope, kind: string, status: string, note: string, version: number, attemptId?: string) { const payload = { ...scopeData, command: kind, status, note, expectedVersion: version, attemptId }; const result = await command.run("check:" + id, payload, (key, signal) => api.check(id, payload, key, signal)); return result?.kind === "committed"; }
  async function plan(id: string, draft: PeriodPlanDraft) {
    const result = await command.run("plan:" + id, draft, (key, signal) => api.plan(id, draft, key, signal));
    if (result?.kind === "queued") { setJobId(result.jobId); setJobOwner(id); return "queued" as const; }
    if (result?.kind === "committed") { setJobId(null); await detail.reload(); return "committed" as const; }
  }
  async function preferences(id: string, prefs: NodePreference[], version: number) { const payload = { prefs, expectedVersion: version }; const result = await command.run("preferences:" + id, payload, (key, signal) => api.preferences(id, prefs, version, key, signal)); return result?.kind === "committed"; }
  async function stop(activity: ActivitySummary, rewardReminderPolicy: "keep" | "stop", note: string) { const payload = { command: "cancel" as const, expectedVersion: activity.version, rewardReminderPolicy, note }; const result = await command.run("stop:" + activity.id, payload, (key, signal) => api.stop(activity.id, payload, key, signal)); return result?.kind === "committed"; }
  return { list, detail, command, latest, save, check, plan, preferences, stop, job: jobOwner === selectedId ? job : undefined, jobId: jobOwner === selectedId ? jobId : null };
}
export type ActivitiesController = ReturnType<typeof useActivitiesController>;
