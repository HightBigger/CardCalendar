import { privateRoute, privateQuery, todoFilter, todoCommandSchema } from "../../../../src/server/catalog/private-http";
import { AppError } from "../../../../src/shared/errors";
import { parse } from "../../../../src/modules/activity-catalog/service";
export const GET=privateRoute(async ({workflow,queries,commands,service,actor,request,params,key})=>privateQuery(actor,service,(tx,timezone)=>workflow.personal.todos.query(tx,actor.userId,timezone,todoFilter(request),true)));
