import { expect, test } from "@playwright/test";

test("MVP main flow on mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const email = "e2e-" + Date.now() + "@example.com";
  const nextFee = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

  await page.goto("/login");
  await page.getByRole("button", { name: "注册" }).click();
  await page.locator('label:has-text("称呼") input').fill("E2E 用户");
  await page.locator('label:has-text("邮箱") input').fill(email);
  await page.locator('label:has-text("密码") input').fill("password123");
  await page.getByRole("button", { name: "注册并进入" }).click();
  await page.waitForURL("/");
  await expect(page.locator("h1").first()).toContainText("你好", { timeout: 20_000 });

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);

  await page.getByRole("button", { name: "打开导航" }).click();
  await page.getByRole("button", { name: "我的卡片" }).click();
  await page.getByRole("button", { name: "新增卡片" }).click();

  await page.locator('label:has-text("发卡银行") input').fill("测试银行");
  await page.locator('label:has-text("卡片名称") input').fill("E2E白金卡");
  await page.locator('label:has-text("卡号后四位") input').fill("1234");
  await page.locator('label:has-text("年费金额") input').fill("1800");
  await page.locator('label:has-text("下次年费日期") input').fill(nextFee);
  await page.locator('label:has-text("免年费规则") select').selectOption("count");
  await page.locator('label:has-text("目标次数") input').fill("12");
  await page.getByRole("button", { name: "保存卡片" }).click();

  const cardRow = page.locator(".card-row").filter({ hasText: "E2E白金卡" });
  await expect(cardRow).toBeVisible();
  await cardRow.locator(".card-row-main-button").click();

  const cyclePanel = page.locator(".cycle-panel").first();
  await expect(cyclePanel).toBeVisible({ timeout: 20_000 });
  const progressForm = cyclePanel.locator(".progress-box + .form-grid");
  await progressForm.locator('label:has-text("次数增量") input').fill("5");
  await progressForm.locator('label:has-text("备注") input').fill("e2e progress");
  await progressForm.getByRole("button", { name: "追加进度" }).click();
  await expect(page.locator(".cycle-panel").first().locator(".progress-values")).toContainText("5 次");

  const editedPanel = page.locator(".cycle-panel").first();
  await editedPanel.getByRole("button", { name: "编辑" }).click();
  const editForm = editedPanel.locator(".progress-box + .form-grid");
  await editForm.locator('label:has-text("次数增量") input').fill("12");
  await editForm.getByRole("button", { name: "保存修改" }).click();
  await expect(page.locator(".cycle-panel").first().locator(".status-pill.success")).toContainText("已达标", { timeout: 20_000 });
  await expect(page.locator(".dot")).toBeVisible();

  const eventPanel = page.locator(".cycle-panel").first();
  await eventPanel.locator('label:has-text("处理状态") select').selectOption("waived");
  await eventPanel.getByRole("button", { name: "保存事件状态" }).click();
  await expect(page.locator(".cycle-panel").first().locator(".event-history")).toContainText("待确认 → 已免除", { timeout: 20_000 });

  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("button", { name: "提醒", exact: true }).click();
  await expect(page.getByText("没有待处理提醒。")).toBeVisible();

  await page.getByRole("button", { name: "打开导航" }).click();
  await page.getByRole("button", { name: "年费日历" }).click();
  await expect(page.locator(".calendar-grid")).toBeVisible();
  await expect(page.getByRole("tab", { name: "月视图" })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: "列表视图" }).click();
  await expect(page.locator(".calendar-list")).toBeVisible();
});
