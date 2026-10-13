import { z } from "zod";
import type { CatalogCommandContext } from "../activity-catalog/ports";
import { parse, conflict } from "../activity-catalog/service";
import { versionSchema } from "../activity-catalog/validation";
import type { PersonalCatalogService } from "./catalog-import";
import { CatalogPrivateQueries } from "./catalog-queries";
import { AppError } from "../../shared/errors";
import { syncParticipationActions } from "./catalog-action-projection";
const note = z.string().trim().min(1).max(4000),
  day = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine((v) => {
      const d = new Date(v + "T00:00:00Z");
      return !isNaN(+d) && d.toISOString().slice(0, 10) === v;
    });
export class CatalogPrivateCommands {
  readonly queries: CatalogPrivateQueries;
  constructor(readonly personal: PersonalCatalogService) {
    this.queries = new CatalogPrivateQueries(personal);
  }
  async check(context: CatalogCommandContext, id: string, raw: unknown) {
    const base=z.object({expectedVersion:versionSchema,scope:z.enum(["participation","period"]),periodId:z.string().uuid().optional(),command:z.enum(["record_eligibility","record_enrollment","record_quota"]),status:z.enum(["unknown","confirmed","not_met"]),note,attemptId:z.string().uuid().optional()}).strict();
    if(raw&&typeof raw==='object'&&'command' in raw&&raw.command==='cancel') {
      const input=parse(z.object({command:z.literal('cancel'),expectedVersion:versionSchema,rewardReminderPolicy:z.enum(['keep','stop']),note:z.string().max(4000)}).strict(),raw);
      return this.personal.catalog.repository.command(context,'participation.cancel:'+id,input,false,async tx=>{
        const p=await this.personal.owned(tx,context.actor.userId,id,true);
        if(p.version!==input.expectedVersion) conflict();
        p.reward_reminder_policy=input.rewardReminderPolicy==='keep'?'continue':'stop';
        p.cancelled_at=new Date();
        p.version=(await tx.query("update activity_participations set cancelled_at=now(),reward_reminder_policy=$2,tracking_decision='stop_future',version=version+1 where id=$1 returning version",[id,p.reward_reminder_policy])).rows[0].version;
        await tx.query('update activity_periods set stopped=true,version=version+1 where participation_id=$1 and not stopped',[id]);
        await this.personal.todos.cancelSpendActions(tx,p);
        await tx.query("update todo_notification_schedules s set status='cancelled' from todo_actions a where s.action_id=a.id and a.participation_id=$1 and s.status='pending' and (a.node_kind not like 'reward_%' or $2<>'continue')",[id,p.reward_reminder_policy]);
        await this.personal.history(tx,p,'participation.cancelled',input.note||'取消个人跟踪；保留业务历史',input);
        return {participationId:id,version:p.version,invalidated:['activities','spend-tasks','rewards','todos','notifications']};
      });
    }
    const input=parse(base,raw);
    return this.personal.catalog.repository.command(context,'participation.check:'+id,input,false,async tx=>{
      const p=await this.personal.owned(tx,context.actor.userId,id,true);
      if(p.version!==input.expectedVersion) conflict();
      const field=input.command==='record_eligibility'?'eligibility':input.command==='record_enrollment'?'enrollment':'quota';
      if(input.scope==='period') {
        if(!input.periodId) throw new AppError('VALIDATION_ERROR','每期核对必须指定周期');
        const period=(await tx.query('select * from activity_periods where id=$1 and participation_id=$2 and owner_user_id=$3 for update',[input.periodId,id,p.owner_user_id])).rows[0];
        if(!period) throw new AppError('NOT_FOUND','核对周期不属于本参与');
        await tx.query(`update activity_periods set ${field}=$2,version=version+1 where id=$1`,[input.periodId,input.status]);
      } else {
        if(input.periodId) throw new AppError('VALIDATION_ERROR','全期核对不能包含周期 ID');
        if(input.command==='record_enrollment'&&p.content.conditions.enrollmentScope==='period') throw new AppError('UNPROCESSABLE_ENTITY','本活动报名必须分别记录每期结果');
        await tx.query(`update activity_participations set ${field}=$2 where id=$1`,[id,input.status]);
        p[field]=input.status;
      }
      const scopeKey=input.scope==='period'?input.periodId!:'participation';
      await tx.query(`insert into participation_checks(owner_user_id,card_id,participation_id,period_id,scope_key,kind,status,note,sequence)
        values($1,$2,$3,$4,$5,$6,$7,$8,(select coalesce(max(sequence),0)+1 from participation_checks where participation_id=$3 and scope_key=$5 and kind=$6))`,[p.owner_user_id,p.card_id,id,input.periodId??null,scopeKey,field,input.status,input.note]);
      p.version=(await tx.query('update activity_participations set version=version+1 where id=$1 returning version',[id])).rows[0].version;
      await syncParticipationActions(tx,this.personal,p,input.note);
      await this.personal.history(tx,p,'participation.'+input.command,input.note,input);
      return {participationId:id,version:p.version,invalidated:['activities','spend-tasks','rewards','todos','notifications']};
    });
  }
  async taskWrite(
    context: CatalogCommandContext,
    id: string,
    kind: "observations" | "qualification",
    raw: unknown,
  ) {
    const input =
      kind === "observations"
        ? parse(
            z
              .object({
                expectedVersion: versionSchema,
                count: z.number().int().min(0).max(1000000),
                amount: z.string().regex(/^\d{1,12}(\.\d{1,2})?$/),
                occurredOn: day,
                stage: z.enum(["occurred", "posted", "settled"]),
                note,
              })
              .strict(),
            raw,
          )
        : parse(
            z
              .object({
                expectedVersion: versionSchema,
                status: z.enum(["unknown", "met", "not_met"]),
                scope: z.enum(["period","participation"]),
                periodId: z.string().uuid().optional(),
                note,
              })
              .strict(),
            raw,
          );
    return this.personal.catalog.repository.command(
      context,
      "task." + kind + ":" + id,
      input,
      false,
      async (tx) => {
        const task = await this.queries.task(tx, context.actor.userId, id),
          p = await this.personal.owned(
            tx,
            context.actor.userId,
            task.participationId,
            true,
          );
        await tx.query("select id from spend_tasks where id=$1 for update", [
          id,
        ]);
        const current = await this.queries.task(tx, context.actor.userId, id);
        if (current.version !== input.expectedVersion) conflict();
        if (
          !current.allowedCommands.find(
            (c) =>
              c.kind ===
              (kind === "observations" ? "observation" : "qualification"),
          )?.enabled
        )
          throw new AppError(
            "UNPROCESSABLE_ENTITY",
            "当前资格、报名、规则或跟踪状态不允许记录执行结果",
          );
        if ("occurredOn" in input) {
          if (
            input.occurredOn < current.startOn ||
            input.occurredOn > current.endOn
          )
            throw new AppError(
              "UNPROCESSABLE_ENTITY",
              "观察日期必须在本期边界内",
            );
          await tx.query(
            "insert into catalog_spend_observations(owner_user_id,card_id,participation_id,task_id,occurred_on,count,amount,note,stage) values($1,$2,$3,$4,$5,$6,$7,$8,$9)",
            [
              p.owner_user_id,
              p.card_id,
              p.id,
              id,
              input.occurredOn,
              input.count,
              input.amount,
              input.note,
              input.stage,
            ],
          );
          const after = await this.queries.task(tx, p.owner_user_id, id);
          if (
            current.qualificationStatus === "met" &&
            after.progressStatus !== "reached"
          ) {
            await tx.query(
              "update spend_tasks set qualification='unknown' where id=$1",
              [id],
            );
            await tx.query(
              "update activity_periods set qualification='unknown',version=version+1 where id=$1",
              [current.periodId],
            );
            await this.personal.history(
              tx,
              p,
              "task.qualification_needs_review",
              "累计观察更正后目标不再确定达到，重新核对官方达标",
              { taskId: id, previous: "met" },
            );
          }
        } else {
          if ((input.periodId??null) !== task.periodId || input.scope!==(task.periodId?"period":"participation"))
            throw new AppError("NOT_FOUND", "核对范围与任务不一致");
          await tx.query(
            "update spend_tasks set qualification=$2 where id=$1",
            [id, input.status],
          );
          if(current.periodId) await tx.query(
            "update activity_periods set qualification=$2,version=version+1 where id=$1",
            [current.periodId, input.status],
          );
        }
        await tx.query("update spend_tasks set version=version+1 where id=$1", [
          id,
        ]);
        p.version = (
          await tx.query(
            "update activity_participations set version=version+1 where id=$1 returning version",
            [p.id],
          )
        ).rows[0].version;
        await syncParticipationActions(tx, this.personal, p, input.note, id);
        await this.personal.history(tx, p, "task." + kind, input.note, {
          taskId: id,
          input,
        });
        return {
          task: await this.queries.task(tx, p.owner_user_id, id),
          invalidated: [
            "spend-tasks",
            "activities",
            "rewards",
            "todos",
            "notifications",
          ],
        };
      },
    );
  }
  async rewardWrite(
    context: CatalogCommandContext,
    id: string,
    kind: "claim" | "receipt" | "claim_result",
    raw: unknown,
  ) {
    const input =
      kind === "claim"
        ? parse(
            z
              .object({
                expectedVersion: versionSchema,
                occurredAt: z.string().datetime({ offset: true }),
                note,
              })
              .strict(),
            raw,
          )
        : kind === "receipt"
          ? parse(
              z
                .object({
                  expectedVersion: versionSchema,
                  receivedOn: day,
                  quantity: z
                    .string()
                    .regex(/^\d{1,12}(\.\d{1,2})?$/)
                    .refine((v) => Number(v) > 0),
                  note,
                })
                .strict(),
              raw,
            )
          : parse(
              z
                .object({
                  expectedVersion: versionSchema,
                  rewardVersion: versionSchema,
                  status: z.enum(["confirmed", "needs_review"]),
                  note,
                })
                .strict(),
              raw,
            );
    return this.personal.catalog.repository.command(
      context,
      "reward." + kind + ":" + id,
      input,
      false,
      async (tx) => {
        let rewardId = id;
        if (kind === "claim_result") {
          const attempt = (
            await tx.query(
              "select reward_id from activity_reward_events where id=$1 and owner_user_id=$2 and event_type='claim_submitted'",
              [id, context.actor.userId],
            )
          ).rows[0];
          if (!attempt) throw new AppError("NOT_FOUND", "无法访问领取提交");
          rewardId = attempt.reward_id;
        }
        const r = await this.queries.reward(tx, context.actor.userId, rewardId),
          p = await this.personal.owned(
            tx,
            context.actor.userId,
            r.participationId,
            true,
          );
        await tx.query(
          "select id from activity_rewards where id=$1 for update",
          [rewardId],
        );
        const current = await this.queries.reward(
          tx,
          context.actor.userId,
          rewardId,
        );
        if (
          current.version !==
          ("rewardVersion" in input
            ? input.rewardVersion
            : input.expectedVersion)
        )
          conflict();
        if (!current.allowedCommands.find((c) => c.kind === kind)?.enabled)
          throw new AppError(
            "UNPROCESSABLE_ENTITY",
            "当前奖励条件或领取窗口不允许该操作",
          );
        const occurred =
          "occurredAt" in input
            ? new Date(input.occurredAt).toLocaleDateString("sv-SE", {
                timeZone: p.content.periodTemplate.timezone ?? "Asia/Shanghai",
              })
            : "receivedOn" in input
              ? input.receivedOn
              : new Date().toLocaleDateString("sv-SE", {
                  timeZone:
                    p.content.periodTemplate.timezone ?? "Asia/Shanghai",
                });
        if (new Date(occurred + "T00:00:00Z").getTime() > Date.now())
          throw new AppError(
            "UNPROCESSABLE_ENTITY",
            "实际业务事实不能记录为未来日期",
          );
        if (
          kind === "claim" &&
          dateOutside(occurred, current.claimStart, current.claimDeadline)
        )
          throw new AppError(
            "UNPROCESSABLE_ENTITY",
            "实际提交必须在领取窗口内",
          );
        if (
          "quantity" in input &&
          current.quantity &&
          /^\d+(\.\d+)?$/.test(current.quantity) &&
          Number(current.receivedText) + Number(input.quantity) >
            Number(current.quantity)
        )
          throw new AppError(
            "UNPROCESSABLE_ENTITY",
            "到账总量不能超过明确的奖励数量",
          );
        const type =
          kind === "claim"
            ? "claim_submitted"
            : kind === "receipt"
              ? "receipt"
              : "claim_" + ("status" in input ? input.status : "");
        await tx.query(
          "insert into activity_reward_events(owner_user_id,card_id,participation_id,reward_id,event_type,quantity,occurred_on,note) values($1,$2,$3,$4,$5,$6,$7,$8)",
          [
            p.owner_user_id,
            p.card_id,
            p.id,
            rewardId,
            type,
            "quantity" in input ? input.quantity : null,
            occurred,
            input.note,
          ],
        );
        const received =
          kind === "receipt" &&
          current.quantity &&
          Number(current.receivedText) +
            Number("quantity" in input ? input.quantity : 0) >=
            Number(current.quantity);
        await tx.query(
          "update activity_rewards set version=version+1,claim_status=case when $2='claim_submitted' then 'submitted' when $2='claim_confirmed' then 'confirmed' when $2='claim_needs_review' then 'submitted' else claim_status end,receipt_status=case when $3 then 'received' else receipt_status end where id=$1",
          [rewardId, type, !!received],
        );
        p.version = (
          await tx.query(
            "update activity_participations set version=version+1 where id=$1 returning version",
            [p.id],
          )
        ).rows[0].version;
        if (type === "claim_confirmed") {
          await this.personal.todos.businessState(
            tx,
            p,
            `${p.id}:${rewardId}:claim`,
            "completed",
            input.note,
          );
          await this.personal.todos.upsert(tx, p, {
            key: `${p.id}:${rewardId}:receipt`,
            nodeKind: "reward_receipt",
            type: "reward_receipt",
            title: "核对实际到账 · " + current.name,
            deadline: current.expectedReceipt,
            primary: {
              kind: "receipt",
              resourceId: rewardId,
              participationId: p.id,
              label: "记录实际到账",
              enabled: true,
            },
          });
        }
        if (type === "claim_needs_review")
          await this.personal.todos.businessState(
            tx,
            p,
            `${p.id}:${rewardId}:claim`,
            "pending",
            input.note,
            undefined,
            undefined,
            p.reward_reminder_policy === "continue",
          );
        if (received) {
          await this.personal.todos.businessState(
            tx,
            p,
            `${p.id}:${rewardId}:receipt`,
            "completed",
            input.note,
          );
        }
        await this.personal.history(tx, p, "reward." + kind, input.note, {
          rewardId,
          input,
        });
        return {
          reward: await this.queries.reward(tx, p.owner_user_id, rewardId),
          invalidated: ["rewards", "activities", "todos", "notifications"],
        };
      },
    );
  }
}
function dateOutside(
  day: string,
  start: import("../../contracts/workbench").DateValue,
  end: import("../../contracts/workbench").DateValue,
) {
  return (
    start.kind === "unknown" ||
    end.kind === "unknown" ||
    day < start.value.slice(0, 10) ||
    day > end.value.slice(0, 10)
  );
}
