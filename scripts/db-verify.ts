import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import EmbeddedPostgres from "embedded-postgres";

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address && typeof address === "object") {
        const port = address.port;
        server.close((error) => (error ? reject(error) : resolve(port)));
      } else {
        server.close();
        reject(new Error("无法获取可用端口"));
      }
    });
  });
}

function runCommand(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} ${args.join(" ")} 退出码 ${code}`));
      }
    });
  });
}

async function main() {
  const databaseDir = await mkdtemp(join(tmpdir(), "cardcalendar-pg-"));
  const port = await getFreePort();
  const databaseName = "cardcalendar";
  const databaseUrl = `postgres://postgres:postgres@127.0.0.1:${port}/${databaseName}`;
  const pg = new EmbeddedPostgres({
    databaseDir,
    port,
    user: "postgres",
    password: "postgres",
    persistent: false,
    initdbFlags: ["--locale=C"],
    onLog: () => undefined,
    onError: (message) => {
      if (process.env.DEBUG_PG) {
        console.error(message);
      }
    },
  });
  let closeApplicationDatabase: (() => Promise<void>) | undefined;

  try {
    console.log(`启动临时 PostgreSQL（端口 ${port}）`);
    await pg.initialise();
    await pg.start();
    await pg.createDatabase(databaseName);

    const env = { ...process.env, DATABASE_URL: databaseUrl };
    await runCommand(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "db:migrate"], env);
    await runCommand(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "db:smoke"], env);

    const userId = crypto.randomUUID();
    const client = pg.getPgClient(databaseName, "127.0.0.1");
    await client.connect();
    try {
      await client.query(
        "insert into users (id, email, password_hash, timezone) values ($1, $2, $3, $4)",
        [userId, "db-verify@example.com", "db-verify-only", "Asia/Shanghai"],
      );
    } finally {
      await client.end();
    }

    process.env.DATABASE_URL = databaseUrl;
    process.env.USE_DATABASE = "true";
    const databaseModule = await import("../src/shared/db/client");
    closeApplicationDatabase = () => databaseModule.getDatabase().pool.end();
    const { listAuditLogs, recordAudit } = await import("../src/shared/audit");
    await recordAudit({
      userId,
      actorType: "system",
      action: "database.verified",
      entityType: "user",
      entityId: userId,
      metadata: { source: "db:verify" },
    });
    const logs = await listAuditLogs(userId, "user", userId);
    if (logs.length !== 1 || logs[0].action !== "database.verified") {
      throw new Error("audit_logs 写入或读取验证失败");
    }
    console.log("audit persistence ok");
    console.log("db verify passed");
  } finally {
    await closeApplicationDatabase?.().catch(() => undefined);
    await pg.stop().catch((error) => {
      console.error("停止临时 PostgreSQL 失败", error);
    });
    await rm(databaseDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
