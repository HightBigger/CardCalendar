import { z } from "zod";
import type { PoolClient } from "pg";
import type { CommandContext } from "../../shared/db/ports";
import type { PersonalCatalogService } from "../participation/catalog-import";
import { CatalogPrivateQueries } from "../participation/catalog-queries";
import { syncParticipationActions } from "../participation/catalog-action-projection";
import { parse } from "../activity-catalog/service";
import { daySchema,versionSchema } from "../activity-catalog/validation";
import { AppError } from "../../shared/errors";
import { invalidated } from "../campaign/service";
import { minor,money } from "./money";
export const spendSchema=z.object({count:z.number().int().positive().max(1000000),amount:z.string().regex(/^\d{1,12}(\.\d{1,2})?$/),occurredOn:daySchema,stage:z.enum(['occurred','posted','settled']),note:z.string().trim().min(1).max(4000),postedOn:daySchema.optional(),settledOn:daySchema.optional(),channel:z.string().max(200).optional(),taskVersion:versionSchema,evaluateTaskIds:z.array(z.string().uuid()).min(1).max(100),taskVersions:z.record(versionSchema).optional()}).strict();
export class SpendFactService {
 readonly queries:CatalogPrivateQueries;
 constructor(readonly personal:PersonalCatalogService){this.queries=new CatalogPrivateQueries(personal);}
 async create(context:CommandContext,id:string,raw:unknown) {
  const input=parse(spendSchema,raw);
  if(input.stage==='occurred'&&(input.postedOn||input.settledOn)||input.stage==='posted'&&input.settledOn)
   throw new AppError('VALIDATION_ERROR','声明阶段与里程碑日期不一致');
  if(new Set(input.evaluateTaskIds).size!==input.evaluateTaskIds.length) throw new AppError('VALIDATION_ERROR','同任务只能评估一次');
  return this.personal.catalog.repository.command(context,'spend.fact.create:'+id,input,false,async tx=>{
   const p=await this.personal.owned(tx,context.actor.userId,id,true);
   for(const taskId of [...input.evaluateTaskIds].sort()) {
    await tx.query('select id from spend_tasks where id=$1 and owner_user_id=$2 for update',[taskId,p.owner_user_id]);
    const task=await this.queries.task(tx,p.owner_user_id,taskId);
    if(task.participationId!==id || task.cardId!==p.card_id) throw new AppError('NOT_FOUND','消费任务不属于本卡参与');
    const expected=input.taskVersions?.[taskId]??(input.evaluateTaskIds.length===1?input.taskVersion:undefined);
    if(expected===undefined) throw new AppError('VALIDATION_ERROR','多任务写入需要各任务版本');
    if(task.version!==expected) throw new AppError('CONFLICT','消费任务已更新');
    if(task.mode!=='entries'||!task.allowedCommands.find(c=>c.kind==='create_entry')?.enabled) throw new AppError('UNPROCESSABLE_ENTITY','任务模式或资格不允许新增逐条消费');
   }
   if(input.postedOn&&input.postedOn<input.occurredOn||input.settledOn&&input.settledOn<(input.postedOn??input.occurredOn)) throw new AppError('UNPROCESSABLE_ENTITY','里程碑日期顺序无效');
   const fact=(await tx.query('insert into spend_facts(owner_user_id,card_id,occurred_on,posted_on,settled_on,count,amount,currency,channel,note,declared_stage) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning *',[p.owner_user_id,p.card_id,input.occurredOn,input.postedOn??null,input.settledOn??null,input.count,input.amount,(await this.queries.task(tx,p.owner_user_id,input.evaluateTaskIds[0])).currency,input.channel??'',input.note,input.stage])).rows[0];
   await tx.query("insert into spend_fact_events(owner_user_id,card_id,fact_id,event_type,payload) values($1,$2,$3,'created',$4)",[p.owner_user_id,p.card_id,fact.id,{...input,declaredStage:input.stage}]);
   for(const taskId of [...input.evaluateTaskIds].sort()) await this.evaluate(tx,p.owner_user_id,taskId,fact.id);
   p.version=(await tx.query('update activity_participations set version=version+1 where id=$1 returning version',[p.id])).rows[0].version;
   await syncParticipationActions(tx,this.personal,p,input.note);
   await this.personal.history(tx,p,'spend.fact_created',input.note,{factId:fact.id,evaluateTaskIds:input.evaluateTaskIds});
   return {task:await this.queries.task(tx,p.owner_user_id,input.evaluateTaskIds[0]),invalidated};
  });
 }
 async link(context:CommandContext,id:string,raw:unknown) {
  const input=parse(z.object({spendFactId:z.string().uuid(),expectedVersion:versionSchema}).strict(),raw);
  return this.personal.catalog.repository.command(context,'spend.fact.evaluate:'+id,input,false,async tx=>{
   const task=await this.queries.task(tx,context.actor.userId,id);
   const p=await this.personal.owned(tx,context.actor.userId,task.participationId,true);
   await tx.query('select id from spend_tasks where id=$1 for update',[id]);
   const current=await this.queries.task(tx,p.owner_user_id,id);
   if(current.version!==input.expectedVersion) throw new AppError('CONFLICT','任务已经更新');
   if(current.mode!=='entries'||!current.allowedCommands.find(c=>c.kind==='evaluate')?.enabled) throw new AppError('UNPROCESSABLE_ENTITY','任务不能关联消费事实');
   const fact=(await tx.query('select id from spend_facts where id=$1 and owner_user_id=$2 and card_id=$3',[input.spendFactId,p.owner_user_id,p.card_id])).rows[0];
   if(!fact) throw new AppError('NOT_FOUND','消费事实不属于本卡');
   await this.evaluate(tx,p.owner_user_id,id,fact.id);
   p.version=(await tx.query('update activity_participations set version=version+1 where id=$1 returning version',[p.id])).rows[0].version;
   await syncParticipationActions(tx,this.personal,p,'关联同源消费，各任务分别评估');
   await this.personal.history(tx,p,'spend.fact_evaluated','同一任务仅有一份逻辑评估',{taskId:id,factId:fact.id});
   return {task:await this.queries.task(tx,p.owner_user_id,id),invalidated};
  });
 }
 async evaluate(tx:PoolClient,owner:string,taskId:string,factId:string) {
  const row=(await tx.query(`select t.*,coalesce(ap.start_on,t.start_on)::text as from_on,coalesce(ap.end_on,t.end_on)::text as to_on,
   r.content,r.editor_draft from spend_tasks t left join activity_periods ap on ap.id=t.period_id and ap.owner_user_id=t.owner_user_id
   join private_rule_versions r on r.id=coalesce(ap.rule_version_id,t.rule_version_id) and r.owner_user_id=t.owner_user_id
   where t.id=$1 and t.owner_user_id=$2`,[taskId,owner])).rows[0];
  const f=(await tx.query('select *,occurred_on::text,posted_on::text,settled_on::text,amount::text,refunded_amount::text from spend_facts where id=$1 and owner_user_id=$2 and card_id=$3',[factId,owner,row.card_id])).rows[0];
  if(!f) throw new AppError('NOT_FOUND','消费链不一致');
  const basis=row.content.periodTemplate.countingBasis;
  const basisOn=basis==='occurred'?f.occurred_on:basis==='posted'?f.posted_on:basis==='settled'?f.settled_on:null;
  const amount=minor(f.amount)-minor(f.refunded_amount);
  let decision='included',reason='满足本任务冻结计入规则';
  const rules=row.editor_draft;
  if(basis==='unknown') {decision='needs_review';reason='统计口径未知';}
  else if(f.currency!==(row.overall_target??(await tx.query('select target from activity_periods where id=$1',[row.period_id])).rows[0]?.target)?.currency) {decision='excluded';reason='币种不同';}
  else if(rules?.channel&&!f.channel) {decision='needs_review';reason='消费渠道尚未核对';}
  else if(rules?.channel&&rules.channel!==f.channel) {decision='excluded';reason='渠道不匹配';}
  else if(amount===0n||rules?.minimumAmount&&amount<minor(rules.minimumAmount)) {decision='excluded';reason='退款或最低单笔金额规则不满足';}
  else if(!basisOn) {decision='pending';reason='尚未记录口径所需的里程碑日期';}
  else if(basisOn<row.from_on||basisOn>row.to_on) {decision='excluded';reason='冻结计入日期不属于本期';}
  await tx.query(`insert into task_evaluations(owner_user_id,card_id,participation_id,task_id,fact_id,fact_version,decision,count,amount,basis_on,reason)
   values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) on conflict(task_id,fact_id) do update set fact_version=excluded.fact_version,decision=excluded.decision,count=excluded.count,amount=excluded.amount,basis_on=excluded.basis_on,reason=excluded.reason,updated_at=now()`,[owner,row.card_id,row.participation_id,taskId,factId,f.version,decision,amount===0n?0:f.count,money(amount),basisOn,reason]);
  await tx.query('update spend_tasks set version=version+1 where id=$1',[taskId]);
  const after=await this.queries.task(tx,owner,taskId);
  if(row.qualification==='met'&&after.progressStatus!=='reached') {
   await tx.query("update spend_tasks set qualification='unknown' where id=$1",[taskId]);
   if(row.period_id) await tx.query("update activity_periods set qualification='unknown',version=version+1 where id=$1",[row.period_id]);
  }
 }
 async milestone(context:CommandContext,id:string,kind:'milestones'|'reversals',raw:unknown) {
  const input=kind==='milestones'?parse(z.object({expectedVersion:versionSchema,stage:z.enum(['posted','settled']),occurredOn:daySchema,note:z.string().trim().min(1).max(4000)}).strict(),raw):parse(z.object({expectedVersion:versionSchema,amount:z.string().regex(/^\d{1,12}(\.\d{1,2})?$/),occurredOn:daySchema,note:z.string().trim().min(1).max(4000)}).strict(),raw);
  return this.personal.catalog.repository.command(context,'spend.fact.'+kind+':'+id,input,false,async tx=>{
   const f=(await tx.query('select *,occurred_on::text,posted_on::text,settled_on::text,amount::text,refunded_amount::text from spend_facts where id=$1 and owner_user_id=$2',[id,context.actor.userId])).rows[0];
   if(!f) throw new AppError('NOT_FOUND','无法访问此消费');
   await tx.query('select id from cards where id=$1 and user_id=$2 for share',[f.card_id,f.owner_user_id]);
   const affected=(await tx.query('select distinct participation_id from task_evaluations where fact_id=$1 and owner_user_id=$2 order by participation_id',[id,f.owner_user_id])).rows;
   const parents=[];
   for(const row of affected) parents.push(await this.personal.owned(tx,f.owner_user_id,row.participation_id,true));
   await tx.query('select id from spend_facts where id=$1 for update',[id]);
   const current=(await tx.query('select version,refunded_amount::text from spend_facts where id=$1',[id])).rows[0];
   if(current.version!==input.expectedVersion) throw new AppError('CONFLICT','消费已经更新');
   if(input.occurredOn<f.occurred_on||input.occurredOn>new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'})) throw new AppError('UNPROCESSABLE_ENTITY','实际里程碑日期无效');
   if('amount' in input) {
    const total=minor(current.refunded_amount)+minor(input.amount);
    if(minor(input.amount)<=0n||total>minor(f.amount)) throw new AppError('UNPROCESSABLE_ENTITY','累计退款不能超过原消费');
    await tx.query('update spend_facts set refunded_amount=$2,version=version+1 where id=$1',[id,money(total)]);
   } else {
    if(input.stage==='posted'&&f.settled_on&&input.occurredOn>f.settled_on||input.stage==='settled'&&f.posted_on&&input.occurredOn<f.posted_on) throw new AppError('UNPROCESSABLE_ENTITY','入账与清算日期顺序无效');
    await tx.query(`update spend_facts set ${input.stage==='posted'?'posted_on':'settled_on'}=$2,declared_stage=case when $3='settled' or declared_stage='settled' then 'settled' else 'posted' end,version=version+1 where id=$1`,[id,input.occurredOn,input.stage]);
   }
   await tx.query('insert into spend_fact_events(owner_user_id,card_id,fact_id,event_type,payload) values($1,$2,$3,$4,$5)',[f.owner_user_id,f.card_id,id,kind,input]);
   const tasks=(await tx.query('select task_id from task_evaluations where fact_id=$1 and owner_user_id=$2 order by task_id',[id,f.owner_user_id])).rows;
   for(const task of tasks) {await tx.query('select id from spend_tasks where id=$1 for update',[task.task_id]);await this.evaluate(tx,f.owner_user_id,task.task_id,id);}
   for(const p of parents) {
    p.version=(await tx.query('update activity_participations set version=version+1 where id=$1 returning version',[p.id])).rows[0].version;
    await syncParticipationActions(tx,this.personal,p,input.note);
    await this.personal.history(tx,p,'spend.fact_'+kind,input.note,{factId:id,input});
   }
   return {fact:(await tx.query('select * from spend_facts where id=$1',[id])).rows[0],taskIds:tasks.map(t=>t.task_id),invalidated};
  });
 }
}
