"use client";
import type { SpendDraft } from "../../../../contracts/spend-tasks";
import { useFeatureCommand, useRemoteQuery } from "../../../shared/query";
import { SpendTasksApi, spendTasksApi } from "../api/spend-tasks-api";
export function useSpendTaskController(scope: string, id: string, api: SpendTasksApi = spendTasksApi) {
  const query = useRemoteQuery({ scope, resource: "spend-tasks", queryKey: id, load: (signal) => api.detail(id, signal) });
  const command = useFeatureCommand(scope, ["spend-tasks", "activities", "rewards", "todos", "notifications"], id);
  async function save(draft: SpendDraft) { const task = query.data; if (!task) return false; const result = await command.run(id + "/" + task.mode, { ...draft, expectedVersion: task.version }, (key, signal) => task.mode === "snapshot" ? api.observation(task, draft, key, signal) : api.entry(task, draft, key, signal)); return result?.kind === "committed"; }
  async function link(factId: string) { const task = query.data; if (!task?.canLinkFacts) return false; const result = await command.run(id + "/link", { factId, expectedVersion: task.version }, (key, signal) => api.link(task, factId, key, signal)); return result?.kind === "committed"; }
  async function qualify(status: string, note: string) { const task = query.data; if (!task) return false; const result = await command.run(id + "/qualification", { status, note, expectedVersion: task.version }, (key, signal) => api.qualify(task, status, note, key, signal)); return result?.kind === "committed"; }
  return { query, command, save, link, qualify };
}
export type SpendTaskController = ReturnType<typeof useSpendTaskController>;
