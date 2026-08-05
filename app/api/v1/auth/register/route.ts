import { registerUser } from "../../../../../src/modules/auth";
import { errorResponse } from "../../../../../src/shared/errors";
import { sessionCookieValue } from "../../../../../src/modules/auth";

const secure = process.env.NODE_ENV === "production";

export async function POST(request: Request): Promise<Response> {
  try {
    const result = await registerUser(await request.json());
    return new Response(JSON.stringify({ data: { user: result.user } }), {
      status: 201,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "set-cookie": sessionCookieValue(result.token, secure),
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
