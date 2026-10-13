import { privateRoute,privateQuery } from "../../../../../src/server/catalog/private-http";
import { AppError } from "../../../../../src/shared/errors";
export const GET=privateRoute(async({service,actor,params})=>privateQuery(actor,service,async tx=>{
 const job=(await tx.query('select id,status,progress,message,retryable from workbench_jobs where id=$1 and owner_user_id=$2',[params.id,actor.userId])).rows[0];
 if(!job) throw new AppError('NOT_FOUND','无法访问此任务'); return job;
}));
