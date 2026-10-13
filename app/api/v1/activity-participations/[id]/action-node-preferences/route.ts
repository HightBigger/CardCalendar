import { privateRoute,privateQuery } from "../../../../../../src/server/catalog/private-http";
import { AppError } from "../../../../../../src/shared/errors";
import { NodePreferenceService } from "../../../../../../src/modules/participation/node-preferences";
export const PUT=privateRoute(async({workflow,actor,request,params,key})=>new NodePreferenceService(workflow.personal).save({actor,idempotencyKey:key},params.id,await request.json()));
export const GET=privateRoute(async({workflow,service,actor,params})=>privateQuery(actor,service,async tx=>(await workflow.personal.owned(tx,actor.userId,params.id)).node_preferences));
