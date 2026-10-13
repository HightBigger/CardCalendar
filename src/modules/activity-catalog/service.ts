import type { PoolClient } from "pg";
import { z } from "zod";
import type * as C from "../../contracts/activity-catalog";
import type {
  CatalogActor,
  CatalogCommandContext,
  CatalogQueryPort,
  CatalogCommandPort,
} from "./ports";
import { AppError } from "../../shared/errors";
import { CatalogRepository } from "./repository";
import {
  catalogContentSchema,
  contentHash,
  dateDay,
  validateCatalogContent,
  versionSchema,
} from "./validation";
export type PersonalCatalogReader = {
  links(
    owner: string,
    tx: PoolClient,
  ): Promise<Map<string, C.CatalogPersonalLink[]>>;
};
type ActivityRow = {
  id: string;
  version: number;
  publication_status: C.CatalogPublicationStatus;
  current_release_id: string | null;
  current_draft_id: string | null;
  withdrawal_reason: string | null;
  activity_instance_key: string;
  last_modified_by: string;
  updated_at: Date;
};
export function releaseDto(r: Record<string, unknown>): C.CatalogRelease {
  return {
    id: r.id as string,
    catalogActivityId: r.catalog_activity_id as string,
    activityInstanceKey: r.activity_instance_key as string,
    releaseNumber: r.release_number as number,
    publishedAt: (r.published_at as Date).toISOString(),
    contentHash: r.content_hash as string,
    changeNote: r.change_note as string,
    content: r.content as C.CatalogContent,
  };
}
export function draftDto(r: Record<string, unknown>): C.CatalogDraft {
  return {
    id: r.id as string,
    catalogActivityId: r.catalog_activity_id as string,
    version: r.version as number,
    basedOnReleaseId: r.based_on_release_id as string | null,
    updatedAt: (r.updated_at as Date).toISOString(),
    content: r.content as C.CatalogContent,
  };
}
export const catalogImpact = (id: string): C.CatalogImpact => ({
  resources: ["activity-catalog", "catalog-admin"],
  catalogActivityIds: [id],
  participationIds: [],
});
export const conflict = (
  reason: C.CatalogErrorReason = "CATALOG_VERSION_CONFLICT",
): never => {
  throw new AppError("CONFLICT", "内容已发生变化，请重新读取并核对", 409, {
    reason,
  });
};
const requiredNote = z.string().trim().min(1).max(4000);
export function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const r = schema.safeParse(input);
  if (!r.success)
    throw new AppError("VALIDATION_ERROR", "请求字段无效", 400, {
      issues: r.error.issues,
    });
  return r.data;
}
function targetText(t: C.CatalogTarget) {
  return t.kind === "custom"
    ? t.rulesText || "目标待核对"
    : [
        t.count !== null ? `${t.count} 笔` : null,
        t.amount !== null ? `${t.amount} ${t.currency ?? ""}` : null,
      ]
        .filter(Boolean)
        .join(t.kind === "count_or_amount" ? " 或 " : " 且 ") || "目标待核对";
}
export class CatalogService implements CatalogQueryPort, CatalogCommandPort {
  constructor(
    readonly repository: CatalogRepository,
    public personal?: PersonalCatalogReader,
    readonly joinEnabled = false,
  ) {}
  async withdrawalNotice(tx: PoolClient, id: string) {
    return (
      await tx.query(
        "select id,sequence from catalog_outbox where aggregate_id=$1 and event_type='CatalogWithdrawn.v1' order by sequence desc limit 1",
        [id],
      )
    ).rows[0] as { id: string; sequence: number } | undefined;
  }
  async pendingEvents(tx: PoolClient, limit: number) {
    return (
      await tx.query(
        "select * from catalog_outbox where delivered_at is null order by occurred_at,id for update skip locked limit $1",
        [limit],
      )
    ).rows as import("../participation/catalog-lifecycle").CatalogSystemEvent[];
  }
  async markEventDelivered(tx: PoolClient, id: string) {
    await tx.query("update catalog_outbox set delivered_at=now() where id=$1", [
      id,
    ]);
  }
  async getCapabilities(actor: CatalogActor) {
    return this.repository.transaction(
      async (tx) => (await this.repository.authorize(actor, tx)).capabilities,
      true,
    );
  }
  async banks(actor: CatalogActor) {
    return this.repository.transaction(async (tx) => {
      const { timezone } = await this.repository.authorize(actor, tx);
      return this.repository.envelope(
        tx,
        timezone,
        (await tx.query("select id,name from bank_directory order by name"))
          .rows,
      );
    }, true);
  }
  async row(tx: PoolClient, id: string, lock = false): Promise<ActivityRow> {
    const r = await tx.query<ActivityRow>(
      `select * from catalog_activities where id=$1 ${lock ? "for update" : ""}`,
      [id],
    );
    if (!r.rowCount) throw new AppError("NOT_FOUND", "活动不存在");
    return r.rows[0];
  }
  async release(
    tx: PoolClient,
    id: string,
    releaseId: string,
  ): Promise<C.CatalogRelease> {
    const r = await tx.query(
      "select * from catalog_releases where catalog_activity_id=$1 and id=$2",
      [id, releaseId],
    );
    if (!r.rowCount) throw new AppError("NOT_FOUND", "发布版本不存在");
    return releaseDto(r.rows[0]);
  }
  async domains(tx: PoolClient, bankId: string | null): Promise<string[]> {
    return (
      (
        await tx.query(
          "select official_domains from bank_directory where id=$1",
          [bankId],
        )
      ).rows[0]?.official_domains ?? []
    );
  }
  async summary(
    tx: PoolClient,
    row: ActivityRow,
    release: C.CatalogRelease,
    links: C.CatalogPersonalLink[],
    timezone: string,
  ): Promise<C.CatalogSummary> {
    const content = release.content;
    const bank = (
      await tx.query("select id,name from bank_directory where id=$1", [
        content.bankId,
      ])
    ).rows[0];
    const today = new Intl.DateTimeFormat("sv-SE", {
      timeZone: content.periodTemplate.timezone ?? timezone,
    }).format(new Date());
    const phase: C.CatalogActivityPhase = content.bankCancellation
      ? "cancelled"
      : dateDay(content.start)! > today
        ? "upcoming"
        : dateDay(content.end)! < today
          ? "ended"
          : "ongoing";
    const issues = validateCatalogContent(
      content,
      await this.domains(tx, content.bankId),
    );
    const dates = [
      content.conditions.enrollmentDeadline,
      ...content.rewards.flatMap((r) => [r.claimStart, r.claimEnd]),
      content.end,
    ]
      .filter((d) => dateDay(d)! && dateDay(d)! >= today)
      .sort((a, b) => dateDay(a)!.localeCompare(dateDay(b)!));
    return {
      id: row.id,
      version: row.version,
      releaseId: release.id,
      name: content.name,
      bank: bank ?? { id: content.bankId ?? "", name: "银行待核对" },
      phase,
      start: content.start,
      end: content.end,
      targetText: targetText(content.periodTemplate.target),
      rewardText:
        content.rewards.map((r) => r.name).join(" · ") || "奖励待核对",
      nextKeyDate: dates[0] ?? { kind: "unknown", reason: "关键日期待核对" },
      sourceStatusText: content.sources.some(
        (s) => s.completeness === "partial",
      )
        ? "官方来源不完整"
        : "已核对官方来源",
      unknownItems: issues
        .filter((i) => i.severity !== "blocks_publication")
        .map((i) => ({
          code: i.code,
          field: i.field,
          reason: i.message,
          blocksExecution: i.severity === "blocks_execution",
        })),
      myParticipations: links.map((l) => ({
        ...l,
        updateAvailable: l.boundReleaseId !== release.id,
      })),
      join: {
        enabled:
          this.joinEnabled &&
          row.publication_status === "published" &&
          !content.bankCancellation,
        reason: !this.joinEnabled
          ? "个人活动、周期与待办服务正在接入"
          : content.bankCancellation
            ? "银行已确认取消"
            : row.publication_status !== "published"
              ? "目录已下架"
              : null,
      },
    };
  }
  async list(actor: CatalogActor, filter: C.CatalogFilter) {
    return this.repository.transaction(async (tx) => {
      const { timezone } = await this.repository.authorize(actor, tx);
      const rows = (
        await tx.query<ActivityRow>(
          "select * from catalog_activities where publication_status='published' order by updated_at desc,id",
        )
      ).rows;
      const links =
        (await this.personal?.links(actor.userId, tx)) ??
        new Map<string, C.CatalogPersonalLink[]>();
      const banks = filter.myBanksOnly
        ? (
            await tx.query(
              "select distinct bank_id from cards where user_id=$1 and bank_id is not null and status='active'",
              [actor.userId],
            )
          ).rows.map((r) => r.bank_id)
        : null;
      const items: C.CatalogSummary[] = [];
      for (const row of rows) {
        const release = await this.release(tx, row.id, row.current_release_id!);
        const s = await this.summary(
          tx,
          row,
          release,
          links.get(row.id) ?? [],
          timezone,
        );
        if (this.matches(s, release.content, filter, banks)) items.push(s);
      }
      const start = filter.cursor
        ? items.findIndex((item) => item.id === filter.cursor) + 1
        : 0;
      if (filter.cursor && start === 0)
        throw new AppError("CONFLICT", "分页位置已变化，请回到第一页重新筛选");
      const page = items.slice(start, start + 40),
        nextCursor = start + 40 < items.length ? page.at(-1)!.id : null;
      const result = await this.repository.envelope(tx, timezone, {
        items: page,
        total: items.length,
      });
      result.meta.nextCursor = nextCursor;
      return result;
    }, true);
  }
  private matches(
    s: C.CatalogSummary,
    c: C.CatalogContent,
    f: C.CatalogFilter,
    banks: string[] | null,
  ) {
    return (
      (!f.bankIds?.length || f.bankIds.includes(s.bank.id)) &&
      (!f.activityTypes?.length || f.activityTypes.includes(c.activityType)) &&
      (!banks || banks.includes(s.bank.id)) &&
      (!f.joinedOnly || s.myParticipations.length > 0) &&
      ((f.phase ?? "current") === "current"
        ? ["upcoming", "ongoing"].includes(s.phase)
        : f.phase === s.phase) &&
      (!f.q ||
        (s.name + " " + s.bank.name + " " + c.summary)
          .toLowerCase()
          .includes(f.q.toLowerCase()))
    );
  }
  async detail(actor: CatalogActor, id: string) {
    return this.repository.transaction(async (tx) => {
      const { timezone } = await this.repository.authorize(actor, tx);
      const row = await this.row(tx, id);
      if (row.publication_status !== "published")
        throw new AppError("NOT_FOUND", "活动未发布或已下架");
      const release = await this.release(tx, id, row.current_release_id!);
      const links = await this.personal?.links(actor.userId, tx);
      return this.repository.envelope(tx, timezone, {
        summary: await this.summary(
          tx,
          row,
          release,
          links?.get(id) ?? [],
          timezone,
        ),
        release,
        publicationStatus: row.publication_status,
        withdrawalReason: row.withdrawal_reason,
      });
    }, true);
  }
  async readRelease(actor: CatalogActor, id: string, releaseId: string) {
    return this.repository.transaction(async (tx) => {
      const { timezone } = await this.repository.authorize(actor, tx);
      const row = await this.row(tx, id);
      if (row.publication_status !== "published")
        throw new AppError("NOT_FOUND", "请从自己的个人参与查看下架来源");
      return this.repository.envelope(
        tx,
        timezone,
        await this.release(tx, id, releaseId),
      );
    }, true);
  }
  private async adminSummary(
    tx: PoolClient,
    row: ActivityRow,
  ): Promise<C.CatalogAdminSummary> {
    const draft = row.current_draft_id
      ? (
          await tx.query("select * from catalog_drafts where id=$1", [
            row.current_draft_id,
          ])
        ).rows[0]
      : null;
    const c =
      draft?.content ??
      (row.current_release_id
        ? (await this.release(tx, row.id, row.current_release_id)).content
        : null);
    const actor = (
      await tx.query(
        "select id,coalesce(name,email::text) as name from users where id=$1",
        [row.last_modified_by],
      )
    ).rows[0];
    return {
      id: row.id,
      version: row.version,
      publicationStatus: row.publication_status,
      currentReleaseId: row.current_release_id,
      draftId: row.current_draft_id,
      name: c.name,
      bankId: c.bankId,
      start: c.start,
      end: c.end,
      targetText: targetText(c.periodTemplate.target),
      rewardText: c.rewards
        .map((r: C.CatalogRewardTemplate) => r.name)
        .join(" · "),
      lastVerifiedAt:
        c.sources
          .map((s: C.CatalogOfficialSource) => s.verifiedAt)
          .filter(Boolean)
          .sort()
          .at(-1) ?? null,
      lastModifiedBy: { id: actor.id, displayName: actor.name },
      updatedAt: row.updated_at.toISOString(),
    };
  }
  async adminList(actor: CatalogActor, filter: C.CatalogAdminFilter) {
    return this.repository.transaction(async (tx) => {
      const { timezone } = await this.repository.authorize(actor, tx, true);
      const rows = (
        await tx.query<ActivityRow>(
          "select * from catalog_activities order by updated_at desc,id",
        )
      ).rows;
      const items: C.CatalogAdminSummary[] = [];
      for (const row of rows) {
        const s = await this.adminSummary(tx, row);
        const today = new Intl.DateTimeFormat("sv-SE", {
          timeZone: timezone,
        }).format(new Date());
        const phase =
          dateDay(s.start)! > today
            ? "upcoming"
            : dateDay(s.end)! < today
              ? "ended"
              : "ongoing";
        if (
          (!filter.publicationStatus ||
            s.publicationStatus === filter.publicationStatus) &&
          (!filter.bankIds?.length ||
            filter.bankIds.includes(s.bankId ?? "")) &&
          (!filter.q ||
            s.name.toLowerCase().includes(filter.q.toLowerCase())) &&
          (!filter.phase ||
            (filter.phase === "current"
              ? phase !== "ended"
              : filter.phase === phase))
        )
          items.push(s);
      }
      const start = filter.cursor
        ? items.findIndex((item) => item.id === filter.cursor) + 1
        : 0;
      if (filter.cursor && start === 0)
        throw new AppError("CONFLICT", "分页位置已变化，请回到第一页重新筛选");
      const page = items.slice(start, start + 40),
        nextCursor = start + 40 < items.length ? page.at(-1)!.id : null;
      const result = await this.repository.envelope(tx, timezone, {
        items: page,
        total: items.length,
      });
      result.meta.nextCursor = nextCursor;
      return result;
    }, true);
  }
  async adminDetail(actor: CatalogActor, id: string) {
    return this.repository.transaction(async (tx) => {
      const { timezone } = await this.repository.authorize(actor, tx, true);
      const row = await this.row(tx, id);
      return this.repository.envelope(tx, timezone, {
        activity: await this.adminSummary(tx, row),
        draft: row.current_draft_id
          ? draftDto(
              (
                await tx.query("select * from catalog_drafts where id=$1", [
                  row.current_draft_id,
                ])
              ).rows[0],
            )
          : null,
        releases: (
          await tx.query(
            "select * from catalog_releases where catalog_activity_id=$1 order by release_number desc",
            [id],
          )
        ).rows.map(releaseDto),
        history: (
          await tx.query(
            "select * from catalog_history where catalog_activity_id=$1 order by occurred_at,id",
            [id],
          )
        ).rows.map((r) => ({
          id: r.id,
          actorId: r.actor_id,
          action: r.action,
          occurredAt: r.occurred_at.toISOString(),
          releaseId: r.release_id,
          note: r.note,
          catalogVersion: r.catalog_version,
          draftVersion: r.draft_version,
        })),
      });
    }, true);
  }
  async previewDraft(actor: CatalogActor, id: string, draftId: string) {
    return this.repository.transaction(async (tx) => {
      const { timezone } = await this.repository.authorize(actor, tx, true);
      const row = await this.row(tx, id);
      if (row.current_draft_id !== draftId)
        throw new AppError("NOT_FOUND", "当前草稿不存在");
      const draft = draftDto(
        (await tx.query("select * from catalog_drafts where id=$1", [draftId]))
          .rows[0],
      );
      const issues = validateCatalogContent(
        draft.content,
        await this.domains(tx, draft.content.bankId),
      );
      return this.repository.envelope(tx, timezone, {
        draftId,
        draftVersion: draft.version,
        catalogVersion: row.version,
        contentHash: contentHash(draft.content),
        content: draft.content,
        issues,
        canPublish: !issues.some((i) => i.severity === "blocks_publication"),
      });
    }, true);
  }
  async history(
    tx: PoolClient,
    actor: CatalogActor,
    row: ActivityRow,
    action: string,
    note: string,
    releaseId: string | null = null,
    draftVersion: number | null = null,
  ) {
    await tx.query(
      "insert into catalog_history(catalog_activity_id,actor_id,action,catalog_version,draft_version,release_id,note) values($1,$2,$3,$4,$5,$6,$7)",
      [
        row.id,
        actor.userId,
        action,
        row.version,
        draftVersion,
        releaseId,
        note,
      ],
    );
    await tx.query(
      "insert into audit_logs(actor_type,actor_id,action,entity_type,entity_id,metadata) values('admin',$1,$2,'catalog_activity',$3,$4)",
      [
        actor.userId,
        action,
        row.id,
        { version: row.version, draftVersion, releaseId, note },
      ],
    );
  }
  async createDraft(
    context: CatalogCommandContext,
    input: C.CreateCatalogDraftInput,
  ) {
    input = parse(z.object({ content: catalogContentSchema }).strict(), input);
    return this.repository.command(
      context,
      "catalog.create",
      input,
      true,
      async (tx) => {
        const row = (
          await tx.query<ActivityRow>(
            "insert into catalog_activities(last_modified_by) values($1) returning *",
            [context.actor.userId],
          )
        ).rows[0];
        const draft = draftDto(
          (
            await tx.query(
              "insert into catalog_drafts(catalog_activity_id,content) values($1,$2) returning *",
              [row.id, input.content],
            )
          ).rows[0],
        );
        await tx.query(
          "update catalog_activities set current_draft_id=$2 where id=$1",
          [row.id, draft.id],
        );
        await this.history(
          tx,
          context.actor,
          row,
          "catalog.draft_created",
          "创建初始草稿",
          null,
          draft.version,
        );
        return draft;
      },
    );
  }
  async startRevision(
    context: CatalogCommandContext,
    id: string,
    input: { expectedVersion: number },
  ) {
    input = parse(z.object({ expectedVersion: versionSchema }).strict(), input);
    return this.repository.command(
      context,
      "catalog.revision:" + id,
      input,
      true,
      async (tx) => {
        const row = await this.row(tx, id, true);
        if (row.version !== input.expectedVersion) conflict();
        if (row.current_draft_id)
          throw new AppError("CONFLICT", "已有编辑中的草稿，请打开它继续编辑");
        if (!row.current_release_id)
          throw new AppError("UNPROCESSABLE_ENTITY", "没有可修订的发布版本");
        const release = await this.release(tx, id, row.current_release_id);
        const draft = draftDto(
          (
            await tx.query(
              "insert into catalog_drafts(catalog_activity_id,based_on_release_id,content) values($1,$2,$3) returning *",
              [id, release.id, release.content],
            )
          ).rows[0],
        );
        const updated = (
          await tx.query<ActivityRow>(
            "update catalog_activities set current_draft_id=$2,version=version+1,last_modified_by=$3,updated_at=now() where id=$1 returning *",
            [id, draft.id, context.actor.userId],
          )
        ).rows[0];
        await this.history(
          tx,
          context.actor,
          updated,
          "catalog.revision_started",
          "基于发布版本建立修订草稿",
          release.id,
          draft.version,
        );
        return draft;
      },
    );
  }
  async updateDraft(
    context: CatalogCommandContext,
    id: string,
    draftId: string,
    input: C.UpdateCatalogDraftInput,
  ) {
    input = parse(
      z
        .object({
          expectedVersion: versionSchema,
          content: catalogContentSchema,
        })
        .strict(),
      input,
    );
    return this.repository.command(
      context,
      "catalog.edit:" + id + ":" + draftId,
      input,
      true,
      async (tx) => {
        const row = await this.row(tx, id, true);
        if (row.current_draft_id !== draftId)
          throw new AppError("NOT_FOUND", "当前草稿不存在");
        const r = await tx.query(
          "update catalog_drafts set content=$3,version=version+1,updated_at=now() where id=$1 and version=$2 returning *",
          [draftId, input.expectedVersion, input.content],
        );
        if (!r.rowCount) conflict("DRAFT_CHANGED");
        const draft = draftDto(r.rows[0]);
        const updated = (
          await tx.query<ActivityRow>(
            "update catalog_activities set version=version+1,last_modified_by=$2,updated_at=now() where id=$1 returning *",
            [id, context.actor.userId],
          )
        ).rows[0];
        await this.history(
          tx,
          context.actor,
          updated,
          "catalog.draft_updated",
          "更新草稿，尚未发布",
          null,
          draft.version,
        );
        return draft;
      },
    );
  }
  async publish(
    context: CatalogCommandContext,
    id: string,
    input: C.PublishCatalogDraftInput,
  ) {
    input = parse(
      z
        .object({
          draftId: z.string().uuid(),
          expectedDraftVersion: versionSchema,
          expectedCatalogVersion: versionSchema,
          reviewedContentHash: z.string().regex(/^[a-f0-9]{64}$/),
          changeNote: requiredNote,
        })
        .strict(),
      input,
    );
    return this.repository.command(
      context,
      "catalog.publish:" + id,
      input,
      true,
      async (tx) => {
        const row = await this.row(tx, id, true);
        if (row.version !== input.expectedCatalogVersion) conflict();
        if (row.current_draft_id !== input.draftId) conflict("DRAFT_CHANGED");
        const draft = draftDto(
          (
            await tx.query("select * from catalog_drafts where id=$1", [
              input.draftId,
            ])
          ).rows[0],
        );
        if (
          draft.version !== input.expectedDraftVersion ||
          contentHash(draft.content) !== input.reviewedContentHash
        )
          conflict("DRAFT_CHANGED");
        const issues = validateCatalogContent(
          draft.content,
          await this.domains(tx, draft.content.bankId),
        );
        if (issues.some((i) => i.severity === "blocks_publication"))
          throw new AppError(
            "UNPROCESSABLE_ENTITY",
            "发布必需信息不完整",
            422,
            { reason: "PUBLICATION_BLOCKED", issues },
          );
        const number = (
          await tx.query(
            "select coalesce(max(release_number),0)+1 as n from catalog_releases where catalog_activity_id=$1",
            [id],
          )
        ).rows[0].n;
        const release = releaseDto(
          (
            await tx.query(
              "insert into catalog_releases(catalog_activity_id,release_number,activity_instance_key,published_by,content_hash,change_note,content) values($1,$2,$3,$4,$5,$6,$7) returning *",
              [
                id,
                number,
                row.activity_instance_key,
                context.actor.userId,
                input.reviewedContentHash,
                input.changeNote,
                draft.content,
              ],
            )
          ).rows[0],
        );
        const updated = (
          await tx.query<ActivityRow>(
            "update catalog_activities set version=version+1,publication_status='published',current_release_id=$2,current_draft_id=null,withdrawal_reason=null,last_modified_by=$3,updated_at=now() where id=$1 returning *",
            [id, release.id, context.actor.userId],
          )
        ).rows[0];
        await this.history(
          tx,
          context.actor,
          updated,
          "catalog.published",
          input.changeNote,
          release.id,
          draft.version,
        );
        await tx.query(
          "insert into catalog_outbox(aggregate_id,sequence,event_type,payload) values($1,$2,'CatalogReleasePublished.v1',$3)",
          [
            id,
            updated.version,
            {
              catalogActivityId: id,
              releaseId: release.id,
              previousReleaseId: row.current_release_id,
              changeNote: input.changeNote,
            },
          ],
        );
        return {
          catalogActivityId: id,
          version: updated.version,
          releaseId: release.id,
          impact: catalogImpact(id),
        };
      },
    );
  }
  async withdraw(
    context: CatalogCommandContext,
    id: string,
    input: C.WithdrawCatalogInput,
  ) {
    input = parse(
      z
        .object({ expectedVersion: versionSchema, reason: requiredNote })
        .strict(),
      input,
    );
    return this.repository.command(
      context,
      "catalog.withdraw:" + id,
      input,
      true,
      async (tx) => {
        const row = await this.row(tx, id, true);
        if (row.version !== input.expectedVersion) conflict();
        if (row.publication_status !== "published")
          throw new AppError("UNPROCESSABLE_ENTITY", "只有已发布目录可以下架");
        const updated = (
          await tx.query<ActivityRow>(
            "update catalog_activities set publication_status='withdrawn',version=version+1,withdrawal_reason=$2,last_modified_by=$3,updated_at=now() where id=$1 returning *",
            [id, input.reason, context.actor.userId],
          )
        ).rows[0];
        await this.history(
          tx,
          context.actor,
          updated,
          "catalog.withdrawn",
          input.reason,
          row.current_release_id,
        );
        await tx.query(
          "insert into catalog_outbox(aggregate_id,sequence,event_type,payload) values($1,$2,'CatalogWithdrawn.v1',$3)",
          [
            id,
            updated.version,
            {
              catalogActivityId: id,
              releaseId: row.current_release_id,
              reason: input.reason,
            },
          ],
        );
        return {
          catalogActivityId: id,
          version: updated.version,
          releaseId: row.current_release_id,
          impact: catalogImpact(id),
        };
      },
    );
  }
}
