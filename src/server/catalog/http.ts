import { z } from "zod";
import { getDatabase } from "../../shared/db/client";
import { AppError, errorResponse } from "../../shared/errors";
import { authRepository } from "../../modules/auth/repository";
import {
  hashSessionToken,
  readCookie,
  SESSION_COOKIE,
} from "../../modules/auth/session";
import type { CatalogActor } from "../../modules/activity-catalog/ports";
import type { CatalogAdminFilter } from "../../contracts/activity-catalog";
import { CatalogRepository } from "../../modules/activity-catalog/repository";
import { PersonalCatalogService } from "../../modules/participation/catalog-import";
import { CatalogService, parse } from "../../modules/activity-catalog/service";

export function catalogRuntime() {
  if (process.env.USE_DATABASE !== "true")
    throw new AppError(
      "UNPROCESSABLE_ENTITY",
      "银行活动目录需要 PostgreSQL，请先启用数据库并执行迁移",
      422,
      { reason: "CATALOG_STORAGE_DISABLED" },
    );
  const service = new CatalogService(
    new CatalogRepository(getDatabase().pool),
    undefined,
    process.env.FEATURE_CATALOG_JOIN === "true",
  );
  if (process.env.FEATURE_CATALOG_JOIN === "true")
    service.personal = new PersonalCatalogService(service);
  return service;
}
export async function catalogActor(request: Request): Promise<CatalogActor> {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) throw new AppError("UNAUTHENTICATED", "请用真实账号登录");
  const session = await authRepository.findSessionByTokenHash(
    hashSessionToken(token),
  );
  if (!session) throw new AppError("UNAUTHENTICATED", "登录已失效");
  return { userId: session.userId, sessionId: session.id };
}
export type RouteContext = { params: Promise<Record<string, string>> };
export function catalogRoute(
  manage: boolean,
  work: (input: {
    request: Request;
    actor: CatalogActor;
    service: CatalogService;
    params: Record<string, string>;
    key: string;
  }) => Promise<unknown>,
) {
  return async (
    request: Request,
    context: RouteContext,
  ) => {
    try {
      const actor = await catalogActor(request);
      const enabled =
        process.env[
          manage ? "FEATURE_CATALOG_MANAGE" : "FEATURE_CATALOG_READ"
        ] === "true";
      if (!enabled) throw new AppError("NOT_FOUND", "银行活动功能暂未开放");
      const service = catalogRuntime();
      // Authorization precedes decoding resource identities and body, avoiding draft disclosure.
      await service.repository.transaction(
        (tx) => service.repository.authorize(actor, tx, manage),
        true,
      );
      const params = (await context?.params) ?? {};
      for (const [name, value] of Object.entries(params))
        if (name.endsWith("Id") || name === "id")
          parse(z.string().uuid(), value);
      const data = await work({
        request,
        actor,
        service,
        params,
        key: request.headers.get("Idempotency-Key") ?? "",
      });
      return Response.json(data, { headers: { "cache-control": "no-store" } });
    } catch (error) {
      return errorResponse(error);
    }
  };
}
export async function capabilitiesRoute(request: Request) {
  try {
    const actor = await catalogActor(request);
    if (process.env.USE_DATABASE !== "true") {
      const user = await authRepository.findUserById(actor.userId);
      if (user?.status !== "active")
        throw new AppError("UNAUTHENTICATED", "账号不可用");
      return Response.json(
        {
          data: {
            canReadCatalog: false,
            canManageCatalog: false,
            permissionsVersion: 0,
            canCreateCustom: false,
            canManageActivities: false,
            canManageActivityPeriods: false,
          },
        },
        { headers: { "cache-control": "no-store" } },
      );
    }
    const caps = await catalogRuntime().getCapabilities(actor);
    return Response.json(
      {
        data: {
          ...caps,
          canCreateCustom: process.env.FEATURE_TODOS === "true",
          canManageActivities: process.env.FEATURE_TODOS === "true" && process.env.FEATURE_ACTIVITIES === "true",
          canManageActivityPeriods: process.env.FEATURE_TODOS === "true" && process.env.FEATURE_ACTIVITIES === "true" && process.env.FEATURE_ACTIVITY_PERIODS === "true",
          canReadCatalog:
            caps.canReadCatalog && process.env.FEATURE_CATALOG_READ === "true",
          canManageCatalog:
            caps.canManageCatalog &&
            process.env.FEATURE_CATALOG_MANAGE === "true",
        },
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
export function catalogFilter(request: Request): CatalogAdminFilter {
  const p = new URL(request.url).searchParams;
  return parse(
    z
      .object({
        q: z.string().max(200).optional(),
        bankIds: z.array(z.string().max(100)).max(30).optional(),
        activityTypes: z.array(z.string().max(100)).max(30).optional(),
        phase: z.enum(["current", "upcoming", "ongoing", "ended"]).optional(),
        myBanksOnly: z.boolean().optional(),
        joinedOnly: z.boolean().optional(),
        publicationStatus: z
          .enum(["unpublished", "published", "withdrawn"])
          .optional(),
        cursor: z.string().uuid().optional(),
      })
      .strict(),
    {
      q: p.get("q") ?? undefined,
      bankIds: p.getAll("bankIds"),
      activityTypes: p.getAll("activityTypes"),
      phase: p.get("phase") ?? undefined,
      myBanksOnly: p.get("myBanksOnly") === "true",
      joinedOnly: p.get("joinedOnly") === "true",
      publicationStatus: p.get("publicationStatus") ?? undefined,
      cursor: p.get("cursor") ?? undefined,
    },
  );
}
