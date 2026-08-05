import { addProgressEntry, getCycleProgress } from "../../../../../../src/modules/progress";
import { requireUserId } from "../../../../../../src/modules/auth/request";
import { errorResponse } from "../../../../../../src/shared/errors";

type Context = { params: Promise<{ cycleId: string }> };
export async function GET(request: Request, context: Context): Promise<Response> { try { const params = await context.params; return new Response(JSON.stringify({ data: await getCycleProgress(await requireUserId(request), params.cycleId) }), { headers: { "content-type": "application/json; charset=utf-8" } }); } catch (error) { return errorResponse(error); } }
export async function POST(request: Request, context: Context): Promise<Response> { try { const params = await context.params; return new Response(JSON.stringify({ data: await addProgressEntry(await requireUserId(request), params.cycleId, await request.json()) }), { status: 201, headers: { "content-type": "application/json; charset=utf-8" } }); } catch (error) { return errorResponse(error); } }
