import type { Pool, PoolClient } from "pg";
import { AppError } from "../errors";
import { commandHash as contentHash } from "./command-hash";
import type {
  CatalogActor,
  CatalogCommandContext,
} from "./ports";
import type {
  CatalogCapabilities,
  CatalogEnvelope,
} from "../../contracts/activity-catalog";

export type CatalogTransaction = PoolClient;
export class UnitOfWork {
  constructor(readonly pool: Pool) {}
  async requireActiveMember(actor: CatalogActor, tx: PoolClient) {
    await this.authorize(actor, tx, false, true);
  }
  async requireCatalogManager(actor: CatalogActor, tx: PoolClient) {
    await this.authorize(actor, tx, true, true);
  }
  async getCapabilities(actor: CatalogActor) {
    return this.transaction(
      async (tx) => (await this.authorize(actor, tx)).capabilities,
      true,
    );
  }
  async run<T>(work: (tx: PoolClient) => Promise<T>) {
    return this.transaction(work);
  }
  async transaction<T>(
    work: (tx: PoolClient) => Promise<T>,
    readOnly = false,
  ): Promise<T> {
    const tx = await this.pool.connect();
    try {
      await tx.query(
        readOnly ? "begin isolation level repeatable read read only" : "begin",
      );
      const value = await work(tx);
      await tx.query("commit");
      return value;
    } catch (error) {
      await tx.query("rollback");
      throw error;
    } finally {
      tx.release();
    }
  }
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
    const capabilities: CatalogCapabilities = {
      canReadCatalog: true, canManageCatalog: false, permissionsVersion: 0,
    };
    if (manage) throw new AppError("FORBIDDEN", "私人工作台不提供目录管理权限");
    return { timezone: result.rows[0].timezone, capabilities };
  }
  async envelope<T>(
    tx: PoolClient,
    timezone: string,
    data: T,
  ): Promise<CatalogEnvelope<T>> {
    const { rows } = await tx.query<{ now: Date; boundary: Date }>(
      "select transaction_timestamp() as now, ((transaction_timestamp() at time zone $1)::date + 1)::timestamp at time zone $1 as boundary",
      [timezone],
    );
    const now = rows[0].now.toISOString();
    return {
      data,
      meta: {
        serverNow: now,
        asOf: now,
        timezone,
        nextBoundaryAt: rows[0].boundary.toISOString(),
      },
    };
  }
  async command<T>(
    context: CatalogCommandContext,
    scope: string,
    input: unknown,
    manage: boolean,
    work: (tx: PoolClient) => Promise<T>,
  ): Promise<CatalogEnvelope<T>> {
    if (!context.idempotencyKey || context.idempotencyKey.length > 200)
      throw new AppError("VALIDATION_ERROR", "需要有效的 Idempotency-Key");
    return this.transaction(async (tx) => {
      const { timezone } = await this.authorize(
        context.actor,
        tx,
        manage,
        true,
      );
      await tx.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [
        context.actor.userId + ":" + scope + ":" + context.idempotencyKey,
      ]);
      const hash = contentHash(input);
      const existing = await tx.query(
        "select request_hash,result from catalog_command_results where owner_user_id=$1 and command_scope=$2 and idempotency_key=$3",
        [context.actor.userId, scope, context.idempotencyKey],
      );
      if (existing.rowCount) {
        if (existing.rows[0].request_hash !== hash)
          throw new AppError("CONFLICT", "同一请求键不能改变请求内容");
        return existing.rows[0].result as CatalogEnvelope<T>;
      }
      const result = await this.envelope(tx, timezone, await work(tx));
      await tx.query(
        "insert into catalog_command_results(owner_user_id,command_scope,idempotency_key,request_hash,result) values($1,$2,$3,$4,$5)",
        [context.actor.userId, scope, context.idempotencyKey, hash, result],
      );
      return result;
    });
  }
}
