import { listCardSummaries } from "../../../../../src/modules/cards";
import { requireUserId } from "../../../../../src/modules/auth/request";
import { errorResponse } from "../../../../../src/shared/errors";

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const includeArchived = url.searchParams.get("all") === "true";
    const qualified = url.searchParams.get("qualified");
    const data = await listCardSummaries(
      await requireUserId(request),
      includeArchived,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        search: url.searchParams.get("search") ?? undefined,
        status: (url.searchParams.get("status") ?? undefined) as "active" | "suspended" | "archived" | undefined,
        feeStatus: url.searchParams.get("feeStatus") ?? undefined,
        qualified: qualified === null ? undefined : qualified === "true",
        dateFrom: url.searchParams.get("dateFrom") ?? undefined,
        dateTo: url.searchParams.get("dateTo") ?? undefined,
        sortBy: (url.searchParams.get("sortBy") ?? undefined) as "due_date" | "remaining_count" | "remaining_amount" | "qualified" | "name" | "created_at" | undefined,
        sortOrder: (url.searchParams.get("sortOrder") ?? undefined) as "asc" | "desc" | undefined,
      },
    );
    return new Response(JSON.stringify({ data }), {
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
