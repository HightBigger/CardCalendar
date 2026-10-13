import type { PoolClient } from "pg";
import { UnitOfWork } from "../../shared/db/unit-of-work";
import { AppError } from "../../shared/errors";
import type { CatalogActor, CatalogAccessPort } from "./ports";
import type { CatalogCapabilities } from "../../contracts/activity-catalog";
export type CatalogTransaction = PoolClient;
export class CatalogRepository extends UnitOfWork implements CatalogAccessPort<PoolClient> {
  async authorize(
    actor: CatalogActor,
    tx: PoolClient,
    manage = false,
    lock = false,
  ) {
    const result = await tx.query<{ timezone: string }>(
      `select u.timezone from users u join sessions s on s.user_id=u.id where u.id=$1 and s.id=$2 and u.status='active' and u.deleted_at is null and s.revoked_at is null and s.expires_at>now() ${lock ? "for share of u,s" : ""}`,
      [actor.userId, actor.sessionId],
    );
    if (!result.rowCount)
      throw new AppError("UNAUTHENTICATED", "登录已失效，请重新登录");
    const grant = await tx.query<{ version: number; revoked_at: Date | null }>(
      `select version,revoked_at from user_role_grants where user_id=$1 ${lock ? "for update" : ""}`,
      [actor.userId],
    );
    const capabilities: CatalogCapabilities = {
      canReadCatalog: true,
      canManageCatalog: !!grant.rowCount && !grant.rows[0].revoked_at,
      permissionsVersion: grant.rows[0]?.version ?? 0,
    };
    if (manage && !capabilities.canManageCatalog)
      throw new AppError("FORBIDDEN", "当前账号没有银行活动管理权限");
    return { timezone: result.rows[0].timezone, capabilities };
  }
}
