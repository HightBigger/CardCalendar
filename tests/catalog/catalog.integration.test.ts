import { beforeAll, afterAll, describe, expect, it } from "vitest";
import EmbeddedPostgres from "embedded-postgres";
import { Pool } from "pg";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { createHash, randomUUID } from "node:crypto";
import { CatalogRepository } from "../../src/modules/activity-catalog/repository";
import { CatalogService } from "../../src/modules/activity-catalog/service";
import type { CatalogActor } from "../../src/modules/activity-catalog/ports";
import { CatalogParticipationWorkflow } from "../../src/server/workflows/catalog-participation";
import { CatalogPrivateQueries } from "../../src/modules/participation/catalog-queries";
import { dispatchTodoNotifications } from "../../src/modules/todos/notification-dispatch";
import { CatalogPrivateCommands } from "../../src/modules/participation/catalog-commands";
import { exportCatalogParticipation } from "../../src/modules/participation/catalog-export";
import { catalogFixture } from "./fixture";
import { archiveCard, updateCard } from "../../src/modules/cards/service";
import { createDrizzleRepositories } from "../../src/shared/db/repositories";
import { drizzle } from "drizzle-orm/node-postgres";
import * as dbSchema from "../../db/schema";
import { ensureFeeEventReminders } from "../../src/modules/reminders/service";
import { workbenchRuntime } from "../../src/server/workbench/runtime";
import { CampaignService } from "../../src/modules/campaign/service";
import { PeriodPlanService } from "../../src/modules/participation/period-plans";
import { OverallTaskService } from "../../src/modules/spend-task/overall";
import { ActivityRewardService } from "../../src/modules/activity-reward/service";
import { SpendFactService } from "../../src/modules/spend-task/service";
import { reconcileWorkbenchJobs } from "../../src/modules/participation/workbench-jobs";
import { privateQuery } from "../../src/server/catalog/private-http";
import { TodoService } from "../../src/modules/todos/catalog-todos";
import type { CatalogJoinSelection } from "../../src/contracts/activity-catalog";
let pool: Pool, pg: EmbeddedPostgres, dir: string, service: CatalogService;
let admin: CatalogActor, member: CatalogActor, other: CatalogActor;
let legacyTaskId: string, legacyActionId: string;
let legacyArchivedCard: string, legacyArchivedParticipation: string;
let legacyRuleSnapshot: {id:string;release_id:string;content:unknown};
const context = (actor = admin, key = randomUUID()) => ({
  actor,
  idempotencyKey: key,
});
async function account(email: string) {
  const id = randomUUID(),
    sessionId = randomUUID();
  await pool.query(
    "insert into users(id,email,password_hash) values($1,$2,'test-only')",
    [id, email],
  );
  await pool.query(
    "insert into sessions(id,user_id,token_hash,expires_at) values($1,$2,$3,now()+interval '1 day')",
    [sessionId, id, createHash("sha256").update(id).digest("hex")],
  );
  return { userId: id, sessionId };
}
async function publish(content = catalogFixture()) {
  const draft = await service.createDraft(context(), {
    content,
  });
  const preview = await service.previewDraft(
    admin,
    draft.data.catalogActivityId,
    draft.data.id,
  );
  const p = preview.data;
  const commit = await service.publish(
    context(),
    draft.data.catalogActivityId,
    {
      draftId: p.draftId,
      expectedDraftVersion: p.draftVersion,
      expectedCatalogVersion: p.catalogVersion,
      reviewedContentHash: p.contentHash,
      changeNote: "初版测试发布",
    },
  );
  return { id: draft.data.catalogActivityId, commit };
}
async function counts() {
  return (
    await pool.query(
      "select (select count(*) from catalog_activities)::int as activities,(select count(*) from catalog_drafts)::int as drafts,(select count(*) from catalog_releases)::int as releases,(select count(*) from catalog_history)::int as history,(select count(*) from catalog_command_results)::int as commands,(select count(*) from catalog_outbox)::int as outbox",
    )
  ).rows[0];
}
async function card(owner: string, bankId: string | null = "cmb") {
  return (
    await pool.query(
      "insert into cards(user_id,issuer_name,name,last4,fee_cycle_type,next_fee_date,bank_id) values($1,'招商银行','测试卡','1234','custom','2027-01-01',$2) returning id",
      [owner, bankId],
    )
  ).rows[0].id as string;
}
async function selections(
  workflow: CatalogParticipationWorkflow,
  id: string,
  releaseId: string,
  actor: CatalogActor,
  cardIds: string[],
) {
  const selected: CatalogJoinSelection[] = cardIds.map((cardId) => ({
    cardId,
    acknowledgedUnknownCodes: [] as string[],
    boundaries: [],
    nodePreferences: [],
  }));
  const preview = (
    await workflow.previewJoin(actor, id, { releaseId, selections: selected })
  ).data;
  return {
    releaseId,
    expectedCatalogVersion: preview.catalogVersion,
    selections: selected.map((s) => ({
      ...s,
      acknowledgedUnknownCodes: preview.items
        .find((i) => i.card.id === s.cardId)!
        .issues.filter((i) => i.severity === "blocks_execution")
        .map((i) => i.code),
    })),
  };
}
async function joinFixture(
  actor = member,
  content = catalogFixture(),
  preferences: CatalogJoinSelection["nodePreferences"] = [],
) {
  const { id, commit } = await publish(content),
    workflow = new CatalogParticipationWorkflow(service),
    cardId = await card(actor.userId),
    input = await selections(workflow, id, commit.data.releaseId!, actor, [
      cardId,
    ]);
  for (const s of input.selections) s.nodePreferences = preferences;
  const result = await workflow.join(context(actor), id, input);
  if (result.kind !== "committed") throw new Error("unexpected queue");
  return {
    workflow,
    id,
    cardId,
    participationId: result.data.items[0].participationId,
    input,
  };
}
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "cc23-pg-test-"));
  const port = await new Promise<number>((resolve) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });
  pg = new EmbeddedPostgres({
    databaseDir: dir,
    port,
    user: "postgres",
    password: "postgres",
    persistent: false,
    initdbFlags: ["--locale=C"],
    onLog: () => undefined,
    onError: () => undefined,
  });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase("catalog_test");
  pool = new Pool({
    connectionString: `postgres://postgres:postgres@127.0.0.1:${port}/catalog_test`,
    max: 8,
  });
  for (const name of (await readdir("db/migrations"))
    .filter((n) => n.endsWith(".sql") && !n.startsWith("._"))
    .sort())
    if (name < "0006")
      await pool.query(await readFile(join("db/migrations", name), "utf8"));
  service = new CatalogService(new CatalogRepository(pool));
  admin = await account("admin@test.invalid");
  member = await account("member@test.invalid");
  other = await account("other@test.invalid");
  await pool.query(
    "insert into user_role_grants(user_id,role) values($1,'catalog_admin')",
    [admin.userId],
  );
  const legacy = await joinFixture();
  legacyTaskId = (
    await pool.query(
      "select id from spend_tasks where participation_id=$1 order by id limit 1",
      [legacy.participationId],
    )
  ).rows[0].id;
  legacyActionId = (
    await pool.query(
      "select t.id from todo_actions t join spend_tasks s on t.action_key=s.participation_id::text||':'||s.period_id::text||':spend' where s.id=$1",
      [legacyTaskId],
    )
  ).rows[0].id;
  await pool.query(
    "insert into catalog_spend_observations(owner_user_id,card_id,participation_id,task_id,occurred_on,count,amount,note) values($1,$2,$3,$4,'2026-10-09',5,2000,'legacy snapshot without milestone')",
    [member.userId, legacy.cardId, legacy.participationId, legacyTaskId],
  );
  await pool.query(
    "insert into todo_notification_schedules(owner_user_id,action_id,action_version,days_before,deadline) select owner_user_id,id,version,7,deadline from todo_actions where id=$1",
    [legacyActionId],
  );
  await pool.query(
    "update activity_participations set eligibility='confirmed',enrollment='confirmed' where id=$1",
    [legacy.participationId],
  );
  await pool.query("update spend_tasks set qualification='met' where id=$1", [
    legacyTaskId,
  ]);
  await pool.query(
    "update activity_periods set qualification='met' where id=(select period_id from spend_tasks where id=$1)",
    [legacyTaskId],
  );
  const archived = await joinFixture(member, catalogFixture(), [
    {
      nodeKind: "reward_claim",
      label: "领奖",
      showInCalendar: true,
      createTodo: true,
      notifyDaysBefore: [1],
    },
  ]);
  legacyArchivedCard = archived.cardId;
  legacyArchivedParticipation = archived.participationId;
  await pool.query(
    "update cards set status='archived',archived_at=now() where id=$1",
    [legacyArchivedCard],
  );
  legacyRuleSnapshot=(await pool.query(`select r.id,r.release_id,r.content from private_rule_versions r
    join activity_participations p on p.rule_version_id=r.id where p.id=$1`,[legacy.participationId])).rows[0];
  await pool.query(
    await readFile("db/migrations/0006_catalog_review_fixes.sql", "utf8"),
  );
  for (const name of (await readdir("db/migrations"))
    .filter((n) => n.endsWith(".sql") && !n.startsWith("._") && n > "0006_catalog_review_fixes.sql")
    .sort())
    await pool.query(await readFile(join("db/migrations", name), "utf8"));
}, 90000);
afterAll(async () => {
  await pool?.end();
  await pg?.stop();
  if (dir) await rm(dir, { recursive: true, force: true });
}, 30000);
describe("CC-23 real PostgreSQL directory", () => {
  it("upgrades populated 0006 data without changing rule provenance or child identities",async()=>{
    const rule=(await pool.query("select id,release_id,content from private_rule_versions where id=$1",[legacyRuleSnapshot.id])).rows[0];
    expect(rule).toEqual(legacyRuleSnapshot);
    expect((await pool.query("select id from spend_tasks where id=$1",[legacyTaskId])).rowCount).toBe(1);
    expect((await pool.query("select id from todo_actions where id=$1",[legacyActionId])).rowCount).toBe(1);
    expect((await pool.query("select id from activity_participations where id=$1",[legacyArchivedParticipation])).rowCount).toBe(1);
  });
  async function executable(
    preferences: CatalogJoinSelection["nodePreferences"] = [],
    content = catalogFixture(),
  ) {
    const f = await joinFixture(member, content, preferences),
      commands = new CatalogPrivateCommands(f.workflow.personal);
    for (const command of [
      "record_eligibility",
      "record_enrollment",
    ] as const) {
      const p = await service.repository.transaction(
        (tx) => f.workflow.personal.owned(tx, member.userId, f.participationId),
        true,
      );
      await commands.check(context(member), p.id, {
        expectedVersion: p.version,
        scope: "participation",
        command,
        status: "confirmed",
        note: "银行核对资格与报名",
      });
    }
    const id = (
      await pool.query(
        "select t.id from spend_tasks t join activity_periods p on p.id=t.period_id where t.participation_id=$1 and p.start_on<=current_date and p.end_on>=current_date",
        [f.participationId],
      )
    ).rows[0].id;
    const task = () =>
      service.repository.transaction(
        (tx) => commands.queries.task(tx, member.userId, id),
        true,
      );
    const observe = async (
      stage: "occurred" | "posted" | "settled",
      count: number,
      amount: string,
    ) =>
      commands.taskWrite(context(member), id, "observations", {
        expectedVersion: (await task()).version,
        count,
        amount,
        occurredOn: new Date().toLocaleDateString("sv-SE", {
          timeZone: "Asia/Shanghai",
        }),
        stage,
        note: "有依据的累计阶段观察",
      });
    return { ...f, commands, task, observe, taskId: id };
  }
  const chosen = [
    {
      nodeKind: "spend_period",
      label: "周期消费",
      createTodo: true,
      showInCalendar: true,
      notifyDaysBefore: [30, 7, 1],
    },
  ];
  const actionState = async (key: string) => (await pool.query(
    "select t.*,(select count(*)::int from todo_notification_schedules s where s.action_id=t.id and s.status='pending') as notices from todo_actions t where action_key=$1",
    [key],
  )).rows[0];
  async function manualAction(f: Awaited<ReturnType<typeof executable>>, key: string, command: "complete" | "ignore" | "restore") {
    const action = await actionState(key);
    await service.repository.transaction((tx) => f.workflow.personal.todos.command(
      tx, member.userId, action.id,
      { command, expectedVersion: action.version, note: "成员明确处理行动" }, "Asia/Shanghai",
    ));
    return actionState(key);
  }
  it.each(["complete", "ignore"] as const)("partial progress preserves manual %s and suppresses notifications without revising action history", async (command) => {
    const f = await executable(chosen), task = await f.task();
    const key = `${f.participationId}:${task.periodId}:spend`;
    const before = await manualAction(f, key, command);
    const eligibility = await actionState(`${f.participationId}:eligibility`);
    await f.observe("posted", 1, "100.00");
    expect(await actionState(key)).toEqual(before);
    expect(before).toMatchObject({ status: command === "complete" ? "completed" : "ignored", notices: 0 });
    expect(await actionState(`${f.participationId}:eligibility`)).toEqual(eligibility);
  });
  it("current-period writes never revise other periods or their chosen notifications", async () => {
    const f = await executable(chosen);
    const keys = (await pool.query(
      "select t.action_key from todo_actions t join activity_periods p on t.action_key=p.participation_id::text||':'||p.id::text||':spend' where t.participation_id=$1 and p.start_on>current_date order by p.start_on",
      [f.participationId],
    )).rows.map((r) => r.action_key as string);
    expect(keys).toHaveLength(2);
    await manualAction(f, keys[0], "complete");
    const before = await Promise.all(keys.map(actionState));
    const schedules = async () => (await pool.query(
      "select s.* from todo_notification_schedules s join todo_actions t on t.id=s.action_id where t.action_key=any($1::text[]) order by s.id", [keys],
    )).rows;
    const oldSchedules = await schedules();
    await f.observe("posted", 1, "100.00");
    await f.observe("posted", 5, "2000.00");
    await f.observe("posted", 0, "0.00");
    expect(await Promise.all(keys.map(actionState))).toEqual(before);
    expect(await schedules()).toEqual(oldSchedules);
  });
  it.each(["complete", "ignore"] as const)("prerequisite metadata projections preserve manual %s until explicit restore", async (command) => {
    const f = await executable(chosen), task = await f.task();
    const key = `${f.participationId}:${task.periodId}:spend`;
    await manualAction(f, key, command);
    const check = async (status: "unknown" | "confirmed") => {
      const p = await service.repository.transaction((tx) => f.workflow.personal.owned(tx, member.userId, f.participationId), true);
      await f.commands.check(context(member), p.id, {
        expectedVersion: p.version, scope: "participation", command: "record_enrollment", status, note: "重新核对报名事实",
      });
    };
    await check("unknown");
    await check("confirmed");
    const projected = await actionState(key);
    expect(projected).toMatchObject({ status: command === "complete" ? "completed" : "ignored", notices: 0 });
    expect(projected.history.at(-1)).toMatchObject({ command: "business_projection", from: projected.status, to: projected.status });
    await check("confirmed");
    await f.observe("posted", 1, "100.00");
    expect(await actionState(key)).toEqual(projected);
    expect(await manualAction(f, key, "restore")).toMatchObject({ status: "pending", notices: 3 });
    await f.observe("posted", 2, "200.00");
    expect(await actionState(key)).toMatchObject({ status: "pending", notices: 3 });
  });
  it("real confirmation closes dismissed spend; business corrections preserve dismissal and reopen automatic official review", async () => {
    const f = await executable(chosen), task = await f.task();
    const spend = `${f.participationId}:${task.periodId}:spend`, review = `${f.participationId}:${task.periodId}:qualification`;
    await manualAction(f, spend, "ignore");
    const reached = (await f.observe("posted", 5, "2000.00")).data.task;
    expect(await actionState(spend)).toMatchObject({ status: "completed", notices: 0 });
    expect(await actionState(review)).toMatchObject({ status: "pending" });
    const qualify = async (status: "met" | "unknown") => f.commands.taskWrite(context(member), task.id, "qualification", {
      expectedVersion: (await f.task()).version, periodId: task.periodId, scope: "period", status, note: "核对并更正银行达标结果",
    });
    await qualify("met");
    expect(await actionState(review)).toMatchObject({ status: "completed" });
    await qualify("unknown");
    expect(await actionState(review)).toMatchObject({ status: "pending" });
    expect(reached.progressStatus).toBe("reached");
    await f.observe("posted", 1, "100.00");
    expect(await actionState(spend)).toMatchObject({ status: "ignored", notices: 0 });
    expect(await actionState(review)).toMatchObject({ status: "cancelled" });
    await f.observe("posted", 5, "2000.00");
    expect(await actionState(review)).toMatchObject({ status: "pending" });
  });
  it("upgrade preserves unknown legacy milestones and cancels only unselected undelivered notifications", async () => {
    const personal = new CatalogParticipationWorkflow(service).personal;
    const task = await service.repository.transaction(
      (tx) =>
        new CatalogPrivateQueries(personal).task(
          tx,
          member.userId,
          legacyTaskId,
        ),
      true,
    );
    expect(task.observations[0].stage).toBe("unknown");
    expect(task.confirmed.count).toBe(0);
    expect(task.pending.count).toBe(0);
    expect(task.progressStatus).toBe("needs_review");
    expect(task.qualificationStatus).toBe("met"); // Preserve explicit official facts despite unknown legacy totals.
    expect(task.reviewText).toContain("历史阶段未知");
    expect(
      (
        await pool.query(
          "select status from todo_notification_schedules where action_id=$1",
          [legacyActionId],
        )
      ).rows[0].status,
    ).toBe("cancelled");
    const fixed = (
      await pool.query("select status,history from todo_actions where id=$1", [
        legacyActionId,
      ])
    ).rows[0];
    expect(fixed.status).toBe("completed");
    expect(fixed.history.at(-1).command).toBe("business_projection");
  });
  it("upgrade stops legacy archived consumption and requires an explicit reward choice before selected reminders resume", async () => {
    const p = (
      await pool.query(
        "select reward_reminder_policy from activity_participations where id=$1",
        [legacyArchivedParticipation],
      )
    ).rows[0];
    expect(p.reward_reminder_policy).toBe("needs_confirmation");
    expect(
      (
        await pool.query(
          "select count(*)::int as n from activity_periods where participation_id=$1 and not stopped",
          [legacyArchivedParticipation],
        )
      ).rows[0].n,
    ).toBe(0);
    expect(
      (
        await pool.query(
          "select count(*)::int as n from todo_actions where participation_id=$1 and node_kind='spend_period' and status='pending'",
          [legacyArchivedParticipation],
        )
      ).rows[0].n,
    ).toBe(0);
    expect(
      (
        await pool.query(
          "select count(*)::int as n from todo_notification_schedules s join todo_actions t on t.id=s.action_id where t.participation_id=$1 and s.status='pending'",
          [legacyArchivedParticipation],
        )
      ).rows[0].n,
    ).toBe(0);
    await archiveCard(
      member.userId,
      legacyArchivedCard,
      undefined,
      undefined,
      { rewardReminderPolicy: "keep", note: "本人重新确认继续领奖提醒" },
      pool,
    );
    expect(
      (
        await pool.query(
          "select reward_reminder_policy from activity_participations where id=$1",
          [legacyArchivedParticipation],
        )
      ).rows[0].reward_reminder_policy,
    ).toBe("continue");
    expect(
      (
        await pool.query(
          "select s.days_before from todo_notification_schedules s join todo_actions t on t.id=s.action_id where t.participation_id=$1 and s.status='pending'",
          [legacyArchivedParticipation],
        )
      ).rows,
    ).toEqual([{ days_before: 1 }]);
  });
  it("frozen counting basis separates occurred estimates, confirmed snapshots and corrections without adding snapshots", async () => {
    const f = await executable();
    let result = (await f.observe("occurred", 5, "2000.00")).data.task;
    expect(result).toMatchObject({
      confirmed: { count: 0, amount: "0.00" },
      pending: { count: 5, amount: "2000.00" },
      progressStatus: "not_reached",
    });
    result = (await f.observe("posted", 3, "1000.00")).data.task;
    expect(result).toMatchObject({
      confirmed: { count: 3, amount: "1000.00" },
      pending: { count: 2, amount: "1000.00" },
      remaining: { count: 2, amount: "1000.00" },
    });
    result = (await f.observe("posted", 5, "2000.00")).data.task;
    expect(result).toMatchObject({
      confirmed: { count: 5 },
      pending: { count: 0 },
      progressStatus: "reached",
      qualificationStatus: "unknown",
    });
    result = (await f.observe("posted", 1, "400.00")).data.task;
    expect(result).toMatchObject({
      confirmed: { count: 1, amount: "400.00" },
      pending: { count: 4, amount: "1600.00" },
      progressStatus: "not_reached",
    });
    expect(result.observations.map((o) => o.stage)).toEqual([
      "occurred",
      "posted",
      "posted",
      "posted",
    ]);
    const settled = catalogFixture();
    settled.periodTemplate.countingBasis = "settled";
    const later = await executable([], settled);
    expect(
      (await later.observe("posted", 5, "2000.00")).data.task.confirmed.count,
    ).toBe(0);
    expect(
      (await later.observe("settled", 5, "2000.00")).data.task.confirmed.count,
    ).toBe(5);
    const occurred = catalogFixture();
    occurred.periodTemplate.countingBasis = "occurred";
    const early = await executable([], occurred);
    expect(
      (await early.observe("occurred", 5, "2000.00")).data.task.progressStatus,
    ).toBe("reached");
  });
  it("business confirmation closes persistent actions and notifications; corrections reopen the appropriate projection", async () => {
    const f = await executable(chosen),
      t = await f.task();
    const eligibility = (
      await pool.query("select * from todo_actions where action_key=$1", [
        `${f.participationId}:eligibility`,
      ])
    ).rows[0];
    expect(eligibility.status).toBe("completed");
    expect(eligibility.history.at(-1).command).toBe("business_projection");
    const reached = (await f.observe("posted", 5, "2000.00")).data.task;
    const spendKey = `${f.participationId}:${t.periodId}:spend`,
      reviewKey = `${f.participationId}:${t.periodId}:qualification`;
    const state = async (key: string) =>
      (
        await pool.query(
          "select t.*,(select count(*)::int from todo_notification_schedules s where s.action_id=t.id and s.status='pending') as notices from todo_actions t where action_key=$1",
          [key],
        )
      ).rows[0];
    expect(await state(spendKey)).toMatchObject({
      status: "completed",
      notices: 0,
    });
    expect(await state(reviewKey)).toMatchObject({
      status: "pending",
      node_kind: "spend_qualification",
      notices: 0,
    });
    await f.commands.taskWrite(context(member), t.id, "qualification", {
      expectedVersion: reached.version,
      periodId: t.periodId,
      scope: "period",
      status: "met",
      note: "银行确认本期达标",
    });
    expect(await state(spendKey)).toMatchObject({
      status: "completed",
      notices: 0,
    });
    expect(await state(reviewKey)).toMatchObject({
      status: "completed",
      notices: 0,
    });
    const corrected = (await f.observe("posted", 1, "100.00")).data.task;
    expect(corrected.qualificationStatus).toBe("unknown");
    expect(await state(spendKey)).toMatchObject({
      status: "pending",
      notices: 3,
    });
    expect(await state(reviewKey)).toMatchObject({
      status: "cancelled",
      notices: 0,
    });
    const p = await service.repository.transaction(
      (tx) => f.workflow.personal.owned(tx, member.userId, f.participationId),
      true,
    );
    await f.commands.check(context(member), p.id, {
      expectedVersion: p.version,
      scope: "participation",
      command: "record_enrollment",
      status: "unknown",
      note: "更正报名确认",
    });
    expect(await state(`${p.id}:eligibility`)).toMatchObject({
      status: "pending",
    });
    expect(await state(spendKey)).toMatchObject({
      status: "pending",
      notices: 0,
      primary_action: { enabled: false },
    });
    expect(
      (
        await pool.query(
          "select count(*)::int as n from todo_actions where action_key=$1",
          [spendKey],
        )
      ).rows[0].n,
    ).toBe(1);
  });
  it("a projection failure rolls back the business confirmation and its history", async () => {
    const f = await joinFixture(),
      commands = new CatalogPrivateCommands(f.workflow.personal);
    const before = (
      await pool.query(
        "select version,eligibility from activity_participations where id=$1",
        [f.participationId],
      )
    ).rows[0];
    await pool.query(
      "create function fail_business_projection() returns trigger language plpgsql as $$ begin raise exception 'projection_failed'; end $$;create trigger fail_projection before update on todo_actions for each row execute function fail_business_projection()",
    );
    try {
      await expect(
        commands.check(context(member), f.participationId, {
          expectedVersion: before.version,
          scope: "participation",
          command: "record_eligibility",
          status: "confirmed",
          note: "must roll back",
        }),
      ).rejects.toThrow("projection_failed");
      expect(
        (
          await pool.query(
            "select version,eligibility from activity_participations where id=$1",
            [f.participationId],
          )
        ).rows[0],
      ).toEqual(before);
      expect(
        (
          await pool.query(
            "select count(*)::int as n from catalog_personal_history where participation_id=$1 and action='participation.record_eligibility'",
            [f.participationId],
          )
        ).rows[0].n,
      ).toBe(0);
    } finally {
      await pool.query(
        "drop trigger fail_projection on todo_actions;drop function fail_business_projection()",
      );
    }
  });
  it("unselected activity reminders stay empty, and explicit days are independent of calendar/todo visibility", async () => {
    const none = await joinFixture();
    expect(
      (
        await pool.query(
          "select count(*)::int as n from todo_notification_schedules s join todo_actions t on t.id=s.action_id where t.participation_id=$1",
          [none.participationId],
        )
      ).rows[0].n,
    ).toBe(0);
    const p = [
      {
        nodeKind: "spend_period",
        label: "周期",
        createTodo: false,
        showInCalendar: false,
        notifyDaysBefore: [3],
      },
    ];
    const f = await joinFixture(member, catalogFixture(), p);
    const action = (
      await pool.query(
        "select * from todo_actions where participation_id=$1 and node_kind='spend_period' limit 1",
        [f.participationId],
      )
    ).rows[0];
    expect(action).toMatchObject({
      create_todo: false,
      show_in_calendar: false,
    });
    expect(
      (
        await pool.query(
          "select days_before from todo_notification_schedules where action_id=$1",
          [action.id],
        )
      ).rows,
    ).toEqual([{ days_before: 3 }]);
    await service.repository.transaction(async (tx) => {
      const done = await f.workflow.personal.todos.command(
        tx,
        member.userId,
        action.id,
        { command: "complete", expectedVersion: action.version },
        "Asia/Shanghai",
      );
      await f.workflow.personal.todos.command(
        tx,
        member.userId,
        action.id,
        { command: "restore", expectedVersion: done.action.version },
        "Asia/Shanghai",
      );
    });
    expect(
      (
        await pool.query(
          "select days_before from todo_notification_schedules where action_id=$1 and status='pending'",
          [action.id],
        )
      ).rows,
    ).toEqual([{ days_before: 3 }]);
  });
  async function annualFeeFixture(cardId: string) {
    const repositories = createDrizzleRepositories(drizzle(pool, { schema: dbSchema }));
    const cycle = await repositories.cycles.save({
      id: randomUUID(), userId: member.userId, cardId,
      periodStart: "2026-01-01", periodEnd: "2027-01-01", feeDueDate: "2027-01-01",
      waiveRuleType: "none", status: "open",
    });
    const event = await repositories.feeEvents.create(member.userId, {
      cardId, cycleId: cycle.id, dueDate: "2027-01-01", expectedAmount: 1000, status: "pending",
    });
    await ensureFeeEventReminders(member.userId, event, "Asia/Shanghai", [30, 7, 1], repositories.reminders);
    await repositories.progress.add({
      userId: member.userId, cardId, cycleId: cycle.id, entryDate: "2026-10-09", countDelta: 2, amountDelta: 300,
    });
    return { repositories, cycle, event };
  }
  async function archivedBusinessSnapshot(cardId: string) {
    const queries = [
      "select status,archived_at::text as archived_at from cards where id=$1",
      "select * from activity_participations where card_id=$1 order by id",
      "select * from activity_periods where card_id=$1 order by id",
      "select * from spend_tasks where card_id=$1 order by id",
      "select * from activity_rewards where card_id=$1 order by id",
      "select * from todo_actions where card_id=$1 order by id",
      "select s.* from todo_notification_schedules s join todo_actions t on t.id=s.action_id where t.card_id=$1 order by s.id",
      "select * from catalog_personal_history where card_id=$1 order by id",
      "select * from card_archive_commands where card_id=$1 order by idempotency_key",
      "select * from audit_logs where entity_id=$1 and action='card.archived' order by id",
    ];
    return Promise.all(queries.map(async (sql) => (await pool.query(sql, [cardId])).rows));
  }
  it.each(["keep", "stop"] as const)("archived metadata edits retain %s policy, archive time/history and suppressed annual reminders", async (policy) => {
    const f = await executable([...chosen, {
      nodeKind: "reward_claim", label: "领奖", createTodo: true, showInCalendar: true, notifyDaysBefore: [1],
    }]);
    await f.observe("posted", 1, "100.00");
    const annual = await annualFeeFixture(f.cardId);
    const archived = await archiveCard(member.userId, f.cardId, undefined, undefined,
      { rewardReminderPolicy: policy, idempotencyKey: randomUUID() }, pool);
    const before = await archivedBusinessSnapshot(f.cardId);
    const progress = await annual.repositories.progress.list(member.userId, annual.cycle.id);
    const reminders = (await annual.repositories.reminders.list(member.userId, false)).filter((r) => r.cardId === f.cardId);
    expect(reminders).toHaveLength(3);
    expect(reminders.every((r) => r.status === "cancelled")).toBe(true);
    const save = (value: unknown) => updateCard(member.userId, f.cardId, value,
      undefined, undefined, undefined, undefined, undefined, pool);
    // Both the old full form and the new status-omitting form must work.
    expect(await save({ ...archived, name: "已归档改名", notes: "归档后完整编辑", status: "archived" })).toMatchObject({
      name: "已归档改名", notes: "归档后完整编辑", status: "archived", archivedAt: archived.archivedAt,
    });
    expect(await archivedBusinessSnapshot(f.cardId)).toEqual(before);
    expect(await save({ name: "再次改名", annualFeeAmount: 1200, nextFeeDate: "2027-02-01" })).toMatchObject({
      name: "再次改名", annualFeeAmount: 1200, nextFeeDate: "2027-02-01", status: "archived", archivedAt: archived.archivedAt,
    });
    expect(await archivedBusinessSnapshot(f.cardId)).toEqual(before);
    expect(await annual.repositories.cycles.get(member.userId, annual.cycle.id)).toMatchObject({
      id: annual.cycle.id, feeDueDate: "2027-02-01", periodStart: "2026-02-01", periodEnd: "2027-02-01", status: "open",
    });
    expect(await annual.repositories.feeEvents.get(member.userId, annual.event.id)).toMatchObject({
      cycleId: annual.cycle.id, dueDate: "2027-02-01", expectedAmount: 1200, status: "pending",
    });
    expect(await annual.repositories.progress.list(member.userId, annual.cycle.id)).toEqual(progress);
    expect((await annual.repositories.reminders.list(member.userId, false)).filter((r) => r.cardId === f.cardId)).toEqual(reminders);
  });
  it.each(["active", "suspended"] as const)("legacy %s-to-archived PATCH saves every edited field and fee schedule with archive effects", async (status) => {
    const f = await executable(chosen), annual = await annualFeeFixture(f.cardId);
    await pool.query("update cards set status=$2 where id=$1", [f.cardId, status]);
    const updated = await updateCard(member.userId, f.cardId, {
      name: "edited on archive", notes: "兼容完整编辑", annualFeeAmount: 1500, nextFeeDate: "2027-03-01",
      currency: "USD", waiveRuleType: "count", targetCount: 8, status: "archived",
    }, undefined, undefined, undefined, undefined, undefined, pool);
    expect(updated).toMatchObject({
      name: "edited on archive", notes: "兼容完整编辑", annualFeeAmount: 1500, nextFeeDate: "2027-03-01",
      currency: "USD", waiveRuleType: "count", targetCount: 8, status: "archived",
      rewardReminderPolicy: "needs_confirmation",
    });
    expect(await annual.repositories.cards.get(member.userId, f.cardId)).toMatchObject({
      name: updated.name, notes: updated.notes, annualFeeAmount: updated.annualFeeAmount,
      nextFeeDate: updated.nextFeeDate, status: "archived", currency: "USD", targetCount: 8,
    });
    expect(await annual.repositories.cycles.get(member.userId, annual.cycle.id)).toMatchObject({
      feeDueDate: "2027-03-01", waiveRuleType: "count", targetCount: 8,
    });
    expect(await annual.repositories.feeEvents.get(member.userId, annual.event.id)).toMatchObject({ dueDate: "2027-03-01", expectedAmount: 1500 });
    expect((await annual.repositories.reminders.list(member.userId, false)).filter((r) => r.cardId === f.cardId).every((r) => r.status === "cancelled")).toBe(true);
    expect((await pool.query("select reward_reminder_policy from activity_participations where id=$1", [f.participationId])).rows[0]).toEqual({ reward_reminder_policy: "needs_confirmation" });
    expect((await f.task()).allowedCommands.find((c) => c.kind === "observation")?.enabled).toBe(false);
    expect((await pool.query("select count(*)::int as n from card_archive_commands where card_id=$1", [f.cardId])).rows[0].n).toBe(1);
  });
  it("a failed combined edit/archive rolls back metadata, fee schedule, reminders and catalog actions together", async () => {
    const f = await executable(chosen), annual = await annualFeeFixture(f.cardId);
    const beforeCard = await annual.repositories.cards.get(member.userId, f.cardId);
    const beforeBusiness = await archivedBusinessSnapshot(f.cardId);
    const beforeCycle = await annual.repositories.cycles.get(member.userId, annual.cycle.id);
    const beforeEvent = await annual.repositories.feeEvents.get(member.userId, annual.event.id);
    const beforeReminders = (await annual.repositories.reminders.list(member.userId, false)).filter((r) => r.cardId === f.cardId);
    await pool.query(`create function fail_combined_archive() returns trigger language plpgsql as $$ begin if new.action='card.archived' and new.entity_id='${f.cardId}' then raise exception 'archive regression rollback'; end if; return new; end $$; create trigger fail_combined_archive before insert on audit_logs for each row execute function fail_combined_archive()`);
    try {
      await expect(updateCard(member.userId, f.cardId, { name: "must rollback", annualFeeAmount: 999, nextFeeDate: "2027-04-01", status: "archived" },
        undefined, undefined, undefined, undefined, undefined, pool)).rejects.toThrow("archive regression rollback");
      expect(await annual.repositories.cards.get(member.userId, f.cardId)).toEqual(beforeCard);
      expect(await archivedBusinessSnapshot(f.cardId)).toEqual(beforeBusiness);
      expect(await annual.repositories.cycles.get(member.userId, annual.cycle.id)).toEqual(beforeCycle);
      expect(await annual.repositories.feeEvents.get(member.userId, annual.event.id)).toEqual(beforeEvent);
      expect((await annual.repositories.reminders.list(member.userId, false)).filter((r) => r.cardId === f.cardId)).toEqual(beforeReminders);
    } finally {
      await pool.query("drop trigger fail_combined_archive on audit_logs; drop function fail_combined_archive()");
    }
  });
  it("archive commits consumption stops and reward keep/stop choices together, with ownership and idempotency", async () => {
    for (const policy of ["keep", "stop"] as const) {
      const f = await executable([
        ...chosen,
        {
          nodeKind: "reward_claim",
          label: "奖励",
          createTodo: true,
          showInCalendar: true,
          notifyDaysBefore: [1],
        },
      ]);
      const beforeTask = await f.task(),
        key = randomUUID();
      const reward = (
        await pool.query(
          "select id,deadline from todo_actions where participation_id=$1 and node_kind='reward_claim' limit 1",
          [f.participationId],
        )
      ).rows[0];
      const today = {
        kind: "date",
        value: new Date().toLocaleDateString("sv-SE", {
          timeZone: "Asia/Shanghai",
        }),
        timezone: "Asia/Shanghai",
      };
      await pool.query("update todo_actions set deadline=$2 where id=$1", [
        reward.id,
        today,
      ]);
      await expect(
        archiveCard(
          other.userId,
          f.cardId,
          undefined,
          undefined,
          { rewardReminderPolicy: policy },
          pool,
        ),
      ).rejects.toMatchObject({ status: 404 });
      const options = {
        rewardReminderPolicy: policy,
        note: "本人确认归档",
        idempotencyKey: key,
      };
      const result = await archiveCard(
        member.userId,
        f.cardId,
        undefined,
        undefined,
        options,
        pool,
      );
      expect(result).toMatchObject({
        status: "archived",
        rewardReminderPolicy: policy === "keep" ? "continue" : "stop",
      });
      expect(
        await archiveCard(
          member.userId,
          f.cardId,
          undefined,
          undefined,
          options,
          pool,
        ),
      ).toEqual(result);
      await expect(
        archiveCard(
          member.userId,
          f.cardId,
          undefined,
          undefined,
          {
            ...options,
            rewardReminderPolicy: policy === "keep" ? "stop" : "keep",
          },
          pool,
        ),
      ).rejects.toMatchObject({ status: 409 });
      const t = await f.task();
      expect(t.version).toBeGreaterThan(beforeTask.version);
      expect(
        t.allowedCommands.find((c) => c.kind === "observation")?.enabled,
      ).toBe(false);
      await expect(f.observe("posted", 1, "100.00")).rejects.toMatchObject({
        status: 422,
      });
      const actions = (
        await pool.query(
          "select status,primary_action,history from todo_actions where participation_id=$1 and node_kind='spend_period'",
          [f.participationId],
        )
      ).rows;
      expect(
        actions.every(
          (a) =>
            a.status === "cancelled" &&
            !a.primary_action.enabled &&
            a.history.at(-1).note === "本人确认归档",
        ),
      ).toBe(true);
      expect(
        (
          await pool.query(
            "select reward_reminder_policy from activity_participations where id=$1",
            [f.participationId],
          )
        ).rows[0].reward_reminder_policy,
      ).toBe(result.rewardReminderPolicy);
      const detail = await service.repository.transaction(
        (tx) =>
          new CatalogPrivateQueries(f.workflow.personal).detail(
            tx,
            member.userId,
            f.participationId,
          ),
        true,
      );
      expect(
        detail.periods.every(
          (p) => !p.allowedCommands.find((c) => c.kind === "progress")?.enabled,
        ),
      ).toBe(true);
      await dispatchTodoNotifications(service.repository, 1000);
      expect(
        (
          await pool.query(
            "select count(*)::int as n from todo_notifications where action_id=$1",
            [reward.id],
          )
        ).rows[0].n,
      ).toBe(policy === "keep" ? 1 : 0);
      expect(
        (
          await pool.query(
            "select count(*)::int as n from catalog_personal_history where participation_id=$1 and action='card.archived'",
            [f.participationId],
          )
        ).rows[0].n,
      ).toBe(1);
    }
  });
  it("archive failure rolls back card, task, activity, schedules and policy", async () => {
    const f = await executable(chosen),
      task = await f.task();
    const before = (
      await pool.query(
        "select version,reward_reminder_policy from activity_participations where id=$1",
        [f.participationId],
      )
    ).rows[0];
    const pending = async () =>
      (
        await pool.query(
          "select count(*)::int as n from todo_notification_schedules s join todo_actions t on t.id=s.action_id where t.participation_id=$1 and s.status='pending'",
          [f.participationId],
        )
      ).rows[0].n;
    const pendingBefore = await pending();
    expect(pendingBefore).toBeGreaterThan(0);
    await pool.query(
      "create function fail_archive_history() returns trigger language plpgsql as $$ begin if new.action='card.archived' then raise exception 'archive_failed';end if; return new; end $$;create trigger fail_archive before insert on catalog_personal_history for each row execute function fail_archive_history()",
    );
    try {
      await expect(
        archiveCard(
          member.userId,
          f.cardId,
          undefined,
          undefined,
          { rewardReminderPolicy: "stop" },
          pool,
        ),
      ).rejects.toThrow("archive_failed");
      expect(
        (await pool.query("select status from cards where id=$1", [f.cardId]))
          .rows[0].status,
      ).toBe("active");
      expect(
        (
          await pool.query(
            "select version,reward_reminder_policy from activity_participations where id=$1",
            [f.participationId],
          )
        ).rows[0],
      ).toEqual(before);
      expect((await f.task()).version).toBe(task.version);
      expect(await pending()).toBe(pendingBefore);
    } finally {
      await pool.query(
        "drop trigger fail_archive on catalog_personal_history;drop function fail_archive_history()",
      );
    }
  });
  it("an archive that wins the card lock fences an already started observation", async () => {
    const f = await executable(chosen),
      task = await f.task(),
      lock = await pool.connect();
    const wait = async (query: string) => {
      for (let i = 0; i < 300; i++) {
        if (
          (
            await pool.query(
              "select count(*)::int as n from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query=$1",
              [query],
            )
          ).rows[0].n > 0
        )
          return;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      throw new Error("expected PostgreSQL lock wait");
    };
    await lock.query("begin");
    await lock.query("select id from cards where id=$1 for update", [f.cardId]);
    const archive = archiveCard(
      member.userId,
      f.cardId,
      undefined,
      undefined,
      { rewardReminderPolicy: "keep" },
      pool,
    );
    let observation: Promise<unknown> | undefined;
    try {
      await wait("select id from cards where id=$1 and user_id=$2 for update");
      observation = f.observe("posted", 5, "2000.00");
      // Attach rejection handling before releasing either command.
      const results = Promise.allSettled([archive, observation]);
      await wait("select id from cards where id=$1 and user_id=$2 for share");
      await lock.query("commit");
      const [a, o] = await results;
      expect(a.status).toBe("fulfilled");
      expect(o.status).toBe("rejected");
      expect(
        (
          await pool.query(
            "select count(*)::int as n from catalog_spend_observations where task_id=$1",
            [task.id],
          )
        ).rows[0].n,
      ).toBe(0);
    } finally {
      await lock.query("rollback");
      lock.release();
      await Promise.allSettled([
        archive,
        ...(observation ? [observation] : []),
      ]);
    }
  });
  it("database archive cancels original annual-fee reminders while preserving cycles and facts", async () => {
    const id = await card(member.userId);
    const cycle = (
      await pool.query(
        "insert into fee_cycles(user_id,card_id,period_start,period_end,fee_due_date,waive_rule_type) values($1,$2,'2026-01-01','2026-12-31','2027-01-01','none') returning id",
        [member.userId, id],
      )
    ).rows[0].id;
    const reminder = (
      await pool.query(
        "insert into reminders(user_id,card_id,fee_cycle_id,kind,days_before,scheduled_for,status) values($1,$2,$3,'progress',7,now(),'snoozed') returning id",
        [member.userId, id, cycle],
      )
    ).rows[0].id;
    await archiveCard(member.userId, id, undefined, undefined, {}, pool);
    expect(
      (
        await pool.query(
          "select status,snoozed_until from reminders where id=$1",
          [reminder],
        )
      ).rows[0],
    ).toEqual({ status: "cancelled", snoozed_until: null });
    expect(
      (
        await pool.query(
          "select count(*)::int as n from fee_cycles where id=$1",
          [cycle],
        )
      ).rows[0].n,
    ).toBe(1);
  });
  it("elapsed instant deadlines are overdue in account timezone and snooze preserves the hard cutoff", async () => {
    const f = await joinFixture(),
      todos = f.workflow.personal.todos;
    const row = (
      await service.repository.transaction(
        (tx) => todos.rows(tx, member.userId),
        true,
      )
    ).find((r) => r.participation_id === f.participationId)!;
    const now = new Date("2026-10-10T00:05:00Z"),
      deadline = {
        kind: "instant" as const,
        value: "2026-10-10T00:04:00Z",
        timezone: "America/Los_Angeles",
      };
    row.deadline = deadline;
    row.snoozed_until = {
      kind: "instant",
      value: "2026-10-10T01:05:00Z",
      timezone: "Asia/Shanghai",
    };
    expect(todos.dto(row, "Asia/Shanghai", now)).toMatchObject({
      group: "overdue",
      deadline,
      urgency: { label: "已逾期，稍后提示；硬截止仍保留" },
    });
    row.deadline = {
      kind: "date",
      value: "2026-10-10",
      timezone: "Asia/Shanghai",
    };
    expect(todos.dto(row, "Asia/Shanghai", now).group).toBe("today");
    expect(
      todos.dto(row, "Asia/Shanghai", new Date("2026-10-10T16:00:00Z")).group,
    ).toBe("overdue");
    row.deadline = deadline;
    await pool.query("update todo_actions set deadline=$2 where id=$1", [
      row.id,
      deadline,
    ]);
    const calendar = (await service.repository.transaction(
      (tx) =>
        todos.query(
          tx,
          member.userId,
          "Asia/Shanghai",
          { status: "pending", from: "2026-10-10", to: "2026-10-10" },
          true,
        ),
      true,
    )) as import("../../src/contracts/todos").TodoCalendar;
    expect(calendar.entries.find((e) => e.id === row.id)?.date).toBe(
      "2026-10-10",
    );
  });
  it("member cannot read or write drafts; capabilities reflect current grants", async () => {
    expect(await service.getCapabilities(member)).toEqual({
      canReadCatalog: true,
      canManageCatalog: false,
      permissionsVersion: 0,
    });
    await expect(service.adminList(member, {})).rejects.toMatchObject({
      status: 403,
    });
    await expect(
      service.createDraft(context(member), { content: catalogFixture() }),
    ).rejects.toMatchObject({ status: 403 });
  });
  it("published release is shared, revision draft never leaks, GET is read only", async () => {
    const { id, commit } = await publish();
    const version = commit.data.version;
    expect((await service.detail(member, id)).data.release.id).toBe(
      commit.data.releaseId,
    );
    expect((await service.detail(other, id)).data.release.id).toBe(
      commit.data.releaseId,
    );
    const draft = (
      await service.startRevision(context(), id, { expectedVersion: version })
    ).data;
    const content = { ...draft.content, name: "SECRET_UNPUBLISHED_NAME" };
    await service.updateDraft(context(), id, draft.id, {
      expectedVersion: draft.version,
      content,
    });
    const before = await counts();
    const response = await service.detail(member, id);
    await service.list(other, {});
    expect(JSON.stringify(response)).not.toContain("SECRET_UNPUBLISHED_NAME");
    expect(JSON.stringify(response)).not.toContain("draft");
    expect(await counts()).toEqual(before);
  });
  it("different banks publish independently and bank filters use stable directory IDs", async () => {
    const content = catalogFixture();
    content.name = "工商银行测试目录";
    content.bankId = "icbc";
    content.sources[0].url = "https://www.icbc.com.cn/";
    content.rewards[0].officialUrl = "https://www.icbc.com.cn/";
    const icbc = await publish(content),
      cmb = await publish();
    for (const actor of [member, other]) {
      const list = (await service.list(actor, { bankIds: ["icbc"] })).data
        .items;
      expect(list.some((r) => r.id === icbc.id)).toBe(true);
      expect(list.some((r) => r.id === cmb.id)).toBe(false);
      const detail = (await service.detail(actor, icbc.id)).data;
      expect(detail.summary.bank.id).toBe("icbc");
      expect(detail.release.content.sources[0].url).toBe(
        "https://www.icbc.com.cn/",
      );
    }
  });
  it("missing required information blocks publication; unknown conditions stay unknown", async () => {
    const content = catalogFixture();
    content.sources = [];
    content.conditions.channelText = "";
    const d = (await service.createDraft(context(), { content })).data;
    const p = (await service.previewDraft(admin, d.catalogActivityId, d.id))
      .data;
    expect(p.canPublish).toBe(false);
    await expect(
      service.publish(context(), d.catalogActivityId, {
        draftId: d.id,
        expectedDraftVersion: p.draftVersion,
        expectedCatalogVersion: p.catalogVersion,
        reviewedContentHash: p.contentHash,
        changeNote: "不能发布",
      }),
    ).rejects.toMatchObject({ status: 422 });
    content.sources = catalogFixture().sources;
    const edited = (
      await service.updateDraft(context(), d.catalogActivityId, d.id, {
        content,
        expectedVersion: d.version,
      })
    ).data;
    const p2 = (
      await service.previewDraft(admin, d.catalogActivityId, edited.id)
    ).data;
    expect(p2.canPublish).toBe(true);
    expect(p2.issues.some((i) => i.severity === "blocks_execution")).toBe(true);
  });
  it("preview fences versions/hash, permanent releases reject UPDATE and DELETE", async () => {
    const d = (
      await service.createDraft(context(), { content: catalogFixture() })
    ).data;
    const p = (await service.previewDraft(admin, d.catalogActivityId, d.id))
      .data;
    await service.updateDraft(context(), d.catalogActivityId, d.id, {
      expectedVersion: d.version,
      content: { ...d.content, name: "Changed after preview" },
    });
    await expect(
      service.publish(context(), d.catalogActivityId, {
        draftId: d.id,
        expectedDraftVersion: p.draftVersion,
        expectedCatalogVersion: p.catalogVersion,
        reviewedContentHash: p.contentHash,
        changeNote: "stale",
      }),
    ).rejects.toMatchObject({ status: 409 });
    const { commit } = await publish();
    await expect(
      pool.query(
        "update catalog_releases set change_note='tamper' where id=$1",
        [commit.data.releaseId],
      ),
    ).rejects.toThrow("immutable");
    await expect(
      pool.query("delete from catalog_releases where id=$1", [
        commit.data.releaseId,
      ]),
    ).rejects.toThrow("immutable");
  });
  it("same-key concurrent create replays one result, different request conflicts", async () => {
    const key = randomUUID(),
      ctx = context(admin, key),
      input = { content: catalogFixture() };
    const before = await counts();
    const [a, b] = await Promise.all([
      service.createDraft(ctx, input),
      service.createDraft(ctx, input),
    ]);
    expect(a).toEqual(b);
    expect((await counts()).activities - before.activities).toBe(1);
    await expect(
      service.createDraft(ctx, {
        content: { ...input.content, name: "different" },
      }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("two publishers serialize; history/outbox/audit commit with the release", async () => {
    const d = (
        await service.createDraft(context(), { content: catalogFixture() })
      ).data,
      p = (await service.previewDraft(admin, d.catalogActivityId, d.id)).data;
    const input = {
      draftId: d.id,
      expectedDraftVersion: p.draftVersion,
      expectedCatalogVersion: p.catalogVersion,
      reviewedContentHash: p.contentHash,
      changeNote: "concurrent",
    };
    const results = await Promise.allSettled([
      service.publish(context(), d.catalogActivityId, input),
      service.publish(context(), d.catalogActivityId, input),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      (
        await pool.query(
          "select count(*)::int as n from catalog_releases where catalog_activity_id=$1",
          [d.catalogActivityId],
        )
      ).rows[0].n,
    ).toBe(1);
    const detail = (await service.adminDetail(admin, d.catalogActivityId)).data;
    expect(detail.history.at(-1)).toMatchObject({
      actorId: admin.userId,
      action: "catalog.published",
      note: "concurrent",
    });
  });
  it("outbox failure rolls back release/pointer/history/idempotency/audit", async () => {
    const d = (
        await service.createDraft(context(), { content: catalogFixture() })
      ).data,
      p = (await service.previewDraft(admin, d.catalogActivityId, d.id)).data;
    await pool.query(
      "create function fail_catalog_event() returns trigger language plpgsql as $$ begin raise exception 'injected_outbox_failure'; end $$; create trigger catalog_fail_event before insert on catalog_outbox for each row execute function fail_catalog_event()",
    );
    const before = await counts();
    try {
      await expect(
        service.publish(context(), d.catalogActivityId, {
          draftId: d.id,
          expectedDraftVersion: p.draftVersion,
          expectedCatalogVersion: p.catalogVersion,
          reviewedContentHash: p.contentHash,
          changeNote: "rollback",
        }),
      ).rejects.toThrow("injected_outbox_failure");
      expect(await counts()).toEqual(before);
      expect(
        (await service.adminDetail(admin, d.catalogActivityId)).data.activity
          .publicationStatus,
      ).toBe("unpublished");
    } finally {
      await pool.query(
        "drop trigger catalog_fail_event on catalog_outbox;drop function fail_catalog_event()",
      );
    }
  });
  it("withdraw removes discovery, preserves version and a reason; ended releases remain readable", async () => {
    const { id, commit } = await publish();
    await service.withdraw(context(), id, {
      expectedVersion: commit.data.version,
      reason: "来源需要重新核对",
    });
    await expect(service.detail(member, id)).rejects.toMatchObject({
      status: 404,
    });
    const d = (await service.adminDetail(admin, id)).data;
    expect(d.releases[0].id).toBe(commit.data.releaseId);
    expect(d.history.at(-1)?.note).toBe("来源需要重新核对");
    const content = catalogFixture();
    content.start = {
      kind: "date",
      value: "2026-01-01",
      timezone: "Asia/Shanghai",
    };
    content.end = {
      kind: "date",
      value: "2026-01-31",
      timezone: "Asia/Shanghai",
    };
    const draft = (await service.createDraft(context(), { content })).data,
      p = (await service.previewDraft(admin, draft.catalogActivityId, draft.id))
        .data;
    await service.publish(context(), draft.catalogActivityId, {
      draftId: draft.id,
      expectedCatalogVersion: p.catalogVersion,
      expectedDraftVersion: p.draftVersion,
      reviewedContentHash: p.contentHash,
      changeNote: "ended fixture",
    });
    expect(
      (await service.list(member, { phase: "ended" })).data.items.some(
        (i) => i.id === draft.catalogActivityId,
      ),
    ).toBe(true);
  });
  it("revocation takes effect on the old session, including idempotent management retries", async () => {
    const ctx = context(),
      input = { content: catalogFixture() };
    await service.createDraft(ctx, input);
    await pool.query(
      "update user_role_grants set revoked_at=now(),version=version+1 where user_id=$1",
      [admin.userId],
    );
    expect((await service.getCapabilities(admin)).canManageCatalog).toBe(false);
    await expect(service.adminList(admin, {})).rejects.toMatchObject({
      status: 403,
    });
    await expect(service.createDraft(ctx, input)).rejects.toMatchObject({
      status: 403,
    });
    await pool.query(
      "update user_role_grants set revoked_at=null,version=version+1 where user_id=$1",
      [admin.userId],
    );
  });
  it("multi-card ownership is all-or-nothing; two owners and the administrator cannot cross private boundaries", async () => {
    const { id, commit } = await publish(),
      workflow = new CatalogParticipationWorkflow(service),
      a = await card(member.userId),
      b = await card(other.userId);
    const before = (
      await pool.query("select count(*)::int as n from activity_participations")
    ).rows[0].n;
    await expect(
      workflow.join(context(member), id, {
        releaseId: commit.data.releaseId!,
        expectedCatalogVersion: commit.data.version,
        selections: [a, b].map((cardId) => ({
          cardId,
          acknowledgedUnknownCodes: [],
          boundaries: [],
          nodePreferences: [],
        })),
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(
      (
        await pool.query(
          "select count(*)::int as n from activity_participations",
        )
      ).rows[0].n,
    ).toBe(before);
    const ai = await selections(workflow, id, commit.data.releaseId!, member, [
        a,
      ]),
      bi = await selections(workflow, id, commit.data.releaseId!, other, [b]);
    const ar = await workflow.join(context(member), id, ai),
      br = await workflow.join(context(other), id, bi);
    if (ar.kind !== "committed" || br.kind !== "committed")
      throw new Error("unexpected queue");
    expect(ar.data.items[0].participationId).not.toBe(
      br.data.items[0].participationId,
    );
    for (const actor of [other, admin])
      await expect(
        workflow.readSource(actor, ar.data.items[0].participationId),
      ).rejects.toMatchObject({ status: 404 });
    const query = new CatalogPrivateQueries(workflow.personal);
    const task = (
      await pool.query("select id from spend_tasks where participation_id=$1", [
        ar.data.items[0].participationId,
      ])
    ).rows[0].id;
    const reward = (
      await pool.query(
        "select id from activity_rewards where participation_id=$1",
        [ar.data.items[0].participationId],
      )
    ).rows[0].id;
    await expect(
      service.repository.transaction(
        (tx) => query.task(tx, admin.userId, task),
        true,
      ),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      service.repository.transaction(
        (tx) => query.reward(tx, other.userId, reward),
        true,
      ),
    ).rejects.toMatchObject({ status: 404 });
  });
  it("join previews are read only; same/new-key/concurrent retries preserve one participation and one action per node", async () => {
    const f = await joinFixture(
        member,
        catalogFixture(),
        ["spend_period", "reward_claim"].map((nodeKind) => ({
          nodeKind,
          label: nodeKind,
          showInCalendar: true,
          createTodo: true,
          notifyDaysBefore: [30, 7, 1],
        })),
      ),
      before = await counts();
    const personalBefore = (
      await pool.query("select count(*)::int as n from todo_actions")
    ).rows[0].n;
    await f.workflow.previewJoin(member, f.id, {
      releaseId: f.input.releaseId,
      selections: f.input.selections,
    });
    expect(await counts()).toEqual(before);
    expect(
      (await pool.query("select count(*)::int as n from todo_actions")).rows[0]
        .n,
    ).toBe(personalBefore);
    const results = await Promise.all([
      f.workflow.join(context(member), f.id, f.input),
      f.workflow.join(context(member), f.id, f.input),
    ]);
    for (const r of results) {
      if (r.kind !== "committed") throw new Error("unexpected queue");
      expect(r.data.items[0]).toMatchObject({
        participationId: f.participationId,
        created: false,
      });
    }
    expect(
      (
        await pool.query(
          "select count(*)::int as n from activity_participations where id=$1",
          [f.participationId],
        )
      ).rows[0].n,
    ).toBe(1);
    expect(
      (await pool.query("select count(*)::int as n from todo_actions")).rows[0]
        .n,
    ).toBe(personalBefore);
    const duplicates = (
      await pool.query(
        "select action_id,count(*)::int as n from todo_notification_schedules s join todo_actions t on t.id=s.action_id where t.participation_id=$1 group by action_id",
        [f.participationId],
      )
    ).rows;
    expect(duplicates.length).toBeGreaterThan(0);
    expect(duplicates.every((r) => r.n === 3)).toBe(true);
  });
  it("unknown targets/boundaries stay non-executable; join never confirms enrollment or eligibility", async () => {
    const content = catalogFixture();
    content.periodTemplate.type = "billing";
    content.periodTemplate.target.count = null;
    content.conditions.channelText = "";
    const d = (await service.createDraft(context(), { content })).data,
      p = (await service.previewDraft(admin, d.catalogActivityId, d.id)).data;
    const commit = (
      await service.publish(context(), d.catalogActivityId, {
        draftId: d.id,
        expectedDraftVersion: p.draftVersion,
        expectedCatalogVersion: p.catalogVersion,
        reviewedContentHash: p.contentHash,
        changeNote: "unknown fixture",
      })
    ).data;
    const workflow = new CatalogParticipationWorkflow(service),
      cardId = await card(member.userId),
      input = await selections(
        workflow,
        d.catalogActivityId,
        commit.releaseId!,
        member,
        [cardId],
      );
    const joined = await workflow.join(
      context(member),
      d.catalogActivityId,
      input,
    );
    if (joined.kind !== "committed") throw new Error("unexpected queue");
    const id = joined.data.items[0].participationId;
    expect(
      (
        await pool.query(
          "select eligibility,enrollment,tracking_status from activity_participations where id=$1",
          [id],
        )
      ).rows[0],
    ).toEqual({
      eligibility: "unknown",
      enrollment: "unknown",
      tracking_status: "needs_review",
    });
    expect(
      (
        await pool.query(
          "select count(*)::int as n from spend_tasks where participation_id=$1",
          [id],
        )
      ).rows[0].n,
    ).toBe(0);
    const actions = (
      await pool.query(
        "select * from todo_actions where participation_id=$1 and node_kind='eligibility'",
        [id],
      )
    ).rows;
    expect(actions).toHaveLength(1);
    expect(actions[0].deadline.kind).toBe("unknown");
  });
  it("join derivation failure rolls back campaign/rule/participation/period/action/audit/outbox", async () => {
    const { id, commit } = await publish(),
      workflow = new CatalogParticipationWorkflow(service),
      cardId = await card(member.userId),
      input = await selections(workflow, id, commit.data.releaseId!, member, [
        cardId,
      ]);
    const before = (
      await pool.query("select count(*)::int as n from private_campaigns")
    ).rows[0].n;
    await pool.query(
      "create function fail_todo_creation() returns trigger language plpgsql as $$ begin raise exception 'injected_todo_failure'; end $$;create trigger fail_todo before insert on todo_actions for each row execute function fail_todo_creation()",
    );
    try {
      await expect(workflow.join(context(member), id, input)).rejects.toThrow(
        "injected_todo_failure",
      );
      expect(
        (await pool.query("select count(*)::int as n from private_campaigns"))
          .rows[0].n,
      ).toBe(before);
      expect(
        (
          await pool.query(
            "select count(*)::int as n from activity_participations where card_id=$1",
            [cardId],
          )
        ).rows[0].n,
      ).toBe(0);
    } finally {
      await pool.query(
        "drop trigger fail_todo on todo_actions;drop function fail_todo_creation()",
      );
    }
  });
  it("list and calendar share IDs/version/status; action completion does not confirm banking outcomes", async () => {
    const f = await joinFixture();
    const action = (
      await pool.query(
        "select id from todo_actions where participation_id=$1 and node_kind='reward_claim'",
        [f.participationId],
      )
    ).rows[0].id;
    await service.repository.transaction(async (tx) => {
      const todos = f.workflow.personal.todos;
      const list = (await todos.query(
        tx,
        member.userId,
        "Asia/Shanghai",
        { status: "pending" },
        false,
      )) as import("../../src/contracts/todos").TodoList;
      const calendar = (await todos.query(
        tx,
        member.userId,
        "Asia/Shanghai",
        { status: "pending" },
        true,
      )) as import("../../src/contracts/todos").TodoCalendar;
      const a = list.groups
        .flatMap((g) => g.items)
        .find((a) => a.id === action)!;
      expect(
        calendar.entries.find(
          (e) => e.kind === "action" && e.action.id === action,
        )?.id,
      ).toBe(a.id);
      await todos.command(
        tx,
        member.userId,
        action,
        { command: "complete", expectedVersion: a.version },
        "Asia/Shanghai",
      );
    });
    expect(
      (
        await pool.query(
          "select eligibility,enrollment from activity_participations where id=$1",
          [f.participationId],
        )
      ).rows[0],
    ).toEqual({ eligibility: "unknown", enrollment: "unknown" });
    expect(
      (
        await pool.query(
          "select claim_status,receipt_status from activity_rewards where participation_id=$1",
          [f.participationId],
        )
      ).rows[0],
    ).toEqual({
      claim_status: "not_submitted",
      receipt_status: "not_received",
    });
  });
  it("updates create exactly one review action, adoption keeps current observations and appends review revisions", async () => {
    const f = await joinFixture(),
      p = (await f.workflow.readSource(member, f.participationId)).data;
    const current = (
      await pool.query(
        "select *,start_on::text,end_on::text from activity_periods where participation_id=$1 order by activity_periods.start_on",
        [f.participationId],
      )
    ).rows;
    const detail = (await service.adminDetail(admin, f.id)).data,
      draft = (
        await service.startRevision(context(), f.id, {
          expectedVersion: detail.activity.version,
        })
      ).data;
    draft.content.periodTemplate.target.count = 9;
    await service.updateDraft(context(), f.id, draft.id, {
      expectedVersion: draft.version,
      content: draft.content,
    });
    const preview = (await service.previewDraft(admin, f.id, draft.id)).data;
    const release = (
      await service.publish(context(), f.id, {
        draftId: draft.id,
        expectedDraftVersion: preview.draftVersion,
        expectedCatalogVersion: preview.catalogVersion,
        reviewedContentHash: preview.contentHash,
        changeNote: "target increase",
      })
    ).data;
    await f.workflow.dispatchEvents();
    await f.workflow.dispatchEvents();
    expect(
      (
        await pool.query(
          "select count(*)::int as n from todo_actions where owner_user_id=$1 and action_key=$2",
          [
            member.userId,
            `${f.participationId}:${release.releaseId}:catalog_update`,
          ],
        )
      ).rows[0].n,
    ).toBe(1);
    const diff = (
      await f.workflow.diff(member, f.participationId, release.releaseId!)
    ).data;
    expect(diff.changes.some((c) => c.field === "periodTemplate")).toBe(true);
    const today = new Date().toLocaleDateString("sv-SE", {
      timeZone: "Asia/Shanghai",
    });
    const active = current.filter(
        (x) => x.start_on <= today && x.end_on >= today,
      ),
      future = current.filter((x) => x.start_on > today);
    const beforeActive = active.map((x) => x.target);
    const adopted = await f.workflow.adopt(context(member), f.participationId, {
      expectedVersion: diff.participationVersion,
      targetReleaseId: release.releaseId!,
      affectedFuturePeriodIds: future.map((x) => x.id),
      currentPeriodDecisions: active.map((x) => ({
        periodId: x.id,
        expectedVersion: x.version,
        decision: "create_review_revision",
        note: "preserve current facts",
      })),
      note: "accept future only",
    });
    expect(adopted.kind).toBe("committed");
    for (const [i, x] of active.entries())
      expect(
        (
          await pool.query("select target from activity_periods where id=$1", [
            x.id,
          ])
        ).rows[0].target,
      ).toEqual(beforeActive[i]);
    for (const x of future)
      expect(
        (
          await pool.query("select target from activity_periods where id=$1", [
            x.id,
          ])
        ).rows[0].target.count,
      ).toBe(9);
    expect(
      (await f.workflow.readSource(member, f.participationId)).data.source
        .initialReleaseId,
    ).toBe(p.source.initialReleaseId);
    expect(
      (
        await pool.query(
          "select count(*)::int as n from activity_period_revisions where participation_id=$1",
          [f.participationId],
        )
      ).rows[0].n,
    ).toBe(active.length);
  });
  it("withdraw/join serializes, source remains owner-readable and tracking decisions preserve rewards", async () => {
    const f = await joinFixture(),
      detail = (await service.adminDetail(admin, f.id)).data;
    await service.withdraw(context(), f.id, {
      expectedVersion: detail.activity.version,
      reason: "content withdrawn, bank not cancelled",
    });
    await expect(
      f.workflow.join(context(member), f.id, f.input),
    ).rejects.toMatchObject({ status: 422 });
    await f.workflow.dispatchEvents();
    const source = (await f.workflow.readSource(member, f.participationId))
      .data;
    expect(source.source).toMatchObject({
      publicationStatus: "withdrawn",
      withdrawalReason: "content withdrawn, bank not cancelled",
      bankCancellation: null,
    });
    const p = await service.repository.transaction(
      (tx) => f.workflow.personal.owned(tx, member.userId, f.participationId),
      true,
    );
    await f.workflow.decideTracking(context(member), f.participationId, {
      expectedVersion: p.version,
      noticeId: source.source.noticeId!,
      decision: "stop_future",
      rewardReminderPolicy: "continue",
      note: "keep rewards",
    });
    expect(
      (
        await pool.query(
          "select count(*)::int as n from activity_rewards where participation_id=$1",
          [f.participationId],
        )
      ).rows[0].n,
    ).toBeGreaterThan(0);
  });
  it("composite FK rejects cross-owner/card insertion; private cleanup keeps platform releases", async () => {
    const f = await joinFixture();
    const p = await service.repository.transaction(
      (tx) => f.workflow.personal.owned(tx, member.userId, f.participationId),
      true,
    );
    await expect(
      pool.query(
        "update activity_participations set owner_user_id=$2 where id=$1",
        [p.id, other.userId],
      ),
    ).rejects.toThrow();
    const before = (
      await pool.query("select count(*)::int as n from catalog_releases")
    ).rows[0].n;
    await pool.query(
      "delete from activity_participations where id=$1 and owner_user_id=$2",
      [p.id, member.userId],
    );
    expect(
      (await pool.query("select count(*)::int as n from catalog_releases"))
        .rows[0].n,
    ).toBe(before);
  });

  it("withdraw committed before concurrent join prevents any new private record", async () => {
    const { id, commit } = await publish(),
      workflow = new CatalogParticipationWorkflow(service),
      cardId = await card(member.userId),
      input = await selections(workflow, id, commit.data.releaseId!, member, [
        cardId,
      ]);
    const locked = await pool.connect();
    await locked.query("begin");
    await locked.query(
      "select id from catalog_activities where id=$1 for update",
      [id],
    );
    const withdrawal = service.withdraw(context(), id, {
      expectedVersion: commit.data.version,
      reason: "concurrent withdrawal",
    });
    const waitForLocks = async (n: number) => {
      for (let i = 0; i < 200; i++) {
        const count = (
          await pool.query(
            "select count(*)::int as n from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like '%catalog_activities where id=$1%'",
          )
        ).rows[0].n;
        if (count >= n) return;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      throw new Error("lock wait not observed");
    };
    await waitForLocks(1);
    const joining = workflow.join(context(member), id, input);
    await waitForLocks(2);
    await locked.query("commit");
    locked.release();
    const results = await Promise.allSettled([withdrawal, joining]);
    expect(results[0].status).toBe("fulfilled");
    expect(results[1].status).toBe("rejected");
    expect(
      (
        await pool.query(
          "select count(*)::int as n from activity_participations where card_id=$1",
          [cardId],
        )
      ).rows[0].n,
    ).toBe(0);
  });
  it("a revoked grant lock fences an already-started publisher", async () => {
    const d = (
        await service.createDraft(context(), { content: catalogFixture() })
      ).data,
      p = (await service.previewDraft(admin, d.catalogActivityId, d.id)).data;
    const revoked = await pool.connect();
    await revoked.query("begin");
    await revoked.query(
      "update user_role_grants set revoked_at=now(),version=version+1 where user_id=$1",
      [admin.userId],
    );
    const publishing = service.publish(context(), d.catalogActivityId, {
      draftId: d.id,
      expectedDraftVersion: p.draftVersion,
      expectedCatalogVersion: p.catalogVersion,
      reviewedContentHash: p.contentHash,
      changeNote: "revoked while waiting",
    });
    await revoked.query("commit");
    revoked.release();
    await expect(publishing).rejects.toMatchObject({ status: 403 });
    await pool.query(
      "update user_role_grants set revoked_at=null,version=version+1 where user_id=$1",
      [admin.userId],
    );
    expect(
      (await service.adminDetail(admin, d.catalogActivityId)).data.releases,
    ).toHaveLength(0);
  });
  it("explicit qualification and observations remain separate; adopting a new future rule preserves current facts", async () => {
    const f = await joinFixture(),
      commands = new CatalogPrivateCommands(f.workflow.personal);
    let p = await service.repository.transaction(
      (tx) => f.workflow.personal.owned(tx, member.userId, f.participationId),
      true,
    );
    await commands.check(context(member), p.id, {
      expectedVersion: p.version,
      scope: "participation",
      command: "record_eligibility",
      status: "confirmed",
      note: "bank verified eligibility",
    });
    p = await service.repository.transaction(
      (tx) => f.workflow.personal.owned(tx, member.userId, p.id),
      true,
    );
    await commands.check(context(member), p.id, {
      expectedVersion: p.version,
      scope: "participation",
      command: "record_enrollment",
      status: "confirmed",
      note: "bank confirmed enrollment",
    });
    const task = (
      await pool.query(
        "select t.id from spend_tasks t join activity_periods p on p.id=t.period_id where t.participation_id=$1 and p.start_on<=current_date and p.end_on>=current_date",
        [p.id],
      )
    ).rows[0].id;
    const today = new Date().toLocaleDateString("sv-SE", {
      timeZone: "Asia/Shanghai",
    });
    const t = await service.repository.transaction(
      (tx) => commands.queries.task(tx, member.userId, task),
      true,
    );
    const observed = (
      await commands.taskWrite(context(member), task, "observations", {
        expectedVersion: t.version,
        count: 5,
        amount: "2000.00",
        occurredOn: today,
        stage: "posted",
        note: "member cumulative snapshot",
      })
    ).data.task;
    expect(observed.progressStatus).toBe("reached");
    expect(observed.qualificationStatus).toBe("unknown");
    await commands.taskWrite(context(member), task, "qualification", {
      expectedVersion: observed.version,
      scope: "period",
      periodId: observed.periodId,
      status: "met",
      note: "bank confirmed period target",
    });
    const record = (
      await pool.query(
        "select * from catalog_spend_observations where task_id=$1",
        [task],
      )
    ).rows;
    expect(record).toHaveLength(1);
    const reward = (
      await pool.query(
        "select id from activity_rewards where participation_id=$1",
        [p.id],
      )
    ).rows[0].id;
    expect(
      (
        await service.repository.transaction(
          (tx) => commands.queries.reward(tx, member.userId, reward),
          true,
        )
      ).claimStatus,
    ).toBe("not_submitted");
    const a = (await service.adminDetail(admin, f.id)).data.activity,
      d = (
        await service.startRevision(context(), f.id, {
          expectedVersion: a.version,
        })
      ).data;
    d.content.periodTemplate.target.count = 8;
    d.content.periodTemplate.countingBasis = "settled";
    await service.updateDraft(context(), f.id, d.id, {
      expectedVersion: d.version,
      content: d.content,
    });
    const pv = (await service.previewDraft(admin, f.id, d.id)).data,
      r = (
        await service.publish(context(), f.id, {
          draftId: d.id,
          expectedDraftVersion: pv.draftVersion,
          expectedCatalogVersion: pv.catalogVersion,
          reviewedContentHash: pv.contentHash,
          changeNote: "future target 8",
        })
      ).data;
    const diff = (await f.workflow.diff(member, p.id, r.releaseId!)).data,
      periods = await service.repository.transaction(
        (tx) => f.workflow.personal.periods(tx, p),
        true,
      );
    await f.workflow.adopt(context(member), p.id, {
      expectedVersion: diff.participationVersion,
      targetReleaseId: r.releaseId!,
      affectedFuturePeriodIds: periods
        .filter((x) => x.start_on > today)
        .map((x) => x.id),
      currentPeriodDecisions: periods
        .filter((x) => x.start_on <= today && x.end_on >= today)
        .map((x) => ({
          periodId: x.id,
          expectedVersion: x.version,
          decision: "keep_frozen",
          note: "preserve current met",
        })),
      note: "future only",
    });
    expect(
      (
        await pool.query(
          "select * from catalog_spend_observations where task_id=$1",
          [task],
        )
      ).rows,
    ).toEqual(record);
    expect(
      (
        await service.repository.transaction(
          (tx) => commands.queries.task(tx, member.userId, task),
          true,
        )
      ).targetText,
    ).toContain("5");
    const frozen = await service.repository.transaction(
      (tx) => commands.queries.task(tx, member.userId, task),
      true,
    );
    expect(frozen.countingBasisText).toBe("posted");
    expect(frozen.confirmed.count).toBe(5);
  });
  it("natural end keeps open rewards processable; claim submission/confirmation/partial receipt are distinct facts", async () => {
    const today = new Date().toLocaleDateString("sv-SE", {
        timeZone: "Asia/Shanghai",
      }),
      content = catalogFixture();
    content.start = {
      kind: "date",
      value: "2026-01-01",
      timezone: "Asia/Shanghai",
    };
    content.end = {
      kind: "date",
      value: "2026-01-31",
      timezone: "Asia/Shanghai",
    };
    content.rewards[0].claimStart = {
      kind: "date",
      value: "2026-01-01",
      timezone: "Asia/Shanghai",
    };
    content.rewards[0].claimEnd = {
      kind: "date",
      value: "2027-01-31",
      timezone: "Asia/Shanghai",
    };
    const d = (await service.createDraft(context(), { content })).data,
      pv = (await service.previewDraft(admin, d.catalogActivityId, d.id)).data,
      r = (
        await service.publish(context(), d.catalogActivityId, {
          draftId: d.id,
          expectedDraftVersion: pv.draftVersion,
          expectedCatalogVersion: pv.catalogVersion,
          reviewedContentHash: pv.contentHash,
          changeNote: "ended with future reward window",
        })
      ).data,
      workflow = new CatalogParticipationWorkflow(service),
      cardId = await card(member.userId),
      input = await selections(
        workflow,
        d.catalogActivityId,
        r.releaseId!,
        member,
        [cardId],
      ),
      joined = await workflow.join(context(member), d.catalogActivityId, input);
    if (joined.kind !== "committed") throw new Error("unexpected queue");
    const id = joined.data.items[0].participationId;
    // Arrange historically confirmed facts in this isolated database; no public command fabricates past progress.
    await pool.query(
      "update activity_participations set eligibility='confirmed',enrollment='confirmed' where id=$1",
      [id],
    );
    await pool.query(
      "update activity_periods set qualification='met' where participation_id=$1",
      [id],
    );
    const rewardId = (
        await pool.query(
          "select id from activity_rewards where participation_id=$1",
          [id],
        )
      ).rows[0].id,
      commands = new CatalogPrivateCommands(workflow.personal),
      reward = await service.repository.transaction(
        (tx) => commands.queries.reward(tx, member.userId, rewardId),
        true,
      );
    expect(reward.windowStatus).toBe("open");
    expect(
      reward.allowedCommands.find((c) => c.kind === "claim")?.enabled,
    ).toBe(true);
    const submitted = (
      await commands.rewardWrite(context(member), rewardId, "claim", {
        expectedVersion: reward.version,
        occurredAt: new Date().toISOString(),
        note: "actual bank submission",
      })
    ).data.reward;
    expect(submitted.claimStatus).toBe("submitted");
    expect(submitted.receiptStatus).toBe("not_received");
    const confirmed = (
      await commands.rewardWrite(
        context(member),
        submitted.claimAttempts[0].id,
        "claim_result",
        {
          expectedVersion: 1,
          rewardVersion: submitted.version,
          status: "confirmed",
          note: "bank confirmed claim",
        },
      )
    ).data.reward;
    expect(confirmed.claimStatus).toBe("confirmed");
    expect(confirmed.receiptStatus).toBe("not_received");
    const part = (
      await commands.rewardWrite(context(member), rewardId, "receipt", {
        expectedVersion: confirmed.version,
        receivedOn: today,
        quantity: "40.00",
        note: "partial actual receipt",
      })
    ).data.reward;
    expect(part.receivedText).toBe("40.00");
    expect(part.receiptStatus).toBe("not_received");
    const full = (
      await commands.rewardWrite(context(member), rewardId, "receipt", {
        expectedVersion: part.version,
        receivedOn: today,
        quantity: "60.00",
        note: "rest actual receipt",
      })
    ).data.reward;
    expect(full.receiptStatus).toBe("received");
    expect(full.claimStatus).toBe("confirmed");
  });
  it("private export only contains the owner's aggregates and immutable rule provenance", async () => {
    const mine = await joinFixture(),
      theirs = await joinFixture(other);
    const exported = (await exportCatalogParticipation(member.userId, pool))!;
    for (const [table, rows] of Object.entries(exported)) {
      if (table === "schemaVersion") continue;
      expect(
        (rows as { owner_user_id: string }[]).every(
          (r) => r.owner_user_id === member.userId,
        ),
      ).toBe(true);
    }
    const participations = exported.activity_participations as { id: string }[];
    expect(participations.some((p) => p.id === mine.participationId)).toBe(
      true,
    );
    expect(participations.some((p) => p.id === theirs.participationId)).toBe(
      false,
    );
    const rules = exported.private_rule_versions as { id: string }[];
    await expect(
      pool.query(
        "update private_rule_versions set created_at=created_at+interval '1 second' where id=$1",
        [rules[0].id],
      ),
    ).rejects.toThrow("immutable");
  });
  it("a withdrawal notice survives later draft edits and is consumed exactly once", async () => {
    const f = await joinFixture();
    const a = (await service.adminDetail(admin, f.id)).data.activity;
    const withdrawn = (
      await service.withdraw(context(), f.id, {
        expectedVersion: a.version,
        reason: "official source needs review",
      })
    ).data;
    await service.startRevision(context(), f.id, {
      expectedVersion: withdrawn.version,
    });
    await f.workflow.dispatchEvents(1000);
    await f.workflow.dispatchEvents(1000);
    const source = (await f.workflow.readSource(member, f.participationId))
      .data;
    expect(source.source.withdrawalReason).toBe("official source needs review");
    const notices = (
      await pool.query(
        "select id from todo_actions where participation_id=$1 and action_key like '%:catalog_withdrawn'",
        [f.participationId],
      )
    ).rows;
    expect(notices).toHaveLength(1);
    expect(
      (
        await pool.query(
          "select tracking_decision from activity_participations where id=$1",
          [f.participationId],
        )
      ).rows[0].tracking_decision,
    ).toBe("needs_confirmation");
  });
  it("official cancellation stops spending actions while keeping existing reward facts", async () => {
    const f = await joinFixture(),
      before = (
        await pool.query(
          "select id,claim_status,receipt_status from activity_rewards where participation_id=$1",
          [f.participationId],
        )
      ).rows;
    const a = (await service.adminDetail(admin, f.id)).data.activity;
    const draft = (
      await service.startRevision(context(), f.id, {
        expectedVersion: a.version,
      })
    ).data;
    draft.content.bankCancellation = {
      verifiedAt: "2026-10-01T00:00:00Z",
      reason: "official cancellation confirmed",
      officialSourceUrl: "https://www.cmbchina.com/",
    };
    await service.updateDraft(context(), f.id, draft.id, {
      expectedVersion: draft.version,
      content: draft.content,
    });
    const p = (await service.previewDraft(admin, f.id, draft.id)).data;
    await service.publish(context(), f.id, {
      draftId: p.draftId,
      expectedDraftVersion: p.draftVersion,
      expectedCatalogVersion: p.catalogVersion,
      reviewedContentHash: p.contentHash,
      changeNote: "bank confirmed cancellation",
    });
    await f.workflow.dispatchEvents(1000);
    const periods = (
      await pool.query(
        "select executable,stopped from activity_periods where participation_id=$1",
        [f.participationId],
      )
    ).rows;
    expect(periods.every((p) => !p.executable && p.stopped)).toBe(true);
    expect(
      (
        await pool.query(
          "select count(*)::int as n from todo_actions where participation_id=$1 and node_kind='spend_period' and status='pending'",
          [f.participationId],
        )
      ).rows[0].n,
    ).toBe(0);
    expect(
      (
        await pool.query(
          "select id,claim_status,receipt_status from activity_rewards where participation_id=$1",
          [f.participationId],
        )
      ).rows,
    ).toEqual(before);
    await expect(
      f.workflow.previewJoin(member, f.id, {
        releaseId: (await service.detail(member, f.id)).data.summary.releaseId,
        selections: f.input.selections,
      }),
    ).rejects.toMatchObject({ code: "UNPROCESSABLE_ENTITY" });
  });
  it("claim windows honor exact instants instead of opening or closing at midnight", async () => {
    const now = Date.now(),
      instant = (time: number) => ({
        kind: "instant" as const,
        value: new Date(time).toISOString(),
        timezone: "Asia/Shanghai",
      });
    const future = catalogFixture();
    future.rewards[0].claimStart = instant(now + 3600000);
    future.rewards[0].claimEnd = instant(now + 7200000);
    const past = catalogFixture();
    past.rewards[0].claimStart = instant(now - 7200000);
    past.rewards[0].claimEnd = instant(now - 3600000);
    for (const [content, status] of [
      [future, "not_open"],
      [past, "closed"],
    ] as const) {
      const f = await joinFixture(member, content);
      const rewardId = (
        await pool.query(
          "select id from activity_rewards where participation_id=$1",
          [f.participationId],
        )
      ).rows[0].id;
      const reward = await service.repository.transaction(
        (tx) =>
          new CatalogPrivateQueries(f.workflow.personal).reward(
            tx,
            member.userId,
            rewardId,
          ),
        true,
      );
      expect(reward.windowStatus).toBe(status);
      expect(
        reward.allowedCommands.find((c) => c.kind === "claim")?.enabled,
      ).toBe(false);
    }
  });
  it("bounded notification scans prioritize due work and preserve instant expiry and snooze times", async () => {
    await pool.query(
      "update todo_notification_schedules set status='cancelled' where status='pending'",
    );
    const future = await joinFixture(),
      due = await joinFixture(),
      expired = await joinFixture();
    // Only these three unknown-date eligibility actions receive schedules.
    await pool.query(
      "update todo_notification_schedules set status='cancelled' where status='pending'",
    );
    const now = Date.now();
    const schedule = async (
      f: Awaited<ReturnType<typeof joinFixture>>,
      id: string,
      time: number,
      days: number,
    ) => {
      const a = (
        await pool.query(
          "select id,version from todo_actions where participation_id=$1 and node_kind='eligibility'",
          [f.participationId],
        )
      ).rows[0];
      const deadline = {
        kind: "instant",
        value: new Date(time).toISOString(),
        timezone: "Asia/Shanghai",
      };
      await pool.query("update todo_actions set deadline=$2 where id=$1", [
        a.id,
        deadline,
      ]);
      await pool.query(
        "insert into todo_notification_schedules(id,owner_user_id,action_id,action_version,days_before,deadline) values($1,$2,$3,$4,$5,$6)",
        [id, member.userId, a.id, a.version, days, deadline],
      );
      return { ...a, deadline };
    };
    const f = await schedule(
      future,
      "00000000-0000-0000-0000-000000000001",
      now + 25 * 3600000,
      1,
    );
    const d = await schedule(
      due,
      "ffffffff-ffff-ffff-ffff-fffffffffff1",
      now + 6 * 3600000,
      1,
    );
    const e = await schedule(
      expired,
      "ffffffff-ffff-ffff-ffff-fffffffffff2",
      now - 3600000,
      0,
    );
    await dispatchTodoNotifications(service.repository, 1); // Expired first, then due; future cannot consume the limit.
    await dispatchTodoNotifications(service.repository, 1);
    expect(
      (
        await pool.query(
          "select action_id from todo_notifications where action_id=any($1::uuid[])",
          [[f.id, d.id, e.id]],
        )
      ).rows,
    ).toEqual([{ action_id: d.id }]);
    expect(
      (
        await pool.query(
          "select status from todo_notification_schedules where action_id=$1",
          [f.id],
        )
      ).rows[0].status,
    ).toBe("pending");
    const snooze = await joinFixture();
    await pool.query(
      "update todo_notification_schedules set status='cancelled' where status='pending'",
    );
    const s = await schedule(
      snooze,
      "ffffffff-ffff-ffff-ffff-fffffffffff3",
      now + 6 * 3600000,
      1,
    );
    await pool.query(
      "update activity_participations set node_preferences=$2 where id=$1",
      [
        snooze.participationId,
        JSON.stringify([
          {
            nodeKind: "eligibility",
            showInCalendar: true,
            createTodo: true,
            notifyDaysBefore: [1],
          },
        ]),
      ],
    );
    const writeSnooze = async (version: number, time: number) =>
      service.repository.transaction((tx) =>
        snooze.workflow.personal.todos.command(
          tx,
          member.userId,
          s.id,
          {
            command: "snooze",
            expectedVersion: version,
            snoozedUntil: {
              kind: "instant",
              value: new Date(time).toISOString(),
              timezone: "Asia/Shanghai",
            },
          },
          "Asia/Shanghai",
        ),
      );
    const asleep = await writeSnooze(s.version, now + 3600000);
    expect(asleep.action.deadline).toEqual(s.deadline);
    await dispatchTodoNotifications(service.repository, 100);
    expect(
      (
        await pool.query(
          "select count(*)::int as n from todo_notifications where action_id=$1",
          [s.id],
        )
      ).rows[0].n,
    ).toBe(0);
    await writeSnooze(asleep.action.version, now - 3600000);
    await dispatchTodoNotifications(service.repository, 100);
    await dispatchTodoNotifications(service.repository, 100);
    expect(
      (
        await pool.query(
          "select count(*)::int as n from todo_notifications where action_id=$1",
          [s.id],
        )
      ).rows[0].n,
    ).toBe(1);
  });
  it("real notification delivery is deduplicated and uses one TodoAction for 30/7/1 nodes", async () => {
    const f = await joinFixture(),
      action = (
        await pool.query(
          "select id,version from todo_actions where participation_id=$1 and node_kind='eligibility'",
          [f.participationId],
        )
      ).rows[0],
      today = new Date().toLocaleDateString("sv-SE", {
        timeZone: "Asia/Shanghai",
      }),
      deadline = { kind: "date", value: today, timezone: "Asia/Shanghai" };
    await pool.query("update todo_actions set deadline=$2 where id=$1", [
      action.id,
      deadline,
    ]);
    for (const days of [30, 7, 1])
      await pool.query(
        "insert into todo_notification_schedules(owner_user_id,action_id,action_version,days_before,deadline) values($1,$2,$3,$4,$5)",
        [member.userId, action.id, action.version, days, deadline],
      );
    await dispatchTodoNotifications(service.repository, 1000);
    await dispatchTodoNotifications(service.repository, 1000);
    expect(
      (
        await pool.query(
          "select count(*)::int as n from todo_notifications where action_id=$1",
          [action.id],
        )
      ).rows[0].n,
    ).toBe(1);
    expect(
      (
        await pool.query(
          "select count(*)::int as n from todo_actions where id=$1",
          [action.id],
        )
      ).rows[0].n,
    ).toBe(1);
  });

  it("creates and revises an independent overall task, then evaluates one fact against two tasks",async()=>{
    const personal=workbenchRuntime(pool).workflow.personal;
    const campaign=new CampaignService(personal);
    const cardId=await card(member.userId);
    const today=new Intl.DateTimeFormat("sv-SE",{timeZone:"Asia/Shanghai"}).format(new Date());
    const endOn="2027-01-31";
    const draft={cardId,name:"独立全期任务测试",startOn:today,endOn,sourceLabel:"测试",rulesText:"一次消费",
      enrollmentRequired:"no" as const,channel:"",cycleType:"once" as const,targetKind:"count_and_amount" as const,
      targetCount:1,targetAmount:"10.00",currency:"CNY",countingBasis:"occurred" as const,rewardText:"原文"};
    const definition=(await campaign.create(context(member),draft)).data;
    const joined=(await campaign.join(context(member),definition.id,{cardId,campaignVersion:definition.version,activityInstanceKey:"opaque-overall"})).data;
    const participationId=joined.participationId;
    const plan=(await new PeriodPlanService(personal).propose(context(member),participationId,{
      type:"once",startOn:today,endOn,timezone:"Asia/Shanghai",partialPolicy:"full_target",periods:[],affectedPeriodIds:[],
      targetKind:"count_and_amount",targetCount:1,targetAmount:"10.00",currency:"CNY",ruleVersionId:joined.ruleVersionId,participationVersion:1,mode:"entries",
    })).data;
    expect("jobId" in plan).toBe(false);
    const commands=new CatalogPrivateCommands(personal);
    await commands.check(context(member),participationId,{command:"record_eligibility",scope:"participation",expectedVersion:2,status:"confirmed",note:"资格已核对"});
    const overall=new OverallTaskService(personal);
    const base={key:"annual",startOn:today,endOn,timezone:"Asia/Shanghai",targetKind:"count_and_amount" as const,
      targetCount:1,targetAmount:"10.00",currency:"CNY",mode:"entries" as const,ruleVersionId:joined.ruleVersionId};
    const created=(await overall.create(context(member),participationId,{...base,participationVersion:3})).data;
    expect(created.task.periodId).toBeNull();
    const revised=(await overall.revise(context(member),created.task.id,{...base,targetAmount:"12.00",participationVersion:4,expectedVersion:created.task.version})).data;
    const periodTaskId=(await pool.query("select id from spend_tasks where participation_id=$1 and period_id is not null",[participationId])).rows[0].id;
    const queries=new CatalogPrivateQueries(personal);
    const periodTask=await service.repository.transaction(tx=>queries.task(tx,member.userId,periodTaskId),true);
    const saved=(await new SpendFactService(personal).create(context(member),participationId,{
      count:1,amount:"10.00",occurredOn:today,stage:"occurred",note:"同源双任务",taskVersion:periodTask.version,
      evaluateTaskIds:[periodTaskId,revised.task.id],taskVersions:{[periodTaskId]:periodTask.version,[revised.task.id]:revised.task.version},
    })).data;
    expect(saved.task.confirmed.count).toBe(1);
    const overallAfter=await service.repository.transaction(tx=>queries.task(tx,member.userId,revised.task.id),true);
    expect(overallAfter.confirmed).toMatchObject({count:1,amount:"10.00"});
    expect((await pool.query("select count(*)::int as n from spend_facts where owner_user_id=$1 and card_id=$2",[member.userId,cardId])).rows[0].n).toBe(1);
    expect((await pool.query("select count(*)::int as n from task_evaluations where fact_id=$1",[saved.task.entries[0].id])).rows[0].n).toBe(2);
    await expect(overall.revise(context(member),created.task.id,{...base,participationVersion:6,expectedVersion:overallAfter.version})).rejects.toMatchObject({status:422});
    const exported=(await exportCatalogParticipation(member.userId,pool))!;
    expect((exported.spend_facts as unknown[]).length).toBeGreaterThan(0);
    expect((exported.task_evaluations as unknown[]).length).toBeGreaterThan(1);
  });

  it("freezes an officially checked overall target and keeps dependent rewards tied to it",async()=>{
    const personal=workbenchRuntime(pool).workflow.personal;
    const campaign=new CampaignService(personal);
    const cardId=await card(member.userId);
    const today=new Intl.DateTimeFormat("sv-SE",{timeZone:"Asia/Shanghai"}).format(new Date());
    const endOn=`${Number(today.slice(0,4))+1}-12-31`;
    const draft={cardId,name:"官方核对全期目标",startOn:today,endOn,sourceLabel:"测试",rulesText:"一次消费",
      enrollmentRequired:"no" as const,channel:"",cycleType:"once" as const,targetKind:"count" as const,
      targetCount:1,currency:"CNY",countingBasis:"occurred" as const,rewardText:"原文"};
    const definition=(await campaign.create(context(member),draft)).data;
    const joined=(await campaign.join(context(member),definition.id,{cardId,campaignVersion:definition.version,activityInstanceKey:"official-overall"})).data;
    const participationId=joined.participationId;
    const version=async()=>service.repository.transaction(async tx=>(await personal.owned(tx,member.userId,participationId)).version,true);
    const commands=new CatalogPrivateCommands(personal);
    await commands.check(context(member),participationId,{command:"record_eligibility",scope:"participation",expectedVersion:await version(),status:"confirmed",note:"资格已核对"});
    const overall=new OverallTaskService(personal);
    const base={key:"official",startOn:today,endOn,timezone:"Asia/Shanghai",targetKind:"count" as const,
      targetCount:1,currency:"CNY",mode:"entries" as const,ruleVersionId:joined.ruleVersionId};
    const created=(await overall.create(context(member),participationId,{...base,participationVersion:await version()})).data.task;
    const confirmed=(await commands.taskWrite(context(member),created.id,"qualification",{
      expectedVersion:created.version,scope:"participation",status:"met",note:"官方确认整体目标",
    })).data.task;
    const date={kind:"date" as const,value:today,timezone:"Asia/Shanghai"};
    const reward=(await new ActivityRewardService(personal).create(context(member),participationId,{
      name:"整体目标奖励",type:"cashback",quantity:"10.00",unit:"元",currency:"CNY",scope:"overall",
      requiredPeriodIds:[],overallTaskId:created.id,acquisition:"manual",claimStart:date,claimDeadline:date,
      expectedReceipt:date,channel:"人工",instructions:"核对后领取",receiptRuleText:"到账10元",
      participationVersion:await version(),ruleVersionId:joined.ruleVersionId,
    })).data.reward;
    expect(reward.conditionStatus).toBe("met");
    const changed={...base,targetCount:2,participationVersion:await version()};
    await expect(overall.revise(context(member),created.id,{...changed,expectedVersion:created.version})).rejects.toMatchObject({status:409});
    await expect(overall.revise(context(member),created.id,{...changed,expectedVersion:confirmed.version})).rejects.toMatchObject({status:422});
    const queries=new CatalogPrivateQueries(personal);
    const persisted=await service.repository.transaction(tx=>queries.task(tx,member.userId,created.id),true);
    expect(persisted).toMatchObject({version:confirmed.version,targetText:"1 笔",qualificationStatus:"met"});
    const dependent=await service.repository.transaction(tx=>queries.reward(tx,member.userId,reward.id),true);
    expect(dependent.conditionStatus).toBe("met");
    expect(dependent.conditions).toContainEqual({label:"全期独立任务",taskId:created.id,status:"met"});
    const cleared=(await commands.taskWrite(context(member),created.id,"qualification",{
      expectedVersion:persisted.version,scope:"participation",status:"unknown",note:"官方撤回结论",
    })).data.task;
    await expect(overall.revise(context(member),created.id,{
      ...changed,participationVersion:await version(),expectedVersion:cleared.version,
    })).rejects.toMatchObject({status:422});
    const after=await service.repository.transaction(tx=>queries.reward(tx,member.userId,reward.id),true);
    expect(after.conditionStatus).toBe("unknown");
    expect((await service.repository.transaction(tx=>queries.task(tx,member.userId,created.id),true)).targetText).toBe("1 笔");
  });

  it("persists candidate batches and reclaims an expired lease once across two workers",async()=>{
    const prior={todos:process.env.FEATURE_TODOS,activities:process.env.FEATURE_ACTIVITIES,periods:process.env.FEATURE_ACTIVITY_PERIODS};
    process.env.FEATURE_TODOS="true";process.env.FEATURE_ACTIVITIES="true";process.env.FEATURE_ACTIVITY_PERIODS="true";
    try {
      const personal=workbenchRuntime(pool).workflow.personal;
      const campaign=new CampaignService(personal);
      const cardId=await card(member.userId);
      const startOn="2027-02-01",endOn="2031-02-28";
      const draft={cardId,name:"候选恢复测试",startOn,endOn,sourceLabel:"测试",rulesText:"每月一次",enrollmentRequired:"no" as const,
        channel:"",cycleType:"month" as const,targetKind:"count" as const,targetCount:1,currency:"CNY",countingBasis:"occurred" as const,rewardText:"原文"};
      const definition=(await campaign.create(context(member),draft)).data;
      const joined=(await campaign.join(context(member),definition.id,{cardId,campaignVersion:definition.version,activityInstanceKey:"opaque-job"})).data;
      const queued=(await new PeriodPlanService(personal).propose(context(member),joined.participationId,{
        type:"month",startOn,endOn,timezone:"Asia/Shanghai",partialPolicy:"full_target",periods:[],affectedPeriodIds:[],
        targetKind:"count",targetCount:1,currency:"CNY",ruleVersionId:joined.ruleVersionId,participationVersion:1,mode:"entries",
      })).data;
      if (!("jobId" in queued)) throw new Error("expected job");
      await pool.query(`update workbench_jobs set status='running',lease_token=$2,lease_until=now()-interval '1 second'
        where id=$1`,[queued.jobId,randomUUID()]);
      const repository=new CatalogRepository(pool);
      const results=await Promise.all([reconcileWorkbenchJobs(repository,1),reconcileWorkbenchJobs(repository,1)]);
      expect(results.reduce((n,r)=>n+r.succeeded,0)).toBe(1);
      const job=(await pool.query("select status,attempt,progress from workbench_jobs where id=$1",[queued.jobId])).rows[0];
      expect(job).toMatchObject({status:"succeeded",attempt:2,progress:100});
      expect((await pool.query("select count(*)::int as n from period_plan_candidates where job_id=$1",[queued.jobId])).rows[0].n).toBe(49);
      expect((await pool.query("select count(*)::int as n from activity_periods where participation_id=$1",[joined.participationId])).rows[0].n).toBe(49);
    } finally {
      for(const [key,value] of [["FEATURE_TODOS",prior.todos],["FEATURE_ACTIVITIES",prior.activities],["FEATURE_ACTIVITY_PERIODS",prior.periods]])
        if(value===undefined) delete process.env[key!]; else process.env[key!]=value;
    }
  });

  it("binds todo pagination to response asOf, owner and filters",async()=>{
    const runtime=workbenchRuntime(pool);
    const todos=new TodoService();
    const first=await privateQuery(member,runtime.service,(tx,timezone)=>todos.query(tx,member.userId,timezone,{status:"pending",includeUndated:true,limit:1}));
    expect(first.data.nextCursor).toBeTruthy();
    const asOf=first.meta.asOf,cursor=first.data.nextCursor!;
    const second=await privateQuery(member,runtime.service,(tx,timezone)=>todos.query(tx,member.userId,timezone,{status:"pending",includeUndated:true,limit:1,cursor,asOf}),asOf);
    expect(second.meta.asOf).toBe(asOf);
    if (!first.data.groups || !second.data.groups) throw new Error("expected todo list groups");
    const firstId=first.data.groups.flatMap(g=>g.items)[0].id;
    expect(second.data.groups.flatMap(g=>g.items)[0].id).not.toBe(firstId);
    await expect(privateQuery(other,runtime.service,(tx,timezone)=>todos.query(tx,other.userId,timezone,{status:"pending",includeUndated:true,limit:1,cursor,asOf}))).rejects.toMatchObject({status:400});
    await expect(privateQuery(member,runtime.service,(tx,timezone)=>todos.query(tx,member.userId,timezone,{status:"pending",includeUndated:true,q:"different",limit:1,cursor,asOf}))).rejects.toMatchObject({status:400});
  });
});
