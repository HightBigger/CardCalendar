import { Client } from "pg";

const tables = [
  "users",
  "sessions",
  "cards",
  "fee_cycles",
  "progress_entries",
  "fee_events",
  "reminder_rules",
  "reminders",
  "audit_logs",
  "worker_heartbeats",
];

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.log("未设置 DATABASE_URL，跳过 db smoke");
    return;
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    for (const table of tables) {
      const result = await client.query("select 1 from " + table + " limit 1");
      console.log(table + " ok rows=" + (result.rowCount ?? 0));
    }
    console.log("db smoke passed");
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
