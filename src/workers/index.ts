import { PgBoss } from "pg-boss";
import { runCalendarReconcile, runReminderDispatch } from "./jobs";
import { runAccountCleanup } from "../modules/account";

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
  await boss.start();
  await Promise.all(QUEUES.map((queue) => boss.createQueue(queue)));

  await boss.schedule("calendar.reconcile", "0 2 * * *");
  await boss.schedule("reminder.dispatch", "*/5 * * * *");
  await boss.schedule("account.cleanup", "0 3 * * *");
  await boss.work("calendar.reconcile", async () => runCalendarReconcile());
  await boss.work("reminder.dispatch", async () => runReminderDispatch());
  await boss.work("account.cleanup", async () => runAccountCleanup());

  const stop = async () => {
    await boss.stop({ graceful: true });
    process.exit(0);
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  console.log(`CardCalendar worker started; queues=${QUEUES.join(",")}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
