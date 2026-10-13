import { z } from "zod";
import type { CommandContext } from "../../shared/db/ports";
import type { PersonalCatalogService } from "../participation/catalog-import";
import { dateSchema,versionSchema } from "../activity-catalog/validation";
import { parse } from "../activity-catalog/service";
import { AppError } from "../../shared/errors";
import { invalidated } from "../campaign/service";
import { CatalogPrivateQueries } from "../participation/catalog-queries";
const rewardSchema=z.object({name:z.string().trim().min(1).max(200),type:z.enum(['cashback','points','gift','other']),quantity:z.string().regex(/^\d{1,12}(\.\d{1,2})?$/).nullable(),unit:z.string().max(100),currency:z.string().regex(/^[A-Z]{3}$/),scope:z.enum(['period','all_periods','overall']),periodId:z.string().uuid().optional(),requiredPeriodIds:z.array(z.string().uuid()).max(2400),overallTaskId:z.string().uuid().optional(),acquisition:z.enum(['manual','automatic','unknown']),claimStart:dateSchema,claimDeadline:dateSchema,expectedReceipt:dateSchema,channel:z.string().max(200),officialUrl:z.string().url().refine(v=>new URL(v).protocol==='https:').optional(),instructions:z.string().max(12000),receiptRuleText:z.string().max(12000),participationVersion:versionSchema,ruleVersionId:z.string().uuid()}).strict();
export class ActivityRewardService {
 constructor(readonly personal:PersonalCatalogService){}
 async create(context:CommandContext,id:string,raw:unknown) {
  const input=parse(rewardSchema,raw);
  return this.personal.catalog.repository.command(context,'reward.create:'+id,input,false,async tx=>{
   const p=await this.personal.owned(tx,context.actor.userId,id,true);
   if(p.version!==input.participationVersion) throw new AppError('CONFLICT','参与已经更新');
   if(!(await tx.query('select id from private_rule_versions where id=$1 and owner_user_id=$2 and campaign_id=$3',[input.ruleVersionId,p.owner_user_id,p.campaign_id])).rowCount) throw new AppError('NOT_FOUND','奖励规则不属于本参与');
   const periods=await this.personal.periods(tx,p);
   const required=input.scope==='period'?[input.periodId]:input.scope==='all_periods'?input.requiredPeriodIds:[];
   if(input.scope!=='overall'&&(!required.length||required.some(id=>!id||!periods.some(p=>p.id===id))||new Set(required).size!==required.length)) throw new AppError('NOT_FOUND','奖励必须绑定本参与的固定周期集合');
   if(input.scope==='all_periods'&&input.periodId||input.scope==='overall'&&(input.periodId||input.requiredPeriodIds.length)||input.scope!=='overall'&&input.overallTaskId) throw new AppError('VALIDATION_ERROR','奖励依赖范围不一致');
   if(input.scope==='overall'&&(!input.overallTaskId||!(await tx.query('select id from spend_tasks where id=$1 and participation_id=$2 and owner_user_id=$3 and card_id=$4 and period_id is null',[input.overallTaskId,id,p.owner_user_id,p.card_id])).rowCount)) throw new AppError('NOT_FOUND','全期奖励需要独立的全期任务');
   const key=crypto.randomUUID();
   const template={rewardKey:key,name:input.name,type:input.type,amountOrQuantity:input.quantity,unit:input.unit,currency:input.currency,scope:input.scope,conditionsText:input.instructions,overallTarget:null,acquisition:input.acquisition,channel:input.channel,officialUrl:input.officialUrl??null,claimStart:input.claimStart,claimEnd:input.claimDeadline,expectedReceipt:input.expectedReceipt,receiptRuleText:input.receiptRuleText};
   const r=(await tx.query('insert into activity_rewards(owner_user_id,card_id,participation_id,period_id,reward_key,template,campaign_id,rule_version_id,required_period_ids) values($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id',[p.owner_user_id,p.card_id,id,input.periodId??null,key,template,p.campaign_id,input.ruleVersionId,required])).rows[0];
   if(input.overallTaskId) await tx.query('insert into activity_reward_dependencies(owner_user_id,card_id,participation_id,reward_id,task_id) values($1,$2,$3,$4,$5)',[p.owner_user_id,p.card_id,id,r.id,input.overallTaskId]);
   p.version=(await tx.query('update activity_participations set version=version+1 where id=$1 returning version',[id])).rows[0].version;
   if(input.acquisition!=='automatic') await this.personal.todos.upsert(tx,p,{key:`${id}:${r.id}:claim`,nodeKind:'reward_claim',type:'reward_claim',title:'核对奖励条件／领取 · '+input.name,deadline:input.claimDeadline,primary:{kind:'reward_conditions',resourceId:r.id,participationId:id,label:'查看条件与领取窗口',enabled:true}});
   if(input.acquisition==='automatic') await this.personal.todos.upsert(tx,p,{key:`${id}:${r.id}:receipt`,nodeKind:'reward_receipt',type:'reward_receipt',title:'核对实际到账 · '+input.name,deadline:input.expectedReceipt,primary:{kind:'receipt',resourceId:r.id,participationId:id,label:'核对实际到账',enabled:true}});
   await this.personal.todos.upsert(tx,p,{key:`${id}:${r.id}:claim_start`,nodeKind:'reward_claim_start',type:'reward_claim',title:'奖励领取窗口开始 · '+input.name,deadline:input.claimStart,primary:{kind:'detail',resourceId:id,participationId:id,label:'查看活动',enabled:true}});
   await this.personal.history(tx,p,'reward.created','奖励条件、领取与到账独立维护',{rewardId:r.id,requiredPeriodIds:required,overallTaskId:input.overallTaskId});
   return {reward:await new CatalogPrivateQueries(this.personal).reward(tx,p.owner_user_id,r.id),invalidated};
  });
 }
}
