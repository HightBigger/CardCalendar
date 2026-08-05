import { archiveCard, getCard, restoreCard, updateCard } from "../../../../../src/modules/cards";
import { requireUserId } from "../../../../../src/modules/auth/request";
import { errorResponse } from "../../../../../src/shared/errors";

const json = (data: unknown, status = 200) => new Response(JSON.stringify({ data }), { status, headers: { "content-type": "application/json; charset=utf-8" } });
type Context = { params: Promise<{ cardId: string }> };

async function cardId(context: Context): Promise<string> { const p = await context.params; return p.cardId; }
export async function GET(request: Request, context: Context): Promise<Response> { try { return json(await getCard(await requireUserId(request), await cardId(context))); } catch (error) { return errorResponse(error); } }
export async function PATCH(request: Request, context: Context): Promise<Response> { try { return json(await updateCard(await requireUserId(request), await cardId(context), await request.json())); } catch (error) { return errorResponse(error); } }
export async function POST(request: Request, context: Context): Promise<Response> {
  try {
    const body = await request.json() as { action?: string };
    const id = await cardId(context);
    if (body.action === "archive") return json(await archiveCard(await requireUserId(request), id));
    if (body.action === "restore") return json(await restoreCard(await requireUserId(request), id));
    return new Response(
      JSON.stringify({
        error: { code: "VALIDATION_ERROR", message: "仅支持 archive 或 restore 操作" },
      }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
