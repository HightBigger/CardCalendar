import { privateRoute } from "../../../../../../src/server/catalog/private-http";
import { SpendFactService } from "../../../../../../src/modules/spend-task/service";
export const POST=privateRoute(async ({workflow,actor,request,params,key})=>new SpendFactService(workflow.personal).link({actor,idempotencyKey:key},params.id,await request.json()));
