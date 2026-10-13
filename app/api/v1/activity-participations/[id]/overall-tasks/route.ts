import { privateRoute,privateQuery } from "../../../../../../src/server/catalog/private-http";
import { OverallTaskService } from "../../../../../../src/modules/spend-task/overall";
import { CatalogPrivateQueries } from "../../../../../../src/modules/participation/catalog-queries";

export const POST=privateRoute(async({workflow,actor,request,params,key})=>
  new OverallTaskService(workflow.personal).create({actor,idempotencyKey:key},params.id,await request.json()));
export const GET=privateRoute(async({workflow,service,actor,params})=>privateQuery(actor,service,async tx=>{
  const p=await workflow.personal.owned(tx,actor.userId,params.id);
  const rows=(await tx.query("select id from spend_tasks where participation_id=$1 and owner_user_id=$2 and period_id is null order by id",[p.id,p.owner_user_id])).rows;
  const queries=new CatalogPrivateQueries(workflow.personal);
  return {items:await Promise.all(rows.map(row=>queries.task(tx,p.owner_user_id,row.id)))};
}));
