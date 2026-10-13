import type { PoolClient } from "pg";
import type * as C from "../../contracts/activity-catalog";
import type { PersonalCatalogService } from "./catalog-import";
import { dateDay } from "../activity-catalog/validation";
import { privateImpact, months } from "./catalog-import";
import { conflict } from "../activity-catalog/service";
import { AppError } from "../../shared/errors";
export type CatalogSystemEvent = {
  id: string;
  aggregate_id: string;
  sequence: number;
  event_type: string;
  payload: { releaseId?: string };
};
// Public personal-domain ports, sharing the caller's UnitOfWork. Catalog workflows
// do not write private facts or read another member on behalf of an administrator.
export class PersonalCatalogLifecycle {
  constructor(readonly personal: PersonalCatalogService) {}
  async adoptOwnedRelease(
    tx: PoolClient,
    owner: string,
    id: string,
    target: C.CatalogRelease,
    input: C.AdoptCatalogReleaseInput,
  ) {
    const p = await this.personal.owned(tx, owner, id, true);
    if (p.version !== input.expectedVersion) conflict();
    if (p.card_status !== "active" && input.affectedFuturePeriodIds.length)
      throw new AppError(
        "UNPROCESSABLE_ENTITY",
        "归档或停用卡片不能生成新的未来消费计划；历史与奖励仍保留",
      );
    const periods = await this.personal.periods(tx, p, true),
      today = new Intl.DateTimeFormat("sv-SE", {
        timeZone: target.content.periodTemplate.timezone ?? "Asia/Shanghai",
      }).format(new Date());
    if (
      new Set(input.currentPeriodDecisions.map((d) => d.periodId)).size !==
      input.currentPeriodDecisions.length
    )
      throw new AppError("VALIDATION_ERROR", "当前期决定不能重复");
    const futureIds = new Set(input.affectedFuturePeriodIds);
    if (futureIds.size !== input.affectedFuturePeriodIds.length)
      throw new AppError("VALIDATION_ERROR", "周期选择不能重复");
    for (const futureId of futureIds) {
      const period = periods.find((x) => x.id === futureId);
      if (!period) throw new AppError("NOT_FOUND", "无法访问选择的周期");
      if (period.start_on <= today || period.qualification !== "unknown")
        throw new AppError(
          "UNPROCESSABLE_ENTITY",
          "已启动或已确认的周期不能作为未来范围改写",
        );
      const facts = await tx.query(
        "select 1 from catalog_spend_observations o join spend_tasks t on t.id=o.task_id where t.period_id=$1",
        [futureId],
      );
      if (facts.rowCount)
        throw new AppError(
          "UNPROCESSABLE_ENTITY",
          "有消费或观察事实的周期必须保留规则",
        );
    }
    const futureBoundaries = new Map<
      string,
      { startOn: string; endOn: string; timezone: string }
    >();
    for (const period of periods.filter((x) => futureIds.has(x.id))) {
      const template = target.content.periodTemplate.periods.find(
        (x) => x.periodKey === period.period_key,
      );
      const automatic =
        target.content.periodTemplate.type === "month"
          ? months(
              dateDay(target.content.start)!,
              dateDay(target.content.end)!,
            ).find((x) => x.periodKey === period.period_key)
          : null;
      const next =
        template &&
        template.start.kind === "date" &&
        template.end.kind === "date"
          ? {
              startOn: template.start.value,
              endOn: template.end.value,
              timezone: template.start.timezone,
            }
          : automatic
            ? {
                startOn: automatic.startOn,
                endOn: automatic.endOn,
                timezone:
                  target.content.periodTemplate.timezone ?? period.timezone,
              }
            : {
                startOn: period.start_on,
                endOn: period.end_on,
                timezone: period.timezone,
              };
      if (
        next.startOn <= today ||
        next.startOn > next.endOn ||
        next.startOn < dateDay(target.content.start)! ||
        next.endOn > dateDay(target.content.end)!
      )
        throw new AppError(
          "UNPROCESSABLE_ENTITY",
          "新版周期边界与所选未来范围不兼容，请缩小采用范围或先核对私人计划",
        );
      futureBoundaries.set(period.id, next);
    }
    const spans = periods
      .map((period) => ({
        id: period.id,
        start: futureBoundaries.get(period.id)?.startOn ?? period.start_on,
        end: futureBoundaries.get(period.id)?.endOn ?? period.end_on,
      }))
      .sort((a, b) => a.start.localeCompare(b.start));
    for (let i = 1; i < spans.length; i++)
      if (spans[i].start <= spans[i - 1].end)
        throw new AppError(
          "UNPROCESSABLE_ENTITY",
          "采用后的周期边界发生重叠，未修改任何私人记录",
        );
    for (const decision of input.currentPeriodDecisions) {
      const period = periods.find((x) => x.id === decision.periodId);
      if (!period) throw new AppError("NOT_FOUND", "无法访问当前周期");
      if (period.version !== decision.expectedVersion) conflict();
      if (!(period.start_on <= today && period.end_on >= today))
        throw new AppError(
          "UNPROCESSABLE_ENTITY",
          "当前期决定必须引用当前周期",
        );
    }
    for (const period of periods.filter(
      (x) => x.start_on <= today && x.end_on >= today,
    ))
      if (!input.currentPeriodDecisions.some((x) => x.periodId === period.id))
        throw new AppError(
          "UNPROCESSABLE_ENTITY",
          "请明确选择当前周期保留冻结规则或追加待核对修订",
          422,
          { reason: "PERIOD_REVISION_REQUIRED" },
        );
    const rule = (
      await tx.query(
        "insert into private_rule_versions(owner_user_id,campaign_id,release_id,content) values($1,$2,$3,$4) on conflict(campaign_id,release_id) do update set release_id=excluded.release_id returning id",
        [p.owner_user_id, p.campaign_id, target.id, target.content],
      )
    ).rows[0];
    const updated = (
      await tx.query(
        "update activity_participations set rule_version_id=$2,version=version+1 where id=$1 returning version",
        [p.id, rule.id],
      )
    ).rows[0];
    p.version = updated.version;
    for (const period of periods.filter((x) => futureIds.has(x.id))) {
      const boundary = futureBoundaries.get(period.id)!;
      const targetRule =
        target.content.periodTemplate.periods.find(
          (x) => x.periodKey === period.period_key,
        )?.target ?? target.content.periodTemplate.target;
      const issues = await this.personal.joinIssues(
        tx,
        target,
        {
          cardId: p.card_id,
          acknowledgedUnknownCodes: [],
          boundaries: [
            {
              periodKey: period.period_key,
              startOn: boundary.startOn,
              endOn: boundary.endOn,
              timezone: boundary.timezone,
            },
          ],
          nodePreferences: p.node_preferences,
        },
        (
          await tx.query(
            "select bank_id from cards where id=$1 and user_id=$2",
            [p.card_id, p.owner_user_id],
          )
        ).rows[0].bank_id,
      );
      const executable = !issues.some((i) => i.severity === "blocks_execution");
      await tx.query(
        "update activity_periods set rule_version_id=$2,target=$3,executable=$4,start_on=$5,end_on=$6,timezone=$7,version=version+1 where id=$1",
        [
          period.id,
          rule.id,
          targetRule,
          executable,
          boundary.startOn,
          boundary.endOn,
          boundary.timezone,
        ],
      );
      let task = (
        await tx.query("select id from spend_tasks where period_id=$1", [
          period.id,
        ])
      ).rows[0];
      if (!task && executable)
        task = (
          await tx.query(
            "insert into spend_tasks(owner_user_id,card_id,participation_id,period_id) values($1,$2,$3,$4) returning id",
            [p.owner_user_id, p.card_id, p.id, period.id],
          )
        ).rows[0];
      if (task)
        await this.personal.todos.upsert(
          tx,
          p,
          {
            key: `${p.id}:${period.id}:spend`,
            nodeKind: "spend_period",
            type: "spend_period",
            title: "核对周期刷卡目标 · " + period.period_key,
            deadline: {
              kind: "date",
              value: boundary.endOn,
              timezone: boundary.timezone,
            },
            primary: {
              kind: "progress",
              resourceId: task.id,
              participationId: p.id,
              label: "更新进度／核对达标",
              enabled: executable,
            },
          },
          true,
        );
    }
    for (const period of periods.filter((x) => futureIds.has(x.id))) {
      const rewards = (
        await tx.query(
          "select * from activity_rewards where participation_id=$1 and owner_user_id=$2 and period_id=$3 order by id for update",
          [p.id, p.owner_user_id, period.id],
        )
      ).rows;
      for (const reward of rewards) {
        const facts = await tx.query(
          "select 1 from activity_reward_events where reward_id=$1",
          [reward.id],
        );
        if (
          facts.rowCount ||
          reward.claim_status !== "not_submitted" ||
          reward.receipt_status !== "not_received"
        )
          continue;
        const template = target.content.rewards.find(
          (r) =>
            r.rewardKey ===
              (reward.template as C.CatalogRewardTemplate).rewardKey &&
            r.scope === "period",
        );
        if (!template) continue;
        await tx.query(
          "update activity_rewards set template=$2,rule_version_id=$3,version=version+1 where id=$1",
          [reward.id, template, rule.id],
        );
        await this.personal.todos.upsert(
          tx,
          p,
          {
            key: `${p.id}:${reward.id}:claim`,
            nodeKind: "reward_claim",
            type: "reward_claim",
            title: "核对奖励条件／领取 · " + template.name,
            deadline: template.claimEnd,
            primary: {
              kind: "reward_conditions",
              resourceId: reward.id,
              participationId: p.id,
              label: "查看奖励条件与领取记录",
              enabled: true,
            },
          },
          true,
        );
      }
    }
    for (const d of input.currentPeriodDecisions) {
      const period = periods.find((x) => x.id === d.periodId)!;
      await tx.query(
        "insert into activity_period_revisions(owner_user_id,card_id,participation_id,period_id,old_rule_version_id,new_rule_version_id,decision,note,campaign_id) values($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [
          p.owner_user_id,
          p.card_id,
          p.id,
          period.id,
          period.rule_version_id,
          rule.id,
          d.decision,
          d.note,
          p.campaign_id,
        ],
      );
      if (d.decision === "create_review_revision")
        await this.personal.todos.upsert(tx, p, {
          key: `${p.id}:${target.id}:${period.id}:revision`,
          nodeKind: "review",
          type: "enrollment",
          title: "核对当前期规则修订（原消费及目标保留）",
          deadline: { kind: "unknown", reason: "修订需要成员核对" },
          primary: {
            kind: "detail",
            resourceId: p.id,
            participationId: p.id,
            label: "查看原规则与修订",
            enabled: true,
          },
        });
    }
    await tx.query(
      "update todo_actions set status='completed',version=version+1 where owner_user_id=$1 and action_key=$2 and status='pending'",
      [p.owner_user_id, `${p.id}:${target.id}:catalog_update`],
    );
    await tx.query(
      "update todo_notification_schedules s set status='cancelled' from todo_actions t where s.action_id=t.id and t.owner_user_id=$1 and t.action_key=$2 and s.status='pending'",
      [p.owner_user_id, `${p.id}:${target.id}:catalog_update`],
    );
    await this.personal.history(tx, p, "catalog.adopted", input.note, {
      oldReleaseId: p.bound_release_id,
      targetReleaseId: target.id,
      affectedFuturePeriodIds: input.affectedFuturePeriodIds,
      currentPeriodDecisions: input.currentPeriodDecisions,
    });
    return {
      participationId: p.id,
      version: p.version,
      boundReleaseId: target.id,
      impact: privateImpact(p.id, p.catalog_activity_id),
    };
  }
  async decideOwnedTracking(
    tx: PoolClient,
    owner: string,
    id: string,
    input: C.DecideCatalogTrackingInput,
  ) {
    const p = await this.personal.owned(tx, owner, id, true);
    if (p.version !== input.expectedVersion) conflict();
    const today = new Intl.DateTimeFormat("sv-SE", {
      timeZone: p.content.periodTemplate.timezone ?? "Asia/Shanghai",
    }).format(new Date());
    const result = (
      await tx.query(
        "update activity_participations set version=version+1,tracking_decision=$2,reward_reminder_policy=$3 where id=$1 returning version",
        [p.id, input.decision, input.rewardReminderPolicy],
      )
    ).rows[0];
    p.version = result.version;
    await tx.query(
      "update todo_actions set status='completed',version=version+1 where owner_user_id=$1 and action_key=$2 and status='pending'",
      [p.owner_user_id, `${p.id}:${input.noticeId}:catalog_withdrawn`],
    );
    if (input.decision === "stop_future") {
      await tx.query(
        "update activity_periods set stopped=true,version=version+1 where participation_id=$1 and start_on>$2",
        [p.id, today],
      );
      await this.personal.todos.cancelSpendActions(tx, p, today);
    } else {
      await this.personal.todos.restoreFutureSpendActions(tx, p, today);
      await tx.query(
        "update activity_periods set stopped=false,version=version+1 where participation_id=$1 and start_on>$2",
        [p.id, today],
      );
      const periods = await this.personal.periods(tx, p);
      for (const period of periods.filter(
        (x) => x.start_on > today && x.executable,
      )) {
        const task = (
          await tx.query("select id from spend_tasks where period_id=$1", [
            period.id,
          ])
        ).rows[0];
        if (task)
          await this.personal.todos.upsert(
            tx,
            p,
            {
              key: `${p.id}:${period.id}:spend`,
              nodeKind: "spend_period",
              type: "spend_period",
              title: "核对周期刷卡目标 · " + period.period_key,
              deadline: {
                kind: "date",
                value: period.end_on,
                timezone: period.timezone,
              },
              primary: {
                kind: "progress",
                resourceId: task.id,
                participationId: p.id,
                label: "更新进度／核对达标",
                enabled: true,
              },
            },
            true,
          );
      }
    }
    if (input.rewardReminderPolicy !== "continue")
      await tx.query(
        "update todo_notification_schedules s set status='cancelled' from todo_actions t where s.action_id=t.id and t.participation_id=$1 and t.node_kind like 'reward_%' and s.status='pending'",
        [p.id],
      );
    await this.personal.history(
      tx,
      p,
      "catalog.tracking_decided",
      input.note,
      input,
    );
    return {
      participationId: p.id,
      version: p.version,
      boundReleaseId: p.bound_release_id,
      impact: privateImpact(p.id, p.catalog_activity_id),
    };
  }
  async consumeDirectoryEvent(
    tx: PoolClient,
    event: CatalogSystemEvent,
    current: {
      publicationStatus: C.CatalogPublicationStatus;
      version: number;
      latestReleaseId: string | null;
      bankCancelled: boolean;
      withdrawalNoticeId: string | null;
    },
  ) {
    const candidates = (
      await tx.query(
        "select p.id,p.owner_user_id from activity_participations p join private_campaigns c on c.id=p.campaign_id and c.owner_user_id=p.owner_user_id join users u on u.id=p.owner_user_id where c.catalog_activity_id=$1 and u.status='active' and not exists(select 1 from catalog_inbox i where i.event_id=$2 and i.participation_id=p.id) order by p.id limit 100",
        [event.aggregate_id, event.id],
      )
    ).rows;
    let handled = 0;
    for (const candidate of candidates) {
      const active = await tx.query(
        "select id from users where id=$1 and status='active' for share",
        [candidate.owner_user_id],
      );
      if (!active.rowCount) continue;
      const p = await this.personal.owned(
        tx,
        candidate.owner_user_id,
        candidate.id,
        true,
      );
      const inserted = await tx.query(
        "insert into catalog_inbox(event_id,participation_id) values($1,$2) on conflict do nothing returning event_id",
        [event.id, p.id],
      );
      if (!inserted.rowCount) continue;
      if (
        event.event_type === "CatalogReleasePublished.v1" &&
        current.latestReleaseId === event.payload.releaseId &&
        p.bound_release_id !== event.payload.releaseId
      )
        await this.personal.todos.upsert(tx, p, {
          key: `${p.id}:${event.payload.releaseId}:catalog_update`,
          nodeKind: "catalog_review",
          type: "enrollment",
          title: "银行活动规则有更新，请核对是否采用",
          deadline: { kind: "unknown", reason: "成员自行核对" },
          primary: {
            kind: "detail",
            resourceId: p.id,
            participationId: p.id,
            label: "查看规则差异",
            enabled: true,
          },
        });
      if (
        event.event_type === "CatalogWithdrawn.v1" &&
        current.publicationStatus === "withdrawn" &&
        current.withdrawalNoticeId === event.id
      ) {
        await tx.query(
          "update activity_participations set tracking_decision='needs_confirmation',version=version+1 where id=$1",
          [p.id],
        );
        await this.personal.todos.upsert(tx, p, {
          key: `${p.id}:${event.id}:catalog_withdrawn`,
          nodeKind: "catalog_review",
          type: "enrollment",
          title: "活动目录已下架，请选择继续或停止未来跟踪",
          deadline: { kind: "unknown", reason: "下架不表示银行取消" },
          primary: {
            kind: "detail",
            resourceId: p.id,
            participationId: p.id,
            label: "查看下架原因和历史",
            enabled: true,
          },
        });
      }
      if (current.bankCancelled) {
        await tx.query(
          "update activity_periods set executable=false,stopped=true where participation_id=$1",
          [p.id],
        );
        await this.personal.todos.cancelSpendActions(tx, p);
      }
      handled++;
    }
    return { handled, complete: candidates.length < 100 };
  }
}
