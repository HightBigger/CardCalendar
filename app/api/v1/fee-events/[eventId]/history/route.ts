import { getFeeEvent } from "../../../../../../src/modules/fee-events";
import { requireUserId } from "../../../../../../src/modules/auth/request";
import { listAuditLogs } from "../../../../../../src/shared/audit";
import { errorResponse } from "../../../../../../src/shared/errors";

type Context = { params: Promise<{ eventId: string }> };

export async function GET(request: Request, context: Context): Promise<Response> {
  try {
    const userId = await requireUserId(request);
    const { eventId } = await context.params;
    await getFeeEvent(userId, eventId);
    const history = await listAuditLogs(userId, "fee_event", eventId);
    return new Response(JSON.stringify({ data: history }), {
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
