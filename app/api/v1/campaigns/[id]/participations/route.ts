import { privateRoute,privateQuery } from "../../../../../../src/server/catalog/private-http";
import { CampaignService } from "../../../../../../src/modules/campaign/service";
export const POST=privateRoute(async({workflow,actor,request,params,key})=>new CampaignService(workflow.personal).join({actor,idempotencyKey:key},params.id,await request.json()));
