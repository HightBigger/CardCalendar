import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../../../db/schema";
import { createDrizzleRepositories } from "../../shared/db/repositories";
import { AppError } from "../../shared/errors";
import { CatalogRepository } from "../activity-catalog/repository";
import { contentHash } from "../activity-catalog/validation";
import { CatalogService } from "../activity-catalog/service";
import { PersonalCatalogService } from "../participation/catalog-import";
import type { Card } from "./domain";
export type ArchiveOptions = {
  rewardReminderPolicy?: "keep" | "stop";
  note?: string;
  idempotencyKey?: string;
};
export type ArchivedCard = Card & {
  rewardReminderPolicy: "continue" | "stop" | "needs_confirmation";
  invalidated: string[];
};
export function archiveOptions(raw: ArchiveOptions = {}) {
  if (
    raw.rewardReminderPolicy !== undefined &&
    !["keep", "stop"].includes(raw.rewardReminderPolicy)
  )
    throw new AppError(
      "VALIDATION_ERROR",
      "rewardReminderPolicy 仅支持 keep 或 stop",
    );
  if (
    raw.note !== undefined &&
    (typeof raw.note !== "string" || !raw.note.trim() || raw.note.length > 4000)
  )
    throw new AppError("VALIDATION_ERROR", "请提供有效归档说明");
  if (
    raw.idempotencyKey !== undefined &&
    (!raw.idempotencyKey || raw.idempotencyKey.length > 200)
  )
    throw new AppError("VALIDATION_ERROR", "无效的 Idempotency-Key");
  return {
    rewardReminderPolicy:
      raw.rewardReminderPolicy === "keep"
        ? ("continue" as const)
        : raw.rewardReminderPolicy === "stop"
          ? ("stop" as const)
          : ("needs_confirmation" as const),
    note: raw.note?.trim() ?? "归档卡片；停止新消费，保留历史及奖励核对",
  };
}
export async function archivePostgresCard(
  pool: Pool,
  owner: string,
  cardId: string,
  raw: ArchiveOptions = {},
): Promise<ArchivedCard> {
  const repository = new CatalogRepository(pool);
  return repository.transaction((tx) =>
    archivePostgresCardInTransaction(tx, repository, owner, cardId, raw),
  );
}
// Shared by the explicit archive command and the legacy metadata/status PATCH.
// The caller owns commit/rollback, including any card and annual-fee edits.
export async function archivePostgresCardInTransaction(
  tx: PoolClient,
  repository: CatalogRepository,
  owner: string,
  cardId: string,
  raw: ArchiveOptions = {},
): Promise<ArchivedCard> {
  const input = archiveOptions(raw);
  const user = await tx.query(
    "select id from users where id=$1 and status='active' and deleted_at is null for share",
    [owner],
  );
  if (!user.rowCount) throw new AppError("UNAUTHENTICATED", "账号不可用");
  const card = await tx.query(
    "select id from cards where id=$1 and user_id=$2 for update",
    [cardId, owner],
  );
  if (!card.rowCount) throw new AppError("NOT_FOUND", "卡片不存在");
  const catalog = !!(
    await tx.query("select to_regclass('activity_participations') as name")
  ).rows[0].name;
  const key = raw.idempotencyKey ?? randomUUID(),
    hash = contentHash(input);
  if (catalog) {
    const existing = (
      await tx.query(
        "select request_hash,result from card_archive_commands where owner_user_id=$1 and card_id=$2 and idempotency_key=$3",
        [owner, cardId, key],
      )
    ).rows[0];
    if (existing) {
      if (existing.request_hash !== hash)
        throw new AppError("CONFLICT", "同一请求键不能改变归档选择");
      return existing.result as ArchivedCard;
    }
  }
  await tx.query(
    "update cards set status='archived',archived_at=coalesce(archived_at,now()),updated_at=now() where id=$1",
    [cardId],
  );
  await tx.query(
    "update reminders set status='cancelled',snoozed_until=null,updated_at=now() where user_id=$1 and card_id=$2 and status in ('pending','snoozed')",
    [owner, cardId],
  );
  if (catalog) {
    const personal = new PersonalCatalogService(
      new CatalogService(repository),
    );
    const ids = (
      await tx.query(
        "select id from activity_participations where owner_user_id=$1 and card_id=$2 order by id for update",
        [owner, cardId],
      )
    ).rows;
    for (const { id } of ids) {
      const p = await personal.owned(tx, owner, id);
      p.version = (
        await tx.query(
          "update activity_participations set reward_reminder_policy=$2,version=version+1 where id=$1 returning version",
          [id, input.rewardReminderPolicy],
        )
      ).rows[0].version;
      await tx.query(
        "update activity_periods set stopped=true,version=version+1 where participation_id=$1 and not stopped",
        [id],
      );
      await tx.query(
        "update spend_tasks set version=version+1 where participation_id=$1",
        [id],
      );
      const actions = (
        await tx.query(
          "select action_key,primary_action from todo_actions where participation_id=$1 and node_kind='spend_period' and status='pending' order by id",
          [id],
        )
      ).rows;
      for (const action of actions)
        await personal.todos.businessState(
          tx,
          p,
          action.action_key,
          "cancelled",
          input.note,
          { ...action.primary_action, enabled: false },
        );
      if (input.rewardReminderPolicy !== "continue")
        await tx.query(
          "update todo_notification_schedules s set status='cancelled' from todo_actions t where s.action_id=t.id and t.participation_id=$1 and t.node_kind like 'reward_%' and s.status='pending'",
          [id],
        );
      else
        await tx.query(
          `insert into todo_notification_schedules(owner_user_id,action_id,action_version,days_before,deadline)
        select t.owner_user_id,t.id,t.version,days.value::int,t.deadline
        from todo_actions t join activity_participations p on p.id=t.participation_id
        cross join lateral jsonb_array_elements(p.node_preferences) pref
        cross join lateral jsonb_array_elements_text(pref->'notifyDaysBefore') days
        where t.participation_id=$1 and t.node_kind like 'reward_%' and t.status='pending'
          and t.deadline->>'kind'<>'unknown' and pref->>'nodeKind'=t.node_kind
        on conflict(action_id,action_version,days_before) do update set status='pending'
        where todo_notification_schedules.status='cancelled' and not exists(select 1 from todo_notifications n where n.schedule_id=todo_notification_schedules.id)`,
          [id],
        );
      await personal.history(tx, p, "card.archived", input.note, {
        cardId,
        rewardReminderPolicy: input.rewardReminderPolicy,
      });
    }
  }
  const result: ArchivedCard = {
    ...(await createDrizzleRepositories(drizzle(tx, { schema })).cards.get(
      owner,
      cardId,
    ))!,
    rewardReminderPolicy: input.rewardReminderPolicy,
    invalidated: [
      "cards",
      "annual-fees",
      "activities",
      "spend-tasks",
      "rewards",
      "todos",
      "notifications",
    ],
  };
  await tx.query(
    "insert into audit_logs(user_id,actor_type,actor_id,action,entity_type,entity_id,metadata) values($1,'user',$1,'card.archived','card',$2,$3)",
    [owner, cardId, input],
  );
  if (catalog)
    await tx.query(
      "insert into card_archive_commands(owner_user_id,card_id,idempotency_key,request_hash,result) values($1,$2,$3,$4,$5)",
      [owner, cardId, key, hash, result],
    );
  return result;
}
