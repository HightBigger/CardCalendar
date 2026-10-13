import { privateRoute, privateQuery, todoFilter, todoCommandSchema } from "../../../../../../src/server/catalog/private-http";
import { AppError } from "../../../../../../src/shared/errors";
import { parse } from "../../../../../../src/modules/activity-catalog/service";
export const GET=privateRoute(async ({workflow,queries,commands,service,actor,request,params,key})=>privateQuery(actor,service,async tx=>queries.rewards(tx,await workflow.personal.owned(tx,actor.userId,params.id))));

import { ActivityRewardService } from "../../../../../../src/modules/activity-reward/service";
export const POST=privateRoute(async({workflow,actor,request,params,key})=>new ActivityRewardService(workflow.personal).create({actor,idempotencyKey:key},params.id,await request.json()));
