import { privateRoute,privateQuery } from "../../../../../../src/server/catalog/private-http";
import { AppError } from "../../../../../../src/shared/errors";
import { PeriodPlanService } from "../../../../../../src/modules/participation/period-plans";
export const POST=privateRoute(async({workflow,actor,request,params,key})=>new PeriodPlanService(workflow.personal).propose({actor,idempotencyKey:key},params.id,await request.json()));
