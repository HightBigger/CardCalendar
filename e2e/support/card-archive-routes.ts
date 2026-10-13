import { test as catalogTest } from "./catalog-postgres";

type ArchiveRequest = { key: string; body: { action: string; rewardReminderPolicy: string; note?: string }; status: number };
type CardPatch = { cardId: string; body: Record<string, unknown>; status: number };
type ArchiveTransport = { requests: ArchiveRequest[]; patches: CardPatch[]; failNext: () => void; reads: string[] };
type Handler = (request: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response>;
type Entry = { pattern: RegExp; params?: string[]; load: () => Promise<unknown> };

// Additional real handlers run against catalog-postgres's isolated PostgreSQL.
// Only the explicit first-attempt transport failure is simulated.
export const test = catalogTest.extend<{ archiveTransport: ArchiveTransport }>({
  archiveTransport: [async ({ page, catalogHandlers }, use) => {
    void catalogHandlers;
    const requests: ArchiveRequest[] = [], patches: CardPatch[] = [], reads: string[] = [];
    let failNext = false;
    const entries: Entry[] = [
      { pattern: /^\/api\/v1\/cards$/, load: () => import("../../app/api/v1/cards/route") },
      { pattern: /^\/api\/v1\/cards\/summary$/, load: () => import("../../app/api/v1/cards/summary/route") },
      { pattern: /^\/api\/v1\/cards\/([^/]+)$/, params: ["cardId"], load: () => import("../../app/api/v1/cards/[cardId]/route") },
      { pattern: /^\/api\/v1\/cards\/([^/]+)\/cycles$/, params: ["cardId"], load: () => import("../../app/api/v1/cards/[cardId]/cycles/route") },
      { pattern: /^\/api\/v1\/cycles\/([^/]+)\/progress-entries$/, params: ["cycleId"], load: () => import("../../app/api/v1/cycles/[cycleId]/progress-entries/route") },
      { pattern: /^\/api\/v1\/fee-events$/, load: () => import("../../app/api/v1/fee-events/route") },
      { pattern: /^\/api\/v1\/fee-events\/([^/]+)\/history$/, params: ["eventId"], load: () => import("../../app/api/v1/fee-events/[eventId]/history/route") },
      { pattern: /^\/api\/v1\/reminders$/, load: () => import("../../app/api/v1/reminders/route") },
      { pattern: /^\/api\/v1\/reminders\/rules$/, load: () => import("../../app/api/v1/reminders/rules/route") },
      { pattern: /^\/api\/v1\/spend-tasks\/([^/]+)$/, params: ["id"], load: () => import("../../app/api/v1/spend-tasks/[id]/route") },
      { pattern: /^\/api\/v1\/spend-tasks\/([^/]+)\/observations$/, params: ["id"], load: () => import("../../app/api/v1/spend-tasks/[id]/observations/route") },
      { pattern: /^\/api\/v1\/spend-tasks\/([^/]+)\/qualification$/, params: ["id"], load: () => import("../../app/api/v1/spend-tasks/[id]/qualification/route") },
      { pattern: /^\/api\/v1\/activity-participations\/([^/]+)\/rewards$/, params: ["id"], load: () => import("../../app/api/v1/activity-participations/[id]/rewards/route") },
      { pattern: /^\/api\/v1\/activity-rewards\/([^/]+)\/receipt-events$/, params: ["id"], load: () => import("../../app/api/v1/activity-rewards/[id]/receipt-events/route") },
      { pattern: /^\/api\/v1\/workbench\/attention$/, load: () => import("../../app/api/v1/workbench/attention/route") },
    ];
    await page.route("**/api/v1/**", async (route) => {
      const req = route.request(), path = new URL(req.url()).pathname;
      const entry = entries.map((r) => ({ r, match: path.match(r.pattern) })).find((x) => x.match);
      if (!entry) { await route.fallback(); return; }
      if (req.method() === "GET") reads.push(path);
      const archive = req.method() === "POST" && entry.r.params?.[0] === "cardId" && req.postDataJSON()?.action === "archive";
      const attempt = archive ? { key: req.headers()["idempotency-key"], body: req.postDataJSON(), status: 0 } : undefined;
      const patch = req.method() === "PATCH" && entry.r.params?.[0] === "cardId" ? { cardId: entry.match![1], body: req.postDataJSON(), status: 0 } : undefined;
      if (attempt) requests.push(attempt);
      if (patch) patches.push(patch);
      if (attempt && failNext) {
        failNext = false; attempt.status = 503;
        await route.fulfill({ status: 503, json: { error: { code: "TEMPORARY_UNAVAILABLE", message: "模拟传输失败，归档选择和说明已保留" } } }); return;
      }
      const mod = await entry.r.load(), handler = (mod as Record<string, Handler>)[req.method()];
      if (!handler) { await route.fulfill({ status: 405 }); return; }
      const headers = new Headers(await req.allHeaders());
      headers.set("origin", "http://127.0.0.1:3001");
      const request = new Request(req.url(), { method: req.method(), headers, ...(req.postData() ? { body: req.postData()! } : {}) });
      const params: Record<string, string> = {};
      entry.r.params?.forEach((key, i) => { params[key] = entry.match![i + 1]; });
      const response = await handler(request, { params: Promise.resolve(params) });
      if (attempt) attempt.status = response.status;
      if (patch) patch.status = response.status;
      await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() });
    });
    await use({ requests, patches, reads, failNext: () => { failNext = true; } });
  }, { auto: true }],
});
export { expect } from "./catalog-postgres";
