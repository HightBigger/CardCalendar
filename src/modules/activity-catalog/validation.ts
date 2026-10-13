import { createHash } from "node:crypto";
import { z } from "zod";
import type {
  CatalogContent,
  CatalogValidationIssue,
} from "../../contracts/activity-catalog";
import type { DateValue } from "../../contracts/workbench";

const text = z.string().max(12000);
const timezone = z
  .string()
  .max(100)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, "无效的 IANA 时区");
export const daySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const d = new Date(value + "T00:00:00Z");
    return !Number.isNaN(+d) && d.toISOString().slice(0, 10) === value;
  }, "无效日期");
export const dateSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("date"), value: daySchema, timezone }).strict(),
  z
    .object({
      kind: z.literal("instant"),
      value: z.string().datetime({ offset: true }),
      timezone,
    })
    .strict(),
  z.object({ kind: z.literal("unknown"), reason: text }).strict(),
]);
const target = z
  .object({
    kind: z.enum([
      "count",
      "amount",
      "count_and_amount",
      "count_or_amount",
      "custom",
    ]),
    count: z.number().int().positive().max(1000000).nullable(),
    amount: z
      .string()
      .regex(/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/)
      .nullable(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .nullable(),
    rulesText: text,
  })
  .strict();
const https = z
  .string()
  .url()
  .max(2000)
  .refine((value) => {
    const u = new URL(value);
    return u.protocol === "https:" && !u.username && !u.password;
  }, "来源必须是 HTTPS 链接");
export const catalogContentSchema = z
  .object({
    name: text,
    bankId: z.string().max(100).nullable(),
    summary: text,
    activityType: text,
    start: dateSchema,
    end: dateSchema,
    conditions: z
      .object({
        cardTypesText: text,
        customerSegmentsText: text,
        regionText: text,
        channelText: text,
        exclusionsText: text,
        enrollmentRequired: z.enum(["yes", "no", "unknown"]),
        enrollmentScope: z.enum(["participation", "period", "unknown"]),
        enrollmentDeadline: dateSchema,
        quotaText: text,
      })
      .strict(),
    periodTemplate: z
      .object({
        type: z.enum(["month", "billing", "custom", "once"]),
        timezone: timezone.nullable(),
        countingBasis: z.enum(["occurred", "posted", "settled", "unknown"]),
        partialPolicy: z.enum([
          "full_target",
          "source_defined",
          "needs_review",
        ]),
        target,
        periods: z
          .array(
            z
              .object({
                periodKey: text,
                start: dateSchema,
                end: dateSchema,
                target,
              })
              .strict(),
          )
          .max(120),
      })
      .strict(),
    rewards: z
      .array(
        z
          .object({
            rewardKey: text,
            name: text,
            type: z.enum(["cashback", "points", "gift", "other"]),
            amountOrQuantity: text.nullable(),
            unit: text.nullable(),
            scope: z.enum(["period", "all_periods", "overall"]),
            conditionsText: text,
            overallTarget: target.nullable(),
            acquisition: z.enum(["automatic", "manual", "unknown"]),
            channel: text.nullable(),
            officialUrl: https.nullable(),
            claimStart: dateSchema,
            claimEnd: dateSchema,
            expectedReceipt: dateSchema,
            receiptRuleText: text,
          })
          .strict(),
      )
      .max(40),
    sources: z
      .array(
        z
          .object({
            url: https,
            excerpt: text,
            accessedAt: z.string().datetime({ offset: true }).nullable(),
            verifiedAt: z.string().datetime({ offset: true }).nullable(),
            completeness: z.enum(["complete", "partial", "unknown"]),
          })
          .strict(),
      )
      .max(20),
    unknownItems: z
      .array(
        z
          .object({
            code: text,
            field: text,
            reason: text,
            blocksExecution: z.boolean(),
          })
          .strict(),
      )
      .max(100),
    bankCancellation: z
      .object({
        reason: text,
        officialSourceUrl: https,
        verifiedAt: z.string().datetime({ offset: true }),
      })
      .strict()
      .nullable(),
  })
  .strict();
export const versionSchema = z.number().int().positive();
export function contentHash(value: unknown): string {
  const canonical = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(canonical)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.entries(v)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, x]) => [k, canonical(x)]),
          )
        : v;
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}
export function dateDay(date: DateValue): string | null {
  return date.kind === "unknown"
    ? null
    : date.kind === "date"
      ? date.value
      : new Intl.DateTimeFormat("sv-SE", { timeZone: date.timezone }).format(
          new Date(date.value),
        );
}
export function validateCatalogContent(
  content: CatalogContent,
  officialDomains: string[],
  now = new Date(),
): CatalogValidationIssue[] {
  const issues: CatalogValidationIssue[] = [];
  const add = (
    code: string,
    field: string,
    message: string,
    severity: CatalogValidationIssue["severity"] = "blocks_publication",
  ) => issues.push({ code, field, message, severity });
  const official = (url: string) => {
    const host = new URL(url).hostname.toLowerCase();
    return officialDomains.some(
      (domain) => host === domain || host.endsWith("." + domain),
    );
  };
  if (!content.name.trim()) add("NAME_REQUIRED", "name", "请填写活动名称");
  if (!content.bankId || !officialDomains.length)
    add("BANK_REQUIRED", "bankId", "请选择统一银行标识");
  if (content.start.kind !== "date" || content.end.kind !== "date")
    add("DATES_REQUIRED", "start", "发布需要明确的活动起止日期");
  else if (content.end.value < content.start.value)
    add("DATE_ORDER", "end", "活动结束不能早于开始");
  if (
    !content.sources.some(
      (s) =>
        official(s.url) &&
        s.excerpt.trim() &&
        s.accessedAt &&
        s.verifiedAt &&
        s.completeness !== "unknown" &&
        +new Date(s.verifiedAt) <= +now &&
        +new Date(s.accessedAt) <= +now,
    )
  )
    add(
      "OFFICIAL_SOURCE_REQUIRED",
      "sources",
      "需要已访问、已核对且包含原文摘录的本银行官方规则来源",
    );
  for (const [i, s] of content.sources.entries())
    if (!official(s.url))
      add(
        "NON_OFFICIAL_SOURCE",
        `sources.${i}`,
        "来源域名不在该银行官方目录中",
      );
  const important = [
    "cardTypesText",
    "customerSegmentsText",
    "regionText",
    "channelText",
    "exclusionsText",
    "quotaText",
  ] as const;
  const conditionLabels: Record<(typeof important)[number], string> = {
    cardTypesText: "适用卡种",
    customerSegmentsText: "客群",
    regionText: "地区",
    channelText: "消费渠道",
    exclusionsText: "排除条件",
    quotaText: "名额机制",
  };
  for (const key of important)
    if (!content.conditions[key].trim())
      add(
        "UNKNOWN_" + key,
        `conditions.${key}`,
        "参与条件待核对：" + conditionLabels[key],
        "blocks_execution",
      );
  if (
    content.conditions.enrollmentRequired === "unknown" ||
    (content.conditions.enrollmentRequired === "yes" &&
      content.conditions.enrollmentScope === "unknown")
  )
    add(
      "UNKNOWN_ENROLLMENT",
      "conditions.enrollmentRequired",
      "报名要求或范围待核对",
      "blocks_execution",
    );
  if (
    content.conditions.enrollmentRequired === "yes" &&
    content.conditions.enrollmentDeadline.kind === "unknown"
  )
    add(
      "UNKNOWN_ENROLLMENT_DATE",
      "conditions.enrollmentDeadline",
      "报名截止待核对",
      "blocks_execution",
    );
  const checkTarget = (
    t: CatalogContent["periodTemplate"]["target"],
    field: string,
  ) => {
    if (
      t.kind === "custom" ||
      ((t.kind === "count" || t.kind.startsWith("count_")) &&
        t.count === null) ||
      ((t.kind === "amount" || t.kind.startsWith("count_")) &&
        (!t.amount || !t.currency))
    )
      add(
        "UNKNOWN_TARGET",
        field,
        "目标未知或仅原文规则，不能计算确定进度",
        "blocks_execution",
      );
    if (t.amount !== null && Number(t.amount) <= 0)
      add("INVALID_AMOUNT", field, "明确金额目标必须大于零");
  };
  checkTarget(content.periodTemplate.target, "periodTemplate.target");
  if (
    !content.periodTemplate.timezone ||
    content.periodTemplate.countingBasis === "unknown" ||
    content.periodTemplate.partialPolicy === "needs_review"
  )
    add(
      "UNKNOWN_PERIOD_BASIS",
      "periodTemplate",
      "周期时区、计入口径或首尾周期规则待核对",
      "blocks_execution",
    );
  const keys = new Set<string>();
  const spans: { start: string; end: string }[] = [];
  for (const [i, p] of content.periodTemplate.periods.entries()) {
    if (!p.periodKey.trim() || keys.has(p.periodKey))
      add(
        "PERIOD_KEY",
        `periodTemplate.periods.${i}`,
        "周期标识不能为空或重复",
      );
    keys.add(p.periodKey);
    checkTarget(p.target, `periodTemplate.periods.${i}.target`);
    if (p.start.kind === "unknown" || p.end.kind === "unknown")
      add(
        "UNKNOWN_BOUNDARY",
        `periodTemplate.periods.${i}`,
        "周期边界待核对",
        "blocks_execution",
      );
    else {
      const start = dateDay(p.start)!,
        end = dateDay(p.end)!;
      if (start > end)
        add("PERIOD_ORDER", `periodTemplate.periods.${i}`, "周期结束早于开始");
      if (
        (content.start.kind !== "unknown" && start < dateDay(content.start)!) ||
        (content.end.kind !== "unknown" && end > dateDay(content.end)!)
      )
        add(
          "PERIOD_RANGE",
          `periodTemplate.periods.${i}`,
          "周期必须在活动期内",
        );
      if (spans.some((x) => start <= x.end && end >= x.start))
        add(
          "PERIOD_OVERLAP",
          `periodTemplate.periods.${i}`,
          "周期模板不能重叠",
        );
      spans.push({ start, end });
    }
  }
  const rewardKeys = new Set<string>();
  for (const [i, r] of content.rewards.entries()) {
    if (!r.rewardKey.trim() || rewardKeys.has(r.rewardKey) || !r.name.trim())
      add("REWARD_KEY", `rewards.${i}`, "奖励名称及唯一标识必填");
    rewardKeys.add(r.rewardKey);
    if (r.acquisition === "unknown")
      add(
        "UNKNOWN_REWARD",
        `rewards.${i}`,
        "奖励获得方式待核对",
        "blocks_execution",
      );
    if (
      r.claimStart.kind !== "unknown" &&
      r.claimEnd.kind !== "unknown" &&
      dateDay(r.claimStart)! > dateDay(r.claimEnd)!
    )
      add("CLAIM_ORDER", `rewards.${i}`, "领取窗口顺序无效");
  }
  for (const x of content.unknownItems)
    add(
      x.code,
      x.field,
      x.reason,
      x.blocksExecution ? "blocks_execution" : "warning",
    );
  if (
    content.bankCancellation &&
    (!official(content.bankCancellation.officialSourceUrl) ||
      !content.bankCancellation.reason.trim() ||
      +new Date(content.bankCancellation.verifiedAt) > +now)
  )
    add(
      "CANCELLATION_EVIDENCE",
      "bankCancellation",
      "银行取消必须有核对过的官方证据与原因",
    );
  return issues;
}
