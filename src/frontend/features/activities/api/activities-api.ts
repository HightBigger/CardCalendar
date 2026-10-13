import type { ActivityCommit, ActivityDetail, ActivityDraft, ActivityFilter, ActivityList, ActivitySave, ActivitySummary, CheckScope, NodePreference, PeriodPlanDraft, StopActivityDraft } from "../../../../contracts/activities";
import type { CommandResult, Envelope, Job } from "../../../../contracts/workbench";
import { apiCommand, apiJson } from "../../../shared/http";
export interface ActivitiesApi {
  list(filter: ActivityFilter, signal: AbortSignal): Promise<Envelope<ActivityList>>;
  detail(id: string, signal: AbortSignal): Promise<Envelope<ActivityDetail>>;
  save(draft: ActivityDraft, context: ActivitySummary | undefined, key: string, signal: AbortSignal): Promise<CommandResult<ActivitySave>>;
  check(id: string, payload: CheckScope & { command: string; status: string; note: string; expectedVersion: number; attemptId?: string }, key: string, signal: AbortSignal): Promise<CommandResult<ActivityCommit>>;
  plan(id: string, draft: PeriodPlanDraft, key: string, signal: AbortSignal): Promise<CommandResult<ActivityCommit>>;
  preferences(id: string, prefs: NodePreference[], version: number, key: string, signal: AbortSignal): Promise<CommandResult<ActivityCommit>>;
  stop(id: string, draft: StopActivityDraft, key: string, signal: AbortSignal): Promise<CommandResult<ActivityCommit>>;
  job(id: string, signal: AbortSignal): Promise<Envelope<Job>>;
}
export const activitiesApi: ActivitiesApi = {
  list: (filter, signal) => apiJson("/api/v1/workbench/activities?" + new URLSearchParams({ cardId: filter.cardId, state: filter.state, q: filter.q }), { signal }),
  detail: (id, signal) => apiJson("/api/v1/workbench/participations/" + encodeURIComponent(id), { signal }),
  async save(draft, context, key, signal) {
    if (context) return apiCommand<ActivitySave>("/api/v1/rules/" + encodeURIComponent(context.ruleId) + "/versions", { ...draft, expectedVersion: context.ruleVersion }, key, { signal });
    const campaign = await apiCommand<{ id: string; version: number }>("/api/v1/campaigns", draft, key + ":definition", { signal });
    if (campaign.kind === "queued") throw new Error("活动定义应返回已提交结果");
    return apiCommand<ActivitySave>("/api/v1/campaigns/" + encodeURIComponent(campaign.data.id) + "/participations", { cardId: draft.cardId, campaignVersion: campaign.data.version, activityInstanceKey: key + ":participation" }, key + ":participation", { signal });
  },
  check: (id, payload, key, signal) => apiCommand("/api/v1/activity-participations/" + encodeURIComponent(id) + (payload.command === "record_enrollment" ? "/enrollment-attempts" : "/actions"), payload, key, { signal }),
  plan: (id, draft, key, signal) => apiCommand("/api/v1/activity-participations/" + encodeURIComponent(id) + "/period-plans", draft, key, { signal }),
  preferences: (id, nodePreferences, expectedVersion, key, signal) => apiCommand("/api/v1/activity-participations/" + encodeURIComponent(id) + "/action-node-preferences", { nodePreferences, expectedVersion }, key, { method: "PUT", signal }),
  stop: (id, draft, key, signal) => apiCommand("/api/v1/activity-participations/" + encodeURIComponent(id) + "/actions", draft, key, { signal }),
  job: (id, signal) => apiJson("/api/v1/jobs/" + encodeURIComponent(id), { signal }),
};
