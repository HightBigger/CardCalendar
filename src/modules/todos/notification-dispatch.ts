import type { CatalogRepository } from "../activity-catalog/repository";
// The same action/version fence drives every notification node. Unknown dates are
// never scheduled; current account/card/participation/source are checked at delivery.
export async function dispatchTodoNotifications(
  repository: CatalogRepository,
  limit = 100,
) {
  return repository.transaction(async (tx) => {
    const now = (await tx.query("select now() as now")).rows[0].now as Date;
    const selection = `select s.*,coalesce(t.card_id,n.card_id) as card_id,coalesce(t.participation_id,n.participation_id) as participation_id,
          t.status as action_status,coalesce(t.version,n.version) as current_version,coalesce(t.title,n.title) as title,
          coalesce(t.node_kind,n.node_kind) as node_kind,coalesce(t.deadline,n.date_value) as current_deadline,
          t.snoozed_until as action_snoozed_until,c.status as card_status,u.status as user_status,
          p.tracking_decision,p.reward_reminder_policy,a.current_release_id,
          timing.due_at,timing.expires_at,timing.snoozed_until_at
        from todo_notification_schedules s
        left join todo_actions t on t.id=s.action_id and t.owner_user_id=s.owner_user_id
        left join business_date_nodes n on n.id=s.node_id and n.owner_user_id=s.owner_user_id
        left join cards c on c.id=coalesce(t.card_id,n.card_id) and c.user_id=s.owner_user_id
        join users u on u.id=s.owner_user_id
        left join activity_participations p on p.id=coalesce(t.participation_id,n.participation_id) and p.owner_user_id=s.owner_user_id
        left join private_campaigns pc on pc.id=p.campaign_id and pc.owner_user_id=p.owner_user_id
        left join catalog_activities a on a.id=pc.catalog_activity_id
        cross join lateral (select coalesce(coalesce(t.deadline,n.date_value)->>'timezone','Asia/Shanghai') as tz) zone
        cross join lateral (select
          case coalesce(t.deadline,n.date_value)->>'kind'
            when 'date' then ((coalesce(t.deadline,n.date_value)->>'value')::date-s.days_before)::timestamp at time zone zone.tz
            when 'instant' then (((coalesce(t.deadline,n.date_value)->>'value')::timestamptz at time zone zone.tz)-s.days_before*interval '1 day') at time zone zone.tz
          end as due_at,
          case coalesce(t.deadline,n.date_value)->>'kind'
            when 'date' then ((coalesce(t.deadline,n.date_value)->>'value')::date+1)::timestamp at time zone zone.tz
            when 'instant' then (coalesce(t.deadline,n.date_value)->>'value')::timestamptz
          end as expires_at,
          case coalesce(t.snoozed_until,'{"kind":"unknown"}'::jsonb)->>'kind'
            when 'date' then (t.snoozed_until->>'value')::date::timestamp at time zone coalesce(t.snoozed_until->>'timezone',zone.tz)
            when 'instant' then (t.snoozed_until->>'value')::timestamptz
          end as snoozed_until_at
        ) timing
        where s.status='pending' and (
          coalesce(t.status,'pending')<>'pending' or s.action_version<>coalesce(t.version,n.version) or u.status<>'active'
          or (c.status is not null and c.status<>'active' and not (c.status='archived' and coalesce(t.node_kind,n.node_kind) like 'reward_%' and p.reward_reminder_policy='continue'))
          or coalesce(t.deadline,n.date_value)->>'kind'='unknown' or (timing.due_at<=now() and
            (timing.snoozed_until_at is null or timing.snoozed_until_at<=now() or timing.expires_at<=now()))
        )`;
    const rows = (
      await tx.query(
        selection +
          ` order by timing.due_at nulls first,s.action_id,s.days_before,s.id limit $1`,
        [limit],
      )
    ).rows;
    let delivered = 0,
      cancelled = 0;
    for (const candidate of rows) {
      // Same user -> card -> participation -> action lock order as fact/archive commands.
      // Re-read after locking: an archive/confirmation that won the race must fence delivery.
      await tx.query("select id from users where id=$1 for share", [
        candidate.owner_user_id,
      ]);
      await tx.query(
        "select id from cards where id=$1 and user_id=$2 for share",
        [candidate.card_id, candidate.owner_user_id],
      );
      if (candidate.participation_id)
        await tx.query(
          "select id from activity_participations where id=$1 and owner_user_id=$2 for share",
          [candidate.participation_id, candidate.owner_user_id],
        );
      const s = (
        await tx.query(
          selection + " and s.id=$1 for update of s skip locked",
          [candidate.id],
        )
      ).rows[0];
      if (!s) continue;
      let bankCancelled = false;
      if (s.current_release_id)
        bankCancelled = !!(
          await tx.query(
            "select content->'bankCancellation' <> 'null'::jsonb as cancelled from catalog_releases where id=$1",
            [s.current_release_id],
          )
        ).rows[0]?.cancelled;
      const invalid =
        (s.action_status && s.action_status !== "pending") ||
        s.action_version !== s.current_version ||
        (s.card_status !== null && s.card_status !== "active" &&
          !(
            s.card_status === "archived" &&
            s.node_kind.startsWith("reward_") &&
            s.reward_reminder_policy === "continue"
          )) ||
        s.user_status !== "active" ||
        (s.node_kind === "spend_period" && s.participation_id &&
          (s.tracking_decision === "stop_future" || bankCancelled)) ||
        (s.node_kind.startsWith("reward_") && s.participation_id &&
          s.reward_reminder_policy !== "continue");
      if (invalid) {
        await tx.query(
          "update todo_notification_schedules set status='cancelled' where id=$1",
          [s.id],
        );
        cancelled++;
        continue;
      }
      const d = s.current_deadline as {
        kind: string;
        value?: string;
        timezone?: string;
      };
      if (d.kind === "unknown") {
        await tx.query(
          "update todo_notification_schedules set status='cancelled' where id=$1",
          [s.id],
        );
        cancelled++;
        continue;
      }
      if (s.expires_at <= now) {
        await tx.query(
          "update todo_notification_schedules set status='cancelled' where id=$1",
          [s.id],
        );
        cancelled++;
        continue;
      }
      if (s.due_at > now || s.snoozed_until_at > now) continue;
      // If multiple reminder dates passed during downtime, deliver only the nearest
      // node in this repair pass and cancel missed earlier nodes for this action version.
      const earlier = (
        await tx.query(
          `select min(days_before)::int as n from todo_notification_schedules
          where (action_id=$1 or node_id=$2) and action_version=$3 and status='pending' and
          (case $4::text
            when 'date' then (($5::date-days_before)::timestamp at time zone $6)
            when 'instant' then (($5::timestamptz at time zone $6)-days_before*interval '1 day') at time zone $6
          end)<=now()`,
          [
            s.action_id,
            s.node_id,
            s.action_version,
            d.kind,
            d.value,
            d.timezone ?? "Asia/Shanghai",
          ],
        )
      ).rows[0].n;
      if (earlier !== s.days_before) continue;
      await tx.query(
        "insert into todo_notifications(owner_user_id,action_id,node_id,schedule_id,title) values($1,$2,$3,$4,$5) on conflict(schedule_id) do nothing",
        [s.owner_user_id, s.action_id, s.node_id, s.id, s.title],
      );
      await tx.query(
        "update todo_notification_schedules set status=case when id=$3 then 'delivered' else 'cancelled' end where (($1::uuid is not null and action_id=$1::uuid) or ($2::uuid is not null and node_id=$2::uuid)) and action_version=$4 and status='pending' and days_before >= $5",
        [s.action_id, s.node_id, s.id, s.action_version, s.days_before],
      );
      delivered++;
    }
    return { delivered, cancelled };
  });
}
