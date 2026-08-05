import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "../../../db/schema";

export type Database = NodePgDatabase<typeof schema>;

export function createDatabase(databaseUrl = process.env.DATABASE_URL): {
  db: Database;
  pool: Pool;
} {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
    idleTimeoutMillis: 30_000,
  });

  return { db: drizzle(pool, { schema }), pool };
}

let sharedDatabase: ReturnType<typeof createDatabase> | undefined;

export function getDatabase(): ReturnType<typeof createDatabase> {
  if (!sharedDatabase) {
    sharedDatabase = createDatabase();
  }
  return sharedDatabase;
}
