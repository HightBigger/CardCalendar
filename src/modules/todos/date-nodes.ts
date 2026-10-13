import type { PoolClient } from "pg";
import type { DateValue, PrimaryAction } from "../../contracts/workbench";
import type { PrivateParticipation } from "../participation/catalog-import";
export const NODE_KINDS=["eligibility","enrollment","spend_period","spend_qualification","activity_start","activity_end","reward_claim","reward_claim_start","reward_receipt"] as const;
export async function projectActivityNode(tx:PoolClient,p:PrivateParticipation,input:{key:string;nodeKind:string;title:string;deadline:DateValue;primary:PrimaryAction}) {
 const pref=p.node_preferences.find(x=>x.nodeKind===input.nodeKind);
 const n=(await tx.query(`insert into business_date_nodes(owner_user_id,card_id,participation_id,source_kind,node_key,node_kind,title,date_value,source_version,show_in_calendar,notify_days,primary_action)
 values($1,$2,$3,'activity',$4,$5,$6,$7,$8,$9,$10,$11)
 on conflict(owner_user_id,node_key) do update set title=excluded.title,date_value=excluded.date_value,source_version=excluded.source_version,
 show_in_calendar=excluded.show_in_calendar,notify_days=excluded.notify_days,primary_action=excluded.primary_action,version=business_date_nodes.version+1
 where (business_date_nodes.title,business_date_nodes.date_value,business_date_nodes.show_in_calendar,business_date_nodes.notify_days,business_date_nodes.primary_action)
 is distinct from (excluded.title,excluded.date_value,excluded.show_in_calendar,excluded.notify_days,excluded.primary_action) returning *`,
 [p.owner_user_id,p.card_id,p.id,input.key,input.nodeKind,input.title,input.deadline,p.version,pref?.showInCalendar??true,pref?.notifyDaysBefore??[],input.primary])).rows[0]
 ?? (await tx.query("select * from business_date_nodes where owner_user_id=$1 and node_key=$2",[p.owner_user_id,input.key])).rows[0];
 return {node:n,pref};
}
export async function scheduleNode(tx:PoolClient,p:Pick<PrivateParticipation,"owner_user_id"|"cancelled_at"|"reward_reminder_policy">,n:Record<string,any>,action?:{id:string;version:number;status:string}) {
 await tx.query("update todo_notification_schedules set status='cancelled' where node_id=$1 and status='pending'",[n.id]);
 if(n.date_value.kind==='unknown'||action?.status&&action.status!=="pending"||p.cancelled_at&& !n.node_kind.startsWith('reward_')||n.node_kind.startsWith('reward_')&&p.reward_reminder_policy!=="continue") return;
 for(const days of n.notify_days) { await tx.query(`insert into todo_notification_schedules(owner_user_id,node_id,action_id,action_version,days_before,deadline)
 values($1,$2,$3,$4,$5,$6) on conflict do nothing`,[p.owner_user_id,n.id,action?.id??null,action?.version??n.version,days,n.date_value]);
 await tx.query("update todo_notification_schedules s set status='pending' where s.node_id=$1 and s.action_version=$2 and s.days_before=$3 and s.status='cancelled' and not exists(select 1 from todo_notifications n where n.owner_user_id=s.owner_user_id and n.delivery_key=s.delivery_key)",[n.id,action?.version??n.version,days]);
 }
}
export async function activityMarkers(tx:PoolClient,owner:string,timezone:string,filter:import("../../contracts/todos").TodoFilters|Partial<import("../../contracts/todos").TodoFilters>) {
 const nodes=(await tx.query(`select n.*,jsonb_build_object('id',c.id,'bank',c.issuer_name,'name',c.name,'last4',c.last4) as card,r.content->>'name' as activity_name
 from business_date_nodes n left join cards c on c.id=n.card_id and c.user_id=n.owner_user_id
 left join activity_participations p on p.id=n.participation_id left join private_rule_versions r on r.id=p.rule_version_id
 where n.owner_user_id=$1 and n.show_in_calendar and n.date_value->>'kind'<>'unknown'
 and not exists(select 1 from todo_actions a where a.node_id=n.id and a.show_in_calendar)`,[owner])).rows;
 return nodes.flatMap(n=>{
  const d=n.date_value as DateValue;
  const date=d.kind==="instant"?new Intl.DateTimeFormat("sv-SE",{timeZone:timezone}).format(new Date(d.value)):d.kind==="date"?d.value:null;
  const type=n.node_kind.startsWith('reward_claim')?'reward_claim':n.node_kind==='reward_receipt'?'reward_receipt':n.node_kind.startsWith('spend')?'spend_period':n.source_kind==='annual_fee'?'annual_fee':'enrollment';
  if(!date || filter.month&&!date.startsWith(filter.month)||filter.from&&date<filter.from||filter.to&&date>filter.to||filter.cardIds?.length&&!filter.cardIds.includes(n.card_id)||filter.types?.length&&!filter.types.includes(type)||filter.q&&!((n.title+' '+(n.card?.name??'')+' '+(n.activity_name??'')).includes(filter.q))) return [];
  return [{kind:"marker" as const,id:n.id,date,title:n.title,card:n.card,primaryAction:n.primary_action,description:"业务日期标记"}];
 });
}
