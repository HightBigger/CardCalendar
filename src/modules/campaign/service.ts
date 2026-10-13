import { projectMarkers } from "../participation/node-preferences";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { PoolClient } from "pg";
import type { ActivityDraft } from "../../contracts/activities";
import type { CatalogContent } from "../../contracts/activity-catalog";
import type { DateValue } from "../../contracts/workbench";
import type { CommandContext } from "../../shared/db/ports";
import type { PersonalCatalogService } from "../participation/catalog-import";
import { parse } from "../activity-catalog/service";
import { dateSchema,daySchema,versionSchema } from "../activity-catalog/validation";
import { AppError } from "../../shared/errors";
export const invalidated=["activities","spend-tasks","rewards","todos","notifications"] as const;
export const unknown=(reason="待核对"):DateValue=>({kind:"unknown",reason});
const optionalEmpty = (schema:z.ZodType<string>) => z.union([schema,z.literal("").transform(()=>undefined)]).optional();
export const activityDraftSchema=z.object({
 cardId:z.string().uuid(),name:z.string().trim().min(1).max(200),startOn:optionalEmpty(daySchema),endOn:optionalEmpty(daySchema),
 sourceLabel:z.string().max(200),sourceUrl:optionalEmpty(z.string().url().refine(v=>{try{return new URL(v).protocol==="https:";}catch{return false;}})),rulesText:z.string().max(12000),
 enrollmentRequired:z.enum(["yes","no","unknown"]),channel:z.string().max(200),cycleType:z.enum(["month","billing","custom","once"]),
 targetKind:z.enum(["count","amount","count_and_amount","count_or_amount","custom"]),targetCount:z.number().int().positive().max(1000000).optional(),
 targetAmount:z.string().regex(/^\d{1,12}(\.\d{1,2})?$/).optional(),currency:z.string().regex(/^[A-Z]{3}$/),
 countingBasis:z.enum(["occurred","posted","settled","unknown"]),rewardText:z.string().max(12000),
 start:dateSchema.optional(),end:dateSchema.optional(),enrollmentScope:z.enum(["participation","period"]).optional(),
 enrollmentDeadline:dateSchema.optional(),quotaRequired:z.boolean().optional(),minimumAmount:z.string().regex(/^\d{1,12}(\.\d{1,2})?$/).optional(),
});
export type PrivateDraft=z.infer<typeof activityDraftSchema>;
function content(d:PrivateDraft,timezone:string):CatalogContent {
 const date=(v?:string)=>v?{kind:"date" as const,value:v,timezone}:unknown();
 return {name:d.name,bankId:null,summary:d.rewardText,activityType:"私人活动",start:d.start??date(d.startOn),end:d.end??date(d.endOn),
 conditions:{cardTypesText:"私人录入，资格独立核对",customerSegmentsText:"待核对",regionText:"待核对",channelText:d.channel,exclusionsText:d.rulesText,enrollmentRequired:d.enrollmentRequired,enrollmentScope:d.enrollmentScope??"participation",enrollmentDeadline:d.enrollmentDeadline??unknown(),quotaText:d.quotaRequired?"需确认名额":"待核对"},
 periodTemplate:{type:d.cycleType,timezone,countingBasis:d.countingBasis,partialPolicy:"needs_review",target:{kind:d.targetKind,count:d.targetCount??null,amount:d.targetAmount??null,currency:d.currency,rulesText:d.rulesText},periods:[]},
 rewards:[],sources:d.sourceUrl?[{url:d.sourceUrl,excerpt:d.sourceLabel,accessedAt:new Date().toISOString(),verifiedAt:null,completeness:"partial"}]:[],unknownItems:[],bankCancellation:null};
}
export class CampaignService {
 constructor(readonly personal:PersonalCatalogService){}
 async create(context:CommandContext,raw:unknown) {
  const input=parse(activityDraftSchema.strict(),raw);
  return this.personal.catalog.repository.command(context,"campaign.create",input,false,async tx=>{
   await this.card(tx,context.actor.userId,input.cardId);
   if(input.startOn && input.endOn && input.endOn<input.startOn) throw new AppError("UNPROCESSABLE_ENTITY","活动日期顺序无效");
   const timezone=(await tx.query("select timezone from users where id=$1",[context.actor.userId])).rows[0].timezone;
   const campaign=(await tx.query("insert into private_campaigns(owner_user_id,source_kind,activity_instance_key) values($1,'manual',$2) returning id,version",[context.actor.userId,randomUUID()])).rows[0];
   await tx.query("insert into private_rule_versions(owner_user_id,campaign_id,source_kind,revision,content,editor_draft) values($1,$2,'manual',1,$3,$4)",[context.actor.userId,campaign.id,content(input,timezone),input]);
   await this.definitionHistory(tx,context.actor.userId,campaign.id,1,"campaign.created",{cardId:input.cardId});
   return campaign;
  });
 }
 async card(tx:PoolClient,owner:string,id:string) {
  if(!(await tx.query("select id from cards where id=$1 and user_id=$2 and status='active' for share",[id,owner])).rowCount) throw new AppError("NOT_FOUND","无法使用此卡片");
 }
 async join(context:CommandContext,id:string,raw:unknown) {
  const input=parse(z.object({cardId:z.string().uuid(),campaignVersion:versionSchema,activityInstanceKey:z.string().min(1).max(240)}).strict(),raw);
  return this.personal.catalog.repository.command(context,"campaign.join:"+id,input,false,async tx=>{
   await this.card(tx,context.actor.userId,input.cardId);
   const c=(await tx.query("select * from private_campaigns where id=$1 and owner_user_id=$2 and source_kind='manual' for update",[id,context.actor.userId])).rows[0];
   if(!c) throw new AppError("NOT_FOUND","无法访问此私人活动定义");
   const existing=(await tx.query("select id,rule_version_id from activity_participations where owner_user_id=$1 and campaign_id=$2 and card_id=$3 and activity_instance_key=$4",[context.actor.userId,id,input.cardId,c.activity_instance_key])).rows[0];
   if(existing) return {participationId:existing.id,ruleVersionId:existing.rule_version_id,invalidated};
   if(c.version!==input.campaignVersion) throw new AppError("CONFLICT","活动定义已更新");
   const rule=(await tx.query("select * from private_rule_versions where campaign_id=$1 and owner_user_id=$2 order by revision desc limit 1",[id,context.actor.userId])).rows[0];
   const result=(await tx.query("insert into activity_participations(owner_user_id,card_id,campaign_id,rule_version_id,activity_instance_key,tracking_status,node_preferences) values($1,$2,$3,$4,$5,'needs_review','[]') returning id",[context.actor.userId,input.cardId,id,rule.id,c.activity_instance_key])).rows[0];
   const p=await this.personal.owned(tx,context.actor.userId,result.id);
   await this.personal.todos.upsert(tx,p,{key:p.id+":eligibility",nodeKind:"eligibility",type:"enrollment",title:"核对个人资格及报名",deadline:p.content.conditions.enrollmentDeadline,primary:{kind:"enrollment",resourceId:p.id,participationId:p.id,label:"核对资格和报名",enabled:true}});
   await projectMarkers(tx,this.personal,p);
   await this.personal.history(tx,p,"participation.created","私人定义加入本卡；不确认银行事实",{clientRequestKey:input.activityInstanceKey});
   return {participationId:p.id,ruleVersionId:rule.id,invalidated};
  });
 }
 async version(context:CommandContext,id:string,raw:unknown) {
  const input=parse(activityDraftSchema.extend({expectedVersion:versionSchema}).strict(),raw);
  return this.personal.catalog.repository.command(context,"campaign.rule:"+id,input,false,async tx=>{
   await this.card(tx,context.actor.userId,input.cardId);
   const c=(await tx.query("select * from private_campaigns where id=$1 and owner_user_id=$2 and source_kind='manual' for update",[id,context.actor.userId])).rows[0];
   if(!c) throw new AppError("NOT_FOUND","私人规则编辑仅用于本人自建活动");
   const link=(await tx.query("select id from activity_participations where campaign_id=$1 and owner_user_id=$2 and card_id=$3",[id,context.actor.userId,input.cardId])).rows[0];
   if(!link) throw new AppError("NOT_FOUND","找不到本卡参与");
   const p=await this.personal.owned(tx,context.actor.userId,link.id,true);
   const old=(await tx.query("select revision from private_rule_versions where id=$1",[p.rule_version_id])).rows[0];
   if(old.revision!==input.expectedVersion) throw new AppError("CONFLICT","私人规则版本已更新");
   const next=(await tx.query("select coalesce(max(revision),0)+1 as n from private_rule_versions where campaign_id=$1",[id])).rows[0].n;
   const {expectedVersion,...draft}=input;
   const timezone=(await tx.query("select timezone from users where id=$1",[context.actor.userId])).rows[0].timezone;
   const rule=(await tx.query("insert into private_rule_versions(owner_user_id,campaign_id,source_kind,revision,content,editor_draft) values($1,$2,'manual',$3,$4,$5) returning id",[context.actor.userId,id,next,content(draft,timezone),draft])).rows[0];
   await tx.query("update private_campaigns set version=version+1 where id=$1",[id]);
   p.version=(await tx.query("update activity_participations set rule_version_id=$2,version=version+1 where id=$1 returning version",[p.id,rule.id])).rows[0].version;
   p.content=content(draft,timezone);
   await projectMarkers(tx,this.personal,p);
   await this.personal.history(tx,p,"rule.version_created","既有周期及奖励保持冻结；未来采用须明确选择",{ruleVersionId:rule.id,previousRuleVersionId:p.rule_version_id});
   return {participationId:p.id,ruleVersionId:rule.id,invalidated};
  });
 }
 async definitionHistory(tx:PoolClient,owner:string,id:string,version:number,action:string,payload:unknown) {
  await tx.query("insert into audit_logs(user_id,actor_type,actor_id,action,entity_type,entity_id,metadata) values($1,'user',$1,$2,'campaign',$3,$4)",[owner,action,id,payload]);
  await tx.query("insert into catalog_personal_outbox(owner_user_id,aggregate_id,sequence,event_type,payload) values($1,$2,$3,$4,$5)",[owner,id,version,action,payload]);
 }
}
