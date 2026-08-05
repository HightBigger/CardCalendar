import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "pg";

const migrationsDir = join(process.cwd(), "db", "migrations");

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(`
      create table if not exists _cardcalendar_migrations (
        name text primary key,
        applied_at timestamptz not null default now()
      )
    `);

    const files = (await readdir(migrationsDir)).filter((name) => name.endsWith(".sql")).sort();
    for (const file of files) {
      const existing = await client.query("select 1 from _cardcalendar_migrations where name = $1", [file]);
      if (existing.rowCount) {
        console.log(`skip ${file}`);
        continue;
      }

      const sql = await readFile(join(migrationsDir, file), "utf8");
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query("insert into _cardcalendar_migrations (name) values ($1)", [file]);
        await client.query("commit");
        console.log(`applied ${file}`);
      } catch (error) {
        await client.query("rollback");
        throw error;
      }
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
