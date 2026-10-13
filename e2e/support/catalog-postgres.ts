import { test as base, expect } from "@playwright/test";
import EmbeddedPostgres from "embedded-postgres";
import { Pool, type PoolClient } from "pg";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { createHash, randomUUID } from "node:crypto";
import { CatalogRepository } from "../../src/modules/activity-catalog/repository";
import { CatalogService } from "../../src/modules/activity-catalog/service";
import { catalogFixture } from "../../tests/catalog/fixture";
import type { CatalogActor } from "../../src/modules/activity-catalog/ports";
export type CatalogDatabase = {
  pool: Pool;
  service: CatalogService;
  admin: CatalogActor;
  member: CatalogActor;
  adminToken: string;
  memberToken: string;
  activityId: string;
  releaseId: string;
  cardId: string;
  close: () => Promise<void>;
};
function closeAfterDisconnect(pool: Pool) {
  const clients = new Set<PoolClient>();
  pool.on("connect", (client) => {
    clients.add(client);
    client.once("end", () => clients.delete(client));
  });
  return async () => {
    // Pool.end() can resolve after removing idle clients but before their sockets
    // disconnect. Wait for those end events before stopping embedded PostgreSQL.
    const disconnected = [...clients].map((client) => new Promise<void>((resolve) => {
      client.once("end", resolve);
    }));
    await pool.end();
    await Promise.all(disconnected);
  };
}
async function startDatabase(): Promise<CatalogDatabase> {
  const dir = await mkdtemp(join(tmpdir(), "cc23-e2e-")),
    port = await new Promise<number>((resolve) => {
      const s = createServer();
      s.listen(0, "127.0.0.1", () => {
        const port = (s.address() as { port: number }).port;
        s.close(() => resolve(port));
      });
    });
  const pg = new EmbeddedPostgres({
    databaseDir: dir,
    port,
    user: "postgres",
    password: "postgres",
    persistent: false,
    initdbFlags: ["--locale=C"],
    onLog: () => undefined,
    onError: () => undefined,
  });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase("catalog_e2e");
  const url = `postgres://postgres:postgres@127.0.0.1:${port}/catalog_e2e`,
    pool = new Pool({ connectionString: url });
  process.env.DATABASE_URL = url;
  process.env.USE_DATABASE = "true";
  process.env.FEATURE_CATALOG_READ = "true";
  process.env.FEATURE_CATALOG_MANAGE = "true";
  process.env.FEATURE_CATALOG_JOIN = "true";
  process.env.FEATURE_TODOS = "true";
  process.env.FEATURE_ACTIVITIES = "true";
  process.env.FEATURE_ACTIVITY_PERIODS = "true";
  const db = await import("../../src/shared/db/client");
  const closeApplicationPool = closeAfterDisconnect(db.getDatabase().pool);
  const closeFixturePool = closeAfterDisconnect(pool);
  for (const name of (await readdir("db/migrations"))
    .filter((n) => n.endsWith(".sql") && !n.startsWith("._"))
    .sort())
    await pool.query(await readFile(join("db/migrations", name), "utf8"));
  const account = async (label: string) => {
    const userId = randomUUID(),
      sessionId = randomUUID(),
      token = randomUUID();
    await pool.query(
      "insert into users(id,email,password_hash,name) values($1,$2,'test-only',$3)",
      [userId, label + "@catalog-e2e.invalid", label],
    );
    await pool.query(
      "insert into sessions(id,user_id,token_hash,expires_at) values($1,$2,$3,now()+interval '1 day')",
      [sessionId, userId, createHash("sha256").update(token).digest("hex")],
    );
    return { actor: { userId, sessionId }, token };
  };
  const a = await account("admin"),
    m = await account("member");
  await pool.query(
    "insert into user_role_grants(user_id,role) values($1,'catalog_admin')",
    [a.actor.userId],
  );
  const cardId = (
    await pool.query(
      "insert into cards(user_id,issuer_name,name,last4,fee_cycle_type,next_fee_date,bank_id) values($1,'招商银行','成员测试卡','1234','custom','2027-01-01','cmb') returning id",
      [m.actor.userId],
    )
  ).rows[0].id;
  const service = new CatalogService(new CatalogRepository(pool)),
    ctx = () => ({ actor: a.actor, idempotencyKey: randomUUID() }),
    d = (await service.createDraft(ctx(), { content: catalogFixture() })).data,
    p = (await service.previewDraft(a.actor, d.catalogActivityId, d.id)).data,
    r = (
      await service.publish(ctx(), d.catalogActivityId, {
        draftId: d.id,
        expectedCatalogVersion: p.catalogVersion,
        expectedDraftVersion: p.draftVersion,
        reviewedContentHash: p.contentHash,
        changeNote: "E2E 隔离数据库规则夹具",
      })
    ).data;
  return {
    pool,
    service,
    admin: a.actor,
    member: m.actor,
    adminToken: a.token,
    memberToken: m.token,
    activityId: d.catalogActivityId,
    releaseId: r.releaseId!,
    cardId,
    close: async () => {
      await closeApplicationPool();
      await closeFixturePool();
      await pg.stop();
      await rm(dir, { recursive: true, force: true });
    },
  };
}
// Actual Request/Response handlers + real PostgreSQL; browser interception only routes
// to this isolated process, keeping the user's development database and server untouched.
export const test = base.extend<
  { catalogHandlers: void },
  { catalogDb: CatalogDatabase }
>({
  catalogDb: [
    async ({}, use) => {
      const db = await startDatabase();
      try {
        await use(db);
      } finally {
        await db.close();
      }
    },
    { scope: "worker" },
  ],
  catalogHandlers: [
    async ({ page, catalogDb }, use) => {
      const routes = [
        {
          pattern: /^\/api\/v1\/cards\/([^/]+)$/,
          params: ["cardId"],
          load: () => import("../../app/api/v1/cards/[cardId]/route"),
        },
        {
          pattern: /^\/api\/v1\/me$/,
          load: () => import("../../app/api/v1/me/route"),
        },
        {
          pattern: /^\/api\/v1\/me\/capabilities$/,
          load: () => import("../../app/api/v1/me/capabilities/route"),
        },
        {
          pattern: /^\/api\/v1\/banks$/,
          load: () => import("../../app/api/v1/banks/route"),
        },
        {
          pattern: /^\/api\/v1\/bank-activities$/,
          load: () => import("../../app/api/v1/bank-activities/route"),
        },
        {
          pattern: /^\/api\/v1\/bank-activities\/([^/]+)$/,
          params: ["id"],
          load: () => import("../../app/api/v1/bank-activities/[id]/route"),
        },
        {
          pattern: /^\/api\/v1\/bank-activities\/([^/]+)\/join-preview$/,
          params: ["id"],
          load: () =>
            import("../../app/api/v1/bank-activities/[id]/join-preview/route"),
        },
        {
          pattern: /^\/api\/v1\/bank-activities\/([^/]+)\/join$/,
          params: ["id"],
          load: () =>
            import("../../app/api/v1/bank-activities/[id]/join/route"),
        },
        {
          pattern: /^\/api\/v1\/catalog-cards$/,
          load: () => import("../../app/api/v1/catalog-cards/route"),
        },
        {
          pattern: /^\/api\/v1\/catalog-cards\/([^/]+)\/bank-association$/,
          params: ["id"],
          load: () =>
            import(
              "../../app/api/v1/catalog-cards/[id]/bank-association/route"
            ),
        },
        {
          pattern: /^\/api\/v1\/workbench\/activities$/,
          load: () => import("../../app/api/v1/workbench/activities/route"),
        },
        {
          pattern: /^\/api\/v1\/workbench\/participations\/([^/]+)$/,
          params: ["id"],
          load: () =>
            import("../../app/api/v1/workbench/participations/[id]/route"),
        },
        {
          pattern:
            /^\/api\/v1\/activity-participations\/([^/]+)\/catalog-source$/,
          params: ["id"],
          load: () =>
            import(
              "../../app/api/v1/activity-participations/[id]/catalog-source/route"
            ),
        },
        {
          pattern:
            /^\/api\/v1\/activity-participations\/([^/]+)\/catalog-diff$/,
          params: ["id"],
          load: () =>
            import(
              "../../app/api/v1/activity-participations/[id]/catalog-diff/route"
            ),
        },
        {
          pattern:
            /^\/api\/v1\/activity-participations\/([^/]+)\/adopt-catalog-release$/,
          params: ["id"],
          load: () =>
            import(
              "../../app/api/v1/activity-participations/[id]/adopt-catalog-release/route"
            ),
        },
        {
          pattern:
            /^\/api\/v1\/activity-participations\/([^/]+)\/catalog-tracking-decisions$/,
          params: ["id"],
          load: () =>
            import(
              "../../app/api/v1/activity-participations/[id]/catalog-tracking-decisions/route"
            ),
        },
        {
          pattern: /^\/api\/v1\/todos$/,
          load: () => import("../../app/api/v1/todos/route"),
        },
        {
          pattern: /^\/api\/v1\/calendar-entries$/,
          load: () => import("../../app/api/v1/calendar-entries/route"),
        },
        {
          pattern: /^\/api\/v1\/todos\/([^/]+)$/,
          params: ["id"],
          load: () => import("../../app/api/v1/todos/[id]/route"),
        },
        {
          pattern: /^\/api\/v1\/todos\/([^/]+)\/actions$/,
          params: ["id"],
          load: () => import("../../app/api/v1/todos/[id]/actions/route"),
        },
        {
          pattern: /^\/api\/v1\/admin\/bank-activities$/,
          load: () => import("../../app/api/v1/admin/bank-activities/route"),
        },
        {
          pattern: /^\/api\/v1\/admin\/bank-activities\/([^/]+)$/,
          params: ["id"],
          load: () =>
            import("../../app/api/v1/admin/bank-activities/[id]/route"),
        },
        {
          pattern: /^\/api\/v1\/admin\/bank-activities\/([^/]+)\/drafts$/,
          params: ["id"],
          load: () =>
            import("../../app/api/v1/admin/bank-activities/[id]/drafts/route"),
        },
        {
          pattern:
            /^\/api\/v1\/admin\/bank-activities\/([^/]+)\/drafts\/([^/]+)$/,
          params: ["id", "draftId"],
          load: () =>
            import(
              "../../app/api/v1/admin/bank-activities/[id]/drafts/[draftId]/route"
            ),
        },
        {
          pattern:
            /^\/api\/v1\/admin\/bank-activities\/([^/]+)\/drafts\/([^/]+)\/preview$/,
          params: ["id", "draftId"],
          load: () =>
            import(
              "../../app/api/v1/admin/bank-activities/[id]/drafts/[draftId]/preview/route"
            ),
        },
        {
          pattern: /^\/api\/v1\/admin\/bank-activities\/([^/]+)\/publish$/,
          params: ["id"],
          load: () =>
            import("../../app/api/v1/admin/bank-activities/[id]/publish/route"),
        },
        {
          pattern: /^\/api\/v1\/admin\/bank-activities\/([^/]+)\/withdraw$/,
          params: ["id"],
          load: () =>
            import(
              "../../app/api/v1/admin/bank-activities/[id]/withdraw/route"
            ),
        },
      ];
      await page.context().addCookies([
        {
          name: "cardcalendar_session",
          value: catalogDb.memberToken,
          url: "http://127.0.0.1:3001",
        },
      ]);
      await page.route("**/api/v1/**", async (route) => {
        const req = route.request(),
          path = new URL(req.url()).pathname,
          entry = routes
            .map((r) => ({ r, match: path.match(r.pattern) }))
            .find((x) => x.match);
        if (!entry) {
          await route.fulfill({
            status: 404,
            json: { error: { message: "未支持的隔离端点 " + path } },
          });
          return;
        }
        const mod = await entry.r.load(),
          handler = (mod as Record<string, unknown>)[req.method()] as (
            r: Request,
            c: { params: Promise<Record<string, string>> },
          ) => Promise<Response>;
        if (!handler) {
          await route.fulfill({ status: 405 });
          return;
        }
        const headers = new Headers(await req.allHeaders());
        headers.set("origin", "http://127.0.0.1:3001");
        const request = new Request(req.url(), {
          method: req.method(),
          headers,
          ...(req.postData() ? { body: req.postData()! } : {}),
        });
        const params: Record<string, string> = {};
        entry.r.params?.forEach(
          (key, i) => (params[key] = entry.match![i + 1]),
        );
        const response = await handler(request, {
          params: Promise.resolve(params),
        });
        await route.fulfill({
          status: response.status,
          headers: Object.fromEntries(response.headers),
          body: await response.text(),
        });
      });
      await use();
    },
    { auto: true },
  ],
});
export { expect };
