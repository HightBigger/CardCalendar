import { z } from "zod";
import type { PoolClient } from "pg";
import type { CommandContext } from "../../shared/db/ports";
import type { PersonalCatalogService, PrivateParticipation } from "../participation/catalog-import";
import { parse } from "../activity-catalog/service";
import { dateDay, daySchema, versionSchema } from "../activity-catalog/validation";
import { timezoneSchema } from "../participation/period-plans";
import { CatalogPrivateQueries } from "../participation/catalog-queries";
import { syncParticipationActions } from "../participation/catalog-action-projection";
import { AppError } from "../../shared/errors";
import { invalidated } from "../campaign/service";

const targetSchema = z.object({
  key: z.string().trim().min(1).max(100),
  startOn: daySchema,
  endOn: daySchema,
  timezone: timezoneSchema,
  targetKind: z.enum(["count", "amount", "count_and_amount", "count_or_amount", "custom"]),
  targetCount: z.number().int().positive().optional(),
  targetAmount: z.string().regex(/^\d{1,12}(\.\d{1,2})?$/).optional(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  mode: z.enum(["snapshot", "entries"]),
  ruleVersionId: z.string().uuid(),
  participationVersion: versionSchema,
}).strict();

export class OverallTaskService {
  constructor(readonly personal: PersonalCatalogService) {}

  private async validate(tx: PoolClient, p: PrivateParticipation, input: z.infer<typeof targetSchema>) {
    if (p.version !== input.participationVersion) throw new AppError("CONFLICT", "参与已更新");
    if (p.card_status !== "active" || p.cancelled_at || p.tracking_decision === "stop_future")
      throw new AppError("UNPROCESSABLE_ENTITY", "当前卡片或参与不能维护全期目标");
    const rule = (await tx.query(`select * from private_rule_versions
      where id=$1 and owner_user_id=$2 and campaign_id=$3`,
      [input.ruleVersionId, p.owner_user_id, p.campaign_id])).rows[0];
    if (!rule) throw new AppError("NOT_FOUND", "规则不属于本活动");
    const start = dateDay(rule.content.start), end = dateDay(rule.content.end);
    if (input.startOn > input.endOn || start && input.startOn < start || end && input.endOn > end)
      throw new AppError("UNPROCESSABLE_ENTITY", "全期目标区间无效或越出活动范围");
    if (["count", "count_and_amount", "count_or_amount"].includes(input.targetKind) && input.targetCount === undefined ||
        ["amount", "count_and_amount", "count_or_amount"].includes(input.targetKind) && input.targetAmount === undefined)
      throw new AppError("VALIDATION_ERROR", "全期目标缺少明确笔数或金额");
    return rule;
  }

  async create(context: CommandContext, participationId: string, raw: unknown) {
    const input = parse(targetSchema, raw);
    return this.personal.catalog.repository.command(context, "overall.task.create:" + participationId, input, false, async tx => {
      const p = await this.personal.owned(tx, context.actor.userId, participationId, true);
      const rule = await this.validate(tx, p, input);
      const target = {kind: input.targetKind, count: input.targetCount ?? null, amount: input.targetAmount ?? null,
        currency: input.currency, rulesText: rule.content.periodTemplate.target.rulesText};
      const row = (await tx.query(`insert into spend_tasks(owner_user_id,card_id,participation_id,period_id,
        task_key,mode,overall_target,start_on,end_on,timezone,rule_version_id,campaign_id)
        values($1,$2,$3,null,$4,$5,$6,$7,$8,$9,$10,$11)
        on conflict(participation_id,task_key) where task_key is not null do nothing returning id`,
        [p.owner_user_id,p.card_id,p.id,"overall:"+input.key,input.mode,target,input.startOn,input.endOn,input.timezone,input.ruleVersionId,p.campaign_id])).rows[0];
      if (!row) throw new AppError("CONFLICT", "全期任务键已存在，请读取后修订");
      p.version = (await tx.query("update activity_participations set version=version+1 where id=$1 returning version",[p.id])).rows[0].version;
      await this.personal.todos.upsert(tx,p,{key:`${p.id}:${row.id}:spend`,nodeKind:"spend_period",type:"spend_period",
        title:"核对全期刷卡目标 · "+input.key,deadline:{kind:"date",value:input.endOn,timezone:input.timezone},
        primary:{kind:"progress",resourceId:row.id,participationId:p.id,label:"更新进度／核对达标",enabled:true}});
      await syncParticipationActions(tx,this.personal,p,"全期目标已创建",row.id);
      await this.personal.history(tx,p,"overall.task_created","独立全期目标和规则快照",{taskId:row.id,key:input.key});
      return {task:await new CatalogPrivateQueries(this.personal).task(tx,p.owner_user_id,row.id),participationId:p.id,version:p.version,invalidated};
    });
  }

  async revise(context: CommandContext, taskId: string, raw: unknown) {
    const input = parse(targetSchema.extend({expectedVersion:versionSchema}), raw);
    return this.personal.catalog.repository.command(context, "overall.task.revise:" + taskId, input, false, async tx => {
      const scope=(await tx.query("select participation_id from spend_tasks where id=$1 and owner_user_id=$2 and period_id is null",[taskId,context.actor.userId])).rows[0];
      if (!scope) throw new AppError("NOT_FOUND", "无法访问全期任务");
      const p=await this.personal.owned(tx,context.actor.userId,scope.participation_id,true);
      const rule=await this.validate(tx,p,input);
      const existing=(await tx.query("select * from spend_tasks where id=$1 and owner_user_id=$2 for update",[taskId,p.owner_user_id])).rows[0];
      if (existing.version!==input.expectedVersion) throw new AppError("CONFLICT", "全期任务已更新");
      if (existing.task_key!=="overall:"+input.key) throw new AppError("VALIDATION_ERROR", "任务键不能改变");
      if ((await tx.query(`select 1 from task_evaluations where task_id=$1
        union all select 1 from catalog_spend_observations where task_id=$1
        union all select 1 from catalog_personal_history where owner_user_id=$2
          and participation_id=$3 and action='task.qualification' and payload->>'taskId'=$1::text
        limit 1`,[taskId,p.owner_user_id,p.id])).rowCount || existing.qualification!=="unknown")
        throw new AppError("UNPROCESSABLE_ENTITY", "已有消费或官方核对证据的全期目标必须保持冻结");
      const target={kind:input.targetKind,count:input.targetCount??null,amount:input.targetAmount??null,
        currency:input.currency,rulesText:rule.content.periodTemplate.target.rulesText};
      await tx.query(`update spend_tasks set overall_target=$2,start_on=$3,end_on=$4,timezone=$5,
        rule_version_id=$6,mode=$7,version=version+1 where id=$1`,
        [taskId,target,input.startOn,input.endOn,input.timezone,input.ruleVersionId,input.mode]);
      p.version=(await tx.query("update activity_participations set version=version+1 where id=$1 returning version",[p.id])).rows[0].version;
      await this.personal.todos.upsert(tx,p,{key:`${p.id}:${taskId}:spend`,nodeKind:"spend_period",type:"spend_period",
        title:"核对全期刷卡目标 · "+input.key,deadline:{kind:"date",value:input.endOn,timezone:input.timezone},
        primary:{kind:"progress",resourceId:taskId,participationId:p.id,label:"更新进度／核对达标",enabled:true}},true);
      await syncParticipationActions(tx,this.personal,p,"全期目标已修订",taskId);
      await this.personal.history(tx,p,"overall.task_revised","无证据全期目标采用新规则",{taskId,ruleVersionId:input.ruleVersionId});
      return {task:await new CatalogPrivateQueries(this.personal).task(tx,p.owner_user_id,taskId),participationId:p.id,version:p.version,invalidated};
    });
  }
}
