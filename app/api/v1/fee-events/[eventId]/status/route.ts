import { updateFeeEventStatus } from "../../../../../../src/modules/fee-events";
import { requireUserId } from "../../../../../../src/modules/auth/request";
import { errorResponse } from "../../../../../../src/shared/errors";

type Context = { params: Promise<{ eventId: string }> };
export async function POST(request: Request, context: Context): Promise<Response> { try { const params = await context.params; const data = await updateFeeEventStatus(await requireUserId(request), params.eventId, await request.json()); return new Response(JSON.stringify({ data }), { headers: { "content-type": "application/json; charset=utf-8" } }); } catch (error) { return errorResponse(error); } }
