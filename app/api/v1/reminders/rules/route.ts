import { requireUserId } from "../../../../../src/modules/auth/request";
import {
  listReminderRules,
  saveFeeEventReminderRules,
} from "../../../../../src/modules/reminders";
import { errorResponse } from "../../../../../src/shared/errors";

export async function GET(request: Request): Promise<Response> {
  try {
    return new Response(
      JSON.stringify({ data: await listReminderRules(await requireUserId(request)) }),
      { headers: { "content-type": "application/json; charset=utf-8" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: Request): Promise<Response> {
  try {
    return new Response(
      JSON.stringify({
        data: await saveFeeEventReminderRules(await requireUserId(request), await request.json()),
      }),
      { headers: { "content-type": "application/json; charset=utf-8" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
