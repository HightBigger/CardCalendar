import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { test, expect } from "./support/card-archive-routes";
import type { CatalogDatabase } from "./support/catalog-postgres";
import { CatalogParticipationWorkflow } from "../src/server/workflows/catalog-participation";
import { CatalogPrivateCommands } from "../src/modules/participation/catalog-commands";

async function joinedCard(db: CatalogDatabase, name: string) {
  // MVP repositories select their data source at import time, after the PG fixture starts.
  const importedCards = await import("../src/modules/cards/service");
  const { createCard } = ("default" in importedCards ? importedCards.default : importedCards) as typeof import("../src/modules/cards/service");
  const card = await createCard(db.member.userId, { issuerName: "招商银行", name, last4: "5678", feeCycleType: "custom", nextFeeDate: "2027-01-01", annualFeeAmount: 800, waiveRuleType: "count", targetCount: 5 });
  await db.pool.query("update cards set bank_id='cmb' where id=$1", [card.id]);
  const workflow = new CatalogParticipationWorkflow(db.service);
  const selections = [{ cardId: card.id, acknowledgedUnknownCodes: [] as string[], boundaries: [], nodePreferences: ["spend_period", "reward_claim"].map((nodeKind) => ({ nodeKind, label: nodeKind, showInCalendar: true, createTodo: true, notifyDaysBefore: [7] })) }];
  const preview = (await workflow.previewJoin(db.member, db.activityId, { releaseId: db.releaseId, selections })).data;
  selections[0].acknowledgedUnknownCodes = preview.items[0].issues.filter((issue) => issue.severity === "blocks_execution").map((issue) => issue.code);
  const result = await workflow.join({ actor: db.member, idempotencyKey: randomUUID() }, db.activityId, { releaseId: db.releaseId, expectedCatalogVersion: preview.catalogVersion, selections });
  if (result.kind !== "committed") throw new Error("Expected isolated join to commit");
  const participationId = result.data.items[0].participationId;
  const commands = new CatalogPrivateCommands(workflow.personal);
  for (const command of ["record_eligibility", "record_enrollment"] as const) {
    const p = await db.service.repository.transaction((tx) => workflow.personal.owned(tx, db.member.userId, participationId), true);
    await commands.check({ actor: db.member, idempotencyKey: randomUUID() }, participationId, { expectedVersion: p.version, scope: "participation", command, status: "confirmed", note: "隔离账户官方核对记录" });
  }
  const taskId = (await db.pool.query("select t.id from spend_tasks t join activity_periods p on p.id=t.period_id where t.participation_id=$1 order by p.start_on limit 1", [participationId])).rows[0].id as string;
  const task = await db.service.repository.transaction((tx) => commands.queries.task(tx, db.member.userId, taskId), true);
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" });
  await commands.taskWrite({ actor: db.member, idempotencyKey: randomUUID() }, taskId, "observations", { expectedVersion: task.version, count: 3, amount: "1200.00", occurredOn: today, stage: "posted", note: "归档前活动消费历史" });
  const cycleId = (await db.pool.query("select id from fee_cycles where card_id=$1 order by period_start desc limit 1", [card.id])).rows[0].id as string;
  const importedProgress = await import("../src/modules/progress/service");
  const { addProgressEntry } = ("default" in importedProgress ? importedProgress.default : importedProgress) as typeof import("../src/modules/progress/service");
  await addProgressEntry(db.member.userId, cycleId, { entryDate: today, countDelta: 2, amountDelta: 0, note: "归档前年费进度历史" });
  return { card, participationId, taskId, periodId: task.periodId, today };
}

async function archiveBusinessSnapshot(db: CatalogDatabase, cardId: string, participationId: string) {
  // Scope every fact to this card/participation; other cases share the worker database.
  // Fee metadata saves may update timestamps without changing the underlying facts.
  const result = await db.pool.query(`select jsonb_build_object(
    'cardLifecycle', (select jsonb_build_object('status', status, 'archivedAt', archived_at) from cards where id=$1),
    'participation', (select to_jsonb(p) from activity_participations p where p.id=$2),
    'periods', (select coalesce(jsonb_agg(to_jsonb(p) order by p.id), '[]'::jsonb) from activity_periods p where p.participation_id=$2),
    'tasks', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb) from spend_tasks t where t.participation_id=$2),
    'observations', (select coalesce(jsonb_agg(to_jsonb(o) order by o.id), '[]'::jsonb) from catalog_spend_observations o where o.participation_id=$2),
    'rewards', (select coalesce(jsonb_agg(to_jsonb(r) order by r.id), '[]'::jsonb) from activity_rewards r where r.participation_id=$2),
    'rewardEvents', (select coalesce(jsonb_agg(to_jsonb(e) order by e.id), '[]'::jsonb) from activity_reward_events e where e.participation_id=$2),
    'actions', (select coalesce(jsonb_agg(to_jsonb(a) order by a.id), '[]'::jsonb) from todo_actions a where a.participation_id=$2),
    'schedules', (select coalesce(jsonb_agg(to_jsonb(s) order by s.id), '[]'::jsonb) from todo_notification_schedules s join todo_actions a on a.id=s.action_id where a.participation_id=$2),
    'notifications', (select coalesce(jsonb_agg(to_jsonb(n) order by n.id), '[]'::jsonb) from todo_notifications n join todo_actions a on a.id=n.action_id where a.participation_id=$2),
    'history', (select coalesce(jsonb_agg(to_jsonb(h) order by h.id), '[]'::jsonb) from catalog_personal_history h where h.participation_id=$2),
    'archiveCommands', (select coalesce(jsonb_agg(to_jsonb(c) order by c.idempotency_key), '[]'::jsonb) from card_archive_commands c where c.card_id=$1),
    'feeCycles', (select coalesce(jsonb_agg(to_jsonb(c) - 'updated_at' order by c.id), '[]'::jsonb) from fee_cycles c where c.card_id=$1),
    'feeEvents', (select coalesce(jsonb_agg(to_jsonb(e) - 'updated_at' order by e.id), '[]'::jsonb) from fee_events e where e.card_id=$1),
    'feeProgress', (select coalesce(jsonb_agg(to_jsonb(p) order by p.id), '[]'::jsonb) from progress_entries p where p.card_id=$1),
    'feeReminders', (select coalesce(jsonb_agg(to_jsonb(r) order by r.id), '[]'::jsonb) from reminders r where r.card_id=$1)
  ) as facts`, [cardId, participationId]);
  return result.rows[0].facts;
}

for (const policy of ["keep", "stop"] as const) {
  test(`real card archive persists ${policy}, preserves metadata edits and history, and disables spending`, async ({ page, catalogDb: db, archiveTransport }) => {
    const fixture = await joinedCard(db, `真实归档 ${policy}`);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (/same key|unique.*key/i.test(message.text())) errors.push(message.text()); });
    await page.setViewportSize(policy === "keep" ? { width: 1440, height: 1000 } : { width: 360, height: 800 });
    const artifactDir = process.env.FRONTEND_REVIEW_ARTIFACTS ? resolve(process.env.FRONTEND_REVIEW_ARTIFACTS) : undefined;
    if (artifactDir) await page.emulateMedia({ reducedMotion: "reduce" });
    const visualChecks: unknown[] = [];
    const capture = async (name: string) => {
      if (!artifactDir) return;
      await mkdir(artifactDir, { recursive: true });
      const metrics = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth - innerWidth, dialogs: Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]:not([inert])')).map((dialog) => ({ width: dialog.getBoundingClientRect().width, overflow: dialog.scrollWidth - dialog.clientWidth })) }));
      expect(metrics.overflow).toBe(0);
      expect(metrics.dialogs.every((dialog) => dialog.overflow === 0)).toBe(true);
      visualChecks.push({ name, policy, viewport: page.viewportSize(), ...metrics, errors: [...errors] });
      await page.screenshot({ path: join(artifactDir, `archive-${policy}-${name}.png`), animations: "disabled" });
      await writeFile(join(artifactDir, `archive-${policy}-qa.json`), JSON.stringify(visualChecks, null, 2) + "\n");
    };
    await page.goto("/dev/cards-review");
    const row = page.locator(".card-row").filter({ hasText: fixture.card.name });
    await row.getByRole("button", { name: "编辑", exact: true }).click();
    const edit = page.getByRole("dialog", { name: "编辑卡片", exact: true });
    await edit.getByText("更多设置", { exact: true }).click();
    const status = edit.getByRole("combobox", { name: "卡片状态", exact: true });
    await expect(status).toBeEnabled();
    await expect(status).toHaveValue("active");
    await expect(status.locator("option")).toHaveText(["使用中", "已停用"]);
    await expect(status.locator('option[value="archived"]')).toHaveCount(0);
    const initialNote = `普通编辑备注 ${policy}`;
    await edit.getByRole("textbox", { name: "备注", exact: true }).fill(initialNote);
    await edit.getByRole("button", { name: "保存卡片", exact: true }).click();
    await expect(edit).toBeHidden();
    expect(archiveTransport.patches).toHaveLength(1);
    expect(archiveTransport.patches[0]).toMatchObject({ cardId: fixture.card.id, status: 200, body: { notes: initialNote } });
    expect(archiveTransport.patches[0].body).not.toHaveProperty("status");
    expect((await db.pool.query("select status, notes from cards where id=$1", [fixture.card.id])).rows[0]).toEqual({ status: "active", notes: initialNote });
    expect(archiveTransport.requests).toHaveLength(0);
    for (const nextStatus of ["suspended", "active"] as const) {
      await row.getByRole("button", { name: "编辑", exact: true }).click();
      await edit.getByText("更多设置", { exact: true }).click();
      await status.selectOption(nextStatus);
      const patchCount = archiveTransport.patches.length;
      await edit.getByRole("button", { name: "保存卡片", exact: true }).click();
      await expect(edit).toBeHidden();
      expect(archiveTransport.patches).toHaveLength(patchCount + 1);
      expect(archiveTransport.patches.at(-1)).toMatchObject({ cardId: fixture.card.id, status: 200, body: { status: nextStatus } });
      expect((await db.pool.query("select status from cards where id=$1", [fixture.card.id])).rows[0].status).toBe(nextStatus);
      if (nextStatus === "suspended") await expect(row).toContainText("已停用");
      else await expect(row).not.toContainText("已停用");
    }
    expect(archiveTransport.requests).toHaveLength(0);
    await row.locator(".card-row-main-button").click();
    const detail = page.getByRole("dialog", { name: fixture.card.name, exact: true });
    await expect(detail).toContainText("归档前年费进度历史");
    await expect(detail.getByRole("button", { name: "追加进度", exact: true })).toBeVisible();
    await detail.getByRole("button", { name: "归档", exact: true }).click();
    const archive = page.getByRole("dialog", { name: "归档卡片", exact: true });
    await expect(archive.getByRole("button", { name: "确认归档卡片", exact: true })).toBeDisabled();
    await archive.getByRole("combobox", { name: "未领取奖励提醒", exact: true }).selectOption(policy);
    const note = `真实保存 ${policy} 归档选择`;
    if (policy === "keep") {
      await archive.getByLabel("原因或说明", { exact: true }).fill(note);
      archiveTransport.failNext();
      await archive.getByRole("button", { name: "确认归档卡片", exact: true }).click();
      await expect(archive.getByRole("alert")).toContainText("模拟传输失败");
      await expect(archive.getByRole("combobox", { name: "未领取奖励提醒", exact: true })).toHaveValue(policy);
      await expect(archive.getByRole("textbox", { name: "原因或说明", exact: true })).toHaveValue(note);
      expect((await db.pool.query("select status from cards where id=$1", [fixture.card.id])).rows[0].status).toBe("active");
    }
    const readCount = archiveTransport.reads.length;
    await capture("confirmation");
    await archive.getByRole("button", { name: "确认归档卡片", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(row).toContainText("已归档");
    for (const path of ["/api/v1/cards", "/api/v1/cards/summary", "/api/v1/fee-events", "/api/v1/reminders"]) {
      await expect.poll(() => archiveTransport.reads.slice(readCount).includes(path)).toBe(true);
    }
    if (policy === "keep") {
      expect(archiveTransport.requests).toHaveLength(2);
      expect(archiveTransport.requests[0].status).toBe(503);
      expect(archiveTransport.requests[1].key).toBe(archiveTransport.requests[0].key);
      expect(archiveTransport.requests[1].body).toEqual(archiveTransport.requests[0].body);
    } else expect(archiveTransport.requests[0].body.note).toBeUndefined();
    expect(archiveTransport.requests.at(-1)?.status).toBe(200);
    const stored = (await db.pool.query("select c.status,p.reward_reminder_policy,p.version from cards c join activity_participations p on p.card_id=c.id where c.id=$1", [fixture.card.id])).rows[0];
    expect(stored.status).toBe("archived");
    expect(stored.reward_reminder_policy).toBe(policy === "keep" ? "continue" : "stop");
    expect((await db.pool.query("select count(*)::int as count from card_archive_commands where card_id=$1", [fixture.card.id])).rows[0].count).toBe(1);
    expect((await db.pool.query("select count(*)::int as count from activity_periods where participation_id=$1 and not stopped", [fixture.participationId])).rows[0].count).toBe(0);
    expect((await db.pool.query("select count(*)::int as count from todo_actions where participation_id=$1 and node_kind='spend_period' and status='pending'", [fixture.participationId])).rows[0].count).toBe(0);
    const schedules = (await db.pool.query("select s.status from todo_notification_schedules s join todo_actions t on t.id=s.action_id where t.participation_id=$1 and t.node_kind='reward_claim'", [fixture.participationId])).rows;
    expect(schedules.length).toBeGreaterThan(0);
    expect(schedules.every((s) => s.status === (policy === "keep" ? "pending" : "cancelled"))).toBe(true);
    // Replaying a committed intent must not repeat history or increment participation versions.
    const last = archiveTransport.requests.at(-1)!;
    const replay = await page.evaluate(async ({ cardId, key, body }) => {
      const response = await fetch(`/api/v1/cards/${cardId}`, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": key }, body: JSON.stringify(body) });
      return { status: response.status, json: await response.json() };
    }, { cardId: fixture.card.id, key: last.key, body: last.body });
    expect(replay.status).toBe(200);
    expect(replay.json.data.rewardReminderPolicy).toBe(stored.reward_reminder_policy);
    expect((await db.pool.query("select version from activity_participations where id=$1", [fixture.participationId])).rows[0].version).toBe(stored.version);
    await page.reload();
    await row.locator(".card-row-main-button").click();
    await expect(detail.getByRole("button", { name: "恢复使用", exact: true })).toBeVisible();
    await expect(detail).toContainText("归档前年费进度历史");
    await expect(detail.getByRole("button", { name: "追加进度", exact: true })).toHaveCount(0);
    await expect(detail.getByRole("button", { name: "设置累计值", exact: true })).toHaveCount(0);
    await capture("card-history");
    await detail.locator(`[data-participation-id="${fixture.participationId}"]`).getByRole("button", { name: "查看活动", exact: true }).click();
    const period = page.locator(`.period-card[data-period-id="${fixture.periodId}"]`);
    await expect(period).toContainText("已取消");
    await expect(period.getByRole("button", { name: "更新进度", exact: true })).toBeDisabled();
    await expect(page.locator(".reward-card")).toHaveCount(1);
    await page.locator(".activity-history > summary").click();
    await expect(page.getByText("card.archived", { exact: false })).toBeVisible();
    await period.scrollIntoViewIfNeeded();
    await capture("periods");
    await period.getByRole("button", { name: "查看进度", exact: true }).click();
    const task = page.getByRole("dialog", { name: "查看进度", exact: true });
    await expect(task).toContainText("归档前活动消费历史");
    await expect(task.locator(".progress-facts")).toContainText("3 笔");
    await expect(task.getByRole("button", { name: "保存累计观察", exact: true })).toBeDisabled();
    await expect(task.getByLabel("累计笔数", { exact: true })).toBeDisabled();
    await expect.poll(() => task.evaluate((dialog) => dialog.contains(document.activeElement))).toBe(true);
    await task.getByRole("combobox", { name: "达标核对结果", exact: true }).selectOption("met");
    await task.getByRole("textbox", { name: "达标核对依据", exact: true }).fill("归档后根据官方记录核对本期达标");
    await task.getByRole("button", { name: "记录达标核对", exact: true }).click();
    await expect(task.locator(".progress-facts")).toContainText("官方已确认达标");
    await task.locator(".progress-facts").scrollIntoViewIfNeeded();
    await capture("task-progress");
    await task.getByText("归档前活动消费历史", { exact: false }).scrollIntoViewIfNeeded();
    await capture("task-history");
    const denied = await page.evaluate(async ({ taskId, today, key }) => {
      const data = (await (await fetch(`/api/v1/spend-tasks/${taskId}`)).json()).data;
      const response = await fetch(`/api/v1/spend-tasks/${taskId}/observations`, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": key }, body: JSON.stringify({ expectedVersion: data.version, count: 6, amount: "2500.00", occurredOn: today, stage: "posted", note: "归档后禁止新增" }) });
      return response.status;
    }, { taskId: fixture.taskId, today: fixture.today, key: randomUUID() });
    expect(denied).toBe(422);
    await task.getByRole("button", { name: "关闭", exact: true }).click();
    await page.locator(".reward-card").getByRole("button", { name: "查看奖励／处理记录", exact: true }).click();
    const reward = page.getByRole("dialog");
    await reward.getByLabel("实际收到日期", { exact: true }).fill(fixture.today);
    await reward.getByLabel("实际到账数量（CNY）", { exact: true }).fill("10.00");
    await reward.getByLabel("到账依据", { exact: true }).fill("归档后核对实际到账");
    await reward.getByRole("button", { name: "确认实际到账", exact: true }).click();
    await expect(reward.locator("p").filter({ hasText: "归档后核对实际到账" })).toHaveCount(1);
    await reward.getByRole("heading", { name: "领取与到账历史", exact: true }).scrollIntoViewIfNeeded();
    await capture("reward-receipt");
    expect((await db.pool.query("select count(*)::int as count from activity_reward_events where participation_id=$1 and event_type='receipt'", [fixture.participationId])).rows[0].count).toBe(1);
    expect((await db.pool.query("select count(*)::int as count from catalog_spend_observations where task_id=$1", [fixture.taskId])).rows[0].count).toBe(1);
    await reward.getByRole("button", { name: "关闭", exact: true }).click();
    await page.goto("/dev/cards-review");
    await expect(row).toContainText("已归档");
    const beforeEdit = await archiveBusinessSnapshot(db, fixture.card.id, fixture.participationId);
    const archiveCount = archiveTransport.requests.length;
    const patchCount = archiveTransport.patches.length;
    await row.getByRole("button", { name: "编辑", exact: true }).click();
    await edit.getByText("更多设置", { exact: true }).click();
    await expect(status).toBeDisabled();
    await expect(status).toHaveValue("archived");
    await expect(status.locator("option")).toHaveText(["已归档"]);
    const editedName = `${fixture.card.name} · 编辑后`;
    const editedNote = `归档后保存名称和备注 ${policy}`;
    await edit.getByRole("textbox", { name: "卡片名称", exact: true }).fill(editedName);
    await edit.getByRole("textbox", { name: "备注", exact: true }).fill(editedNote);
    await status.scrollIntoViewIfNeeded();
    await capture("metadata-edit");
    await edit.getByRole("button", { name: "保存卡片", exact: true }).click();
    await expect(edit).toBeHidden();
    expect(archiveTransport.patches).toHaveLength(patchCount + 1);
    expect(archiveTransport.patches.at(-1)).toMatchObject({ cardId: fixture.card.id, status: 200, body: { name: editedName, notes: editedNote } });
    expect(archiveTransport.patches.at(-1)!.body).not.toHaveProperty("status");
    expect(archiveTransport.requests).toHaveLength(archiveCount);
    expect((await db.pool.query("select status, name, notes from cards where id=$1", [fixture.card.id])).rows[0]).toEqual({ status: "archived", name: editedName, notes: editedNote });
    expect(await archiveBusinessSnapshot(db, fixture.card.id, fixture.participationId)).toEqual(beforeEdit);
    await page.reload();
    const editedRow = page.locator(".card-row").filter({ hasText: editedName });
    await expect(editedRow).toHaveCount(1);
    await editedRow.locator(".card-row-main-button").click();
    const editedDetail = page.getByRole("dialog", { name: editedName, exact: true });
    await expect(editedDetail.locator(".detail-note")).toHaveText(editedNote);
    await expect(editedDetail).toContainText("归档前年费进度历史");
    await expect(editedDetail.getByRole("button", { name: "恢复使用", exact: true })).toBeVisible();
    await expect(editedDetail.getByRole("button", { name: "追加进度", exact: true })).toHaveCount(0);
    expect(await archiveBusinessSnapshot(db, fixture.card.id, fixture.participationId)).toEqual(beforeEdit);
    expect(archiveTransport.requests).toHaveLength(archiveCount);
    expect(errors).toEqual([]);
  });
}
