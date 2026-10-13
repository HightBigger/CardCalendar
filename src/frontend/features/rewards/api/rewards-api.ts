import type { Reward, RewardDraft, RewardWrite } from "../../../../contracts/rewards";
import type { CommandResult, Envelope } from "../../../../contracts/workbench";
import { apiCommand, apiJson } from "../../../shared/http";
export interface RewardsApi {
  detail(participationId: string, id: string, signal: AbortSignal): Promise<Envelope<Reward>>;
  create(participationId: string, draft: RewardDraft, key: string, signal: AbortSignal): Promise<CommandResult<RewardWrite>>;
  claim(reward: Reward, payload: { occurredAt: string; note: string }, key: string, signal: AbortSignal): Promise<CommandResult<RewardWrite>>;
  confirm(reward: Reward, attemptId: string, status: string, note: string, key: string, signal: AbortSignal): Promise<CommandResult<RewardWrite>>;
  receipt(reward: Reward, receivedOn: string, quantity: string, note: string, key: string, signal: AbortSignal): Promise<CommandResult<RewardWrite>>;
}
export const rewardsApi: RewardsApi = {
  // Aggregate collection includes independent components; no per-component GET is specified yet.
  async detail(participationId, id, signal) { const result = await apiJson<Reward[]>("/api/v1/activity-participations/" + encodeURIComponent(participationId) + "/rewards", { signal }); const data = result.data.find((reward) => reward.id === id); if (!data) throw new Error("无法访问此奖励记录"); return { data, meta: result.meta }; },
  create: (id, draft, key, signal) => apiCommand("/api/v1/activity-participations/" + encodeURIComponent(id) + "/rewards", draft, key, { signal }),
  claim: (reward, payload, key, signal) => apiCommand("/api/v1/activity-rewards/" + encodeURIComponent(reward.id) + "/claim-attempts", { ...payload, expectedVersion: reward.version }, key, { signal }),
  confirm: (reward, attemptId, status, note, key, signal) => { const attempt = reward.claimAttempts.find((entry) => entry.id === attemptId); return apiCommand("/api/v1/reward-claim-attempts/" + encodeURIComponent(attemptId) + "/results", { status, note, expectedVersion: attempt?.version, rewardVersion: reward.version }, key, { signal }); },
  receipt: (reward, receivedOn, quantity, note, key, signal) => apiCommand("/api/v1/activity-rewards/" + encodeURIComponent(reward.id) + "/receipt-events", { receivedOn, quantity, note, expectedVersion: reward.version }, key, { signal }),
};
