import { PgBoss } from "pg-boss";
import { runCalendarReconcile, runReminderDispatch } from "./jobs";
import { runAccountCleanup } from "../modules/account";
import { getDatabase } from "../shared/db/client";
import { startWorkerHeartbeat, type WorkerHeartbeatHandle } from "./heartbeat";

const QUEUES = [
  "calendar.reconcile",
  "reminder.dispatch",
  "account.cleanup",
  "export.generate",
] as const;

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to start the CardCalendar worker");
  }

  const boss = new PgBoss(databaseUrl);
  const applicationDatabase = getDatabase();
  let heartbeat: WorkerHeartbeatHandle;
  try {
    await boss.start();
    await Promise.all(QUEUES.map((queue) => boss.createQueue(queue)));

    await boss.schedule("calendar.reconcile", "0 2 * * *");
    await boss.schedule("reminder.dispatch", "*/5 * * * *");
    await boss.schedule("account.cleanup", "0 3 * * *");
    await boss.work("calendar.reconcile", async () => runCalendarReconcile());
    await boss.work("reminder.dispatch", async () => runReminderDispatch());
    await boss.work("account.cleanup", async () => runAccountCleanup());
    heartbeat = await startWorkerHeartbeat(applicationDatabase.db);
  } catch (error) {
    await boss.stop({ graceful: false }).catch(() => undefined);
    await applicationDatabase.pool.end().catch(() => undefined);
    throw error;
  }

  const stop = async () => {
    await stopWorker(boss, heartbeat, () => applicationDatabase.pool.end());
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  console.log(`CardCalendar worker started; queues=${QUEUES.join(",")}`);
}

async function stopWorker(
  boss: PgBoss,
  heartbeat: WorkerHeartbeatHandle,
  closeDatabase: () => Promise<void>,
) {
  let failed = false;
  try {
    await heartbeat.stop();
  } catch (error) {
    failed = true;
    console.error(error);
  }
  await boss.stop({ graceful: true }).catch((error) => {
    failed = true;
    console.error(error);
  });
  await closeDatabase().catch((error) => {
    failed = true;
    console.error(error);
  });
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
