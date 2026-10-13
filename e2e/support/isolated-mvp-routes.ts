import { test as base, expect } from "@playwright/test";

// Optional browser regression against the actual MVP Request/Response handlers.
// A fresh in-process memory repository avoids shared dev accounts and rate limits.
// This does not exercise Next middleware, HTTP routing or database persistence.
export const test = base.extend<{ isolatedMvpRoutes: void }>({
  isolatedMvpRoutes: [async ({ page }, use) => {
    if (process.env.E2E_ISOLATED_MVP_ROUTES !== "true") { await use(); return; }
    if (process.env.USE_DATABASE === "true") throw new Error("Isolated MVP route tests require the memory repository");
    const routes = [
      { pattern: /^\/api\/v1\/auth\/register$/, module: await import("../../app/api/v1/auth/register/route") },
      { pattern: /^\/api\/v1\/auth\/login$/, module: await import("../../app/api/v1/auth/login/route") },
      { pattern: /^\/api\/v1\/me$/, module: await import("../../app/api/v1/me/route") },
      { pattern: /^\/api\/v1\/cards$/, module: await import("../../app/api/v1/cards/route") },
      { pattern: /^\/api\/v1\/cards\/summary$/, module: await import("../../app/api/v1/cards/summary/route") },
      { pattern: /^\/api\/v1\/cards\/([^/]+)\/cycles$/, param: "cardId", module: await import("../../app/api/v1/cards/[cardId]/cycles/route") },
      { pattern: /^\/api\/v1\/cards\/([^/]+)$/, param: "cardId", module: await import("../../app/api/v1/cards/[cardId]/route") },
      { pattern: /^\/api\/v1\/fee-events$/, module: await import("../../app/api/v1/fee-events/route") },
      { pattern: /^\/api\/v1\/fee-events\/([^/]+)\/history$/, param: "eventId", module: await import("../../app/api/v1/fee-events/[eventId]/history/route") },
      { pattern: /^\/api\/v1\/fee-events\/([^/]+)\/status$/, param: "eventId", module: await import("../../app/api/v1/fee-events/[eventId]/status/route") },
      { pattern: /^\/api\/v1\/cycles\/([^/]+)\/progress-entries$/, param: "cycleId", module: await import("../../app/api/v1/cycles/[cycleId]/progress-entries/route") },
      { pattern: /^\/api\/v1\/cycles\/([^/]+)\/progress-entries\/([^/]+)$/, param: "cycleId", secondParam: "entryId", module: await import("../../app/api/v1/cycles/[cycleId]/progress-entries/[entryId]/route") },
      { pattern: /^\/api\/v1\/cycles\/([^/]+)\/progress-entries\/([^/]+)\/reverse$/, param: "cycleId", secondParam: "entryId", module: await import("../../app/api/v1/cycles/[cycleId]/progress-entries/[entryId]/reverse/route") },
      { pattern: /^\/api\/v1\/reminders$/, module: await import("../../app/api/v1/reminders/route") },
      { pattern: /^\/api\/v1\/reminders\/rules$/, module: await import("../../app/api/v1/reminders/rules/route") },
      { pattern: /^\/api\/v1\/reminders\/([^/]+)\/actions$/, param: "reminderId", module: await import("../../app/api/v1/reminders/[reminderId]/actions/route") },
    ];
    await page.route("**/api/v1/**", async (route) => {
      const outgoing = route.request();
      const pathname = new URL(outgoing.url()).pathname;
      const match = routes.map((candidate) => ({ candidate, captures: pathname.match(candidate.pattern) })).find((item) => item.captures);
      if (!match) { await route.fulfill({ status: 404, json: { error: { message: "Unsupported isolated test route" } } }); return; }
      const handlers = match.candidate.module as Record<string, unknown>;
      const handler = handlers[outgoing.method()] as (request: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response>;
      if (!handler) { await route.fulfill({ status: 405 }); return; }
      const request = new Request(outgoing.url(), { method: outgoing.method(), headers: await outgoing.allHeaders(), ...(outgoing.postData() ? { body: outgoing.postData()! } : {}) });
      const params: Record<string, string> = {};
      if (match.candidate.param) params[match.candidate.param] = match.captures![1];
      if (match.candidate.secondParam) params[match.candidate.secondParam] = match.captures![2];
      const response = await handler(request, { params: Promise.resolve(params) });
      await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() });
    });
    await use();
  }, { auto: true }],
});
export { expect };
