import { projectActivityNode, scheduleNode, activityMarkers } from "./date-nodes";
import type { PoolClient } from "pg";
import { isDeepStrictEqual } from "node:util";
import { commandHash } from "../../shared/db/command-hash";
import type {
  TodoAction,
  TodoCommand,
  TodoFilters,
  TodoGroupKey,
} from "../../contracts/todos";
import type { DateValue, PrimaryAction } from "../../contracts/workbench";
import type { PrivateParticipation } from "../participation/catalog-import";
import { dateDay } from "../activity-catalog/validation";
import { AppError } from "../../shared/errors";
const unknown = (): DateValue => ({ kind: "unknown", reason: "未设置" });
const displayDay = (value: DateValue, timezone: string) =>
  value.kind === "instant"
    ? new Intl.DateTimeFormat("sv-SE", { timeZone: timezone }).format(
        new Date(value.value),
      )
    : dateDay(value);
export type ActionRow = {
  id: string;
  owner_user_id: string;
  card_id: string | null;
  participation_id: string | null;
  version: number;
  title: string;
  type: TodoAction["type"];
  node_kind: string;
  action_key: string;
  status: TodoAction["status"];
  deadline: DateValue;
  planned_for: DateValue;
  snoozed_until: DateValue;
  show_in_calendar: boolean;
  create_todo: boolean;
  primary_action: PrimaryAction;
  source_version: number;
  history: TodoAction["history"];
  card: TodoAction["card"];
  description?: string;
  priority?: TodoAction["priority"];
  created_at?: Date;
  activity_name?: string;
};
export class TodoService {
  async upsert(
    tx: PoolClient,
    p: PrivateParticipation,
    node: {
      key: string;
      nodeKind: string;
      type: TodoAction["type"];
      title: string;
      deadline: DateValue;
      primary: PrimaryAction;
    },
    revise = false,
  ) {
    const preference = p.node_preferences.find(
      (n) => n.nodeKind === node.nodeKind,
    );
    const supportsNodes=!!(await tx.query("select to_regclass('business_date_nodes') as name")).rows[0].name;
    const projected=supportsNodes?await projectActivityNode(tx,p,node):undefined;
    const existing=(await tx.query("select id from todo_actions where owner_user_id=$1 and action_key=$2",[p.owner_user_id,node.key])).rows[0];
    if(projected && !existing && (p.source_kind === "manual" && preference?.createTodo === false || ["activity_start","activity_end","reward_claim_start"].includes(node.nodeKind))) {
      await scheduleNode(tx,p,projected.node);
      return;
    }
    const r = await tx.query<ActionRow>(
      `insert into todo_actions(owner_user_id,card_id,participation_id,action_key,title,type,node_kind,deadline,planned_for,snoozed_until,primary_action,source_version,show_in_calendar,create_todo) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$10,$11,$12,$13) on conflict(owner_user_id,action_key) ${revise ? "do update set deadline=excluded.deadline,title=excluded.title,source_version=excluded.source_version,version=todo_actions.version+1 where todo_actions.status='pending'" : "do nothing"} returning *`,
      [
        p.owner_user_id,
        p.card_id,
        p.id,
        node.key,
        node.title,
        node.type,
        node.nodeKind,
        node.deadline,
        unknown(),
        node.primary,
        p.version,
        preference?.showInCalendar ?? true,
        preference?.createTodo ?? true,
      ],
    );
    const action=r.rows[0]??(await tx.query<ActionRow>("select * from todo_actions where owner_user_id=$1 and action_key=$2",[p.owner_user_id,node.key])).rows[0];
    if(!action) return;
    if(projected) {
      await tx.query("update todo_actions set node_id=$2,show_in_calendar=$3,create_todo=$4 where id=$1",[action.id,projected.node.id,preference?.showInCalendar??true,preference?.createTodo??true]);
      await scheduleNode(tx,p,projected.node,action);
      return;
    }
    if (revise)
      await tx.query(
        "update todo_notification_schedules set status='cancelled' where action_id=$1 and status='pending'",
        [action.id],
      );
    if (
      node.deadline.kind !== "unknown" &&
      (!node.nodeKind.startsWith("reward_") ||
        p.reward_reminder_policy === "continue")
    )
      for (const days of preference?.notifyDaysBefore ?? [])
        await tx.query(
          "insert into todo_notification_schedules(owner_user_id,action_id,action_version,days_before,deadline) values($1,$2,$3,$4,$5) on conflict do nothing",
          [p.owner_user_id, action.id, action.version, days, node.deadline],
        );
  }
  async businessState(
    tx: PoolClient,
    p: PrivateParticipation,
    key: string,
    status: TodoAction["status"],
    note: string,
    primary?: PrimaryAction,
    title?: string,
    allowNotify = true,
  ) {
    const row = (
      await tx.query<ActionRow>(
        "select * from todo_actions where owner_user_id=$1 and action_key=$2 for update",
        [p.owner_user_id, key],
      )
    ).rows[0];
    if (!row) return;
    // Manual dismissal is independent of bank facts. Metadata projections and
    // automatic closures must not erase it; only an explicit restore clears it.
    const manual = [...row.history].reverse().find((event) =>
      ["complete", "ignore", "restore"].includes(event.command),
    );
    const nextStatus =
      status === "pending" && manual?.command === "complete"
        ? "completed"
        : status === "pending" && manual?.command === "ignore"
          ? "ignored"
          : status;
    const nextPrimary = primary ?? row.primary_action;
    const changed =
      row.status !== nextStatus ||
      row.title !== (title ?? row.title) ||
      !isDeepStrictEqual(row.primary_action, nextPrimary);
    if (changed) {
      const history = [
        {
          id: crypto.randomUUID(),
          command: "business_projection",
          occurredAt: new Date().toISOString(),
          actor: p.owner_user_id,
          note,
          from: row.status,
          to: nextStatus,
        },
      ];
      await tx.query(
        "update todo_actions set status=$2,version=version+1,title=$3,primary_action=$4,source_version=$5,history=history||$6::jsonb where id=$1",
        [
          row.id,
          nextStatus,
          title ?? row.title,
          nextPrimary,
          p.version,
          JSON.stringify(history),
        ],
      );
    }
    if (changed || nextStatus !== "pending" || !allowNotify) {
      await tx.query(
        "update todo_notification_schedules set status='cancelled' where action_id=$1 and status='pending'",
        [row.id],
      );
      if (
        nextStatus === "pending" &&
        allowNotify &&
        row.deadline.kind !== "unknown"
      )
        for (const days of p.node_preferences.find(
          (n) => n.nodeKind === row.node_kind,
        )?.notifyDaysBefore ?? [])
          await tx.query(
            "insert into todo_notification_schedules(owner_user_id,action_id,action_version,days_before,deadline) values($1,$2,$3,$4,$5) on conflict do nothing",
            [
              p.owner_user_id,
              row.id,
              row.version + (changed ? 1 : 0),
              days,
              row.deadline,
            ],
          );
    }
  }
  async cancelSpendActions(
    tx: PoolClient,
    p: PrivateParticipation,
    futureAfter?: string,
  ) {
    const history = [
      {
        id: crypto.randomUUID(),
        command: "source_stopped",
        occurredAt: new Date().toISOString(),
        actor: p.owner_user_id,
        note: futureAfter ? "成员停止未来跟踪" : "银行官方确认取消",
      },
    ];
    await tx.query(
      "update todo_actions t set status='cancelled',version=version+1,history=history||$3::jsonb where t.owner_user_id=$1 and t.participation_id=$2 and t.node_kind='spend_period' and t.status='pending' and ($4::date is null or exists(select 1 from activity_periods ap where ap.participation_id=t.participation_id and ap.start_on>$4::date and t.action_key=ap.participation_id::text||':'||ap.id::text||':spend'))",
      [p.owner_user_id, p.id, JSON.stringify(history), futureAfter ?? null],
    );
    await tx.query(
      "update todo_notification_schedules s set status='cancelled' from todo_actions t where s.action_id=t.id and t.owner_user_id=$1 and t.participation_id=$2 and t.node_kind='spend_period' and t.status='cancelled' and s.status='pending'",
      [p.owner_user_id, p.id],
    );
  }
  async restoreFutureSpendActions(
    tx: PoolClient,
    p: PrivateParticipation,
    today: string,
  ) {
    await tx.query(
      "update todo_actions t set status='pending',version=version+1 where t.owner_user_id=$1 and t.participation_id=$2 and t.node_kind='spend_period' and t.status='cancelled' and exists(select 1 from activity_periods ap where ap.participation_id=t.participation_id and ap.start_on>$3 and t.action_key=ap.participation_id::text||':'||ap.id::text||':spend')",
      [p.owner_user_id, p.id, today],
    );
  }
  async rows(tx: PoolClient, owner: string): Promise<ActionRow[]> {
    return (
      await tx.query(
        "select t.*,r.content->>'name' as activity_name,case when c.id is null then null else jsonb_build_object('id',c.id,'bank',c.issuer_name,'name',c.name,'last4',c.last4) end as card from todo_actions t left join cards c on c.id=t.card_id and c.user_id=t.owner_user_id left join activity_participations p on p.id=t.participation_id and p.owner_user_id=t.owner_user_id left join private_rule_versions r on r.id=p.rule_version_id where t.owner_user_id=$1 order by t.created_at,t.id",
        [owner],
      )
    ).rows;
  }
  dto(row: ActionRow, timezone: string, now = new Date()): TodoAction {
    const today = new Intl.DateTimeFormat("sv-SE", {
        timeZone: timezone,
      }).format(now),
      effective =
        row.deadline.kind !== "unknown" ? row.deadline : row.planned_for,
      day = displayDay(effective, timezone),
      week = new Date(new Date(today + "T00:00:00Z").getTime() + 7 * 86400000)
        .toISOString()
        .slice(0, 10);
    const overdue =
      effective.kind === "instant"
        ? new Date(effective.value) < now
        : effective.kind === "date"
          ? effective.value <
            new Intl.DateTimeFormat("sv-SE", {
              timeZone: effective.timezone,
            }).format(now)
          : false;
    const group: TodoGroupKey = !day
      ? "undated"
      : overdue
        ? "overdue"
        : day === today
          ? "today"
          : day <= week
            ? "week"
            : "later";
    const snooze = row.snoozed_until,
      sleeping =
        snooze.kind === "instant"
          ? new Date(snooze.value) > now
          : snooze.kind === "date"
            ? snooze.value >
              new Intl.DateTimeFormat("sv-SE", {
                timeZone: snooze.timezone,
              }).format(now)
            : false;
    return {
      id: row.id,
      version: row.version,
      title: row.title,
      description: row.description || "个人行动完成状态与银行业务结果分别记录",
      type: row.type,
      status: row.status,
      card: row.card,
      participationId: row.participation_id ?? undefined,
      activityName: row.activity_name,
      deadline: row.deadline,
      plannedFor: row.planned_for,
      expectedReceipt: unknown(),
      snoozedUntil: row.snoozed_until,
      group,
      urgency: {
        label:
          group === "overdue"
            ? sleeping
              ? "已逾期，稍后提示；硬截止仍保留"
              : "已逾期，请核对"
            : sleeping
              ? "稍后处理，硬截止仍保留"
              : group === "undated"
                ? "日期待核对"
                : "待处理",
      },
      priority: row.priority ?? "normal",
      summary: [],
      primaryAction: row.primary_action,
      allowedCommands: [
        {
          kind: row.status === "pending" ? "complete" : "restore",
          enabled: true,
        },
        { kind: "ignore", enabled: row.status === "pending" },
        { kind: "snooze", enabled: row.status === "pending" },
      ],
      history: row.history,
    };
  }
  matches(action: TodoAction, filter: Partial<TodoFilters>, timezone: string) {
    const day =
      displayDay(action.deadline, timezone) ??
      displayDay(action.plannedFor, timezone);
    return (
      (!filter.cardIds?.length ||
        filter.cardIds.includes(action.card?.id ?? "")) &&
      (!filter.types?.length || filter.types.includes(action.type)) &&
      (!filter.status || action.status === filter.status) &&
      (!filter.q ||
        (action.title + " " + (action.card?.name ?? "") + " " + (action.activityName ?? ""))
          .toLowerCase()
          .includes(filter.q.toLowerCase())) &&
      (!filter.from || (!!day && day >= filter.from)) &&
      (!filter.to || (!!day && day <= filter.to)) &&
      (!day ? filter.includeUndated !== false : true)
    );
  }
  async query(
    tx: PoolClient,
    owner: string,
    timezone: string,
    filter: Partial<TodoFilters> & {limit?: number; cursor?: string; asOf?: string},
    calendar = false,
  ) {
    const rows = await this.rows(tx, owner);
    const cursor = filter.cursor ? (() => {
      try { return JSON.parse(Buffer.from(filter.cursor!, "base64url").toString()) as {asOf?:string;offset?:number;signature?:string}; }
      catch { throw new AppError("VALIDATION_ERROR","分页游标或 asOf 无效"); }
    })() : undefined;
    const asOf = filter.asOf ?? cursor?.asOf ?? (await tx.query("select transaction_timestamp() as now")).rows[0].now.toISOString();
    const at = new Date(asOf);
    if (!Number.isFinite(at.getTime()) || at.toISOString() !== asOf)
      throw new AppError("VALIDATION_ERROR","分页游标或 asOf 无效");
    const signature = commandHash({owner,cardIds:filter.cardIds??[],types:filter.types??[],status:filter.status??"pending",q:filter.q??"",from:filter.from??"",to:filter.to??"",includeUndated:filter.includeUndated!==false,month:filter.month??""});
    const filtered = rows.filter(row => !row.created_at || row.created_at.toISOString() <= asOf)
      .map((row) => ({ row, action: this.dto(row, timezone, at) }))
      .filter(({ action }) => this.matches(action, filter, timezone));
    if (calendar) {
      const markers=await activityMarkers(tx,owner,timezone,filter);
      return {
        entries: [...markers,...filtered
          .filter(({ row }) => row.show_in_calendar)
          .flatMap(({ action }) => {
            const date =
              displayDay(action.deadline, timezone) ??
              displayDay(action.plannedFor, timezone);
            return date && (!filter.month || date.startsWith(filter.month))
              ? [{ kind: "action" as const, id: action.id, date, action }]
              : [];
          })],
        undatedCount: filtered.filter(
          ({ action }) =>
            !dateDay(action.deadline) && !dateDay(action.plannedFor),
        ).length,
        total: filtered.length+markers.length,
      };
    }
    const allItems = filtered
      .filter(({ row }) => row.create_todo)
      .map(({ action }) => action).sort((a,b) => {
        const order = ["overdue","today","week","later","undated"];
        const value = (v: DateValue) => v.kind === "unknown" ? "9999" : v.kind === "instant" ? v.value : v.value+"T23:59:59";
        return order.indexOf(a.group)-order.indexOf(b.group) || value(a.deadline.kind!=="unknown"?a.deadline:a.plannedFor).localeCompare(value(b.deadline.kind!=="unknown"?b.deadline:b.plannedFor)) || Number(b.priority==="important")-Number(a.priority==="important") || rows.findIndex(r=>r.id===a.id)-rows.findIndex(r=>r.id===b.id);
      });
    let offset=0;
    if(cursor) {
      if(cursor.asOf!==asOf || cursor.signature!==signature || !Number.isInteger(cursor.offset) || cursor.offset!<0)
        throw new AppError("VALIDATION_ERROR","分页游标或 asOf 无效");
      offset=cursor.offset!;
    }
    const limit=Math.max(1,filter.limit??allItems.length);
    const items=allItems.slice(offset,offset+limit);
    return {
      canCreateCustom: process.env.FEATURE_TODOS === "true",
      nextCursor: offset+limit<allItems.length ? Buffer.from(JSON.stringify({offset:offset+limit,asOf,signature})).toString("base64url") : null,

      groups: (
        ["overdue", "today", "week", "later", "undated"] as TodoGroupKey[]
      ).map((key) => ({
        key,
        count: allItems.filter((x) => x.group === key).length,
        items: items.filter((x) => x.group === key),
      })),
      total: allItems.length,
      cards: rows
        .map((r) => r.card)
        .filter(
          (card, index, all) =>
            card && all.findIndex((c) => c?.id === card.id) === index,
        ),
    };
  }
  async command(
    tx: PoolClient,
    owner: string,
    id: string,
    input: TodoCommand,
    timezone: string,
  ) {
    const scope = (
      await tx.query(
        "select participation_id,card_id from todo_actions where id=$1 and owner_user_id=$2",
        [id, owner],
      )
    ).rows[0];
    if (!scope) throw new AppError("NOT_FOUND", "无法访问此待办");
    await tx.query(
      "select id from cards where id=$1 and user_id=$2 for share",
      [scope.card_id, owner],
    );
    const participation = (
      await tx.query(
        "select p.node_preferences,p.reward_reminder_policy,c.status as card_status from activity_participations p join cards c on c.id=p.card_id and c.user_id=p.owner_user_id where p.id=$1 and p.owner_user_id=$2 for share of p",
        [scope.participation_id, owner],
      )
    ).rows[0];
    const result = await tx.query<ActionRow>(
      "select t.*,case when c.id is null then null else jsonb_build_object('id',c.id,'bank',c.issuer_name,'name',c.name,'last4',c.last4) end as card from todo_actions t left join cards c on c.id=t.card_id and c.user_id=t.owner_user_id where t.id=$1 and t.owner_user_id=$2 for update of t",
      [id, owner],
    );
    if (!result.rowCount) throw new AppError("NOT_FOUND", "无法访问此待办");
    const row = result.rows[0];
    if (row.version !== input.expectedVersion)
      throw new AppError("CONFLICT", "待办已更新，草稿已保留");
    if (
      input.command === "snooze" &&
      (row.status !== "pending" ||
        !input.snoozedUntil ||
        input.snoozedUntil.kind === "unknown")
    )
      throw new AppError(
        "VALIDATION_ERROR",
        "待处理行动需要明确的稍后提示时间",
      );
    const status =
      input.command === "complete"
        ? "completed"
        : input.command === "ignore"
          ? "ignored"
          : input.command === "restore"
            ? "pending"
            : row.status;
    const event = {
      id: crypto.randomUUID(),
      command: input.command,
      occurredAt: new Date().toISOString(),
      note: input.note,
      actor: owner,
    };
    const updated = (
      await tx.query<ActionRow>(
        "update todo_actions set version=version+1,status=$3,snoozed_until=$4,history=history||$5::jsonb where id=$1 and owner_user_id=$2 returning *",
        [
          id,
          owner,
          status,
          input.command === "snooze"
            ? (input.snoozedUntil ?? unknown())
            : unknown(),
          JSON.stringify([event]),
        ],
      )
    ).rows[0];
    updated.card = row.card;
    await tx.query(
      "update todo_notification_schedules set status='cancelled' where action_id=$1 and status='pending'",
      [id],
    );
    if (
      participation &&
      status === "pending" &&
      (input.command === "restore" || input.command === "snooze") &&
      row.deadline.kind !== "unknown" &&
      (row.node_kind.startsWith("reward_")
        ? participation?.reward_reminder_policy === "continue" &&
          ["active", "archived"].includes(participation?.card_status)
        : participation?.card_status === "active") &&
      (row.node_kind !== "spend_period" || row.primary_action.enabled)
    ) {
      const preferences =
        participation?.node_preferences as PrivateParticipation["node_preferences"];
      const preference = preferences.find((p) => p.nodeKind === row.node_kind);
      for (const days of preference?.notifyDaysBefore ?? [])
        await tx.query(
          "insert into todo_notification_schedules(owner_user_id,action_id,action_version,days_before,deadline) values($1,$2,$3,$4,$5)",
          [owner, id, updated.version, days, row.deadline],
        );
    }
    await tx.query(
      "insert into audit_logs(user_id,actor_type,actor_id,action,entity_type,entity_id,metadata) values($1,'user',$1,'todo.'||$2,'todo_action',$3,$4)",
      [owner, input.command, id, event],
    );
    await tx.query("insert into catalog_personal_outbox(owner_user_id,aggregate_id,sequence,event_type,payload) values($1,$2,$3,$4,$5)",[owner,id,updated.version,"todo."+input.command,event]);
    return {
      action: this.dto(updated, timezone),
      invalidated: ["todos" as const, "notifications" as const],
    };
  }
}
