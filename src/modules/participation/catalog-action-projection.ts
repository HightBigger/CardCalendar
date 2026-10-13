import type { PoolClient } from "pg";
import type {
  PersonalCatalogService,
  PrivateParticipation,
} from "./catalog-import";
import { CatalogPrivateQueries } from "./catalog-queries";
// Called only inside the fact command's transaction, never as a read side-effect.
export async function syncParticipationActions(
  tx: PoolClient,
  personal: PersonalCatalogService,
  p: PrivateParticipation,
  note: string,
  taskId?: string,
) {
  const queries = new CatalogPrivateQueries(personal);
  const ready =
    p.eligibility === "confirmed" &&
    (p.content.conditions.enrollmentRequired === "no" ||
      (p.content.conditions.enrollmentRequired === "yes" &&
        p.enrollment === "confirmed"));
  if (!taskId) {
    await personal.todos.businessState(
      tx,
      p,
      `${p.id}:eligibility`,
      ready && p.tracking_status !== "needs_review" ? "completed" : "pending",
      note,
    );
  }
  const ids = (
    await tx.query(
      "select id from spend_tasks where participation_id=$1 and owner_user_id=$2 and ($3::uuid is null or id=$3) order by id",
      [p.id, p.owner_user_id, taskId ?? null],
    )
  ).rows;
  for (const { id } of ids) {
    const task = await queries.task(tx, p.owner_user_id, id);
    const spendKey = `${p.id}:${task.periodId??task.id}:spend`,
      reviewKey = `${p.id}:${task.periodId??task.id}:qualification`;
    const qualified = task.qualificationStatus === "met",
      reached = task.progressStatus === "reached";
    const canSpend = !!task.allowedCommands.find(
      (c) => c.kind === (task.mode === "entries" ? "create_entry" : "observation"),
    )?.enabled;
    const period = (
      await tx.query(
        "select stopped,executable from activity_periods where id=$1",
        [task.periodId],
      )
    ).rows[0];
    const stopped = p.card_status !== "active" || !!p.cancelled_at || !!period?.stopped;
    const canNotify =
      ready &&
      !stopped &&
      (period?.executable??true) &&
      p.tracking_decision !== "stop_future" &&
      task.endOn >=
        new Intl.DateTimeFormat("sv-SE", { timeZone: task.timezone }).format(
          new Date(),
        );
    await personal.todos.businessState(
      tx,
      p,
      spendKey,
      qualified || reached ? "completed" : stopped ? "cancelled" : "pending",
      note,
      {
        kind: "progress",
        resourceId: id,
        participationId: p.id,
        label:
          qualified || reached ? "查看进度与核对记录" : "更新进度／核对达标",
        enabled: canSpend && !qualified && !reached,
      },
      qualified
        ? "官方已确认本期达标"
        : reached
          ? "本期确定目标已达到，停止继续刷卡"
          : ready
            ? "核对周期刷卡目标 · " + task.startOn
            : "先核对资格和报名 · " + task.startOn,
      canNotify && !qualified && !reached,
    );
    if (reached && !qualified)
      await personal.todos.upsert(tx, p, {
        key: reviewKey,
        nodeKind: "spend_qualification",
        type: "spend_period",
        title: "核对官方达标 · " + task.startOn,
        deadline: { kind: "date", value: task.endOn, timezone: task.timezone },
        primary: {
          kind: "qualification",
          resourceId: id,
          participationId: p.id,
          label: "核对官方达标",
          enabled: true,
        },
      });
    await personal.todos.businessState(
      tx,
      p,
      reviewKey,
      qualified ? "completed" : reached ? "pending" : "cancelled",
      note,
      undefined,
      undefined,
      reached && !qualified,
    );
  }
  for(const reward of await queries.rewards(tx,p)) {
    await tx.query("update activity_rewards set condition_status=$2,version=version+1 where id=$1 and condition_status<>$2",[reward.id,reward.conditionStatus]);
  }
}
