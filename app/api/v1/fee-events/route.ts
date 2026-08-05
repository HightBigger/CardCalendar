import { listFeeEvents } from "../../../../src/modules/fee-events";
import { requireUserId } from "../../../../src/modules/auth/request";
import { errorResponse } from "../../../../src/shared/errors";

export async function GET(request: Request): Promise<Response> { try { const url = new URL(request.url); return new Response(JSON.stringify({ data: await listFeeEvents(await requireUserId(request), { from: url.searchParams.get("from") ?? undefined, to: url.searchParams.get("to") ?? undefined }) }), { headers: { "content-type": "application/json; charset=utf-8" } }); } catch (error) { return errorResponse(error); } }

