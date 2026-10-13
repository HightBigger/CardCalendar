"use client";
import type { ApiCard, ApiFeeEvent } from "../../../../contracts/mvp";
import { invalidate, useRemoteQuery } from "../../../shared/query";
import { annualFeesApi } from "../api/annual-fees-api";
export function useAnnualFeesController(scope: string, activeCard: ApiCard | null) {
  const events = useRemoteQuery({ scope, resource: "annual-fees", queryKey: "events", load: annualFeesApi.events });
  const detail = useRemoteQuery({ scope, resource: "annual-fees", queryKey: JSON.stringify([activeCard?.id, events.data?.filter((event) => event.cardId === activeCard?.id)]), enabled: !!activeCard && !!events.data, load: (signal) => annualFeesApi.detail(activeCard!, events.data ?? [], signal) });
  const changed = () => invalidate(scope, ["annual-fees", "cards", "notifications", "todos"]);
  async function writeProgress(cycleId: string, payload: unknown, entryId?: string, reverse = false) { await annualFeesApi.progress(cycleId, payload, entryId, reverse); changed(); }
  async function updateEvent(event: ApiFeeEvent, status: string, actualAmount?: string, occurredOn?: string, notes?: string) { await annualFeesApi.status(event, status, actualAmount, occurredOn, notes); changed(); }
  return { events, detail, writeProgress, updateEvent };
}
