import { PersonalCatalogLifecycle } from "./catalog-lifecycle";
import type { PoolClient } from "pg";
import type * as C from "../../contracts/activity-catalog";
import type { CardIdentity } from "../../contracts/workbench";
import type { CatalogActor } from "../activity-catalog/ports";
import type { PersonalCatalogImportPort } from "../../server/workflows/catalog-participation.ports";
import type { CatalogService } from "../activity-catalog/service";
import type { UnitOfWork } from "../../shared/db/unit-of-work";
export type PersonalRuntime = { repository: UnitOfWork } & Pick<CatalogService, "row" | "release" | "domains">;
import { AppError } from "../../shared/errors";
import {
  dateDay,
  validateCatalogContent,
} from "../activity-catalog/validation";
import { TodoService } from "../todos/catalog-todos";
export type PrivateParticipation = {
  id: string;
  owner_user_id: string;
  card_id: string;
  campaign_id: string;
  rule_version_id: string;
  activity_instance_key: string;
  version: number;
  tracking_status: "needs_review" | "planned" | "active";
  tracking_decision: C.CatalogParticipationSource["trackingDecision"];
  reward_reminder_policy: string;
  eligibility: string;
  enrollment: string;
  node_preferences: C.CatalogJoinSelection["nodePreferences"];
  catalog_activity_id: string;
  initial_release_id: string;
  bound_release_id: string;
  content: C.CatalogContent;
  card: CardIdentity;
  card_status: string;
  rule_revision?: number;
  editor_draft?: import("../campaign/service").PrivateDraft;
  source_kind?: "manual" | "catalog";
  cancelled_at?: Date | null;
  quota?: string;
};
export type PrivatePeriod = {
  id: string;
  owner_user_id: string;
  card_id: string;
  participation_id: string;
  campaign_id: string;
  rule_version_id: string;
  version: number;
  period_key: string;
  start_on: string;
  end_on: string;
  timezone: string;
  target: C.CatalogTarget;
  executable: boolean;
  qualification: string;
  eligibility?: string;
  enrollment?: string;
  quota?: string;
  plan_revision_id?: string;
  stopped: boolean;
};
const unknown = () => ({ kind: "unknown" as const, reason: "待核对" });
export function privateImpact(id: string, activityId: string): C.CatalogImpact {
  return {
    resources: [
      "activity-catalog",
      "activities",
      "spend-tasks",
      "rewards",
      "todos",
      "notifications",
    ],
    catalogActivityIds: [activityId],
    participationIds: [id],
  };
}
export function months(start: string, end: string) {
  const [sy, sm] = start.split("-").map(Number),
    [ey, em] = end.split("-").map(Number);
  const output = [];
  for (let n = sy * 12 + sm - 1; n <= ey * 12 + em - 1; n++) {
    const year = Math.floor(n / 12),
      month = (n % 12) + 1;
    const key = year + "-" + String(month).padStart(2, "0");
    const last = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
    output.push({
      periodKey: key,
      startOn: key + "-01" > start ? key + "-01" : start,
      endOn: last < end ? last : end,
    });
  }
  return output;
}
export class PersonalCatalogService
  implements PersonalCatalogImportPort<PoolClient>
{
  readonly todos = new TodoService();
  readonly lifecycle: PersonalCatalogLifecycle;
  constructor(readonly catalog: PersonalRuntime) {
    this.lifecycle = new PersonalCatalogLifecycle(this);
  }
  async owned(
    tx: PoolClient,
    owner: string,
    id: string,
    lock = false,
  ): Promise<PrivateParticipation> {
    if (lock) {
      const card = (
        await tx.query(
          "select card_id from activity_participations where id=$1 and owner_user_id=$2",
          [id, owner],
        )
      ).rows[0];
      if (!card) throw new AppError("NOT_FOUND", "无法访问此个人参与");
      // Shared consumption fence, in the same card -> participation order as archive.
      await tx.query(
        "select id from cards where id=$1 and user_id=$2 for share",
        [card.card_id, owner],
      );
    }
    const result = await tx.query(
      `select p.*,coalesce(to_jsonb(c)->>'source_kind','catalog') as source_kind,c.catalog_activity_id,c.initial_release_id,r.release_id as bound_release_id,r.content,(to_jsonb(r)->>'revision')::int as rule_revision,to_jsonb(r)->'editor_draft' as editor_draft,b.status as card_status,jsonb_build_object('id',b.id,'bank',b.issuer_name,'name',b.name,'last4',b.last4) as card from activity_participations p join private_campaigns c on c.id=p.campaign_id and c.owner_user_id=p.owner_user_id join private_rule_versions r on r.id=p.rule_version_id and r.owner_user_id=p.owner_user_id join cards b on b.id=p.card_id and b.user_id=p.owner_user_id where p.id=$1 and p.owner_user_id=$2 ${lock ? "for update of p" : ""}`,
      [id, owner],
    );
    if (!result.rowCount) throw new AppError("NOT_FOUND", "无法访问此个人参与");
    return result.rows[0] as PrivateParticipation;
  }
  async periods(
    tx: PoolClient,
    p: PrivateParticipation,
    lock = false,
  ): Promise<PrivatePeriod[]> {
    return (
      await tx.query(
        `select *,start_on::text,end_on::text from activity_periods where participation_id=$1 and owner_user_id=$2 order by activity_periods.start_on,activity_periods.id ${lock ? "for update" : ""}`,
        [p.id, p.owner_user_id],
      )
    ).rows;
  }
  async cards(
    tx: PoolClient,
    owner: string,
    selections: C.CatalogJoinSelection[],
  ) {
    const ids = selections.map((s) => s.cardId);
    if (new Set(ids).size !== ids.length)
      throw new AppError("VALIDATION_ERROR", "不能重复选择同一卡片");
    const rows = (
      await tx.query(
        "select id,issuer_name as bank,name,last4,bank_id from cards where user_id=$1 and id=any($2::uuid[]) and status='active' order by id for share",
        [owner, ids],
      )
    ).rows;
    if (rows.length !== ids.length)
      throw new AppError("NOT_FOUND", "一张或多张卡片不可用，整个请求未写入");
    return rows;
  }
  async joinIssues(
    tx: PoolClient,
    release: C.CatalogRelease,
    selection: C.CatalogJoinSelection,
    bankId: string | null,
  ): Promise<C.CatalogValidationIssue[]> {
    const c = release.content,
      issues = validateCatalogContent(
        c,
        await this.catalog.domains(tx, c.bankId),
      ).filter((i) => i.severity !== "blocks_publication");
    if (bankId !== c.bankId)
      issues.push({
        code: "CARD_BANK_REVIEW",
        field: "cardId",
        message: "卡片银行关联尚未核对，银行匹配也不确认资格",
        severity: "blocks_execution",
      });
    if (
      c.conditions.enrollmentRequired === "yes" &&
      c.conditions.enrollmentScope === "period"
    )
      issues.push({
        code: "PER_PERIOD_ENROLLMENT_SERVICE_REQUIRED",
        field: "conditions.enrollmentScope",
        message: "每期报名服务尚未具备，保留待核对计划",
        severity: "blocks_execution",
      });
    if (c.rewards.some((r) => r.scope === "overall"))
      issues.push({
        code: "OVERALL_REWARD_TASK_REQUIRED",
        field: "rewards",
        message: "全期独立消费目标尚需完整任务服务，保留待核对计划",
        severity: "blocks_execution",
      });
    if (
      !selection.boundaries.length &&
      (c.periodTemplate.type === "billing" ||
        c.periodTemplate.type === "custom")
    )
      issues.push({
        code: "PRIVATE_BOUNDARIES_REQUIRED",
        field: "boundaries",
        message: "需要成员确认私人账单或自定义周期边界",
        severity: "blocks_execution",
      });
    const start = dateDay(c.start),
      end = dateDay(c.end);
    let lastEnd: string | null = null;
    for (const b of [...selection.boundaries].sort((a, b) =>
      a.startOn.localeCompare(b.startOn),
    )) {
      if (
        b.startOn > b.endOn ||
        (start && b.startOn < start) ||
        (end && b.endOn > end) ||
        (lastEnd && b.startOn <= lastEnd)
      )
        throw new AppError(
          "UNPROCESSABLE_ENTITY",
          "私人周期边界越界、顺序无效或重叠",
        );
      lastEnd = b.endOn;
    }
    return issues;
  }
  async history(
    tx: PoolClient,
    p: PrivateParticipation,
    action: string,
    note: string,
    payload: unknown,
  ) {
    await tx.query(
      "insert into catalog_personal_history(owner_user_id,card_id,participation_id,action,note,payload) values($1,$2,$3,$4,$5,$6)",
      [p.owner_user_id, p.card_id, p.id, action, note, payload],
    );
    await tx.query(
      "insert into audit_logs(user_id,actor_type,actor_id,action,entity_type,entity_id,metadata) values($1,'user',$1,$2,'activity_participation',$3,$4)",
      [p.owner_user_id, action, p.id, { note, payload }],
    );
    await tx.query(
      "insert into catalog_personal_outbox(owner_user_id,aggregate_id,sequence,event_type,payload) values($1,$2,$3,$4,$5)",
      [p.owner_user_id, p.id, p.version, action, payload],
    );
  }
  async links(
    owner: string,
    tx: PoolClient,
  ): Promise<Map<string, C.CatalogPersonalLink[]>> {
    const rows = (
      await tx.query(
        "select p.id,p.card_id,c.catalog_activity_id,r.release_id,b.name,b.last4,b.issuer_name from activity_participations p join private_campaigns c on c.id=p.campaign_id and c.owner_user_id=p.owner_user_id join private_rule_versions r on r.id=p.rule_version_id and r.owner_user_id=p.owner_user_id join cards b on b.id=p.card_id and b.user_id=p.owner_user_id where p.owner_user_id=$1",
        [owner],
      )
    ).rows;
    const map = new Map<string, C.CatalogPersonalLink[]>();
    for (const r of rows) {
      const items = map.get(r.catalog_activity_id) ?? [];
      items.push({
        participationId: r.id,
        boundReleaseId: r.release_id,
        updateAvailable: false,
        card: {
          id: r.card_id,
          name: r.name,
          last4: r.last4,
          bank: r.issuer_name,
        },
      });
      map.set(r.catalog_activity_id, items);
    }
    return map;
  }
  async previewOwnedCards(
    tx: PoolClient,
    owner: string,
    release: C.CatalogRelease,
    selections: C.CatalogJoinSelection[],
  ) {
    const cards = (
      await tx.query(
        "select id,issuer_name as bank,name,last4,bank_id from cards where user_id=$1 and id=any($2::uuid[]) and status='active'",
        [owner, selections.map((s) => s.cardId)],
      )
    ).rows;
    if (new Set(selections.map((s) => s.cardId)).size !== selections.length)
      throw new AppError("VALIDATION_ERROR", "不能重复选择同一卡片");
    if (cards.length !== selections.length)
      throw new AppError("NOT_FOUND", "一张或多张卡片不可用");
    const items = [];
    for (const s of selections) {
      const card = cards.find((c) => c.id === s.cardId)!;
      const issues = await this.joinIssues(tx, release, s, card.bank_id);
      const existing = (
        await tx.query(
          "select p.id from activity_participations p join private_campaigns c on c.id=p.campaign_id and c.owner_user_id=p.owner_user_id where p.owner_user_id=$1 and p.card_id=$2 and c.catalog_activity_id=$3 and p.activity_instance_key=$4",
          [
            owner,
            s.cardId,
            release.catalogActivityId,
            release.activityInstanceKey,
          ],
        )
      ).rows[0];
      items.push({
        card: {
          id: card.id,
          bank: card.bank,
          name: card.name,
          last4: card.last4,
        },
        existingParticipationId: existing?.id ?? null,
        issues,
        canActivate: !issues.some((i) => i.severity === "blocks_execution"),
      });
    }
    return items;
  }
  async joinOwnedCards(
    {
      ownerUserId: owner,
      release,
      selections,
    }: {
      ownerUserId: string;
      release: C.CatalogRelease;
      selections: C.CatalogJoinSelection[];
    },
    tx: PoolClient,
  ): Promise<C.CatalogJoinCommit> {
    const cards = await this.cards(tx, owner, selections);
    const issues = new Map<string, C.CatalogValidationIssue[]>();
    for (const selection of selections)
      issues.set(
        selection.cardId,
        await this.joinIssues(
          tx,
          release,
          selection,
          cards.find((c) => c.id === selection.cardId)!.bank_id,
        ),
      );
    for (const selection of selections) {
      const required = issues
        .get(selection.cardId)!
        .filter((i) => i.severity === "blocks_execution")
        .map((i) => i.code);
      if (
        required.some(
          (code) => !selection.acknowledgedUnknownCodes.includes(code),
        )
      )
        throw new AppError(
          "UNPROCESSABLE_ENTITY",
          "请明确确认所有关键待核对项",
          422,
          { reason: "UNKNOWN_ACKNOWLEDGMENT_REQUIRED", codes: required },
        );
    }
    const campaign = (
      await tx.query(
        "insert into private_campaigns(owner_user_id,catalog_activity_id,activity_instance_key,initial_release_id) values($1,$2,$3,$4) on conflict(owner_user_id,catalog_activity_id,activity_instance_key) do update set owner_user_id=excluded.owner_user_id returning *",
        [
          owner,
          release.catalogActivityId,
          release.activityInstanceKey,
          release.id,
        ],
      )
    ).rows[0];
    const rule = (
      await tx.query(
        "insert into private_rule_versions(owner_user_id,campaign_id,release_id,content) values($1,$2,$3,$4) on conflict(campaign_id,release_id) do update set release_id=excluded.release_id returning *",
        [owner, campaign.id, release.id, release.content],
      )
    ).rows[0];
    const items: C.CatalogJoinCommit["items"] = [];
    for (const selection of [...selections].sort((a, b) =>
      a.cardId.localeCompare(b.cardId),
    )) {
      const existing = (
        await tx.query(
          "select id from activity_participations where owner_user_id=$1 and campaign_id=$2 and card_id=$3 and activity_instance_key=$4",
          [owner, campaign.id, selection.cardId, release.activityInstanceKey],
        )
      ).rows[0];
      if (existing) {
        const p = await this.owned(tx, owner, existing.id);
        items.push({
          cardId: p.card_id,
          participationId: p.id,
          version: p.version,
          created: false,
          boundReleaseId: p.bound_release_id,
          trackingStatus: p.tracking_status,
        });
        continue;
      }
      const blocked = issues
        .get(selection.cardId)!
        .some((i) => i.severity === "blocks_execution");
      const today = new Intl.DateTimeFormat("sv-SE", {
        timeZone: release.content.periodTemplate.timezone ?? "Asia/Shanghai",
      }).format(new Date());
      const tracking = blocked
        ? "needs_review"
        : dateDay(release.content.start)! > today
          ? "planned"
          : "active";
      const inserted = (
        await tx.query(
          "insert into activity_participations(owner_user_id,card_id,campaign_id,rule_version_id,activity_instance_key,tracking_status,node_preferences) values($1,$2,$3,$4,$5,$6,$7) returning id",
          [
            owner,
            selection.cardId,
            campaign.id,
            rule.id,
            release.activityInstanceKey,
            tracking,
            JSON.stringify(selection.nodePreferences),
          ],
        )
      ).rows[0];
      const p = await this.owned(tx, owner, inserted.id);
      const c = release.content,
        pt = c.periodTemplate;
      const boundaries = selection.boundaries.length
        ? selection.boundaries
        : c.periodTemplate.periods.length
          ? c.periodTemplate.periods
              .filter((x) => x.start.kind === "date" && x.end.kind === "date")
              .map((x) => ({
                periodKey: x.periodKey,
                startOn: dateDay(x.start)!,
                endOn: dateDay(x.end)!,
                timezone: pt.timezone ?? "Asia/Shanghai",
              }))
          : pt.type === "month"
            ? months(dateDay(c.start)!, dateDay(c.end)!).map((b) => ({
                ...b,
                timezone: pt.timezone ?? "Asia/Shanghai",
              }))
            : pt.type === "once"
              ? [
                  {
                    periodKey: "once",
                    startOn: dateDay(c.start)!,
                    endOn: dateDay(c.end)!,
                    timezone: pt.timezone ?? "Asia/Shanghai",
                  },
                ]
              : [];
      if (
        new Set(boundaries.map((b) => b.periodKey)).size !== boundaries.length
      )
        throw new AppError("UNPROCESSABLE_ENTITY", "周期标识不能重复");
      if (boundaries.length > 24)
        throw new AppError(
          "UNPROCESSABLE_ENTITY",
          "该范围需要批量计划服务，当前加入上限为每卡 24 期",
          422,
          { reason: "BULK_PLAN_SERVICE_REQUIRED" },
        );
      for (const b of boundaries) {
        const target =
          pt.periods.find((x) => x.periodKey === b.periodKey)?.target ??
          pt.target;
        const period = (
          await tx.query(
            "insert into activity_periods(owner_user_id,card_id,participation_id,campaign_id,rule_version_id,period_key,start_on,end_on,timezone,target,executable) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id",
            [
              owner,
              p.card_id,
              p.id,
              p.campaign_id,
              p.rule_version_id,
              b.periodKey,
              b.startOn,
              b.endOn,
              b.timezone,
              target,
              !blocked && b.endOn >= today && tracking !== "needs_review",
            ],
          )
        ).rows[0];
        if (!blocked && b.endOn >= today) {
          const task = (
            await tx.query(
              "insert into spend_tasks(owner_user_id,card_id,participation_id,period_id) values($1,$2,$3,$4) returning id",
              [owner, p.card_id, p.id, period.id],
            )
          ).rows[0];
          await this.todos.upsert(tx, p, {
            key: `${p.id}:${period.id}:spend`,
            nodeKind: "spend_period",
            type: "spend_period",
            title: "核对周期刷卡目标 · " + b.periodKey,
            deadline: { kind: "date", value: b.endOn, timezone: b.timezone },
            primary: {
              kind: "progress",
              resourceId: task.id,
              participationId: p.id,
              label: "更新进度／核对达标",
              enabled: true,
            },
          });
        }
      }
      const periods = await this.periods(tx, p);
      for (const reward of c.rewards) {
        const scopes =
          reward.scope === "period"
            ? periods.map((period) => ({
                id: period.id,
                key: period.period_key,
              }))
            : [{ id: null, key: "overall" }];
        for (const scope of scopes) {
          const r = (
            await tx.query(
              "insert into activity_rewards(owner_user_id,card_id,participation_id,period_id,reward_key,template,campaign_id,rule_version_id) values($1,$2,$3,$4,$5,$6,$7,$8) returning id",
              [
                owner,
                p.card_id,
                p.id,
                scope.id,
                reward.rewardKey + ":" + scope.key,
                reward,
                p.campaign_id,
                p.rule_version_id,
              ],
            )
          ).rows[0];
          await this.todos.upsert(tx, p, {
            key: `${p.id}:${r.id}:claim`,
            nodeKind: "reward_claim",
            type: "reward_claim",
            title: "核对奖励条件／领取 · " + reward.name,
            deadline: reward.claimEnd,
            primary: {
              kind: "reward_conditions",
              resourceId: r.id,
              participationId: p.id,
              label: "查看奖励条件与领取记录",
              enabled: true,
            },
          });
        }
      }
      await this.todos.upsert(tx, p, {
        key: `${p.id}:eligibility`,
        nodeKind: "eligibility",
        type: "enrollment",
        title: blocked ? "核对未知规则与个人资格" : "核对个人资格及报名",
        deadline: unknown(),
        primary: {
          kind: "enrollment",
          resourceId: p.id,
          participationId: p.id,
          label: "核对资格和报名",
          enabled: true,
        },
      });
      await this.history(
        tx,
        p,
        "catalog.joined",
        "明确加入只代表跟踪，不确认银行报名或资格",
        {
          initialReleaseId: release.id,
          acknowledgedUnknownCodes: selection.acknowledgedUnknownCodes,
          boundaries: selection.boundaries,
        },
      );
      items.push({
        cardId: p.card_id,
        participationId: p.id,
        version: p.version,
        created: true,
        boundReleaseId: release.id,
        trackingStatus: tracking,
      });
    }
    return {
      items,
      impact: {
        ...privateImpact(items[0].participationId, release.catalogActivityId),
        participationIds: items.map((i) => i.participationId),
      },
    };
  }
}
