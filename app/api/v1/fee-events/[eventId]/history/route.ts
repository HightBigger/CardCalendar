import { getFeeEventTimeline } from "../../../../../../src/modules/fee-events";
import { requireUserId } from "../../../../../../src/modules/auth/request";
import { errorResponse } from "../../../../../../src/shared/errors";

type Context = { params: Promise<{ eventId: string }> };

export async function GET(request: Request, context: Context): Promise<Response> {
  try {
    const userId = await requireUserId(request);
    const { eventId } = await context.params;
    const timeline = await getFeeEventTimeline(userId, eventId);
    return new Response(JSON.stringify({ data: { history: timeline.history, reminders: timeline.reminders } }), {
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
