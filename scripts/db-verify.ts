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

  try {
    console.log(`启动临时 PostgreSQL（端口 ${port}）`);
    await pg.initialise();
    await pg.start();
    await pg.createDatabase(databaseName);

    const env = { ...process.env, DATABASE_URL: databaseUrl };
    await runCommand(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "db:migrate"], env);
    await runCommand(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "db:smoke"], env);
    console.log("db verify passed");
  } finally {
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
