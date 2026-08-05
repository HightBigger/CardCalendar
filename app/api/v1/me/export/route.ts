import { exportUserData } from "../../../../../src/modules/export";
import { requireUserId } from "../../../../../src/modules/auth/request";
import { errorResponse } from "../../../../../src/shared/errors";

export async function GET(request: Request): Promise<Response> {
  try {
    const userId = await requireUserId(request);
    return new Response(JSON.stringify({ data: await exportUserData(userId) }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": 'attachment; filename="cardcalendar-export.json"',
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
