import { authRepository, toPublicUser, updateProfile } from "../../../../src/modules/auth";
import { requireUserId } from "../../../../src/modules/auth/request";
import { errorResponse } from "../../../../src/shared/errors";

export async function GET(request: Request): Promise<Response> {
  try {
    const userId = await requireUserId(request);
    const user = toPublicUser(await authRepository.findUserById(userId));
    return new Response(JSON.stringify({ data: user }), {
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request): Promise<Response> {
  try {
    const userId = await requireUserId(request);
    const user = await updateProfile(userId, await request.json());
    return new Response(JSON.stringify({ data: user }), {
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
