import { z } from "zod";
import type { CommandContext } from "../../shared/db/ports";
import type { PersonalCatalogService,PrivateParticipation } from "./catalog-import";
import { NODE_KINDS,projectActivityNode,scheduleNode } from "../todos/date-nodes";
import { versionSchema } from "../activity-catalog/validation";
import { parse } from "../activity-catalog/service";
import { AppError } from "../../shared/errors";
import { invalidated } from "../campaign/service";
import type { PoolClient } from "pg";
export async function projectMarkers(tx:PoolClient,personal:PersonalCatalogService,p:PrivateParticipation) {
 for(const [kind,date,title] of [['activity_start',p.content.start,'活动开始'],['activity_end',p.content.end,'活动结束']] as const) {
  const {node}=await projectActivityNode(tx,p,{key:p.id+':'+kind,nodeKind:kind,title:title+' · '+p.content.name,deadline:date,primary:{kind:'detail',resourceId:p.id,participationId:p.id,label:'查看活动',enabled:true}});
  await scheduleNode(tx,p,node);
 }
}
export class NodePreferenceService {
 constructor(readonly personal:PersonalCatalogService){}
 async save(context:CommandContext,id:string,raw:unknown) {
  const input=parse(z.object({expectedVersion:versionSchema,nodePreferences:z.array(z.object({nodeKind:z.enum(NODE_KINDS),label:z.string().max(200),showInCalendar:z.boolean(),createTodo:z.boolean(),notifyDaysBefore:z.array(z.number().int().min(0).max(365)).max(10)}).strict()).max(20)}).strict(),raw);
  if(new Set(input.nodePreferences.map(x=>x.nodeKind)).size!==input.nodePreferences.length||input.nodePreferences.some(x=>new Set(x.notifyDaysBefore).size!==x.notifyDaysBefore.length)) throw new AppError('VALIDATION_ERROR','节点类型和通知天数不能重复');
  return this.personal.catalog.repository.command(context,'node.preferences:'+id,input,false,async tx=>{
   const p=await this.personal.owned(tx,context.actor.userId,id,true);
   if(p.version!==input.expectedVersion) throw new AppError('CONFLICT','参与已更新');
   p.node_preferences=input.nodePreferences;
   p.version=(await tx.query('update activity_participations set node_preferences=$2,version=version+1 where id=$1 returning version',[id,JSON.stringify(input.nodePreferences)])).rows[0].version;
   const nodes=(await tx.query('select * from business_date_nodes where participation_id=$1 and owner_user_id=$2 order by id',[id,p.owner_user_id])).rows;
   for(const n of nodes) {
    const action=(await tx.query('select * from todo_actions where node_id=$1',[n.id])).rows[0];
    await this.personal.todos.upsert(tx,p,{key:n.node_key,nodeKind:n.node_kind,type:action?.type??(n.node_kind.startsWith('reward_claim')?'reward_claim':n.node_kind==='reward_receipt'?'reward_receipt':n.node_kind.startsWith('spend')?'spend_period':'enrollment'),title:n.title,deadline:n.date_value,primary:n.primary_action},true);
   }
   await projectMarkers(tx,this.personal,p);
   await this.personal.history(tx,p,'node.preferences_saved','日历、行动和通知独立配置',input);
   return {participationId:p.id,version:p.version,invalidated};
  });
 }
}
