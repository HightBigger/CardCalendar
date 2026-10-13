import { catalogRoute, catalogFilter } from "../../../../../../../src/server/catalog/http";
export const POST = catalogRoute(true,async ({request,actor,service,params,key})=>service.publish({actor,idempotencyKey:key},params.id,await request.json()));
