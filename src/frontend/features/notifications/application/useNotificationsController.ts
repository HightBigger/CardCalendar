"use client";
import type { ApiReminder, ApiReminderRule } from "../../../../contracts/mvp";
import { invalidate, useRemoteQuery } from "../../../shared/query";
import { notificationsApi } from "../api/notifications-api";
export function useNotificationsController(scope: string) {
  const history = useRemoteQuery({ scope, resource: "notifications", queryKey: "history", load: notificationsApi.list });
  const rules = useRemoteQuery({ scope, resource: "notifications", queryKey: "rules", load: notificationsApi.rules });
  async function action(reminder: ApiReminder, action: string) { await notificationsApi.action(reminder, action); invalidate(scope, ["notifications"]); }
  async function saveRules(rules: ApiReminderRule[]) { await notificationsApi.saveRules(rules); invalidate(scope, ["notifications"]); }
  return { history, rules, action, saveRules };
}
