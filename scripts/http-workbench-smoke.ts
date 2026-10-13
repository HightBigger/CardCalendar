import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import EmbeddedPostgres from "embedded-postgres";
import { Client } from "pg";

async function freePort() {
  return new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close((error) => {
        if (error) reject(error);
        else if (address && typeof address !== "string") resolve(address.port);
        else reject(new Error("无法获取 HTTP 端口"));
      });
    });
  });
}

async function migrate(databaseUrl: string) {
  const files = (await readdir("db/migrations"))
    .filter((name) => name.endsWith(".sql") && !name.startsWith("._"))
    .sort();
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    for (const file of files)
      await client.query(await readFile(join("db/migrations", file), "utf8"));
  } finally {
    await client.end();
  }
}

async function waitForServer(url: string, child: ReturnType<typeof spawn>) {
  const deadline = Date.now() + 90_000;
  let last = "";
  child.stderr?.on("data", (chunk) => { last = String(chunk).trim(); });
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url + "/api/v1/campaigns");
      if (response.status === 401) return;
    } catch {
      // Next compiles the route on its first request.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Next HTTP 服务启动超时: " + last);
}

async function main() {
  const databaseDir = await mkdtemp(join(tmpdir(), "cardcalendar-http-pg-"));
  const pgPort = await freePort();
  const httpPort = await freePort();
  const databaseName = "cardcalendar_http";
  const databaseUrl = `postgres://postgres:postgres@127.0.0.1:${pgPort}/${databaseName}`;
  const pg = new EmbeddedPostgres({
    databaseDir,
    port: pgPort,
    user: "postgres",
    password: "postgres",
    persistent: false,
    initdbFlags: ["--locale=C"],
    onLog: () => undefined,
    onError: () => undefined,
  });
  const distDir = `.next-http-smoke-${process.pid}`;
  const configBefore=await readFile("tsconfig.json","utf8");
  let server: ReturnType<typeof spawn> | undefined;
  try {
    await pg.initialise();
    await pg.start();
    await pg.createDatabase(databaseName);
    await migrate(databaseUrl);

    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    const userId = randomUUID();
    const token = randomUUID();
    const sessionId = randomUUID();
    const cardId = randomUUID();
    await client.query("insert into users(id,email,password_hash,name) values($1,$2,'http-smoke','HTTP smoke')", [userId, "http-smoke@example.invalid"]);
    await client.query("insert into sessions(id,user_id,token_hash,expires_at) values($1,$2,$3,now()+interval '1 day')", [sessionId, userId, createHash("sha256").update(token).digest("hex")]);
    await client.query("insert into cards(id,user_id,issuer_name,name,last4,fee_cycle_type,next_fee_date) values($1,$2,'测试银行','HTTP 卡','1234','custom','2027-01-01')", [cardId, userId]);
    await client.end();

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      DATABASE_URL: databaseUrl,
      USE_DATABASE: "true",
      FEATURE_CATALOG_READ: "false",
      FEATURE_CATALOG_MANAGE: "false",
      FEATURE_CATALOG_JOIN: "false",
      FEATURE_TODOS: "true",
      FEATURE_ACTIVITIES: "true",
      FEATURE_ACTIVITY_PERIODS: "true",
      NEXT_DIST_DIR: distDir,
      NODE_ENV: "development",
    };
    const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "-p", String(httpPort)], {
      cwd: process.cwd(),
      env,
      stdio: "inherit",
    });
    server = child;
    await waitForServer(`http://127.0.0.1:${httpPort}`, child);

    const base = `http://127.0.0.1:${httpPort}`;
    const headers = {
      cookie: `cardcalendar_session=${token}`,
      origin: base,
      "content-type": "application/json",
    };
    const list = await fetch(base + "/api/v1/campaigns", { headers });
    if (list.status !== 200) throw new Error(`私人活动 GET 失败: ${list.status} ${await list.text()}`);
    const create = await fetch(base + "/api/v1/campaigns", {
      method: "POST",
      headers: { ...headers, "idempotency-key": randomUUID() },
      body: JSON.stringify({
        cardId,
        name: "HTTP 私人活动",
        sourceLabel: "隔离 smoke",
        rulesText: "每期消费一次",
        enrollmentRequired: "no",
        channel: "线上",
        cycleType: "once",
        targetKind: "count",
        targetCount: 1,
        currency: "CNY",
        countingBasis: "occurred",
        rewardText: "无",
      }),
    });
    if (create.status !== 200)
      throw new Error(`私人活动 POST 失败: ${create.status} ${await create.text()}`);
    const missingOrigin = await fetch(base + "/api/v1/campaigns", {
      method: "POST",
      headers: {
        cookie: `cardcalendar_session=${token}`,
        "content-type": "application/json",
        "idempotency-key": randomUUID(),
      },
      body: JSON.stringify({
        cardId,
        name: "拒绝请求",
        sourceLabel: "x",
        rulesText: "x",
        enrollmentRequired: "no",
        channel: "线上",
        cycleType: "once",
        targetKind: "count",
        targetCount: 1,
        currency: "CNY",
        countingBasis: "occurred",
        rewardText: "无",
      }),
    });
    if (missingOrigin.status !== 403)
      throw new Error(`缺失 Origin 未拒绝: ${missingOrigin.status}`);
    console.log("http workbench smoke passed: Cookie + Origin + isolated PostgreSQL + real Next route");
  } finally {
    server?.kill("SIGTERM");
    await new Promise<void>((resolve) => server ? server.once("close", () => resolve()) : resolve());
    await pg.stop().catch(() => undefined);
    await rm(databaseDir, { recursive: true, force: true }).catch(() => undefined);
    await rm(distDir, { recursive: true, force: true }).catch(() => undefined);
    const current=await readFile("tsconfig.json","utf8");
    if(current.includes(distDir)) {
      const generated=JSON.parse(current),original=JSON.parse(configBefore);
      generated.include=(generated.include as string[]).filter((entry)=>!entry.includes(distDir));
      const normalized=(value:Record<string,unknown>)=>JSON.stringify({...value,include:[...(value.include as string[])].sort()});
      if(normalized(generated)===normalized(original)) await writeFile("tsconfig.json",configBefore);
    }
    const nextEnv=await readFile("next-env.d.ts","utf8");
    if(nextEnv.includes(distDir)) await writeFile("next-env.d.ts",nextEnv.replaceAll(distDir,".next"));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
