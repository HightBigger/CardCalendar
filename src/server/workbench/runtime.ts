import type { Pool, PoolClient } from "pg";
import { UnitOfWork } from "../../shared/db/unit-of-work";
import { getDatabase } from "../../shared/db/client";
import { AppError } from "../../shared/errors";
import { PersonalCatalogService, type PersonalRuntime } from "../../modules/participation/catalog-import";
import { CatalogPrivateQueries } from "../../modules/participation/catalog-queries";
import { CatalogPrivateCommands } from "../../modules/participation/catalog-commands";
// The directory is an optional read adapter. Manual commands never call these ports.
function sourceAdapter(repository: UnitOfWork): PersonalRuntime {
  return {
    repository,
    async row(tx, id, lock = false) {
      const row = (await tx.query(`select * from catalog_activities where id=$1 ${lock ? "for update" : ""}`, [id])).rows[0];
      if (!row) throw new AppError("NOT_FOUND", "活动来源不存在");
      return row;
    },
    async release(tx, id, releaseId) {
      const row = (await tx.query("select * from catalog_releases where catalog_activity_id=$1 and id=$2", [id, releaseId])).rows[0];
      if (!row) throw new AppError("NOT_FOUND", "发布版本不存在");
      return {id:row.id,catalogActivityId:row.catalog_activity_id,activityInstanceKey:row.activity_instance_key,
        releaseNumber:row.release_number,publishedAt:row.published_at.toISOString(),contentHash:row.content_hash,changeNote:row.change_note,content:row.content};
    },
    async domains(tx: PoolClient, bankId: string | null) {
      return (await tx.query("select official_domains from bank_directory where id=$1", [bankId])).rows[0]?.official_domains ?? [];
    },
  };
}
export function workbenchRuntime(pool?: Pool) {
  if (!pool && process.env.USE_DATABASE !== "true")
    throw new AppError("UNPROCESSABLE_ENTITY", "私人工作台需要 PostgreSQL 和最新迁移",422,{reason:"WORKBENCH_STORAGE_DISABLED"});
  const service = sourceAdapter(new UnitOfWork(pool ?? getDatabase().pool));
  const personal = new PersonalCatalogService(service);
  return { service, workflow: { personal }, queries:new CatalogPrivateQueries(personal),commands:new CatalogPrivateCommands(personal) };
}
