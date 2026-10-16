import { expect, test } from "@playwright/test";
import { mockMvpAccount } from "./support/mvp-api";

test.skip(process.env.E2E_ACTIVITY_NAVIGATION !== "true", "Requires FEATURE_ACTIVITIES=true and FEATURE_CATALOG_READ=true on the local app");

for (const width of [360, 1440]) {
  test(`${width}px activity menus keep the shell and session while navigating both ways`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await mockMvpAccount(page);
    const responses: Record<string, unknown> = {
      "/api/v1/me/capabilities": { canReadCatalog: true, canManageCatalog: false, permissionsVersion: 1 },
      "/api/v1/workbench/activities": { items: [], cards: [], total: 0 },
      "/api/v1/workbench/attention": { groups: [], cards: [], total: 0 },
      "/api/v1/banks": [],
      "/api/v1/bank-activities": { items: [], total: 0 },
    };
    let failCatalog = false;
    for (const [path, data] of Object.entries(responses)) {
      await page.route((url) => url.pathname === path, async (route) => {
        if (path === "/api/v1/bank-activities") {
          await new Promise((resolve) => setTimeout(resolve, 250));
          if (failCatalog) {
            await route.fulfill({ status: 503, json: { error: { message: "模拟活动目录暂时不可用" } } });
            return;
          }
        }
        await route.fulfill({ json: { data } });
      });
    }
    await page.goto("/activities");
    await expect(page.getByRole("heading", { name: "卡片活动", exact: true })).toBeVisible();
    const sidebar = await page.locator("#app-sidebar").elementHandle();
    const topbar = await page.locator(".topbar").elementHandle();
    const moreMenu = await page.locator(".nav-more").elementHandle();
    const timeOrigin = await page.evaluate(() => performance.timeOrigin);
    const documents: string[] = [];
    const sessionRequests: string[] = [];
    page.on("request", (request) => {
      if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documents.push(request.url());
      if (["/api/v1/me", "/api/v1/me/capabilities"].includes(new URL(request.url()).pathname)) sessionRequests.push(request.url());
    });
    const navigate = async (name: string, path: string, heading: string, secondary = true) => {
      const menuButton = page.getByRole("button", { name: "打开导航", exact: true });
      if (width === 360 && (await menuButton.getAttribute("aria-expanded")) !== "true") await menuButton.click();
      const more = page.locator(".nav-more");
      if (secondary && !(await more.evaluate((element) => element.hasAttribute("open")))) await more.locator("summary").click();
      await page.getByRole("navigation", { name: secondary ? "更多功能" : "主导航", exact: true }).getByRole("button", { name, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(path + "$"));
      await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
      expect(await sidebar!.evaluate((element) => element.isConnected), "Sidebar must stay mounted during navigation").toBe(true);
      expect(await topbar!.evaluate((element) => element.isConnected), "Top bar must stay mounted during navigation").toBe(true);
      expect(await moreMenu!.evaluate((element) => element.isConnected), "More menu must stay mounted during navigation").toBe(true);
      await expect(page.locator('.nav-item[aria-current="page"]')).toHaveText(name);
      if (width === 360) await expect(page.getByRole("button", { name: "打开导航", exact: true })).toHaveAttribute("aria-expanded", "false");
    };
    await navigate("银行活动", "/bank-activities", "银行活动中心");
    await navigate("我的活动", "/activities", "卡片活动");
    await navigate("银行活动", "/bank-activities", "银行活动中心");
    await navigate("银行活动", "/bank-activities", "银行活动中心");
    await page.goBack();
    await expect(page).toHaveURL(/\/activities$/);
    await expect(page.getByRole("heading", { name: "卡片活动", exact: true })).toBeVisible();
    await page.goForward();
    await expect(page).toHaveURL(/\/bank-activities$/);
    await expect(page.getByRole("heading", { name: "银行活动中心", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "暂时没有符合条件的活动", exact: true })).toBeVisible();
    failCatalog = true;
    await navigate("我的活动", "/activities", "卡片活动");
    await navigate("银行活动", "/bank-activities", "银行活动中心");
    await expect(page.locator("#workspace-content").getByRole("alert")).toContainText("模拟活动目录暂时不可用");
    await expect(page.locator(".loading-page")).toHaveCount(0);
    await navigate("我的活动", "/activities", "卡片活动");
    const more = page.locator(".nav-more");
    await expect(more).toHaveAttribute("open");
    await navigate("首页", "/", "账户 A，你好", false);
    await expect(more).toHaveAttribute("open");
    await navigate("我的卡片", "/cards", "我的卡片", false);
    await expect(more).toHaveAttribute("open");
    if (width === 360) await page.getByRole("button", { name: "打开导航", exact: true }).click();
    await more.locator("summary").click();
    await expect(more).not.toHaveAttribute("open");
    await navigate("首页", "/", "账户 A，你好", false);
    await expect(more).not.toHaveAttribute("open");
    await navigate("我的卡片", "/cards", "我的卡片", false);
    await expect(more).not.toHaveAttribute("open");
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(timeOrigin);
    expect(documents).toEqual([]);
    expect(sessionRequests).toEqual([]);
  });
}
