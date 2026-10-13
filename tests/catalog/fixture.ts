import type { CatalogContent } from "../../src/contracts/activity-catalog";
export function catalogFixture(): CatalogContent {
  const date = (value: string) => ({
    kind: "date" as const,
    value,
    timezone: "Asia/Shanghai",
  });
  const unknown = { kind: "unknown" as const, reason: "官方未明确" };
  return {
    name: "验收用活动（非真实银行活动）",
    bankId: "cmb",
    summary: "测试目录发布隔离",
    activityType: "刷卡奖励",
    start: date("2026-10-01"),
    end: date("2026-12-31"),
    conditions: {
      cardTypesText: "以官方资格为准",
      customerSegmentsText: "全部持卡人",
      regionText: "中国大陆",
      channelText: "线下",
      exclusionsText: "退款不计",
      enrollmentRequired: "yes",
      enrollmentScope: "participation",
      enrollmentDeadline: date("2026-10-31"),
      quotaText: "先到先得",
    },
    periodTemplate: {
      type: "month",
      timezone: "Asia/Shanghai",
      countingBasis: "posted",
      partialPolicy: "full_target",
      target: {
        kind: "count_and_amount",
        count: 5,
        amount: "2000.00",
        currency: "CNY",
        rulesText: "每月五笔且两千元",
      },
      periods: [],
    },
    rewards: [
      {
        rewardKey: "final",
        name: "100 元测试奖励",
        type: "cashback",
        amountOrQuantity: "100",
        unit: "CNY",
        scope: "all_periods",
        conditionsText: "三期人工核对达标",
        overallTarget: null,
        acquisition: "manual",
        channel: "银行 App",
        officialUrl: "https://www.cmbchina.com/",
        claimStart: date("2027-01-05"),
        claimEnd: date("2027-01-20"),
        expectedReceipt: unknown,
        receiptRuleText: "以实际到账记录为准",
      },
    ],
    sources: [
      {
        url: "https://www.cmbchina.com/",
        excerpt: "本条为测试夹具，不能作为真实活动规则",
        accessedAt: "2026-10-01T00:00:00Z",
        verifiedAt: "2026-10-01T00:00:00Z",
        completeness: "complete",
      },
    ],
    unknownItems: [],
    bankCancellation: null,
  };
}
