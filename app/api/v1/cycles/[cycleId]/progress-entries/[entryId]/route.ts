import { editProgressEntry } from "../../../../../../../src/modules/progress";
import { requireUserId } from "../../../../../../../src/modules/auth/request";
import { errorResponse } from "../../../../../../../src/shared/errors";

type Context = {
  params: Promise<{ cycleId: string; entryId: string }>;
};

export async function PATCH(request: Request, context: Context): Promise<Response> {
  try {
    const params = await context.params;
    return new Response(
      JSON.stringify({
        data: await editProgressEntry(
          await requireUserId(request),
          params.cycleId,
          params.entryId,
          await request.json().catch(() => ({})),
        ),
      }),
      { headers: { "content-type": "application/json; charset=utf-8" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
