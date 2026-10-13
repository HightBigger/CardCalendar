import { privateRoute, privateQuery, todoFilter, todoCommandSchema } from "../../../../../../src/server/catalog/private-http";
import { AppError } from "../../../../../../src/shared/errors";
import { parse } from "../../../../../../src/modules/activity-catalog/service";
export const POST=privateRoute(async ({workflow,queries,commands,service,actor,request,params,key})=>commands.check({actor,idempotencyKey:key},params.id,await request.json()));
