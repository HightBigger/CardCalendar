import { privateRoute } from "../../../../../../src/server/catalog/private-http";
import { OverallTaskService } from "../../../../../../src/modules/spend-task/overall";

export const PATCH=privateRoute(async({workflow,actor,request,params,key})=>
  new OverallTaskService(workflow.personal).revise({actor,idempotencyKey:key},params.id,await request.json()));
