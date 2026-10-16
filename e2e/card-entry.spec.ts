import { expect, test } from "./support/isolated-mvp-routes";

for (const width of [360, 1280]) {
  test(`${width}px preview card entries create a saved card that survives reload`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/register");
    await page.getByLabel("邮箱", { exact: true }).fill(`card-entry-${width}-${Date.now()}@example.com`);
    await page.getByLabel("密码", { exact: true }).fill("CardEntryTest@2026!");
    await page.getByLabel(/称呼/).fill("卡片入口验收");
    const [registered] = await Promise.all([
      page.waitForResponse((response) => new URL(response.url()).pathname === "/api/v1/auth/register" && response.request().method() === "POST"),
      page.getByRole("button", { name: "创建账号并进入", exact: true }).click(),
    ]);
    expect(registered.status()).toBe(201);
    await page.waitForURL("/");
    await expect(page.getByRole("region", { name: "我的卡片", exact: true })).toBeVisible();

    // The reported regression: My Cards in the preview opened the activity list.
    await page.goto("/dev/workbench?screen=activities");
    await expect(page.getByRole("heading", { name: "卡片活动", exact: true })).toBeVisible();
    if (width === 360) await page.getByRole("button", { name: "打开导航", exact: true }).click();
    await page.getByRole("button", { name: "我的卡片", exact: true }).click();
    await expect(page).toHaveURL(/\/cards$/);
    await expect(page.getByRole("heading", { name: "我的卡片", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "新增卡片", exact: true }).click();
    const form = page.getByRole("dialog", { name: "新增卡片", exact: true });
    await expect(form).toBeVisible();
    await expect(form.getByRole("combobox", { name: "卡片状态", exact: true })).toHaveCount(0);
    await expect(form.getByRole("combobox", { name: "币种", exact: true })).toBeHidden();
    await expect(form.locator(".card-more-settings")).not.toHaveAttribute("open");
    await page.screenshot({ path: testInfo.outputPath("card-editor.png"), fullPage: true, animations: "disabled" });
    await form.getByText("更多设置", { exact: true }).click();
    await page.screenshot({ path: testInfo.outputPath("card-editor-settings.png"), fullPage: true, animations: "disabled" });
    await page.keyboard.press("Escape");
    await expect(form).toBeHidden();

    // Both card entry points on the preview homepage must leave the fixtures.
    await page.goto("/dev/workbench?screen=overview");
    await page.getByRole("button", { name: "管理卡片", exact: true }).click();
    await expect(page).toHaveURL(/\/cards$/);
    await expect(page.getByRole("heading", { name: "我的卡片", exact: true })).toBeVisible();

    await page.goto("/dev/workbench?screen=overview");
    await page.getByRole("button", { name: "新增卡片", exact: true }).click();
    await expect(form).toBeVisible();
    await expect(page).toHaveURL(/\/cards$/);
    await expect(form.getByLabel("发卡银行", { exact: true })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(form).toBeHidden();
    await page.reload();
    await expect(page.getByRole("heading", { name: "我的卡片", exact: true })).toBeVisible();
    await expect(form).toBeHidden();

    await page.goto("/dev/workbench?screen=overview");
    await page.getByRole("button", { name: "新增卡片", exact: true }).click();
    await expect(form).toBeVisible();
    await form.getByLabel("发卡银行", { exact: true }).fill("验收测试银行");
    await form.getByLabel("卡片名称", { exact: true }).fill(`新增卡片验收-${width}`);
    await form.getByLabel("卡号后四位", { exact: true }).fill("2026");
    await form.getByLabel("年费金额", { exact: true }).fill("800");
    await form.getByLabel("下次年费日期", { exact: true }).fill(new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10));
    await form.getByRole("combobox", { name: "免年费规则", exact: true }).selectOption("count");
    await form.getByLabel("目标次数", { exact: true }).fill("12");
    const [saved] = await Promise.all([
      page.waitForResponse((response) => new URL(response.url()).pathname === "/api/v1/cards" && response.request().method() === "POST"),
      form.getByRole("button", { name: "保存卡片", exact: true }).click(),
    ]);
    expect(saved.status()).toBe(201);
    expect((await saved.json()).data).toMatchObject({ status: "active", currency: "CNY" });
    await expect(form).toBeHidden();
    const card = page.locator(".card-row").filter({ hasText: `新增卡片验收-${width}` });
    await expect(card).toHaveCount(1);
    await expect(card).toBeVisible();
    await page.reload();
    await expect(card).toBeVisible();
    await expect(card).toContainText("2026");
    await expect(form).toBeHidden();
    // Filtering must never claim the account has no cards or force a new card.
    await page.getByRole("searchbox", { name: "搜索卡片", exact: true }).fill("不存在的卡片");
    await expect(page.getByText("没有符合条件的卡片", { exact: true })).toBeVisible();
    await expect(page.getByText("还没有信用卡", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "清除筛选", exact: true }).click();
    await expect(card).toBeVisible();
    await page.locator(".card-list-filters > summary").click();
    await page.getByRole("combobox", { name: "按状态筛选", exact: true }).selectOption("suspended");
    await page.locator(".card-list-filters > summary").click();
    await expect(page.getByText("没有符合条件的卡片", { exact: true })).toBeVisible();
    await expect(page.locator(".card-list-filters > summary")).toContainText("已选 1 项");
    await page.getByRole("button", { name: "清除筛选", exact: true }).click();
    await expect(card).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(0);
    await page.screenshot({ path: testInfo.outputPath("saved-card-after-reload.png"), fullPage: true, animations: "disabled" });
  });
}
