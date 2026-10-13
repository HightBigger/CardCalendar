import { z } from "zod";
import type * as C from "../../contracts/activity-catalog";
import type {
  CatalogActor,
  CatalogCommandContext,
} from "../../modules/activity-catalog/ports";
import type { CatalogParticipationWorkflowPort } from "./catalog-participation.ports";
import {
  CatalogService,
  conflict,
  parse,
} from "../../modules/activity-catalog/service";
import {
  daySchema,
  dateSchema,
  dateDay,
  versionSchema,
} from "../../modules/activity-catalog/validation";
import {
  PersonalCatalogService,
  privateImpact,
} from "../../modules/participation/catalog-import";
import { AppError } from "../../shared/errors";
import type { PoolClient } from "pg";
const node = z
  .object({
    nodeKind: z.string().min(1).max(80),
    label: z.string().max(200),
    showInCalendar: z.boolean(),
    createTodo: z.boolean(),
    notifyDaysBefore: z.array(z.number().int().min(0).max(365)).max(10),
  })
  .strict();
const selection = z
  .object({
    cardId: z.string().uuid(),
    acknowledgedUnknownCodes: z.array(z.string().max(200)).max(100),
    boundaries: z
      .array(
        z
          .object({
            periodKey: z.string().min(1).max(100),
            startOn: daySchema,
            endOn: daySchema,
            timezone: z.string().refine((v) => {
              try {
                new Intl.DateTimeFormat("en", { timeZone: v });
                return true;
              } catch {
                return false;
              }
            }),
          })
          .strict(),
      )
      .max(24),
    nodePreferences: z.array(node).max(20),
  })
  .strict();
const previewSchema = z
  .object({
    releaseId: z.string().uuid(),
    selections: z.array(selection).min(1).max(5),
  })
  .strict();
export class CatalogParticipationWorkflow
  implements CatalogParticipationWorkflowPort
{
  readonly personal: PersonalCatalogService;
  constructor(readonly catalog: CatalogService) {
    this.personal = new PersonalCatalogService(catalog);
  }
  async joinable(
    tx: PoolClient,
    id: string,
    releaseId: string,
    version?: number,
  ) {
    const row = await this.catalog.row(tx, id, true);
    if (
      row.publication_status !== "published" ||
      row.current_release_id !== releaseId
    )
      throw new AppError("UNPROCESSABLE_ENTITY", "当前目录版本不可加入", 422, {
        reason: "CATALOG_NOT_JOINABLE",
      });
    if (version !== undefined && row.version !== version) conflict();
    const release = await this.catalog.release(tx, id, releaseId);
    if (release.content.bankCancellation)
      throw new AppError(
        "UNPROCESSABLE_ENTITY",
        "银行已确认取消，不能新加入",
        422,
        { reason: "CATALOG_NOT_JOINABLE" },
      );
    return { row, release };
  }
  async previewJoin(
    actor: CatalogActor,
    id: string,
    input: C.PreviewCatalogJoinInput,
  ) {
    input = parse(previewSchema, input);
    return this.catalog.repository.transaction(async (tx) => {
      const { timezone } = await this.catalog.repository.authorize(actor, tx);
      const row = await this.catalog.row(tx, id);
      if (
        row.publication_status !== "published" ||
        row.current_release_id !== input.releaseId
      )
        throw new AppError(
          "UNPROCESSABLE_ENTITY",
          "目录已变化，请重新查看规则",
          422,
          { reason: "CATALOG_NOT_JOINABLE" },
        );
      const release = await this.catalog.release(tx, id, input.releaseId);
      if (release.content.bankCancellation)
        throw new AppError(
          "UNPROCESSABLE_ENTITY",
          "银行已确认取消，不能新加入",
        );
      const items = await this.personal.previewOwnedCards(
        tx,
        actor.userId,
        release,
        input.selections,
      );
      return this.catalog.repository.envelope(tx, timezone, {
        catalogActivityId: id,
        catalogVersion: row.version,
        releaseId: release.id,
        items,
      });
    }, true);
  }
  async join(
    context: CatalogCommandContext,
    id: string,
    input: C.JoinCatalogActivityInput,
  ) {
    input = parse(
      previewSchema.extend({ expectedCatalogVersion: versionSchema }).strict(),
      input,
    );
    const result = await this.catalog.repository.command(
      context,
      "catalog.join:" + id,
      input,
      false,
      async (tx) => {
        const { release } = await this.joinable(
          tx,
          id,
          input.releaseId,
          input.expectedCatalogVersion,
        );
        return this.personal.joinOwnedCards(
          {
            ownerUserId: context.actor.userId,
            release,
            selections: input.selections,
          },
          tx,
        );
      },
    );
    return { kind: "committed" as const, ...result };
  }
  async readSource(actor: CatalogActor, id: string) {
    return this.catalog.repository.transaction(async (tx) => {
      const { timezone } = await this.catalog.repository.authorize(actor, tx);
      const p = await this.personal.owned(tx, actor.userId, id);
      const row = await this.catalog.row(tx, p.catalog_activity_id);
      const notice = await this.catalog.withdrawalNotice(
        tx,
        p.catalog_activity_id,
      );
      return this.catalog.repository.envelope(tx, timezone, {
        source: {
          catalogActivityId: p.catalog_activity_id,
          activityInstanceKey: p.activity_instance_key,
          initialReleaseId: p.initial_release_id,
          boundReleaseId: p.bound_release_id,
          latestReleaseId: row.current_release_id,
          publicationStatus: row.publication_status,
          withdrawalReason: row.withdrawal_reason,
          noticeId: notice?.id ?? null,
          trackingDecision: p.tracking_decision,
          bankCancellation: row.current_release_id
            ? (await this.catalog.release(tx, row.id, row.current_release_id))
                .content.bankCancellation
            : null,
        },
        release: await this.catalog.release(
          tx,
          p.catalog_activity_id,
          p.bound_release_id,
        ),
      });
    }, true);
  }
  async diff(actor: CatalogActor, id: string, targetReleaseId: string) {
    targetReleaseId = parse(z.string().uuid(), targetReleaseId);
    return this.catalog.repository.transaction(async (tx) => {
      const { timezone } = await this.catalog.repository.authorize(actor, tx);
      const p = await this.personal.owned(tx, actor.userId, id),
        target = await this.catalog.release(
          tx,
          p.catalog_activity_id,
          targetReleaseId,
        );
      const fields: [
        keyof C.CatalogContent,
        C.CatalogRuleDiff["changes"][number]["affects"],
      ][] = [
        ["name", "source"],
        ["summary", "source"],
        ["start", "dates"],
        ["end", "dates"],
        ["conditions", "current_period"],
        ["periodTemplate", "future_periods"],
        ["rewards", "rewards"],
        ["sources", "source"],
        ["unknownItems", "current_period"],
        ["bankCancellation", "current_period"],
      ];
      return this.catalog.repository.envelope(tx, timezone, {
        participationId: p.id,
        participationVersion: p.version,
        boundReleaseId: p.bound_release_id,
        targetReleaseId: target.id,
        changes: fields
          .filter(
            ([f]) =>
              JSON.stringify(p.content[f]) !==
              JSON.stringify(target.content[f]),
          )
          .map(([field, affects]) => ({
            field,
            beforeText: ruleDiffText(field, p.content[field]),
            afterText: ruleDiffText(field, target.content[field]),
            affects,
          })),
      });
    }, true);
  }
  async adopt(
    context: CatalogCommandContext,
    id: string,
    input: C.AdoptCatalogReleaseInput,
  ) {
    input = parse(
      z
        .object({
          expectedVersion: versionSchema,
          targetReleaseId: z.string().uuid(),
          affectedFuturePeriodIds: z.array(z.string().uuid()).max(24),
          currentPeriodDecisions: z
            .array(
              z
                .object({
                  periodId: z.string().uuid(),
                  expectedVersion: versionSchema,
                  decision: z.enum(["keep_frozen", "create_review_revision"]),
                  note: z.string().min(1).max(4000),
                })
                .strict(),
            )
            .max(24),
          note: z.string().trim().min(1).max(4000),
        })
        .strict(),
      input,
    );
    const result = await this.catalog.repository.command(
      context,
      "catalog.adopt:" + id,
      input,
      false,
      async (tx) => {
        const p = await this.personal.owned(tx, context.actor.userId, id);
        const row = await this.catalog.row(tx, p.catalog_activity_id, true),
          target = await this.catalog.release(
            tx,
            row.id,
            input.targetReleaseId,
          );
        if (row.current_release_id !== target.id) conflict();
        return this.personal.lifecycle.adoptOwnedRelease(
          tx,
          context.actor.userId,
          id,
          target,
          input,
        );
      },
    );
    return { kind: "committed" as const, ...result };
  }
  async decideTracking(
    context: CatalogCommandContext,
    id: string,
    input: C.DecideCatalogTrackingInput,
  ) {
    input = parse(
      z
        .object({
          expectedVersion: versionSchema,
          noticeId: z.string().uuid(),
          decision: z.enum(["continue", "stop_future"]),
          rewardReminderPolicy: z.enum([
            "continue",
            "stop",
            "needs_confirmation",
          ]),
          note: z.string().trim().min(1).max(4000),
        })
        .strict(),
      input,
    );
    return this.catalog.repository.command(
      context,
      "catalog.tracking:" + id,
      input,
      false,
      async (tx) => {
        const p = await this.personal.owned(tx, context.actor.userId, id),
          row = await this.catalog.row(tx, p.catalog_activity_id, true);
        const notice = await this.catalog.withdrawalNotice(
          tx,
          p.catalog_activity_id,
        );
        if (
          row.publication_status !== "withdrawn" ||
          notice?.id !== input.noticeId
        )
          throw new AppError(
            "UNPROCESSABLE_ENTITY",
            "下架通知已变化，请重新核对",
          );
        return this.personal.lifecycle.decideOwnedTracking(
          tx,
          context.actor.userId,
          id,
          input,
        );
      },
    );
  }
  async dispatchEvents(limit = 50) {
    return this.catalog.repository.transaction(async (tx) => {
      const events = await this.catalog.pendingEvents(tx, limit);
      let handled = 0;
      for (const event of events) {
        const current = await this.catalog.row(tx, event.aggregate_id);
        const latest = current.current_release_id
          ? await this.catalog.release(
              tx,
              current.id,
              current.current_release_id,
            )
          : null;
        const result = await this.personal.lifecycle.consumeDirectoryEvent(
          tx,
          event,
          {
            publicationStatus: current.publication_status,
            version: current.version,
            latestReleaseId: current.current_release_id,
            bankCancelled: !!latest?.content.bankCancellation,
            withdrawalNoticeId:
              (await this.catalog.withdrawalNotice(tx, current.id))?.id ?? null,
          },
        );
        handled += result.handled;
        if (result.complete)
          await this.catalog.markEventDelivered(tx, event.id);
      }
      return { events: events.length, handled };
    });
  }
}
function ruleDiffText(field: keyof C.CatalogContent, value: unknown): string {
  const labels: Record<string, string> = {
    kind: "类型",
    value: "日期",
    timezone: "时区",
    reason: "说明",
    cardTypesText: "卡种",
    customerSegmentsText: "客群",
    regionText: "地区",
    channelText: "消费渠道",
    exclusionsText: "排除条件",
    enrollmentRequired: "报名要求",
    enrollmentScope: "报名范围",
    enrollmentDeadline: "报名截止",
    quotaText: "名额",
    type: "类型",
    count: "笔数",
    amount: "金额",
    currency: "币种",
    rulesText: "规则原文",
    countingBasis: "计入口径",
    partialPolicy: "首尾周期",
    target: "目标",
    periods: "周期",
    periodKey: "周期标识",
    start: "开始",
    end: "结束",
    name: "名称",
    rewardKey: "奖励标识",
    amountOrQuantity: "数量或金额",
    unit: "单位",
    scope: "范围",
    conditionsText: "获得条件",
    overallTarget: "全期目标",
    acquisition: "获得方式",
    channel: "领取渠道",
    officialUrl: "官方入口",
    claimStart: "领取开始",
    claimEnd: "领取截止",
    expectedReceipt: "预计到账",
    receiptRuleText: "到账规则",
    url: "官方链接",
    excerpt: "规则摘录",
    accessedAt: "访问时间",
    verifiedAt: "核对时间",
    completeness: "来源完整度",
    code: "核对项",
    field: "规则项",
    blocksExecution: "阻止任务执行",
    officialSourceUrl: "官方证据",
  };
  const enums: Record<string, string> = {
    unknown: "待核对",
    date: "日期",
    instant: "精确时间",
    yes: "需要",
    no: "不需要",
    month: "自然月",
    billing: "账单周期",
    custom: "原文或自定义",
    once: "全期一次",
    occurred: "交易发生",
    posted: "入账",
    settled: "清算",
    full_target: "完整目标",
    source_defined: "官方定义",
    needs_review: "待核对",
    count_and_amount: "笔数且金额",
    count_or_amount: "笔数或金额",
    count: "笔数",
    amount: "金额",
    cashback: "返现",
    points: "积分",
    gift: "实物",
    other: "其他",
    period: "每周期",
    all_periods: "所有周期",
    overall: "全期独立目标",
    automatic: "自动发放",
    manual: "主动领取",
    participation: "整个参与",
    complete: "完整",
    partial: "不完整",
  };
  const render = (v: unknown, depth = 0): string =>
    v === null
      ? "待核对"
      : typeof v === "boolean"
        ? v
          ? "是"
          : "否"
        : typeof v === "string"
          ? (enums[v] ?? v)
          : typeof v === "number"
            ? String(v)
            : Array.isArray(v)
              ? v.length
                ? v
                    .map((x, i) => `第 ${i + 1} 项：\n${render(x, depth + 1)}`)
                    .join("\n")
                : "无"
              : v && typeof v === "object"
                ? Object.entries(v)
                    .filter(
                      ([k]) =>
                        !["rewardKey", "periodKey", "code", "field"].includes(
                          k,
                        ),
                    )
                    .map(
                      ([k, x]) =>
                        `${"  ".repeat(depth)}${labels[k] ?? k}：${render(x, depth + 1)}`,
                    )
                    .join("\n")
                : "无";
  return render(value);
}
