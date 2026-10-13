import { privateRoute, privateQuery, todoFilter, todoCommandSchema } from "../../../../../src/server/catalog/private-http";
import { AppError } from "../../../../../src/shared/errors";
import { parse } from "../../../../../src/modules/activity-catalog/service";
export const GET=privateRoute(async ({workflow,queries,commands,service,actor,request,params,key})=>privateQuery(actor,service,async(tx,timezone)=>{const row=(await workflow.personal.todos.rows(tx,actor.userId)).find(r=>r.id===params.id);if(!row)throw new AppError("NOT_FOUND","无法访问此待办");return workflow.personal.todos.dto(row,timezone);}));

import { writeCustomTodo } from "../../../../../src/modules/todos/custom";
export const PATCH=privateRoute(async({service,actor,request,params,key})=>{
 const input=await request.json();
 return service.repository.command({actor,idempotencyKey:key},"todo.custom.patch"+params.id,input,false,async tx=>writeCustomTodo(tx,actor.userId,(await service.repository.authorize(actor,tx)).timezone,input,params.id));
});
