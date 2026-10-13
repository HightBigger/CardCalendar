import { z } from "zod";
import type { CatalogActor } from "../../modules/activity-catalog/ports";
import type { RouteContext } from "./http";
import { catalogActor } from "./http";
import { workbenchRuntime } from "../workbench/runtime";
import { CatalogParticipationWorkflow } from "../workflows/catalog-participation";
import { CatalogPrivateQueries } from "../../modules/participation/catalog-queries";
import { CatalogPrivateCommands } from "../../modules/participation/catalog-commands";
import { parse } from "../../modules/activity-catalog/service";
import {
  dateSchema,
  versionSchema,
} from "../../modules/activity-catalog/validation";
import { errorResponse, AppError } from "../../shared/errors";
import type { TodoFilters, TodoType } from "../../contracts/todos";
import { requireWorkbenchWrite } from "../workbench/gates";
export const privateRuntime = workbenchRuntime;
export function privateRoute(
  work: (
    input: ReturnType<typeof privateRuntime> & {
      actor: CatalogActor;
      request: Request;
      params: Record<string, string>;
      key: string;
    },
  ) => Promise<unknown>,
) {
  return async (
    request: Request,
    context: RouteContext,
  ) => {
    try {
      const actor = await catalogActor(request);
      if (!["GET", "HEAD"].includes(request.method))
        requireWorkbenchWrite(new URL(request.url).pathname);
      const runtime = privateRuntime();
      await runtime.service.repository.transaction(
        (tx) => runtime.service.repository.authorize(actor, tx),
        true,
      );
      const params = (await context?.params) ?? {};
      for (const value of Object.values(params))
        parse(z.string().uuid(), value);
      const data = await work({
        ...runtime,
        actor,
        request,
        params,
        key: request.headers.get("Idempotency-Key") ?? "",
      });
      const result =
        data &&
        typeof data === "object" &&
        "kind" in data &&
        data.kind === "committed" &&
        "data" in data
          ? { data: data.data, meta: "meta" in data ? data.meta : undefined }
          : data;
      return Response.json(result, {
        status: data && typeof data==='object' && 'httpStatus' in data ? Number(data.httpStatus) : 200,
        headers: { "cache-control": "no-store" },
      });
    } catch (e) {
      return errorResponse(e);
    }
  };
}
export function privateQuery<T>(
  actor: CatalogActor,
  service: ReturnType<typeof privateRuntime>["service"],
  work: (tx: import("pg").PoolClient, timezone: string) => Promise<T>,
  asOf?: string,
) {
  return service.repository.transaction(async (tx) => {
    const { timezone } = await service.repository.authorize(actor, tx);
    const envelope = await service.repository.envelope(tx, timezone, await work(tx, timezone));
    if (asOf) envelope.meta.asOf = asOf;
    return envelope;
  }, true);
}
export function todoFilter(request: Request): Partial<TodoFilters> {
  const p = new URL(request.url).searchParams,
    csv = (key: string) => (p.get(key) ?? "").split(",").filter(Boolean);
  return {
    cardIds: csv("cardIds"),
    types: csv("types") as TodoType[],
    status: (p.get("status") ?? "pending") as TodoFilters["status"],
    q: p.get("q") ?? "",
    from: p.get("from") ?? "",
    to: p.get("to") ?? "",
    includeUndated: p.get("includeUndated") !== "false",
    month: p.get("month") ?? "",
    ...{ limit: Number(p.get("limit") ?? 50), cursor:p.get("cursor")??undefined,asOf:p.get("asOf")??undefined },
  };
}
export const todoCommandSchema = z
  .object({
    command: z.enum(["complete", "ignore", "restore", "snooze"]),
    expectedVersion: versionSchema,
    snoozedUntil: dateSchema.optional(),
    note: z.string().max(4000).optional(),
  })
  .strict();
