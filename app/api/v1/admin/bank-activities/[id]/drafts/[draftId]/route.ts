import { catalogRoute, catalogFilter } from "../../../../../../../../src/server/catalog/http";
export const PATCH = catalogRoute(true,async ({request,actor,service,params,key})=>service.updateDraft({actor,idempotencyKey:key},params.id,params.draftId,await request.json()));
