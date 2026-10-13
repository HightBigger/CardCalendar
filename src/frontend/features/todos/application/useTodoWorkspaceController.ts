"use client";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { CustomTodoDraft, TodoAction, TodoCommand, TodoFilters } from "../../../../contracts/todos";
import { invalidate, useFeatureCommand, useRemoteQuery } from "../../../shared/query";
import { todosApi, TodosApi } from "../api/todos-api";
import { parseTodoFilters, todoParams, todoUrl } from "../model/filters";

export function useTodoWorkspaceController(scope: string, timezone: string, api: TodosApi = todosApi, defaultMonth = new Date().toLocaleDateString("sv-SE", { timeZone: timezone }).slice(0, 7), mode: "workspace" | "attention" = "workspace") {
  const search = useSearchParams();
  const filters = parseTodoFilters(new URLSearchParams(mode === "attention" ? "" : search.toString()), defaultMonth);
  const listIdentity = JSON.stringify([mode, timezone, todoParams(filters).toString()]);
  const calendarIdentity = JSON.stringify([timezone, todoParams(filters, true).toString()]);
  const [cursor, setCursor] = useState<{ identity: string; value: string; asOf: string } | null>(null);
  const list = useRemoteQuery({ scope, resource: "todos", queryKey: listIdentity + (cursor?.identity === listIdentity ? cursor.value : ""), load: (signal) => mode === "attention" ? api.attention(signal) : api.list(filters, signal, cursor?.identity === listIdentity ? cursor.value : undefined, cursor?.identity === listIdentity ? cursor.asOf : undefined) });
  const calendar = useRemoteQuery({ scope, resource: "todos", queryKey: calendarIdentity, enabled: filters.view === "calendar", load: (signal) => api.calendar(filters, signal) });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const detail = useRemoteQuery({ scope, resource: "todos", queryKey: "detail:" + selectedId, enabled: !!selectedId, load: (signal) => api.detail(selectedId!, signal) });
  const command = useFeatureCommand(scope, ["todos", "notifications", "activities", "rewards"], listIdentity);
  const [committed, setCommitted] = useState<{ identity: string; actions: Record<string, TodoAction> }>({ identity: listIdentity, actions: {} });
  const currentIdentity = useRef(listIdentity); currentIdentity.current = listIdentity;
  useEffect(() => { setSelectedId(null); }, [scope, listIdentity]);
  function latest(action: TodoAction) {
    const updated = committed.identity === listIdentity ? committed.actions[action.id] : undefined;
    const candidates = [action, updated, detail.data?.id === action.id ? detail.data : undefined, ...list.data?.groups.flatMap((group) => group.items.filter((item) => item.id === action.id)) ?? [], ...calendar.data?.entries.flatMap((entry) => entry.kind === "action" && entry.action.id === action.id ? [entry.action] : []) ?? []].filter((item): item is TodoAction => !!item);
    return candidates.reduce((newest, candidate) => candidate.version > newest.version ? candidate : newest, action);
  }
  function accept(action: TodoAction) {
    if (currentIdentity.current !== listIdentity) return;
    setCommitted((old) => ({ identity: listIdentity, actions: { ...(old.identity === listIdentity ? old.actions : {}), [action.id]: action } }));
  }
  async function act(action: TodoAction, kind: TodoCommand["command"], snoozedUntil?: TodoCommand["snoozedUntil"]) {
    const allowed = action.allowedCommands.find((entry) => entry.kind === kind);
    if (!allowed?.enabled) return false;
    const payload: TodoCommand = { command: kind, expectedVersion: latest(action).version, ...(snoozedUntil ? { snoozedUntil } : {}) };
    const result = await command.run(action.id + "/" + kind, payload, (key, signal) => api.command(action.id, payload, key, signal));
    if (result?.kind !== "committed") return false;
    accept(result.data.action); invalidate(scope, result.data.invalidated ?? ["todos", "notifications"]); return true;
  }
  async function save(draft: CustomTodoDraft, action?: TodoAction) {
    const payload = action ? { ...draft, expectedVersion: latest(action).version } : draft;
    const result = await command.run(action?.id ?? "new-custom-todo", payload, (key, signal) => action ? api.update(action.id, payload as CustomTodoDraft & { expectedVersion: number }, key, signal) : api.create(draft, key, signal));
    if (result?.kind !== "committed") return false;
    accept(result.data.action); return true;
  }
  function updateFilters(patch: Partial<TodoFilters>) { const next = { ...filters, ...patch }; window.history.pushState(null, "", todoUrl(next, new URLSearchParams(search.toString()))); }
  const selected = detail.data ? latest(detail.data) : undefined;
  return { filters, updateFilters, list, calendar, detail, selected, select: setSelectedId, selectedId, latest, act, save, command, nextPage: () => { const value = list.data?.nextCursor ?? list.meta?.nextCursor; if (value && list.meta) setCursor({ identity: listIdentity, value, asOf: list.meta.asOf }); }, firstPage: () => setCursor(null) };
}
export type TodoWorkspaceController = ReturnType<typeof useTodoWorkspaceController>;
