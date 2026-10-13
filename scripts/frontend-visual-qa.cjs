const { chromium, expect } = require("@playwright/test");
const { mkdir, writeFile } = require("node:fs/promises");
const { resolve, join } = require("node:path");

const output = resolve(process.env.FRONTEND_REVIEW_ARTIFACTS || "artifacts/frontend-review-2026-10-10");
const baseURL = process.env.FRONTEND_PREVIEW_URL || "http://127.0.0.1:3001";
const checks = [];

async function main() {
  await mkdir(output, { recursive: true });
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    for (const [size, viewport] of [["desktop", { width: 1440, height: 1000 }], ["mobile", { width: 360, height: 800 }]]) {
      // Each viewport gets its own context before loading any page.
      const context = await browser.newContext({ viewport, reducedMotion: "reduce", timezoneId: "Asia/Shanghai" });
      const page = await context.newPage();
      const pageErrors = [], consoleErrors = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));
      page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
      const goto = (query) => page.goto(baseURL + "/dev/workbench?" + query);
      const capture = async (name) => {
        const layout = await page.evaluate(() => ({
          overflow: document.documentElement.scrollWidth - innerWidth,
          dialogs: Array.from(document.querySelectorAll('[role="dialog"]:not([inert])')).map((dialog) => ({ width: dialog.getBoundingClientRect().width, overflow: dialog.scrollWidth - dialog.clientWidth })),
          planCount: document.querySelectorAll('[aria-label="有限周期计划"]').length,
          preferenceCount: document.querySelectorAll('[aria-label="日历与待办节点偏好"]').length,
          jobCount: document.querySelectorAll(".job-state").length,
        }));
        checks.push({ name, size, viewport, ...layout, pageErrors: [...pageErrors], consoleErrors: [...consoleErrors] });
        await writeFile(join(output, "visual-qa.json"), JSON.stringify({ generatedAt: new Date().toISOString(), source: "read-only development fixtures", checks }, null, 2) + "\n");
        expect(layout.overflow).toBe(0);
        expect(layout.dialogs.every((dialog) => dialog.overflow === 0)).toBe(true);
        expect(pageErrors).toEqual([]);
        expect(consoleErrors).toEqual([]);
        expect(layout.planCount).toBeLessThanOrEqual(1);
        expect(layout.preferenceCount).toBeLessThanOrEqual(1);
        expect(layout.jobCount).toBeLessThanOrEqual(1);
        await page.screenshot({ path: join(output, name + "-" + size + ".png"), fullPage: false, animations: "disabled" });
      };

      await goto("month=2026-10");
      await expect(page.locator(".todo-row")).toHaveCount(8);
      await capture("todos-list");
      await page.getByRole("button", { name: "新增自定义待办", exact: true }).click();
      const custom = page.getByRole("dialog", { name: "新增自定义待办", exact: true });
      await custom.getByLabel("待办标题", { exact: true }).fill("核对下一期活动规则");
      await capture("custom-todo");
      await custom.getByRole("button", { name: "保存待办", exact: true }).scrollIntoViewIfNeeded();
      await capture("custom-todo-submit");
      await page.keyboard.press("Escape");
      await page.getByRole("tab", { name: "日历", exact: true }).click();
      await expect(page.getByRole("grid", { name: "2026-10 月历", exact: true })).toBeVisible();
      await capture("todos-calendar");

      await goto("screen=activities");
      await expect(page.locator(".activity-card")).toHaveCount(3);
      await capture("activities-list");
      await page.getByRole("button", { name: "新增活动", exact: true }).click();
      const editor = page.getByRole("dialog", { name: "新增卡片活动", exact: true });
      await expect(editor).toBeVisible();
      await capture("activity-editor");
      await editor.getByRole("button", { name: "保存活动规则", exact: true }).scrollIntoViewIfNeeded();
      await capture("activity-editor-submit");

      await goto("screen=activities&participation=fixture-participation");
      const plan = page.getByRole("region", { name: "有限周期计划", exact: true });
      await expect(plan).toHaveCount(1);
      await expect(page.locator(".period-card")).toHaveCount(3);
      await capture("activity-detail");
      await plan.scrollIntoViewIfNeeded();
      await capture("period-plan");
      const period = page.locator(".period-card").filter({ hasText: "10 月" });
      await period.getByRole("button", { name: "更新进度／核对达标", exact: true }).click();
      const task = page.getByRole("dialog", { name: "更新进度／核对达标", exact: true });
      await expect(task.locator(".progress-facts")).toBeVisible();
      await capture("period-progress");
      await task.getByRole("button", { name: "记录达标核对", exact: true }).scrollIntoViewIfNeeded();
      await capture("period-progress-submit");

      await goto("scenario=claim-open&screen=activities&participation=fixture-participation");
      await page.locator(".reward-card").filter({ hasText: "三期最终返现" }).getByRole("button", { name: "查看奖励／处理记录", exact: true }).click();
      const reward = page.getByRole("dialog", { name: "记录领取", exact: true });
      await expect(reward.getByRole("link", { name: "打开官方领取入口", exact: true })).toBeVisible();
      await capture("reward-claim");
      await reward.getByRole("button", { name: "确认实际到账", exact: true }).scrollIntoViewIfNeeded();
      await capture("reward-receipt-submit");

      await goto("screen=overview&month=2026-10");
      const attention = page.getByRole("region", { name: "近期待办", exact: true });
      await expect(attention.locator(".todo-row")).toHaveCount(4);
      await capture("overview");
      await attention.locator('[data-action-id="fixture-fee-action"]').getByRole("button", { name: "处理年费", exact: true }).click();
      const summary = page.getByRole("region", { name: "卡片活动摘要", exact: true });
      await expect(summary.locator(".activity-card")).toHaveCount(2);
      await summary.scrollIntoViewIfNeeded();
      await capture("card-summary");

      await goto("scenario=queued-fail&screen=activities&participation=fixture-participation");
      await expect(plan).toHaveCount(1);
      await plan.getByLabel("计划目标笔数", { exact: true }).fill("7");
      await plan.getByRole("button", { name: "保存并生成周期", exact: true }).click();
      const job = page.locator(".job-state");
      await expect(job).toContainText("排队不表示生效");
      await job.scrollIntoViewIfNeeded();
      await capture("plan-queued");
      await expect(job).toContainText("计划生成失败", { timeout: 10000 });
      await capture("plan-failed");
      await plan.getByRole("button", { name: "重试生成计划", exact: true }).click();
      await expect(job).toContainText("计划任务已完成", { timeout: 10000 });
      await capture("plan-succeeded");
      await context.close();
    }
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify({ output, screenshots: checks.length, horizontalOverflow: 0, consoleErrors: 0, pageErrors: 0 }));
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
