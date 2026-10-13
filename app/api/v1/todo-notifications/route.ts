import { privateRoute,privateQuery } from "../../../../src/server/catalog/private-http";
export const GET=privateRoute(async({service,actor,request})=>privateQuery(actor,service,async tx=>{
 const p=new URL(request.url).searchParams; const limit=Math.min(100,Math.max(1,Number(p.get("limit")??50)));
 return (await tx.query(`select n.id,n.action_id,n.node_id,n.title,n.delivered_at as "deliveredAt",s.days_before,s.deadline
 from todo_notifications n join todo_notification_schedules s on s.id=n.schedule_id where n.owner_user_id=$1 order by n.delivered_at desc,n.id desc limit $2`,[actor.userId,limit])).rows;
}));
