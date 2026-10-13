import { catalogRoute, catalogFilter } from "../../../../../src/server/catalog/http";
export const GET = catalogRoute(true,async ({request,actor,service,params,key})=>service.adminList(actor,catalogFilter(request)));
export const POST = catalogRoute(true,async ({request,actor,service,key})=>service.createDraft({actor,idempotencyKey:key},await request.json()));
