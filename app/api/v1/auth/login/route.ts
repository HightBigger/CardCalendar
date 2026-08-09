import { loginUser } from "../../../../../src/modules/auth";
import { errorResponse } from "../../../../../src/shared/errors";
import { sessionCookieValue } from "../../../../../src/modules/auth";
import { limitSensitiveRequest } from "../../../../../src/shared/security";

const secure = process.env.NODE_ENV === "production";

export async function POST(request: Request): Promise<Response> {
  try {
    const limited = limitSensitiveRequest(request, "login");
    if (limited) return limited;
    const result = await loginUser(await request.json());
    return new Response(JSON.stringify({ data: { user: result.user } }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "set-cookie": sessionCookieValue(result.token, secure),
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
