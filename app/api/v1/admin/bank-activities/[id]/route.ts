import { catalogRoute, catalogFilter } from "../../../../../../src/server/catalog/http";
export const GET = catalogRoute(true,async ({request,actor,service,params,key})=>service.adminDetail(actor,params.id));
