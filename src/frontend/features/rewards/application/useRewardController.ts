"use client";
import { useFeatureCommand, useRemoteQuery } from "../../../shared/query";
import { rewardsApi, RewardsApi } from "../api/rewards-api";
export function useRewardController(scope: string, participationId: string, id: string, api: RewardsApi = rewardsApi) {
  const query = useRemoteQuery({ scope, resource: "rewards", queryKey: participationId + id, load: (signal) => api.detail(participationId, id, signal) });
  const command = useFeatureCommand(scope, ["rewards", "activities", "todos", "notifications"], id);
  async function claim(occurredAt: string, note: string) { const reward = query.data; if (!reward) return false; const payload = { occurredAt, note }; const result = await command.run(id + "/claim", { ...payload, expectedVersion: reward.version }, (key, signal) => api.claim(reward, payload, key, signal)); return result?.kind === "committed"; }
  async function confirm(attemptId: string, status: string, note: string) { const reward = query.data; if (!reward || !reward.claimAttempts.some((attempt) => attempt.id === attemptId)) return false; const result = await command.run(id + "/confirm", { attemptId, status, note, expectedVersion: reward.claimAttempts.find((attempt) => attempt.id === attemptId)!.version, rewardVersion: reward.version }, (key, signal) => api.confirm(reward, attemptId, status, note, key, signal)); return result?.kind === "committed"; }
  async function receipt(receivedOn: string, quantity: string, note: string) { const reward = query.data; if (!reward) return false; const result = await command.run(id + "/receipt", { receivedOn, quantity, note, expectedVersion: reward.version }, (key, signal) => api.receipt(reward, receivedOn, quantity, note, key, signal)); return result?.kind === "committed"; }
  return { query, command, claim, confirm, receipt };
}
export type RewardController = ReturnType<typeof useRewardController>;
