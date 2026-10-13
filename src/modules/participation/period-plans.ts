import { z } from "zod";
import type { PoolClient } from "pg";
import type { CommandContext } from "../../shared/db/ports";
import type { PersonalCatalogService,PrivateParticipation } from "./catalog-import";
import { months } from "./catalog-import";
import { parse } from "../activity-catalog/service";
import { daySchema,versionSchema,dateDay } from "../activity-catalog/validation";
import { AppError } from "../../shared/errors";
import { invalidated } from "../campaign/service";
import { syncParticipationActions } from "./catalog-action-projection";
import { commandHash } from "../../shared/db/command-hash";
export const timezoneSchema=z.string().max(100).refine(v=>{try{new Intl.DateTimeFormat('en',{timeZone:v});return true;}catch{return false;}});
const amount=z.string().regex(/^\d{1,12}(\.\d{1,2})?$/);
export const planSchema=z.object({type:z.enum(["month","billing","custom","once"]),startOn:daySchema,endOn:daySchema,timezone:timezoneSchema,
 partialPolicy:z.enum(["full_target","source_defined","needs_review"]),
 periods:z.array(z.object({periodId:z.string().uuid().optional(),startOn:daySchema,endOn:daySchema,targetCount:z.number().int().positive().optional(),targetAmount:amount.optional()}).strict()).max(2400),
 affectedPeriodIds:z.array(z.string().uuid()).max(2400),targetKind:z.enum(["count","amount","count_and_amount","count_or_amount","custom"]),targetCount:z.number().int().positive().optional(),targetAmount:amount.optional(),currency:z.string().regex(/^[A-Z]{3}$/),
 ruleVersionId:z.string().uuid(),participationVersion:versionSchema,expectedVersion:versionSchema.optional(),retryJobId:z.string().uuid().optional(),mode:z.enum(["snapshot","entries"]).optional()}).strict();
export type PlanInput=z.infer<typeof planSchema>;
export type Boundary={periodId?:string;startOn:string;endOn:string;targetCount?:number;targetAmount?:string;periodKey:string};
export function planBoundaries(input:PlanInput):Boundary[] {
 if(input.startOn>input.endOn) throw new AppError("UNPROCESSABLE_ENTITY","有限计划的结束不能早于开始");
 const totalMonths=(Number(input.endOn.slice(0,4))-Number(input.startOn.slice(0,4)))*12+Number(input.endOn.slice(5,7))-Number(input.startOn.slice(5,7))+1;
 if(input.type==='month'&&totalMonths>2400) throw new AppError("UNPROCESSABLE_ENTITY","计划超过明确上限 2400 期",422,{limit:2400});
 let result:Boundary[];
 if(input.periods.length) result=input.periods.map((x,i)=>({...x,periodKey:input.type==='month'?x.startOn.slice(0,7):input.type+':'+i}));
 else if(input.type==='month') result=months(input.startOn,input.endOn);
 else if(input.type==='once') result=[{periodKey:'once',startOn:input.startOn,endOn:input.endOn}];
 else throw new AppError("UNPROCESSABLE_ENTITY","账单和自定义周期必须提供明确边界");
 if(input.type==='once' && (result.length!==1 || result[0].startOn!==input.startOn || result[0].endOn!==input.endOn)) throw new AppError("UNPROCESSABLE_ENTITY","一次性周期必须覆盖完整活动期");
 const ordered=[...result].sort((a,b)=>a.startOn.localeCompare(b.startOn));
 for(let i=0;i<ordered.length;i++) {
  const b=ordered[i];
  if(b.startOn>b.endOn || b.startOn<input.startOn || b.endOn>input.endOn || i>0&&ordered[i-1].endOn>=b.startOn) throw new AppError("UNPROCESSABLE_ENTITY","周期越界或重叠，包含端点不能重复");
 }
 if(input.type==='month') {
  const generated=months(input.startOn,input.endOn);
  if(result.length!==generated.length || result.some((b,i)=>b.startOn!==generated[i].startOn||b.endOn!==generated[i].endOn)) throw new AppError("UNPROCESSABLE_ENTITY","自然月周期必须使用本地月边界");
 }
 return result;
}
export class PeriodPlanService {
 constructor(readonly personal:PersonalCatalogService){}
 async propose(context:CommandContext,id:string,raw:unknown) {
  const input=parse(planSchema,raw),boundaries=planBoundaries(input);
  const envelope=await this.personal.catalog.repository.command(context,"period.plan:"+id,input,false,async tx=>{
   const p=await this.personal.owned(tx,context.actor.userId,id,true);
   await this.validate(tx,p,input,boundaries);
   if(input.retryJobId) {
    const job=(await tx.query("select * from workbench_jobs where id=$1 and owner_user_id=$2 and participation_id=$3 for update",[input.retryJobId,p.owner_user_id,p.id])).rows[0];
    const {retryJobId,...hashInput}=input;
    if(!job) throw new AppError("NOT_FOUND","无法访问此任务");
    if(job.status!=='failed'||!job.retryable||job.input_hash!==commandHash(hashInput)||job.expected_version!==p.version||job.lease_until&&job.lease_until>new Date()) throw new AppError("CONFLICT","任务输入、基础版本或租约已变化");
    await tx.query("update workbench_jobs set status='queued',attempt=attempt+1,message=null,lease_token=null,lease_until=null where id=$1",[job.id]);
    return {jobId:job.id,status:"queued" as const};
   }
   if(boundaries.length>48 || boundaries.length*3>256) {
    const job=(await tx.query("insert into workbench_jobs(owner_user_id,card_id,participation_id,input,input_hash,expected_version) values($1,$2,$3,$4,$5,$6) returning id",[p.owner_user_id,p.card_id,p.id,input,commandHash(input),p.version])).rows[0];
    await tx.query("insert into catalog_personal_outbox(owner_user_id,aggregate_id,sequence,event_type,payload) values($1,$2,1,'period.plan_queued',$3)",[p.owner_user_id,job.id,{participationId:p.id}]);
    return {jobId:job.id,status:"queued" as const};
   }
   return this.activate(tx,p,input,boundaries);
  });
  return 'jobId' in envelope.data ? {...envelope,httpStatus:202 as const}:envelope;
 }
 async validate(tx:PoolClient,p:PrivateParticipation,input:PlanInput,boundaries:Boundary[]) {
  if(p.version!==input.participationVersion) throw new AppError("CONFLICT","参与已更新");
  if(p.card_status!=='active'||p.cancelled_at||p.tracking_decision==='stop_future') throw new AppError("UNPROCESSABLE_ENTITY","当前卡片或参与不能生成消费计划");
  const rule=(await tx.query("select * from private_rule_versions where id=$1 and owner_user_id=$2 and campaign_id=$3",[input.ruleVersionId,p.owner_user_id,p.campaign_id])).rows[0];
  if(!rule) throw new AppError("NOT_FOUND","规则不属于本活动");
  const start=dateDay(rule.content.start),end=dateDay(rule.content.end);
  if(start&&input.startOn<start||end&&input.endOn>end) throw new AppError("UNPROCESSABLE_ENTITY","计划越出活动范围");
  const active=(await tx.query("select version from period_plan_revisions where id=(select active_plan_id from activity_participations where id=$1)",[p.id])).rows[0];
  if(input.expectedVersion!==undefined && (active?.version??0)!==input.expectedVersion) throw new AppError("CONFLICT","生效计划版本已更新");
  const existing=await this.personal.periods(tx,p,true);
  const chosen=new Set(input.affectedPeriodIds);
  if(chosen.size!==input.affectedPeriodIds.length) throw new AppError("VALIDATION_ERROR","未来周期不能重复选择");
  const today=new Intl.DateTimeFormat("sv-SE",{timeZone:input.timezone}).format(new Date());
  for(const id of chosen) {
   const period=existing.find(x=>x.id===id);
   if(!period) throw new AppError("NOT_FOUND","选择的周期不属于本参与");
   const facts=(await tx.query("select 1 from spend_tasks t where t.period_id=$1 and (t.qualification<>'unknown' or exists(select 1 from catalog_spend_observations o where o.task_id=t.id) or exists(select 1 from task_evaluations e where e.task_id=t.id))",[id])).rowCount;
   if(period.start_on<=today||period.qualification!=='unknown'||facts) throw new AppError("UNPROCESSABLE_ENTITY","当前、历史或已有证据的周期必须保持冻结");
  }
  for(const b of boundaries) {
   const old=b.periodId?existing.find(x=>x.id===b.periodId):existing.find(x=>x.period_key===b.periodKey);
   if(b.periodId&&!old) throw new AppError("NOT_FOUND","候选周期不属于本参与");
   if(old&&!chosen.has(old.id)) {
    // Full plan drafts include frozen periods; they must remain byte-equivalent.
    if(old.start_on!==b.startOn||old.end_on!==b.endOn||old.target.kind!==input.targetKind||old.target.count!==(b.targetCount??input.targetCount??null)||old.target.amount!==(b.targetAmount??input.targetAmount??null)||old.timezone!==input.timezone)
     throw new AppError("UNPROCESSABLE_ENTITY","未选择的周期不能改边界或目标");
   }
   if(!old && existing.length && b.startOn<=today) throw new AppError("UNPROCESSABLE_ENTITY","追加实例只能明确作用于未来");
  }
  const candidate=existing.filter(x=>!chosen.has(x.id)).map(x=>({id:x.id,startOn:x.start_on,endOn:x.end_on}));
  for(const b of boundaries) {
   const old=b.periodId?existing.find(x=>x.id===b.periodId):existing.find(x=>x.period_key===b.periodKey);
   if(!old||chosen.has(old.id)) candidate.push({id:old?.id??b.periodKey,startOn:b.startOn,endOn:b.endOn});
  }
  candidate.sort((a,b)=>a.startOn.localeCompare(b.startOn));
  for(let i=1;i<candidate.length;i++) if(candidate[i].startOn<=candidate[i-1].endOn) throw new AppError("UNPROCESSABLE_ENTITY","修订与冻结周期重叠");
  return rule;
 }
 async activate(tx:PoolClient,p:PrivateParticipation,input:PlanInput,boundaries:Boundary[]) {
  // `propose` validates before choosing synchronous versus queued execution;
  // queued jobs validate again in the worker. Keep activation pure so a retry
  // cannot duplicate any validation-side work.
  const rule=(await tx.query("select * from private_rule_versions where id=$1 and owner_user_id=$2 and campaign_id=$3",[input.ruleVersionId,p.owner_user_id,p.campaign_id])).rows[0];
  if(!rule) throw new AppError("NOT_FOUND","规则不属于本活动");
  const prior=(await tx.query("select coalesce(max(version),0)+1 as n from period_plan_revisions where participation_id=$1",[p.id])).rows[0].n;
  const plan=(await tx.query("insert into period_plan_revisions(owner_user_id,card_id,participation_id,campaign_id,rule_version_id,version,type,timezone,partial_policy,start_on,end_on,proposal) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id",[p.owner_user_id,p.card_id,p.id,p.campaign_id,input.ruleVersionId,prior,input.type,input.timezone,input.partialPolicy,input.startOn,input.endOn,input])).rows[0];
  const existing=await this.personal.periods(tx,p,true);
  const executable=input.partialPolicy==='full_target' && rule.content.periodTemplate.countingBasis!=='unknown' && input.targetKind!=='custom' && (!["count","count_and_amount","count_or_amount"].includes(input.targetKind)||input.targetCount!==undefined) && (!["amount","count_and_amount","count_or_amount"].includes(input.targetKind)||input.targetAmount!==undefined);
  for(const b of boundaries) {
   const target={kind:input.targetKind,count:b.targetCount??input.targetCount??null,amount:b.targetAmount??input.targetAmount??null,currency:input.currency,rulesText:rule.content.periodTemplate.target.rulesText};
   const old=b.periodId?existing.find(x=>x.id===b.periodId):existing.find(x=>x.period_key===b.periodKey);
   let periodId=old?.id;
   if(old && !input.affectedPeriodIds.includes(old.id)) continue;
   if(old) {
    await tx.query("insert into activity_period_revisions(owner_user_id,card_id,participation_id,period_id,campaign_id,old_rule_version_id,new_rule_version_id,decision,note) values($1,$2,$3,$4,$5,$6,$7,'future_plan','明确未来周期采用')",[p.owner_user_id,p.card_id,p.id,old.id,p.campaign_id,old.rule_version_id,input.ruleVersionId]);
    await tx.query("update activity_periods set start_on=$2,end_on=$3,target=$4,timezone=$5,executable=$6,rule_version_id=$7,plan_revision_id=$8,version=version+1 where id=$1",[old.id,b.startOn,b.endOn,target,input.timezone,executable,input.ruleVersionId,plan.id]);
    await tx.query("update spend_tasks set version=version+1,mode=$2 where period_id=$1",[old.id,input.mode??'snapshot']);
   } else periodId=(await tx.query("insert into activity_periods(owner_user_id,card_id,participation_id,campaign_id,rule_version_id,period_key,start_on,end_on,timezone,target,executable,plan_revision_id) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id",[p.owner_user_id,p.card_id,p.id,p.campaign_id,input.ruleVersionId,b.periodKey,b.startOn,b.endOn,input.timezone,target,executable,plan.id])).rows[0].id;
   const task=(await tx.query("insert into spend_tasks(owner_user_id,card_id,participation_id,period_id,mode) values($1,$2,$3,$4,$5) on conflict(period_id) do update set period_id=excluded.period_id returning id",[p.owner_user_id,p.card_id,p.id,periodId,input.mode??'snapshot'])).rows[0];
   await this.personal.todos.upsert(tx,p,{key:`${p.id}:${periodId}:spend`,nodeKind:'spend_period',type:'spend_period',title:'核对周期刷卡目标 · '+b.periodKey,deadline:{kind:'date',value:b.endOn,timezone:input.timezone},primary:{kind:'progress',resourceId:task.id,participationId:p.id,label:'更新进度／核对达标',enabled:executable}},!!old);
  }
  p.version=(await tx.query("update activity_participations set active_plan_id=$2,tracking_status=$3,version=version+1 where id=$1 returning version",[p.id,plan.id,executable?'active':'needs_review'])).rows[0].version;
  await this.personal.history(tx,p,'period.plan_activated','同一事务生效，旧历史保留',{planId:plan.id,affectedPeriodIds:input.affectedPeriodIds});
  await syncParticipationActions(tx,this.personal,p,'周期计划已提交');
  return {participationId:p.id,version:p.version,invalidated};
 }
}
