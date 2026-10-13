"use client";
import type { RewardDraft } from "../../../../contracts/rewards";
import { useFeatureCommand } from "../../../shared/query";
import { RewardsApi, rewardsApi } from "../api/rewards-api";
export function useRewardCreateController(scope: string, participationId: string, api: RewardsApi = rewardsApi) {
  const command = useFeatureCommand(scope, ["rewards", "activities", "todos", "notifications"], participationId);
  async function save(draft: RewardDraft) { const result = await command.run(participationId + "/reward", draft, (key, signal) => api.create(participationId, draft, key, signal)); return result?.kind === "committed"; }
  return { command, save };
}
