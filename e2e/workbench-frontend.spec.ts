import { expect, test } from "@playwright/test";
import { mockMvpAccount } from "./support/mvp-api";

test("todos share filters, IDs and versions across list/calendar, reload and back", async ({ page }) => {
  await page.goto("/dev/workbench?month=2026-10");
  const row = page.locator('[data-action-id="fixture-action-10"]').first();
  await expect(row).toContainText("计划处理：2026-10-09");
  await expect(row.locator(".todo-date strong")).toHaveText("更晚");
  await expect(page.locator('.todo-row[data-action-id="fixture-fee-action"]')).toHaveCount(1);
  await page.getByRole("tab", { name: "日历", exact: true }).click();
  await expect(page.getByRole("button", { name: /1 条未定日期待办/ })).toBeVisible();
  await expect(page.locator('.todo-calendar-entry[data-action-id="fixture-unknown-action"]')).toHaveCount(0);
  await expect(page.locator('.todo-calendar-entry[data-action-id="fixture-action-10"]')).toContainText("待处理");
  await expect(page.locator('.todo-calendar-entry.marker')).toContainText("日期标记");
  await page.getByRole("tab", { name: "列表", exact: true }).click();
  await page.getByLabel("搜索", { exact: true }).fill("10 月");
  await page.getByRole("combobox", { name: "类型", exact: true }).selectOption("spend_period");
  await page.getByLabel("日期从", { exact: true }).fill("2026-10-01");
  await page.getByRole("tab", { name: "日历", exact: true }).click();
  await expect(page.getByLabel("搜索", { exact: true })).toHaveValue("10 月");
  await expect(page.getByRole("combobox", { name: "类型", exact: true })).toHaveValue("spend_period");
  await expect(page.getByLabel("日期从", { exact: true })).toHaveValue("2026-10-01");
  await page.reload(); await expect(page.getByRole("tab", { name: "日历", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: "列表", exact: true }).click();
  await page.goBack(); await expect(page.getByRole("tab", { name: "日历", exact: true })).toHaveAttribute("aria-selected", "true");
});

test("snooze retains a hard deadline and completion changes only the action", async ({ page }) => {
  await page.goto("/dev/workbench?month=2026-10");
  await page.locator('.todo-row[data-action-id="fixture-fee-action"]').getByRole("button", { name: "确认年费处理结果", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "确认年费处理结果", exact: true });
  await dialog.getByRole("button", { name: "明天提示", exact: true }).click();
  await expect(dialog).toContainText("硬性截止保持不变");
  await expect(dialog).toContainText("已逾期 2 天");
  await expect(dialog).toContainText("2026-10-08");
  await dialog.getByRole("button", { name: "标记已处理", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "恢复待办", exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "恢复待办", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "标记已处理", exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "处理年费", exact: true }).click();
  const fee = page.getByRole("dialog", { name: "验收白金卡", exact: true });
  await expect(fee.locator('label:has-text("处理状态") select')).toHaveValue("pending");
});

test("custom undated actions can be created, ignored and restored with history", async ({ page }) => {
  await page.goto("/dev/workbench?month=2026-10");
  await page.getByRole("button", { name: "新增自定义待办", exact: true }).click();
  const form = page.getByRole("dialog", { name: "新增自定义待办", exact: true });
  await form.getByLabel("待办标题", { exact: true }).fill("核对新活动说明");
  await form.getByLabel("说明", { exact: true }).fill("保留未知日期");
  await form.getByRole("button", { name: "保存待办", exact: true }).click();
  await expect(form).toBeHidden();
  const row = page.locator(".todo-row").filter({ hasText: "核对新活动说明" });
  await expect(row).toContainText("日期待核对");
  await row.locator("summary").click(); await row.getByRole("button", { name: "忽略", exact: true }).click();
  await page.getByRole("combobox", { name: "处理状态", exact: true }).selectOption("ignored");
  await row.getByRole("button", { name: "核对新活动说明", exact: true }).click();
  const detail = page.getByRole("dialog", { name: "核对新活动说明", exact: true });
  await expect(detail).toContainText("忽略");
  await detail.getByRole("button", { name: "恢复待办", exact: true }).click();
  await expect(detail).toContainText("恢复");
});

test("retry keeps the same intent key and a conflict preserves the draft until reviewed", async ({ page }) => {
  await page.goto("/dev/workbench?scenario=retry&month=2026-10");
  await page.getByRole("button", { name: "新增自定义待办", exact: true }).click();
  const form = page.getByRole("dialog", { name: "新增自定义待办", exact: true });
  await form.getByLabel("待办标题", { exact: true }).fill("同键重试");
  await form.getByRole("button", { name: "保存待办", exact: true }).click();
  await expect(form).toContainText("模拟网络中断");
  await expect(form.getByLabel("待办标题", { exact: true })).toHaveValue("同键重试");
  await form.getByRole("button", { name: "保存待办", exact: true }).click();
  await expect(form).toBeHidden();
  await expect(page.locator(".todo-row").filter({ hasText: "同键重试" })).toHaveCount(1);
  await page.goto("/dev/workbench?scenario=conflict&month=2026-10");
  await page.locator('.todo-row[data-action-id="fixture-today-custom"]').getByRole("button", { name: "整理活动来源", exact: true }).click();
  await page.getByRole("dialog", { name: "整理活动来源", exact: true }).getByRole("button", { name: "编辑待办", exact: true }).click();
  const edit = page.getByRole("dialog", { name: "编辑自定义待办", exact: true });
  await edit.getByLabel("待办标题", { exact: true }).fill("我的保留草稿");
  await edit.getByRole("button", { name: "保存待办", exact: true }).click();
  await expect(edit).toContainText("草稿已保留");
  await expect(edit).toContainText("另一标签页已更新说明");
  await expect(edit.getByLabel("待办标题", { exact: true })).toHaveValue("我的保留草稿");
  await edit.getByRole("button", { name: "保存待办", exact: true }).click();
  await expect(edit).toBeHidden();
});

test("late responses cannot replace a newer filter and local query failures are retryable", async ({ page }) => {
  await page.goto("/dev/workbench?scenario=late&month=2026-10");
  await expect(page.locator(".todo-row")).toHaveCount(8);
  await page.getByLabel("搜索", { exact: true }).fill("核");
  await page.getByLabel("搜索", { exact: true }).fill("不存在的搜索词");
  await expect(page.getByText("没有符合当前条件的待办", { exact: true })).toBeVisible();
  await page.waitForTimeout(1100);
  await expect(page.locator(".todo-row")).toHaveCount(0);
  await page.goto("/dev/workbench?scenario=error");
  await expect(page.getByRole("alert").filter({ hasText: "模拟待办查询失败" })).toBeVisible();
  await page.getByRole("button", { name: "重试", exact: true }).click();
  await expect(page.locator(".todo-row")).toHaveCount(8);
});

test("360px keyboard actions, dialog focus return and calendar day access", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/dev/workbench?month=2026-10");
  await expect(page.locator(".todo-row")).toHaveCount(8);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
  const add = page.getByRole("button", { name: "新增自定义待办", exact: true }); await add.focus(); await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "新增自定义待办", exact: true });
  await expect(dialog.getByLabel("待办标题", { exact: true })).toBeFocused();
  await page.keyboard.press("Shift+Tab"); await expect(dialog.getByRole("button", { name: "关闭", exact: true })).toBeFocused();
  await page.keyboard.press("Escape"); await expect(dialog).toBeHidden(); await expect(add).toBeFocused();
  await page.getByRole("tab", { name: "日历", exact: true }).click();
  const day = page.getByRole("button", { name: "2026-10-31，1 项", exact: true }); await day.focus(); await page.keyboard.press("Enter");
  await expect(page.getByRole("region", { name: "2026-10-31 当天事项", exact: true })).toContainText("核对 10 月活动达标");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
});

test("periods require both targets and human confirmation while other periods remain independent", async ({ page }) => {
  await page.goto("/dev/workbench?screen=activities&participation=fixture-participation");
  const period = page.locator(".period-card").filter({ hasText: "10 月" });
  await expect(period).toContainText("剩余：2 笔 · 800 元");
  await period.getByRole("button", { name: "更新进度", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "更新进度", exact: true });
  await dialog.getByLabel("累计观察日期", { exact: true }).fill("2026-10-10");
  await dialog.getByRole("combobox", { name: "消费阶段", exact: true }).selectOption("posted");
  await dialog.getByLabel("累计笔数", { exact: true }).fill("5"); await dialog.getByLabel("累计金额（CNY）", { exact: true }).fill("1000.00");
  await dialog.getByRole("button", { name: "保存累计观察", exact: true }).click();
  await expect(dialog.locator(".progress-facts")).toContainText("确定进度未达到目标");
  await dialog.getByLabel("累计笔数", { exact: true }).fill("6"); await dialog.getByLabel("累计金额（CNY）", { exact: true }).fill("2500.00");
  await dialog.getByRole("button", { name: "保存累计观察", exact: true }).click();
  await expect(dialog.locator(".progress-facts")).toContainText("确定目标达到，待人工核对");
  await expect(dialog.locator(".progress-facts")).toContainText("人工达标待核对");
  await dialog.getByRole("combobox", { name: "达标核对结果", exact: true }).selectOption("met");
  await dialog.getByRole("textbox", { name: "达标核对依据", exact: true }).fill("银行已确认本期达标");
  await dialog.getByRole("button", { name: "记录达标核对", exact: true }).click();
  await expect(dialog.locator(".progress-facts")).toContainText("已人工核对达标");
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(page.locator(".reward-card").filter({ hasText: "三期最终返现" })).toContainText("已确认 1/3 期");
  await expect(page.locator(".period-card").filter({ hasText: "11 月" })).toContainText("确定进度：0 笔 · 0 元");
});

test("ended activities retain unclaimed rewards; submitting and confirming claims do not imply receipt", async ({ page }) => {
  await page.goto("/dev/workbench?scenario=claim-open&screen=activities&activityState=unclaimed");
  await expect(page.locator(".activity-card").filter({ hasText: "10—12 月三期返现" })).toContainText("已结束");
  await page.locator(".activity-card").filter({ hasText: "10—12 月三期返现" }).getByRole("button", { name: "查看活动", exact: true }).click();
  await page.locator(".reward-card").filter({ hasText: "三期最终返现" }).getByRole("button", { name: "查看奖励／处理记录", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "记录领取", exact: true });
  await expect(dialog.getByRole("link", { name: "打开官方领取入口", exact: true })).toBeVisible();
  await dialog.getByLabel("实际提交领取时间（Asia/Shanghai）", { exact: true }).fill("2027-01-06T12:00");
  await dialog.getByRole("button", { name: "记录已提交领取", exact: true }).click();
  await expect(dialog).toContainText("已提交领取 · 未确认成功");
  await expect(dialog).toContainText("尚未确认到账");
  await dialog.getByRole("combobox", { name: "要核对的领取提交", exact: true }).selectOption({ index: 1 });
  await dialog.getByRole("button", { name: "记录领取确认", exact: true }).click();
  await expect(dialog).toContainText("已确认领取 · 到账仍待核对");
  await dialog.getByLabel("实际收到日期", { exact: true }).fill("2027-01-07"); await dialog.getByLabel("实际到账数量（元）", { exact: true }).fill("50.00");
  await dialog.getByRole("button", { name: "确认实际到账", exact: true }).click(); await expect(dialog).toContainText("部分到账，剩余仍待核对");
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(page.locator(".reward-card").filter({ hasText: "独立自动发放奖励" })).toContainText("尚未确认到账");
  await page.locator(".reward-card").filter({ hasText: "独立自动发放奖励" }).getByRole("button", { name: "查看奖励／处理记录", exact: true }).click();
  const auto = page.getByRole("dialog", { name: "核对到账", exact: true }); await expect(auto).toContainText("无需主动领取"); await expect(auto.getByRole("button", { name: "记录已提交领取", exact: true })).toHaveCount(0);
});

test("queued and failed bulk plans preserve effective periods and retry after failure", async ({ page }) => {
  const duplicateKeys: string[] = [];
  page.on("console", (message) => { if (/same key|unique.*key/i.test(message.text())) duplicateKeys.push(message.text()); });
  await page.goto("/dev/workbench?scenario=queued-fail&screen=activities&participation=fixture-participation");
  await page.locator(".activity-settings > summary").click();
  const plan = page.getByRole("region", { name: "有限周期计划", exact: true });
  const preferences = page.getByRole("region", { name: "日历与待办节点偏好", exact: true });
  const expectSinglePlan = async (withJob: boolean) => {
    await expect(plan).toHaveCount(1);
    await expect(preferences).toHaveCount(1);
    await expect(page.locator(".job-state")).toHaveCount(withJob ? 1 : 0);
    await expect(page.getByLabel("计划开始", { exact: true })).toHaveCount(1);
  };
  await expectSinglePlan(false);
  const target = plan.getByLabel("计划目标笔数", { exact: true });
  const noticeDays = preferences.getByRole("group", { name: "周期截止", exact: true }).getByLabel("提前通知天数", { exact: true });
  await target.fill("7");
  await noticeDays.fill("3,1");
  const expectDrafts = async () => {
    await expect(target).toHaveValue("7");
    await expect(noticeDays).toHaveValue("3,1");
  };
  await expect(page.locator(".period-card")).toHaveCount(3);
  await page.getByRole("button", { name: "保存并生成周期", exact: true }).click();
  await expect(page.locator(".job-state")).toContainText("排队不表示生效");
  await expectSinglePlan(true);
  await expectDrafts();
  await expect(page.locator(".period-card")).toHaveCount(3);
  await expect(page.locator(".job-state")).toContainText("计划生成失败", { timeout: 10_000 });
  await expectSinglePlan(true);
  await expectDrafts();
  await expect(page.getByLabel("计划开始", { exact: true })).toHaveValue("2026-10-01");
  await page.getByRole("button", { name: "重试生成计划", exact: true }).click();
  await expectSinglePlan(true);
  await expectDrafts();
  await expect(page.locator(".job-state")).toContainText("计划任务已完成", { timeout: 10_000 });
  await expect(page.locator(".period-card")).toHaveCount(3);
  await expectSinglePlan(true);
  await expectDrafts();
  await page.getByRole("button", { name: "重新查询任务", exact: true }).click();
  await expectSinglePlan(true);
  await expectDrafts();
  await preferences.getByRole("button", { name: "保存节点偏好", exact: true }).click();
  await expect(preferences).toContainText("节点偏好已保存");
  await expectSinglePlan(true);
  await expectDrafts();
  // A synchronous save refreshes activity versions without remounting either draft.
  await page.goto("/dev/workbench?screen=activities&participation=fixture-participation");
  await page.locator(".activity-settings > summary").click();
  await expectSinglePlan(false);
  await target.fill("7");
  await noticeDays.fill("3,1");
  await plan.getByRole("button", { name: "保存并生成周期", exact: true }).click();
  await expect(plan).toContainText("计划已由服务端确认保存");
  await expectSinglePlan(false);
  await expectDrafts();
  await preferences.getByRole("button", { name: "保存节点偏好", exact: true }).click();
  await expect(preferences).toContainText("节点偏好已保存");
  await expectSinglePlan(false);
  await expectDrafts();
  expect(duplicateKeys).toEqual([]);
});

test("real routes remain gated and a failing fee query does not block cards or session", async ({ page }) => {
  const todo = await page.goto("/todos"); expect(todo?.status()).toBe(404);
  const activity = await page.goto("/activities"); expect(activity?.status()).toBe(404);
  for (const path of ["/activities/unopened", "/bank-activities", "/bank-activities/unopened", "/admin/bank-activities", "/admin/bank-activities/new", "/admin/bank-activities/unopened"]) {
    const response = await page.request.get(path, { headers: { "x-cardcalendar-pathname": "/" } });
    expect(response.status(), path).toBe(404);
  }
  await mockMvpAccount(page, { feeError: "年费局部故障" });
  await page.goto("/"); await expect(page.getByRole("heading", { name: "账户 A，你好", exact: true })).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "年费局部故障" })).toBeVisible();
  await page.getByRole("button", { name: "我的卡片", exact: true }).click(); await expect(page.getByRole("button", { name: "新增卡片", exact: true })).toBeVisible();
});

test("completing and restoring an action synchronizes the same version in both views", async ({ page }) => {
  await page.goto("/dev/workbench?month=2026-10");
  const row = page.locator('.todo-row[data-action-id="fixture-action-10"]');
  await row.getByRole("button", { name: "核对 10 月活动达标", exact: true }).click();
  const detail = page.getByRole("dialog", { name: "核对 10 月活动达标", exact: true });
  await detail.getByRole("button", { name: "标记已处理", exact: true }).click();
  await detail.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("combobox", { name: "处理状态", exact: true }).selectOption("completed");
  await expect(row).toContainText("已处理");
  const completedVersion = await row.getAttribute("data-version");
  await page.getByRole("tab", { name: "日历", exact: true }).click();
  const entry = page.locator('.todo-calendar-entry[data-action-id="fixture-action-10"]');
  await expect(entry).toContainText("已处理");
  await expect(entry).toHaveAttribute("data-version", completedVersion!);
  await entry.click();
  await detail.getByRole("button", { name: "恢复待办", exact: true }).click();
  await detail.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("combobox", { name: "处理状态", exact: true }).selectOption("pending");
  await expect(entry).toContainText("待处理");
  const restoredVersion = await entry.getAttribute("data-version");
  expect(Number(restoredVersion)).toBeGreaterThan(Number(completedVersion));
  await page.getByRole("tab", { name: "列表", exact: true }).click();
  await expect(row).toHaveAttribute("data-version", restoredVersion!);
});

test("switching accounts unmounts old cards, detail and drafts before delayed responses return", async ({ page }) => {
  const account = await mockMvpAccount(page);
  await page.goto("/cards");
  const a = page.locator(".card-row").filter({ hasText: "A 的卡片" });
  await a.locator(".card-row-main-button").click();
  await expect(page.getByRole("dialog", { name: "A 的卡片", exact: true })).toBeVisible();
  await page.getByRole("dialog", { name: "A 的卡片", exact: true }).getByRole("button", { name: "编辑", exact: true }).click();
  await page.getByRole("dialog", { name: "编辑卡片", exact: true }).getByLabel("卡片名称", { exact: true }).fill("A 私密草稿");
  account.holdAccountA();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(() => account.pendingCount()).toBeGreaterThanOrEqual(2);
  account.switchToB();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  const b = page.locator(".card-row").filter({ hasText: "B 的卡片" });
  await expect(b).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "新增卡片", exact: true }).click();
  await expect(page.getByRole("dialog").getByLabel("卡片名称", { exact: true })).toHaveValue("");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "新增卡片", exact: true })).toBeHidden();
  await account.releaseAccountA();
  await expect(a).toHaveCount(0);
  await expect(b).toBeVisible();
  await b.locator(".card-row-main-button").click();
  await expect(page.getByRole("dialog", { name: "B 的卡片", exact: true })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "B 的卡片", exact: true })).not.toContainText("A 的卡片");
});

test("failed annual fee progress saves retain their input and succeed on explicit retry", async ({ page }) => {
  await mockMvpAccount(page, { failFirstProgress: true });
  await page.goto("/cards");
  await page.locator(".card-row-main-button").click();
  const cycle = page.locator(".cycle-panel").first();
  const form = cycle.locator(".progress-box + .form-grid");
  await form.getByLabel("次数增量", { exact: true }).fill("4");
  await form.getByLabel("备注", { exact: true }).fill("失败保留备注");
  await form.getByRole("button", { name: "追加进度", exact: true }).click();
  await expect(cycle.getByRole("alert")).toContainText("模拟进度保存失败");
  await expect(form.getByLabel("次数增量", { exact: true })).toHaveValue("4");
  await expect(form.getByLabel("备注", { exact: true })).toHaveValue("失败保留备注");
  await form.getByRole("button", { name: "追加进度", exact: true }).click();
  await expect(cycle.locator(".progress-values")).toContainText("4 次");
  await expect(form.getByLabel("次数增量", { exact: true })).toHaveValue("");
});

test("overview and card summary reuse todo and reward forms without mixing card progress", async ({ page }) => {
  await page.goto("/dev/workbench?screen=overview&month=2026-10");
  const attention = page.getByRole("region", { name: "近期待办", exact: true });
  await expect(attention.locator(".todo-preview")).toHaveCount(4);
  await expect(page.getByRole("heading", { level: 2 })).toHaveText(["近期待办", "我的卡片"]);
  await expect(page.locator(".fixture-banner")).not.toHaveAttribute("open");
  await expect(attention.getByText("更多操作", { exact: true })).toHaveCount(0);
  await attention.getByRole("button", { name: "整理活动来源", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "整理活动来源", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await attention.locator('[data-action-id="fixture-fee-action"]').getByRole("button", { name: "处理年费", exact: true }).click();
  const summary = page.getByRole("region", { name: "卡片活动摘要", exact: true });
  await expect(summary.locator(".activity-card")).toHaveCount(2);
  await expect(summary).not.toContainText("另一卡独立活动");
  await summary.getByRole("button", { name: "查看三期最终返现", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "核对领取条件", exact: true })).toContainText("已确认 0/3 期");
});

test("cancelled activity tracking retains rewards and records the chosen reminder policy", async ({ page }) => {
  await page.goto("/dev/workbench?screen=activities&participation=fixture-participation");
  await page.locator(".activity-settings > summary").click();
  await page.getByRole("button", { name: "取消活动跟踪", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "取消活动跟踪", exact: true });
  await expect(dialog.getByRole("button", { name: "确认取消活动跟踪", exact: true })).toBeDisabled();
  await dialog.getByRole("combobox", { name: "未领取奖励提醒", exact: true }).selectOption("keep");
  await dialog.getByLabel("原因或说明", { exact: true }).fill("用户决定停止消费跟踪");
  await dialog.getByRole("button", { name: "确认取消活动跟踪", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator(".period-card").first()).toContainText("已取消");
  await expect(page.locator(".period-card").first().getByRole("button", { name: "更新进度", exact: true })).toBeDisabled();
  await page.locator(".activity-history > summary").click();
  await expect(page.getByText("继续奖励提醒 · 用户决定停止消费跟踪", { exact: false })).toBeVisible();
  await expect(page.locator(".reward-card")).toHaveCount(2);
  await page.locator(".reward-card").filter({ hasText: "三期最终返现" }).getByRole("button", { name: "查看奖励／处理记录", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "核对领取条件", exact: true })).toContainText("尚未确认到账");
});

test("archiving a card requires an explicit reward reminder choice in the new frontend", async ({ page }) => {
  await page.goto("/dev/workbench?month=2026-10");
  await page.locator('.todo-row[data-action-id="fixture-fee-action"]').getByRole("button", { name: "处理年费", exact: true }).click();
  await page.getByRole("dialog", { name: "验收白金卡", exact: true }).getByRole("button", { name: "归档", exact: true }).click();
  const archive = page.getByRole("dialog", { name: "归档卡片", exact: true });
  await expect(archive.getByRole("button", { name: "确认归档卡片", exact: true })).toBeDisabled();
  await archive.getByRole("combobox", { name: "未领取奖励提醒", exact: true }).selectOption("stop");
  await archive.getByRole("button", { name: "确认归档卡片", exact: true }).click();
  await expect(archive).toBeHidden();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.locator('.todo-row[data-action-id="fixture-fee-action"]').getByRole("button", { name: "处理年费", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "验收白金卡", exact: true }).getByRole("button", { name: "恢复使用", exact: true })).toBeVisible();
});


test("activity detail prioritizes progress and keeps participation drafts on a failed save", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/dev/workbench?scenario=retry&screen=activities&participation=fixture-participation");
  await expect(page.getByRole("heading", { name: "本期进度", exact: true })).toBeVisible();
  await expect(page.locator(".period-card:visible")).toHaveCount(1);
  await expect(page.locator(".activity-settings")).not.toHaveAttribute("open");
  await expect(page.getByRole("combobox")).toHaveCount(0);
  await expect(page.getByText("资格、报名与名额核对", { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
  await page.getByRole("button", { name: "确认参与信息", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "参与信息", exact: true });
  await expect(dialog.getByRole("combobox")).toHaveCount(1);
  await expect(dialog.getByRole("button", { name: /活动名额/ })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "保存参与资格结果", exact: true })).toBeDisabled();
  await dialog.getByLabel("参与资格结果", { exact: true }).selectOption("confirmed");
  await dialog.getByLabel("银行反馈或备注", { exact: true }).fill("银行客服已确认可参加");
  await dialog.getByRole("button", { name: "保存参与资格结果", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("模拟网络中断");
  await expect(dialog.getByLabel("银行反馈或备注", { exact: true })).toHaveValue("银行客服已确认可参加");
  await expect(dialog.getByLabel("参与资格结果", { exact: true })).toHaveValue("confirmed");
  await dialog.getByRole("button", { name: "保存参与资格结果", exact: true }).click();
  await expect(dialog.getByRole("status")).toContainText("已保存参与资格结果");
  await dialog.getByRole("button", { name: /活动报名/ }).click();
  await dialog.getByLabel("活动报名结果", { exact: true }).selectOption("confirmed");
  await dialog.getByLabel("银行反馈或备注", { exact: true }).fill("银行 App 显示报名成功");
  await dialog.getByRole("button", { name: "保存活动报名结果", exact: true }).click();
  await expect(dialog.getByRole("status")).toContainText("已保存活动报名结果");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: "查看参与信息", exact: true })).toBeFocused();
  await expect(page.locator(".reward-card").filter({ hasText: "三期最终返现" })).toContainText("已确认 0/3 期");
  await page.locator(".activity-history > summary").click();
  await expect(page.locator(".activity-history")).toContainText("银行客服已确认可参加");
  await expect(page.locator(".activity-history")).toContainText("银行 App 显示报名成功");
});

test("per-period enrollment fixes the scope and never confirms a different month", async ({ page }) => {
  await page.goto("/dev/workbench?scenario=period-enrollment&screen=activities&participation=fixture-participation");
  const october = page.locator(".period-card").filter({ hasText: "10 月" });
  await october.getByRole("button", { name: "确认参与信息", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "10 月 · 参与信息", exact: true });
  await expect(dialog.getByLabel("选择报名周期", { exact: true })).toHaveCount(0);
  await dialog.getByRole("button", { name: /活动报名/ }).click();
  await dialog.getByLabel("活动报名结果", { exact: true }).selectOption("confirmed");
  await dialog.getByLabel("银行反馈或备注", { exact: true }).fill("银行已确认十月报名");
  await dialog.getByRole("button", { name: "保存活动报名结果", exact: true }).click();
  await expect(dialog.getByRole("status")).toContainText("已保存活动报名结果");
  await page.keyboard.press("Escape");
  await page.locator(".other-periods > summary").click();
  const november = page.locator(".period-card").filter({ hasText: "11 月" });
  await november.getByRole("button", { name: "确认参与信息", exact: true }).click();
  const next = page.getByRole("dialog", { name: "11 月 · 参与信息", exact: true });
  await next.getByRole("button", { name: /活动报名/ }).click();
  await expect(next.getByLabel("活动报名结果", { exact: true })).toHaveValue("unknown");
  await page.keyboard.press("Escape");
  await october.getByRole("button", { name: "确认参与信息", exact: true }).click();
  await dialog.getByRole("button", { name: /活动报名/ }).click();
  await expect(dialog.getByLabel("活动报名结果", { exact: true })).toHaveValue("confirmed");
});

test("participation only asks for enrollment and quota when the activity requires them", async ({ page }) => {
  await page.goto("/dev/workbench?scenario=no-enrollment&screen=activities&participation=fixture-participation");
  await page.getByRole("button", { name: "确认参与信息", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "参与信息", exact: true });
  await expect(dialog.getByRole("button", { name: /活动报名|活动名额/ })).toHaveCount(0);
  await expect(dialog.getByLabel("参与资格结果", { exact: true })).toBeVisible();
  await page.goto("/dev/workbench?scenario=quota-required&screen=activities&participation=fixture-participation");
  await page.getByRole("button", { name: "确认参与信息", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "参与信息", exact: true });
  await dialog.getByRole("button", { name: /活动名额/ }).click();
  await expect(dialog.getByLabel("活动名额结果", { exact: true })).toBeVisible();
});
