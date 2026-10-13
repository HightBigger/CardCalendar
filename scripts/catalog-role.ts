// Trusted deployment command, never exposed as a member HTTP endpoint.
import { Pool } from "pg";
import { z } from "zod";
async function main() {
  const [action, userId] = process.argv.slice(2);
  if (
    !["grant", "revoke"].includes(action) ||
    !z.string().uuid().safeParse(userId).success
  )
    throw new Error(
      "用法：tsx scripts/catalog-role.ts grant|revoke <稳定 user ID>",
    );
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const tx = await pool.connect();
  try {
    await tx.query("begin");
    const user = await tx.query(
      "select id from users where id=$1 and status='active' and deleted_at is null for update",
      [userId],
    );
    if (!user.rowCount) throw new Error("需要已存在且有效的稳定 user ID");
    await tx.query(
      "insert into user_role_grants(user_id,role,revoked_at) values($1,'catalog_admin',case when $2='revoke' then now() else null end) on conflict(user_id) do update set version=user_role_grants.version+1,revoked_at=excluded.revoked_at,granted_at=case when $2='grant' then now() else user_role_grants.granted_at end",
      [userId, action],
    );
    await tx.query(
      "insert into audit_logs(actor_type,action,entity_type,entity_id,metadata) values('system',$1,'catalog_role',$2,$3)",
      ["catalog_role." + action, userId, { source: "trusted-deployment-cli" }],
    );
    await tx.query("commit");
    console.log("catalog role " + action + " committed for " + userId);
  } catch (e) {
    await tx.query("rollback");
    throw e;
  } finally {
    tx.release();
    await pool.end();
  }
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
