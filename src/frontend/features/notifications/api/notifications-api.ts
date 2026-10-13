import type { ApiReminder, ApiReminderRule } from "../../../../contracts/mvp";
import { apiJson } from "../../../shared/http";
export const notificationsApi = {
  list: (signal: AbortSignal) => apiJson<ApiReminder[]>("/api/v1/reminders?all=true", { signal }),
  rules: (signal: AbortSignal) => apiJson<ApiReminderRule[]>("/api/v1/reminders/rules", { signal }),
  saveRules: (rules: ApiReminderRule[]) => apiJson<ApiReminderRule[]>("/api/v1/reminders/rules", { method: "PUT", body: JSON.stringify({ rules: rules.map(({ daysBefore, enabled }) => ({ daysBefore, enabled })) }) }),
  action: (reminder: ApiReminder, action: string) => apiJson<ApiReminder>("/api/v1/reminders/" + encodeURIComponent(reminder.id) + "/actions", { method: "POST", body: JSON.stringify(action === "snooze" ? { action, snoozedUntil: new Date(Date.now() + 86400000).toISOString() } : { action }) }),
};
