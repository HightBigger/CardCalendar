import { expect, test } from "@playwright/test";

// Opt in against the local PostgreSQL app with FEATURE_ACTIVITIES=true.
// These flows use actual HTTP, middleware, cookies and database persistence.
test.skip(process.env.E2E_REAL_PRIVATE_WORKBENCH !== "true", "Requires a local app with private workbench features and PostgreSQL enabled");

for (const width of [360, 1280]) {
  test(`${width}px private activity saves simple rules and preserves folded settings after editing`, async ({ page, baseURL }, testInfo) => {
    expect(["localhost", "127.0.0.1", "::1"]).toContain(new URL(baseURL!).hostname);
    await page.setViewportSize({ width, height: 900 });
    const headers = { Origin: baseURL! };
    const email = process.env[`E2E_PRIVATE_EMAIL_${width}`] ?? `private-ui-${width}@example.test`;
    const data = { email, password: "PrivateUiTest@2026!", timezone: "Asia/Shanghai" };
    const login = await page.request.post("/api/v1/auth/login", { headers, data });
    if (login.status() === 401) {
      const registration = await page.request.post("/api/v1/auth/register", { headers, data });
      expect(registration.status()).toBe(201);
    } else expect(login.status()).toBe(200);
    // Reuse this test account's single card on retries instead of registering more accounts.
    const cardsResponse = await page.request.get("/api/v1/cards");
    expect(cardsResponse.status()).toBe(200);
    let card = (await cardsResponse.json()).data[0];
    if (!card) {
      const cardResponse = await page.request.post("/api/v1/cards", { headers, data: {
        issuerName: "联调测试银行", name: "活动联调卡", last4: "7316", annualFeeAmount: 0,
        currency: "CNY", feeCycleType: "custom", nextFeeDate: "2027-10-16", waiveRuleType: "none",
      } });
      expect(cardResponse.status()).toBe(201);
      card = (await cardResponse.json()).data;
    }
    await page.goto("/activities");
    await page.getByRole("button", { name: "新增活动", exact: true }).click();
    let editor = page.getByRole("dialog", { name: "新增卡片活动", exact: true });
    await expect(editor.getByLabel("活动所属卡片", { exact: true })).toHaveValue(card.id);
    await expect(editor.locator(".form-disclosure")).not.toHaveAttribute("open");
    const name = `私人活动联调-${width}-${Date.now()}`;
    await editor.getByLabel("活动名称", { exact: true }).fill(name);
    await editor.getByLabel("规则原文", { exact: true }).fill("银行规则后续补充，暂不确认报名与消费口径。");
    const [joined] = await Promise.all([
      page.waitForResponse((response) => /\/campaigns\/[^/]+\/participations$/.test(new URL(response.url()).pathname) && response.request().method() === "POST"),
      editor.getByRole("button", { name: "保存活动规则", exact: true }).click(),
    ]);
    expect(joined.status()).toBe(200);
    const id = (await joined.json()).data.participationId;
    await expect(editor).toBeHidden();
    await page.reload();
    const row = page.locator(".activity-card").filter({ hasText: name });
    await expect(row).toHaveCount(1);
    await row.getByRole("button", { name: "查看活动", exact: true }).click();
    const read = async () => {
      const response = await page.request.get(`/api/v1/workbench/participations/${id}`);
      expect(response.status()).toBe(200);
      return (await response.json()).data;
    };
    expect((await read()).activity.editorDraft).toMatchObject({ enrollmentRequired: "unknown", targetKind: "custom", currency: "CNY" });
    await page.getByText("规则与来源", { exact: true }).click();
    await page.getByRole("button", { name: "修改活动规则", exact: true }).click();
    editor = page.getByRole("dialog", { name: "记录活动规则修订", exact: true });
    await editor.locator(".form-disclosure > summary").click();
    await editor.getByLabel("是否需要报名", { exact: true }).selectOption("yes");
    await editor.getByLabel("周期类型", { exact: true }).selectOption("month");
    await editor.getByLabel("目标关系", { exact: true }).selectOption("count_and_amount");
    await editor.getByLabel("周期目标笔数", { exact: true }).fill("3");
    await editor.getByLabel("周期目标金额", { exact: true }).fill("500.00");
    await editor.getByLabel("活动币种", { exact: true }).fill("USD");
    await editor.getByLabel("计入口径", { exact: true }).selectOption("posted");
    await editor.getByLabel("官方来源链接", { exact: true }).fill("https://example.com/rules");
    // A hidden invalid field must reopen its section with an actionable error.
    await editor.getByLabel("周期目标笔数", { exact: true }).fill("0");
    await editor.locator(".form-disclosure > summary").click();
    await editor.getByRole("button", { name: "保存活动规则", exact: true }).click();
    await expect(editor.getByRole("alert")).toContainText("请检查更多规则");
    await expect(editor.getByLabel("周期目标笔数", { exact: true })).toBeVisible();
    await editor.getByLabel("周期目标笔数", { exact: true }).fill("3");
    await editor.locator(".form-disclosure > summary").click();
    await editor.getByRole("button", { name: "保存活动规则", exact: true }).click();
    await expect(editor).toBeHidden();
    await page.reload();
    await page.getByText("规则与来源", { exact: true }).click();
    await page.getByRole("button", { name: "修改活动规则", exact: true }).click();
    await expect(editor.locator(".form-disclosure")).not.toHaveAttribute("open");
    await editor.getByLabel("活动名称", { exact: true }).fill(name + "已修订");
    await page.screenshot({ path: testInfo.outputPath("activity-editor.png"), fullPage: true, animations: "disabled" });
    await editor.getByRole("button", { name: "保存活动规则", exact: true }).click();
    await expect(editor).toBeHidden();
    await page.reload();
    await expect(page.getByRole("heading", { name: name + "已修订", exact: true })).toBeVisible();
    expect((await read()).activity.editorDraft).toMatchObject({
      name: name + "已修订", enrollmentRequired: "yes", cycleType: "month", targetKind: "count_and_amount",
      targetCount: 3, targetAmount: "500.00", currency: "USD", countingBasis: "posted", sourceUrl: "https://example.com/rules",
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
    await page.screenshot({ path: testInfo.outputPath("saved-activity.png"), fullPage: true, animations: "disabled" });
  });
}
