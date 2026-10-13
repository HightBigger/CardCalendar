import type { PoolClient } from "pg";
import type { Envelope } from "../../contracts/workbench";
export type Actor = { userId: string; sessionId: string };
export type CommandContext = { actor: Actor; idempotencyKey: string };
export type CatalogActor = Actor;
export type CatalogCommandContext = CommandContext;
export interface UnitOfWorkPort {
  transaction<T>(work: (tx: PoolClient) => Promise<T>, readOnly?: boolean): Promise<T>;
  command<T>(context: CommandContext, scope: string, input: unknown, manage: boolean, work: (tx: PoolClient) => Promise<T>): Promise<Envelope<T>>;
}
