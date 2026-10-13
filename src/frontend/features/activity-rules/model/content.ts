import type {
  CatalogContent,
  CatalogRewardTemplate,
} from "../../../../contracts/activity-catalog";
export const unknownDate = () => ({
  kind: "unknown" as const,
  reason: "待核对",
});
export const emptyTarget = () => ({
  kind: "count_and_amount" as const,
  count: null,
  amount: null,
  currency: "CNY",
  rulesText: "",
});
export function emptyReward(): CatalogRewardTemplate {
  return {
    rewardKey: crypto.randomUUID(),
    name: "",
    type: "cashback",
    amountOrQuantity: null,
    unit: null,
    scope: "period",
    conditionsText: "",
    overallTarget: null,
    acquisition: "unknown",
    channel: null,
    officialUrl: null,
    claimStart: unknownDate(),
    claimEnd: unknownDate(),
    expectedReceipt: unknownDate(),
    receiptRuleText: "",
  };
}
export function emptyCatalogContent(): CatalogContent {
  return {
    name: "",
    bankId: null,
    summary: "",
    activityType: "刷卡奖励",
    start: unknownDate(),
    end: unknownDate(),
    conditions: {
      cardTypesText: "",
      customerSegmentsText: "",
      regionText: "",
      channelText: "",
      exclusionsText: "",
      enrollmentRequired: "unknown",
      enrollmentScope: "unknown",
      enrollmentDeadline: unknownDate(),
      quotaText: "",
    },
    periodTemplate: {
      type: "month",
      timezone: null,
      countingBasis: "unknown",
      partialPolicy: "needs_review",
      target: emptyTarget(),
      periods: [],
    },
    rewards: [],
    sources: [],
    unknownItems: [],
    bankCancellation: null,
  };
}
