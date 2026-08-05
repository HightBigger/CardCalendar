import { createCard, listCards } from "../../../../src/modules/cards";
import { errorResponse } from "../../../../src/shared/errors";
import { requireUserId } from "../../../../src/modules/auth/request";

const json = (data: unknown, status = 200) => new Response(JSON.stringify({ data }), { status, headers: { "content-type": "application/json; charset=utf-8" } });

export async function GET(request: Request): Promise<Response> {
  try {
    const includeArchived = new URL(request.url).searchParams.get("all") === "true";
    return json(await listCards(await requireUserId(request), includeArchived));
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request): Promise<Response> {
  try { return json(await createCard(await requireUserId(request), await request.json()), 201); } catch (error) { return errorResponse(error); }
}
