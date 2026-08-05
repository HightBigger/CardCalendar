import { logoutSession } from "../../../../../src/modules/auth";
import { clearSessionCookie, readCookie, SESSION_COOKIE } from "../../../../../src/modules/auth";
import { errorResponse } from "../../../../../src/shared/errors";

const secure = process.env.NODE_ENV === "production";

export async function POST(request: Request): Promise<Response> {
  try {
    await logoutSession(readCookie(request, SESSION_COOKIE));
    return new Response(JSON.stringify({ data: { status: "logged_out" } }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "set-cookie": clearSessionCookie(secure),
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
