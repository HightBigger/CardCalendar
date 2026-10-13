import { catalogRoute, catalogFilter } from "../../../../../src/server/catalog/http";
export const GET = catalogRoute(false,async ({request,actor,service,params,key})=>service.detail(actor,params.id));
