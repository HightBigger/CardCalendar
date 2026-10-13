import { privateRoute, privateQuery, todoFilter, todoCommandSchema } from "../../../../src/server/catalog/private-http";
import { AppError } from "../../../../src/shared/errors";
import { parse } from "../../../../src/modules/activity-catalog/service";
export const GET=privateRoute(async ({workflow,queries,commands,service,actor,request,params,key})=>privateQuery(actor,service,(tx,timezone)=>workflow.personal.todos.query(tx,actor.userId,timezone,todoFilter(request)),new URL(request.url).searchParams.get("asOf")??undefined));

import { writeCustomTodo } from "../../../../src/modules/todos/custom";
export const POST=privateRoute(async({service,actor,request,params,key})=>{
 const input=await request.json();
 return service.repository.command({actor,idempotencyKey:key},"todo.custom.post"+"",input,false,async tx=>writeCustomTodo(tx,actor.userId,(await service.repository.authorize(actor,tx)).timezone,input));
});
