import { listReminders } from "../../../../src/modules/reminders";
import { requireUserId } from "../../../../src/modules/auth/request";
import { errorResponse } from "../../../../src/shared/errors";

export async function GET(request: Request): Promise<Response> { try { const pendingOnly = new URL(request.url).searchParams.get("all") !== "true"; return new Response(JSON.stringify({ data: await listReminders(await requireUserId(request), pendingOnly) }), { headers: { "content-type": "application/json; charset=utf-8" } }); } catch (error) { return errorResponse(error); } }

