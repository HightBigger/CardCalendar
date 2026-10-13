import { getDatabase } from "../../shared/db/client";
export async function exportCatalogParticipation(
  owner: string,
  pool?: import("pg").Pool,
) {
  if (process.env.USE_DATABASE !== "true" && !pool) return null;
  const tx = await (pool ?? getDatabase().pool).connect();
  try {
    await tx.query("begin isolation level repeatable read read only");
    const exists = (
      await tx.query("select to_regclass('private_campaigns') as name")
    ).rows[0].name;
    if (!exists) {
      await tx.query("commit");
      return null;
    }
    const result: Record<string, unknown> = { schemaVersion: 2 };
    for (const table of [
      "private_campaigns",
      "private_rule_versions",
      "activity_participations",
      "activity_periods",
      "activity_period_revisions",
      "period_plan_revisions",
      "participation_checks",
      "spend_tasks",
      "catalog_spend_observations",
      "spend_facts",
      "spend_fact_events",
      "task_evaluations",
      "activity_rewards",
      "activity_reward_dependencies",
      "activity_reward_events",
      "business_date_nodes",
      "todo_actions",
      "todo_notification_schedules",
      "catalog_personal_history",
      "todo_notifications",
      "workbench_jobs",
      "catalog_personal_outbox",
      "catalog_command_results",
    ]) {
      result[table] = (
        await tx.query(`select * from ${table} where owner_user_id=$1`, [owner])
      ).rows;
    }
    result.period_plan_candidates = (await tx.query(`select c.*,j.owner_user_id from period_plan_candidates c
      join workbench_jobs j on j.id=c.job_id where j.owner_user_id=$1 order by c.job_id,c.ordinal`, [owner])).rows;
    result.workbench_inbox = (await tx.query(`select i.*,o.owner_user_id from workbench_inbox i
      join catalog_personal_outbox o on o.id=i.event_id where o.owner_user_id=$1`, [owner])).rows;
    await tx.query("commit");
    return result;
  } catch (e) {
    await tx.query("rollback");
    throw e;
  } finally {
    tx.release();
  }
}
