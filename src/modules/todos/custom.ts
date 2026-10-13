import { z } from "zod";
import type { PoolClient } from "pg";
import { dateSchema,versionSchema } from "../activity-catalog/validation";
import { parse } from "../activity-catalog/service";
import { AppError } from "../../shared/errors";
import { TodoService } from "./catalog-todos";
import { scheduleNode } from "./date-nodes";
export const customTodoSchema=z.object({title:z.string().trim().min(1).max(200),description:z.string().max(4000),cardId:z.string().uuid().optional(),deadline:dateSchema,plannedFor:dateSchema,priority:z.enum(["normal","important"])}).strict();
export async function writeCustomTodo(tx:PoolClient,owner:string,timezone:string,raw:unknown,id?:string) {
 const input=parse(id?customTodoSchema.extend({expectedVersion:versionSchema}):customTodoSchema,raw);
 if(input.cardId && !(await tx.query("select id from cards where id=$1 and user_id=$2 for share",[input.cardId,owner])).rowCount) throw new AppError("NOT_FOUND","无法访问此卡片");
 const todos=new TodoService();
 let version=1;
 const event={id:crypto.randomUUID(),command:id?"edit":"create",occurredAt:new Date().toISOString(),actor:owner};
 if(id) {
  const row=(await tx.query("select * from todo_actions where id=$1 and owner_user_id=$2 and type='custom' for update",[id,owner])).rows[0];
  if(!row) throw new AppError("NOT_FOUND","无法编辑此自定义待办");
  if(!("expectedVersion" in input) || row.version!==input.expectedVersion) throw new AppError("CONFLICT","待办已经更新");
  version=row.version+1;
  await tx.query("update todo_actions set title=$3,description=$4,card_id=$5,deadline=$6,planned_for=$7,priority=$8,version=version+1,history=history||$9::jsonb where id=$1 and owner_user_id=$2",[id,owner,input.title,input.description,input.cardId??null,input.deadline,input.plannedFor,input.priority,JSON.stringify([event])]);
  await tx.query("update todo_notification_schedules set status='cancelled' where action_id=$1 and status='pending'",[id]);
 } else {
  id=crypto.randomUUID();
  const unknown={kind:"unknown",reason:"未设置"};
  await tx.query("insert into todo_actions(id,owner_user_id,card_id,action_key,title,description,type,node_kind,deadline,planned_for,snoozed_until,primary_action,source_version,priority,history) values($1,$2,$3,$4,$5,$6,'custom','custom',$7,$8,$9,$10,1,$11,$12)",[id,owner,input.cardId??null,"custom:"+id,input.title,input.description,input.deadline,input.plannedFor,unknown,{kind:"detail",resourceId:id,label:"查看详情",enabled:true},input.priority,JSON.stringify([event])]);
 }
 const node=(await tx.query(`insert into business_date_nodes(owner_user_id,source_kind,node_key,node_kind,title,date_value,source_version,show_in_calendar,primary_action)
   values($1,'custom',$2,'custom',$3,$4,$5,true,$6)
   on conflict(owner_user_id,node_key) do update set title=excluded.title,date_value=excluded.date_value,
   source_version=excluded.source_version,primary_action=excluded.primary_action,version=business_date_nodes.version+1
   returning *`,[owner,"custom:"+id,input.title,input.deadline,version,{kind:"detail",resourceId:id,label:"查看详情",enabled:true}])).rows[0];
 await tx.query("update todo_actions set node_id=$2 where id=$1 and owner_user_id=$3",[id,node.id,owner]);
 await tx.query("update todo_notification_schedules set status='cancelled' where action_id=$1 and status='pending'",[id]);
 if(input.deadline.kind!=="unknown") await scheduleNode(tx,{owner_user_id:owner,cancelled_at:null,reward_reminder_policy:"continue"},node,{id,version,status:"pending"});
 await tx.query("insert into audit_logs(user_id,actor_type,actor_id,action,entity_type,entity_id,metadata) values($1,'user',$1,$2,'todo_action',$3,$4)",[owner,"todo.custom."+event.command,id,event]);
 await tx.query("insert into catalog_personal_outbox(owner_user_id,aggregate_id,sequence,event_type,payload) values($1,$2,$3,$4,$5)",[owner,id,version,"todo.custom."+event.command,event]);
 const row=(await todos.rows(tx,owner)).find(r=>r.id===id)!;
 return {action:todos.dto(row,timezone),invalidated:["todos","notifications"]};
}
