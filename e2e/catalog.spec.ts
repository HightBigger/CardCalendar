import { test, expect } from "./support/catalog-postgres";
import { randomUUID } from "node:crypto";
test("real member handlers: discovery/details/read-only preview, explicit join, keyboard and 360px layout", async ({
  page,
  catalogDb: db,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/dev/catalog");
  await expect(
    page.getByRole("heading", { name: "银行活动中心", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: /验收用活动/ })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "design-prototypes/screenshots/cc23-member-360.png",
    fullPage: true,
  });
  await page.goto("/dev/catalog?id=" + db.activityId);
  await expect(
    page.getByRole("button", { name: "加入我的卡片", exact: true }),
  ).toBeEnabled();
  const before = (
    await db.pool.query(
      "select count(*)::int as n from activity_participations where owner_user_id=$1 and card_id=$2 and campaign_id in (select id from private_campaigns where catalog_activity_id=$3)",
      [db.member.userId, db.cardId, db.activityId],
    )
  ).rows[0].n;
  await page.getByRole("button", { name: "加入我的卡片", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "加入我的卡片",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  expect(
    await dialog.evaluate((el) => el.contains(document.activeElement)),
  ).toBe(true);
  await page.keyboard.press("Tab");
  expect(
    await dialog.evaluate((el) => el.contains(document.activeElement)),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole("button", { name: "加入我的卡片", exact: true }),
  ).toBeFocused();
  await page.getByRole("button", { name: "加入我的卡片", exact: true }).click();
  await dialog.getByLabel(/招商银行 · 成员测试卡/).check();
  for (const day of [1, 3, 7, 14, 30])
    await expect(
      dialog.getByLabel(`提前 ${day} 天通知`, { exact: true }),
    ).not.toBeChecked();
  await dialog
    .getByRole("button", { name: "只读预览加入结果", exact: true })
    .click();
  await expect(
    dialog.getByRole("heading", { name: "加入预览（尚未写入）", exact: true }),
  ).toBeVisible();
  expect(
    (
      await db.pool.query(
        "select count(*)::int as n from activity_participations where owner_user_id=$1 and card_id=$2 and campaign_id in (select id from private_campaigns where catalog_activity_id=$3)",
        [db.member.userId, db.cardId, db.activityId],
      )
    ).rows[0].n,
  ).toBe(before);
  await dialog.getByLabel(/我已核对所选卡/).check();
  await dialog
    .getByRole("button", { name: "确认加入我的卡片", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "个人参与已保存" }),
  ).toBeVisible();
  expect(
    (
      await db.pool.query(
        "select count(*)::int as n from activity_participations where owner_user_id=$1 and card_id=$2 and campaign_id in (select id from private_campaigns where catalog_activity_id=$3)",
        [db.member.userId, db.cardId, db.activityId],
      )
    ).rows[0].n,
  ).toBe(before + 1);
  const joined = (await db.pool.query(
    "select id,eligibility,enrollment from activity_participations where owner_user_id=$1 and card_id=$2 and campaign_id in (select id from private_campaigns where catalog_activity_id=$3)",
    [db.member.userId, db.cardId, db.activityId],
  )).rows;
  expect(joined).toHaveLength(1);
  expect(joined[0]).toMatchObject({ eligibility: "unknown", enrollment: "unknown" });
  expect(
    (
      await db.pool.query(
        "select count(*)::int as n from todo_notification_schedules s join todo_actions t on t.id=s.action_id where t.owner_user_id=$1 and t.card_id=$2 and t.participation_id=$3",
        [db.member.userId, db.cardId, joined[0].id],
      )
    ).rows[0].n,
  ).toBe(0);
});
test("real admin handlers: draft edits stay private, preview/publish and withdrawal history", async ({
  page,
  catalogDb: db,
}) => {
  await page.context().addCookies([
    {
      name: "cardcalendar_session",
      value: db.adminToken,
      url: "http://127.0.0.1:3001",
    },
  ]);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/dev/catalog?manage=true&id=" + db.activityId);
  await page.getByRole("button", { name: "建立新版草稿", exact: true }).click();
  await expect(page.getByLabel("活动名称", { exact: true })).toBeVisible();
  await page.getByLabel("活动名称", { exact: true }).fill("E2E 新发布版本");
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "预览并校验发布", exact: true }),
  ).toBeEnabled();
  expect(
    (await db.service.detail(db.member, db.activityId)).data.summary.name,
  ).not.toContain("E2E 新");
  await page
    .getByRole("button", { name: "预览并校验发布", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "发布预览", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("发布或更新说明", { exact: true })
    .fill("核对后的第二版规则");
  await page.getByLabel(/我已核对本预览/).check();
  await page.screenshot({
    path: "design-prototypes/screenshots/cc23-admin-preview-1440.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "确认发布", exact: true }).click();
  await expect(
    page.getByText("已发布，成员可读取此不可变版本。", { exact: true }),
  ).toBeVisible();
  expect(
    (await db.service.detail(db.member, db.activityId)).data.summary.name,
  ).toBe("E2E 新发布版本");
  await page.getByRole("button", { name: "下架活动", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "下架银行活动",
    exact: true,
  });
  await dialog
    .getByLabel("下架原因", { exact: true })
    .fill("官方链接需要重新核对");
  await dialog.getByRole("button", { name: "确认下架", exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(
    (await db.service.adminDetail(db.admin, db.activityId)).data.history.at(-1)
      ?.note,
  ).toBe("官方链接需要重新核对");
});
test("real conflict preserves editor input and revoked old session loses management access", async ({
  page,
  catalogDb: db,
}) => {
  await page.context().addCookies([
    {
      name: "cardcalendar_session",
      value: db.adminToken,
      url: "http://127.0.0.1:3001",
    },
  ]);
  const a = (await db.service.adminDetail(db.admin, db.activityId)).data
    .activity;
  const draft = (
    await db.service.startRevision(
      { actor: db.admin, idempotencyKey: randomUUID() },
      db.activityId,
      { expectedVersion: a.version },
    )
  ).data;
  await page.goto("/dev/catalog?manage=true&id=" + db.activityId);
  await page.getByLabel("活动名称", { exact: true }).fill("保留我的冲突草稿");
  await db.service.updateDraft(
    { actor: db.admin, idempotencyKey: randomUUID() },
    db.activityId,
    draft.id,
    {
      expectedVersion: draft.version,
      content: { ...draft.content, name: "另一个编辑者修改" },
    },
  );
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "草稿已保留" }),
  ).toBeVisible();
  await expect(page.getByLabel("活动名称", { exact: true })).toHaveValue(
    "保留我的冲突草稿",
  );
  await page
    .getByRole("button", { name: "保留输入，使用最新版本重试", exact: true })
    .click();
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "预览并校验发布", exact: true }),
  ).toBeEnabled();
  await db.pool.query(
    "update user_role_grants set revoked_at=now(),version=version+1 where user_id=$1",
    [db.admin.userId],
  );
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(
    page.getByRole("heading", { name: "没有活动管理权限", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("活动名称", { exact: true })).toHaveCount(0);
});
test("real personal detail adopts future rule without changing current target; todos list/calendar keep filters and IDs", async ({
  page,
  catalogDb: db,
}) => {
  // The preceding test revoked the same worker-scoped administrator; restore it through the trusted store.
  await db.pool.query(
    "update user_role_grants set revoked_at=null,version=version+1 where user_id=$1",
    [db.admin.userId],
  );
  const a = (await db.service.adminDetail(db.admin, db.activityId)).data;
  const workflowModule = await import(
      "../src/server/workflows/catalog-participation"
    ),
    workflow = new workflowModule.CatalogParticipationWorkflow(db.service);
  const source = await db.service
    .readRelease(db.admin, db.activityId, a.activity.currentReleaseId!)
    .catch(() => null);
  if (!source) {
    const draft =
        a.draft ??
        (
          await db.service.startRevision(
            { actor: db.admin, idempotencyKey: randomUUID() },
            db.activityId,
            { expectedVersion: a.activity.version },
          )
        ).data,
      p = (await db.service.previewDraft(db.admin, db.activityId, draft.id))
        .data;
    await db.service.publish(
      { actor: db.admin, idempotencyKey: randomUUID() },
      db.activityId,
      {
        draftId: draft.id,
        expectedDraftVersion: p.draftVersion,
        expectedCatalogVersion: p.catalogVersion,
        reviewedContentHash: p.contentHash,
        changeNote: "restore fixture for personal acceptance",
      },
    );
  }
  const current = (await db.service.detail(db.member, db.activityId)).data,
    preview = (
      await workflow.previewJoin(db.member, db.activityId, {
        releaseId: current.release.id,
        selections: [
          {
            cardId: db.cardId,
            acknowledgedUnknownCodes: [],
            boundaries: [],
            nodePreferences: [],
          },
        ],
      })
    ).data;
  const joined = await workflow.join(
    { actor: db.member, idempotencyKey: randomUUID() },
    db.activityId,
    {
      releaseId: current.release.id,
      expectedCatalogVersion: preview.catalogVersion,
      selections: [
        {
          cardId: db.cardId,
          acknowledgedUnknownCodes: preview.items[0].issues
            .filter((x) => x.severity === "blocks_execution")
            .map((x) => x.code),
          boundaries: [],
          nodePreferences: [],
        },
      ],
    },
  );
  if (joined.kind !== "committed") throw new Error("unexpected queue");
  const id = joined.data.items[0].participationId;
  const adm = (await db.service.adminDetail(db.admin, db.activityId)).data,
    dr =
      adm.draft ??
      (
        await db.service.startRevision(
          { actor: db.admin, idempotencyKey: randomUUID() },
          db.activityId,
          { expectedVersion: adm.activity.version },
        )
      ).data;
  dr.content.periodTemplate.target.count = 12;
  await db.service.updateDraft(
    { actor: db.admin, idempotencyKey: randomUUID() },
    db.activityId,
    dr.id,
    { expectedVersion: dr.version, content: dr.content },
  );
  const pv = (await db.service.previewDraft(db.admin, db.activityId, dr.id))
    .data;
  await db.service.publish(
    { actor: db.admin, idempotencyKey: randomUUID() },
    db.activityId,
    {
      draftId: dr.id,
      expectedDraftVersion: pv.draftVersion,
      expectedCatalogVersion: pv.catalogVersion,
      reviewedContentHash: pv.contentHash,
      changeNote: "future target 12",
    },
  );
  await workflow.dispatchEvents();
  await page.goto("/dev/catalog?section=personal&id=" + id);
  await expect(
    page.getByRole("heading", { name: "规则有更新", exact: true }),
  ).toBeVisible();
  await page.getByText("周期及刷卡目标 · 未来周期", { exact: true }).click();
  await expect(
    page
      .locator("details")
      .filter({
        has: page.getByText("周期及刷卡目标 · 未来周期", { exact: true }),
      })
      .locator("pre")
      .first(),
  ).toContainText("5");
  await page
    .getByLabel("2026-11 · 5 笔 且 2000.00 CNY", { exact: true })
    .check();
  await page
    .getByLabel("当前周期决定 · 2026-10", { exact: true })
    .selectOption("keep_frozen");
  await page
    .getByLabel("采用说明", { exact: true })
    .fill("只采用明确选择的未来一期");
  await page.getByLabel(/我已阅读原\/新规则差异/).check();
  await page.getByRole("button", { name: "确认采用新版", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "规则有更新", exact: true }),
  ).toHaveCount(0);
  const periods = (
    await db.pool.query(
      "select period_key,target from activity_periods where participation_id=$1",
      [id],
    )
  ).rows;
  expect(periods.find((p) => p.period_key === "2026-10").target.count).toBe(5);
  expect(periods.find((p) => p.period_key === "2026-11").target.count).toBe(12);
  await page.goto("/dev/catalog?section=todos");
  await page.getByLabel("搜索", { exact: true }).fill("2026-10");
  const actionId = (await db.pool.query(
    "select t.id from todo_actions t join activity_periods p on t.action_key=p.participation_id::text||':'||p.id::text||':spend' where t.owner_user_id=$1 and t.card_id=$2 and t.participation_id=$3 and p.period_key='2026-10'",
    [db.member.userId, db.cardId, id],
  )).rows[0].id;
  const row = page.locator(`.todo-row[data-action-id="${actionId}"]`);
  await expect(row).toBeVisible();
  await page.getByRole("tab", { name: "日历", exact: true }).click();
  await expect(page.getByLabel("搜索", { exact: true })).toHaveValue("2026-10");
  await expect(
    page.locator(`.todo-calendar-entry[data-action-id="${actionId}"]`),
  ).toBeVisible();
});
test("discovery has real empty/error/retry states and admin handlers reject member and x-user-id identity", async ({
  page,
  catalogDb: db,
}) => {
  await page.goto("/dev/catalog");
  await page.getByLabel("关键词", { exact: true }).fill("没有任何结果的关键词");
  await expect(
    page.getByRole("heading", { name: "暂时没有符合条件的活动", exact: true }),
  ).toBeVisible();
  let fail = true;
  await page.route("**/api/v1/bank-activities?**", async (route) => {
    if (fail) {
      fail = false;
      await route.abort();
    } else await route.fallback();
  });
  await page.getByLabel("关键词", { exact: true }).fill("");
  await expect(
    page.getByRole("alert").filter({ hasText: "银行活动暂时无法加载" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "重试", exact: true }).click();
  await expect(page.locator(".catalog-tile")).toHaveCount(1);
  const status = await page.evaluate(async () => {
    const r = await fetch("/api/v1/admin/bank-activities");
    return r.status;
  });
  expect(status).toBe(403);
  const { catalogActor } = await import("../src/server/catalog/http");
  await expect(
    catalogActor(
      new Request("http://127.0.0.1:3001/api/v1/admin/bank-activities", {
        headers: { "x-user-id": db.admin.userId },
      }),
    ),
  ).rejects.toMatchObject({ status: 401 });
});
test("owned bank association is explicit and my-banks filtering never infers issuer names", async ({
  page,
  catalogDb: db,
}) => {
  await db.pool.query("update cards set bank_id=null where id=$1", [db.cardId]);
  const foreignCard = (
    await db.pool.query(
      "insert into cards(user_id,issuer_name,name,last4,fee_cycle_type,next_fee_date) values($1,'招商银行','管理员私人卡','5678','custom','2027-01-01') returning id",
      [db.admin.userId],
    )
  ).rows[0].id;
  await page.goto("/dev/catalog");
  const list = () =>
    page.evaluate(async () => {
      const r = await fetch("/api/v1/bank-activities?myBanksOnly=true");
      return r.json();
    });
  expect((await list()).data.items).toHaveLength(0);
  const associate = (cardId: string, bankId: string) =>
    page.evaluate(
      async ({ cardId, bankId }) => {
        const r = await fetch(
          `/api/v1/catalog-cards/${cardId}/bank-association`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Idempotency-Key": crypto.randomUUID(),
            },
            body: JSON.stringify({ bankId, note: "本人核对统一银行标识" }),
          },
        );
        return { status: r.status, body: await r.json() };
      },
      { cardId, bankId },
    );
  expect((await associate(foreignCard, "cmb")).status).toBe(404);
  expect((await associate(db.cardId, "does-not-exist")).status).toBe(422);
  expect((await associate(db.cardId, "cmb")).status).toBe(200);
  expect((await list()).data.items.map((a: { id: string }) => a.id)).toContain(
    db.activityId,
  );
  expect(
    (
      await db.pool.query("select bank_id from cards where id=$1", [
        foreignCard,
      ])
    ).rows[0].bank_id,
  ).toBeNull();
});
test("selected reminder days persist independently of list/calendar visibility", async ({
  page,
  catalogDb: db,
}) => {
  const id = (
    await db.pool.query(
      "insert into cards(user_id,issuer_name,name,last4,fee_cycle_type,next_fee_date,bank_id) values($1,'招商银行','通知独立设置卡','6789','custom','2027-01-01','cmb') returning id",
      [db.member.userId],
    )
  ).rows[0].id;
  await page.goto("/dev/catalog?id=" + db.activityId);
  await page.getByRole("button", { name: "加入我的卡片", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "加入我的卡片",
    exact: true,
  });
  await dialog.getByLabel(/通知独立设置卡/).check();
  await dialog.getByLabel("创建待办", { exact: true }).uncheck();
  await dialog.getByLabel("在日历显示", { exact: true }).uncheck();
  await dialog.getByLabel("提前 3 天通知", { exact: true }).check();
  await dialog
    .getByRole("button", { name: "只读预览加入结果", exact: true })
    .click();
  await dialog.getByLabel(/我已核对所选卡/).check();
  await dialog
    .getByRole("button", { name: "确认加入我的卡片", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "个人参与已保存" }),
  ).toBeVisible();
  const rows = (
    await db.pool.query(
      "select t.create_todo,t.show_in_calendar,s.days_before from todo_actions t join todo_notification_schedules s on s.action_id=t.id join activity_participations p on p.id=t.participation_id join private_campaigns c on c.id=p.campaign_id where t.owner_user_id=$1 and t.card_id=$2 and c.catalog_activity_id=$3",
      [db.member.userId, id, db.activityId],
    )
  ).rows;
  expect(rows.length).toBeGreaterThan(0);
  expect(
    rows.every(
      (r) => r.days_before === 3 && !r.create_todo && !r.show_in_calendar,
    ),
  ).toBe(true);
});
