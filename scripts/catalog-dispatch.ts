import { getDatabase } from "../src/shared/db/client";
import { CatalogRepository } from "../src/modules/activity-catalog/repository";
import { CatalogService } from "../src/modules/activity-catalog/service";
import { CatalogParticipationWorkflow } from "../src/server/workflows/catalog-participation";
async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const { pool } = getDatabase();
  try {
    console.log(
      await new CatalogParticipationWorkflow(
        new CatalogService(new CatalogRepository(pool)),
      ).dispatchEvents(),
    );
  } finally {
    await pool.end();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
