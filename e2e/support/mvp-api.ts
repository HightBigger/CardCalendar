import type { Page } from "@playwright/test";
import type { ApiCard, ApiUser } from "../../src/contracts/mvp";

// Browser contract tests only; never mutates an account or changes server limits.
export async function mockMvpAccount(page: Page, options: { feeError?: string; failFirstProgress?: boolean } = {}) {
  let account: "A" | "B" = "A";
  let holding = false;
  let writes = 0;
  let progress = 0;
  const pending: Array<() => Promise<void>> = [];
  const card = (owner: string): ApiCard => ({ id: "card-" + owner, issuerName: "测试银行", name: owner + " 的卡片", last4: owner === "A" ? "1234" : "5678", status: "active", annualFeeAmount: 800, currency: "CNY", feeCycleType: "custom", nextFeeDate: "2026-10-31", waiveRuleType: "count", targetCount: 5, createdAt: "2026-10-01T00:00:00Z" });
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const owner = account;
    const cycle = { id: "cycle-" + owner, cardId: "card-" + owner, periodStart: "2026-01-01", periodEnd: "2026-12-31", feeDueDate: "2026-10-31", waiveRuleType: "count", targetCount: 5, status: "open" };
    let data: unknown;
    if (path === "/api/v1/me") data = { id: "account-" + owner, name: "账户 " + owner, email: owner + "@example.invalid", timezone: "Asia/Shanghai", status: "active" } satisfies ApiUser;
    else if (path === "/api/v1/cards" || path === "/api/v1/cards/summary") data = [card(owner)];
    else if (path === "/api/v1/fee-events") {
      if (options.feeError) { await route.fulfill({ status: 503, json: { error: { message: options.feeError } } }); return; }
      data = [{ id: "fee-" + owner, cardId: "card-" + owner, cycleId: cycle.id, dueDate: "2026-10-31", expectedAmount: "800.00", status: "pending" }];
    } else if (path.endsWith("/cycles")) data = [cycle];
    else if (path.endsWith("/progress-entries")) {
      if (route.request().method() === "POST") {
        if (options.failFirstProgress && writes++ === 0) { await route.fulfill({ status: 503, json: { error: { message: "模拟进度保存失败" } } }); return; }
        progress += route.request().postDataJSON().countDelta;
      }
      data = { cycle, entries: [], progress: { count: progress, amount: 0, percentage: progress * 20, qualified: progress >= 5 } };
    } else if (path.endsWith("/history")) data = { history: [], reminders: [] };
    else if (path === "/api/v1/reminders" || path === "/api/v1/reminders/rules") data = [];
    else { await route.fulfill({ status: 404, json: { error: { message: "未定义测试端点 " + path } } }); return; }
    const fulfill = async () => { await route.fulfill({ json: { data } }).catch(() => {}); };
    if (holding && owner === "A" && (path === "/api/v1/cards" || path.endsWith("/cycles"))) pending.push(fulfill);
    else await fulfill();
  });
  return {
    holdAccountA: () => { holding = true; },
    pendingCount: () => pending.length,
    switchToB: () => { account = "B"; },
    releaseAccountA: async () => { holding = false; await Promise.all(pending.splice(0).map((fulfill) => fulfill())); },
  };
}
