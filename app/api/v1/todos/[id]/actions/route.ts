import { privateRoute, privateQuery, todoFilter, todoCommandSchema } from "../../../../../../src/server/catalog/private-http";
import { AppError } from "../../../../../../src/shared/errors";
import { parse } from "../../../../../../src/modules/activity-catalog/service";
export const POST=privateRoute(async ({workflow,queries,commands,service,actor,request,params,key})=>(async()=>{const input=parse(todoCommandSchema,await request.json());return service.repository.command({actor,idempotencyKey:key},"todo.action:"+params.id,input,false,async tx=>workflow.personal.todos.command(tx,actor.userId,params.id,input,(await service.repository.authorize(actor,tx)).timezone));})());
