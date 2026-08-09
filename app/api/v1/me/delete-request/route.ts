import { requestAccountDeletion } from "../../../../../src/modules/auth";
import { clearSessionCookie } from "../../../../../src/modules/auth";
import { getAccountDeletionStatus } from "../../../../../src/modules/auth";
import { requireUserId } from "../../../../../src/modules/auth/request";
import { errorResponse } from "../../../../../src/shared/errors";
import { limitSensitiveRequest } from "../../../../../src/shared/security";

const secure = process.env.NODE_ENV === "production";

export async function GET(request: Request): Promise<Response> {
  try {
    const userId = await requireUserId(request);
    return new Response(JSON.stringify({ data: await getAccountDeletionStatus(userId) }), {
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const userId = await requireUserId(request);
    const limited = limitSensitiveRequest(request, "delete", userId);
    if (limited) return limited;
    const result = await requestAccountDeletion(userId, await request.json());
    return new Response(JSON.stringify({ data: result }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "set-cookie": clearSessionCookie(secure),
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
