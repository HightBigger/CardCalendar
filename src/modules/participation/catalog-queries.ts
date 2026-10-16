import { minor,money,positiveDifference } from "../spend-task/money";
import type { PoolClient } from "pg";
import type {
  ActivityDetail,
  ActivitySummary,
} from "../../contracts/activities";
import type { Reward } from "../../contracts/rewards";
import type { SpendTask } from "../../contracts/spend-tasks";
import type {
  PersonalCatalogService,
  PrivateParticipation,
} from "./catalog-import";
import { AppError } from "../../shared/errors";
import { dateDay } from "../activity-catalog/validation";
import { snapshotProgress, targetReached } from "./catalog-progress";
export const targetDescription = (
  t: PrivateParticipation["content"]["periodTemplate"]["target"],
) =>
  t.kind === "custom"
    ? t.rulesText || "目标待核对"
    : [
        t.count === null ? null : t.count + " 笔",
        t.amount === null ? null : t.amount + " " + t.currency,
      ]
        .filter(Boolean)
        .join(t.kind === "count_or_amount" ? " 或 " : " 且 ");
export class CatalogPrivateQueries {
  constructor(readonly personal: PersonalCatalogService) {}
  async task(tx: PoolClient, owner: string, id: string): Promise<SpendTask> {
    const rows = (
      await tx.query(
        "select t.*,coalesce(p.start_on,t.start_on)::text as start_on,coalesce(p.end_on,t.end_on)::text as end_on,coalesce(p.timezone,t.timezone) as timezone,coalesce(p.target,t.overall_target) as target,coalesce(p.executable,true) as executable,coalesce(p.stopped,false) as stopped,p.eligibility as period_eligibility,p.enrollment as period_enrollment,p.quota as period_quota,r.content,r.editor_draft from spend_tasks t left join activity_periods p on p.id=t.period_id and p.owner_user_id=t.owner_user_id join private_rule_versions r on r.id=coalesce(p.rule_version_id,t.rule_version_id) and r.owner_user_id=t.owner_user_id where t.id=$1 and t.owner_user_id=$2",
        [id, owner],
      )
    ).rows;
    if (!rows.length) throw new AppError("NOT_FOUND", "无法访问周期任务");
    const r = rows[0],
      p = await this.personal.owned(tx, owner, r.participation_id),
      content = r.content as PrivateParticipation["content"];
    const observations = (
      await tx.query(
        "select *,occurred_on::text,amount::text from catalog_spend_observations where task_id=$1 and owner_user_id=$2 order by created_at,id",
        [id, owner],
      )
    ).rows;
    const evaluations=(await tx.query("select e.*,f.occurred_on::text,f.count as fact_count,f.amount::text as fact_amount,f.posted_on::text,f.settled_on::text,f.declared_stage,f.note from task_evaluations e join spend_facts f on f.id=e.fact_id and f.owner_user_id=e.owner_user_id where e.task_id=$1 and e.owner_user_id=$2 order by f.created_at,f.id",[id,owner])).rows;
    const entryProgress={count:evaluations.filter(e=>e.decision==='included').reduce((n,e)=>n+e.count,0),amount:money(evaluations.filter(e=>e.decision==='included').reduce((n,e)=>n+minor(e.amount),0n)),pendingCount:evaluations.filter(e=>e.decision==='pending').reduce((n,e)=>n+e.count,0),pendingAmount:money(evaluations.filter(e=>e.decision==='pending').reduce((n,e)=>n+minor(e.amount),0n)),unknown:evaluations.some(e=>e.decision==='needs_review')||content.periodTemplate.countingBasis==='unknown'};
    const progress = r.mode==='entries'?entryProgress:snapshotProgress(observations,content.periodTemplate.countingBasis);
    const { count, amount } = progress;
    const target =
      r.target as PrivateParticipation["content"]["periodTemplate"]["target"];
    const reached =
      r.executable && !progress.unknown && targetReached(target, count, amount);
    const current = p.catalog_activity_id ? await this.personal.catalog.row(tx,p.catalog_activity_id):null;
    const release=current?.current_release_id?await this.personal.catalog.release(tx,current.id,current.current_release_id):null;
    const checkScope=content.conditions.enrollmentScope==='period'&&r.period_id;
    const eligibility=checkScope?r.period_eligibility:p.eligibility;
    const enrollment=checkScope?r.period_enrollment:p.enrollment;
    const quota=checkScope?r.period_quota:p.quota;
    const checked=eligibility==='confirmed'&&(content.conditions.enrollmentRequired==='no'||content.conditions.enrollmentRequired==='yes'&&enrollment==='confirmed')&&(!r.editor_draft?.quotaRequired||quota==='confirmed');
    const today = new Intl.DateTimeFormat("sv-SE", {
      timeZone: r.timezone,
    }).format(new Date());
    const canWrite =
      r.executable &&
      p.card_status === "active" &&
      !r.stopped &&
      !release?.content.bankCancellation &&
      checked &&
      !p.cancelled_at &&
      r.start_on <= today &&
      r.end_on >= today &&
      p.tracking_decision !== "stop_future";
    return {
      id: r.id,
      version: r.version,
      participationId: p.id,
      periodId: r.period_id,
      cardId: p.card_id,
      name: (r.period_id?"周期目标 · ":"全期独立目标 · ") + r.start_on,
      currency: target.currency ?? "CNY",
      mode: r.mode ?? "snapshot",
      modeLocked: observations.length > 0 || evaluations.length > 0,
      targetText: targetDescription(target),
      countingBasisText: content.periodTemplate.countingBasis,
      startOn: r.start_on,
      endOn: r.end_on,
      timezone: r.timezone,
      confirmed: {
        count,
        amount,
        text:
          r.executable && !progress.unknown
            ? `${count} 笔 · ${amount} ${target.currency ?? ""}`
            : "规则或历史观察阶段待核对，不形成确定进度",
      },
      pending: {
        count: progress.pendingCount,
        amount: progress.pendingAmount,
        text: progress.unknown
          ? "历史观察阶段未知，需重新核对"
          : `${progress.pendingCount} 笔 · ${progress.pendingAmount} ${target.currency ?? ""} 待${content.periodTemplate.countingBasis}确认（不与确定值重复）`,
      },
      remaining: {
        count: target.count === null ? null : Math.max(0, target.count - count),
        amount:
          target.amount === null
            ? null
            : positiveDifference(target.amount,amount),
        text:
          r.executable && !progress.unknown
            ? "以确定累计观察核对剩余目标"
            : "目标或阶段待核对",
      },
      progressStatus: progress.unknown
        ? "needs_review"
        : reached
          ? "reached"
          : "not_reached",
      progressStatusText: progress.unknown
        ? "历史阶段未知，不推断目标达到"
        : reached
          ? "观察目标达到，仍需人工核对"
          : "尚未观察到目标达到",
      qualificationStatus: r.qualification,
      qualificationText:
        r.qualification === "met" ? "官方已确认达标" : "官方达标待核对",
      reviewText:
        "累计快照按阶段覆盖，不相加；冻结口径：" +
        content.periodTemplate.countingBasis +
        "。" +
        (progress.unknown
          ? "历史阶段未知，请提交有依据的新观察。"
          : "资格、报名及官方达标分别核对。"),
      entries: evaluations.map(e=>({id:e.fact_id,occurredOn:e.occurred_on,postedOn:e.posted_on??undefined,settledOn:e.settled_on??undefined,count:e.fact_count,amount:e.fact_amount,stage:e.settled_on?'settled':e.posted_on?'posted':e.declared_stage,note:e.note,evaluatedTaskIds:[id]})),
      qualificationScope: r.period_id?{scope:"period",periodId:r.period_id}:{scope:"participation"},
      availableFacts: r.mode==='entries'?(await tx.query("select id,occurred_on::text||' · '||amount::text||' '||currency as label from spend_facts where owner_user_id=$1 and card_id=$2 order by created_at,id",[owner,p.card_id])).rows:[],
      observations: observations.map((o) => ({
        id: o.id,
        observedOn: o.occurred_on,
        count: o.count,
        amount: o.amount,
        stage: o.stage,
        note: o.note,
      })),
      allowedCommands: [
        {kind:"create_entry",enabled:canWrite&&r.mode==='entries'},
        {kind:"evaluate",enabled:canWrite&&r.mode==='entries'},
        {
          kind: "observation",
          enabled: canWrite && r.mode!=="entries",
          reason: canWrite ? undefined : "先核对资格、报名、规则和当前跟踪状态",
        },
        {
          kind: "qualification",
          enabled:
            r.executable &&
            checked,
          reason: "官方核对独立于继续消费；保留历史和归档卡的核对能力",
        },
      ],
      canLinkFacts: r.mode==='entries' && canWrite,
      linkDisabledReason: "本次最小闭环采用累计观察，不支持逐笔关联",
    };
  }
  async reward(tx: PoolClient, owner: string, id: string): Promise<Reward> {
    const r = (
      await tx.query(
        "select * from activity_rewards where id=$1 and owner_user_id=$2",
        [id, owner],
      )
    ).rows[0];
    if (!r) throw new AppError("NOT_FOUND", "无法访问奖励组件");
    const p = await this.personal.owned(tx, owner, r.participation_id),
      rewardRule = (
        await tx.query(
          "select content from private_rule_versions where id=$1 and owner_user_id=$2",
          [r.rule_version_id, owner],
        )
      ).rows[0].content as PrivateParticipation["content"],
      t = r.template as PrivateParticipation["content"]["rewards"][number],
      periods = await this.personal.periods(tx, p);
    const needed = (r.required_period_ids??(r.period_id?[r.period_id]:periods.map(x=>x.id))) as string[];
    const conditions:Reward["conditions"]=needed.map(periodId=>{
      const period=periods.find(x=>x.id===periodId);
      const perScope=rewardRule.conditions.enrollmentScope==='period';
      const checked=!perScope||period?.eligibility==='confirmed'&&(rewardRule.conditions.enrollmentRequired==='no'||period?.enrollment==='confirmed');
      return {label:period?.period_key??'依赖周期缺失',status:!period||!checked?'unknown':period.qualification==='met'?'met':period.qualification==='not_met'?'not_met':'unknown',periodId};
    });
    const deps=(await tx.query("select t.id,t.qualification from activity_reward_dependencies d join spend_tasks t on t.id=d.task_id and t.owner_user_id=d.owner_user_id where d.reward_id=$1 and d.owner_user_id=$2",[id,owner])).rows;
    for(const task of deps) conditions.push({label:'全期独立任务',taskId:task.id,status:task.qualification==='met'?'met':task.qualification==='not_met'?'not_met':'unknown'});
    const globallyChecked=rewardRule.conditions.enrollmentScope==='period'||p.eligibility==='confirmed'&&(rewardRule.conditions.enrollmentRequired==='no'||p.enrollment==='confirmed');
    const status:Reward['conditionStatus']=conditions.some(c=>c.status==='not_met')?'not_met':conditions.length>0&&conditions.every(c=>c.status==='met')&&globallyChecked?'met':'unknown';
    const now = new Date();
    const started =
      t.claimStart.kind === "unknown"
        ? null
        : t.claimStart.kind === "instant"
          ? now >= new Date(t.claimStart.value)
          : new Intl.DateTimeFormat("sv-SE", {
              timeZone: t.claimStart.timezone,
            }).format(now) >= t.claimStart.value;
    const ended =
      t.claimEnd.kind === "unknown"
        ? null
        : t.claimEnd.kind === "instant"
          ? now > new Date(t.claimEnd.value)
          : new Intl.DateTimeFormat("sv-SE", {
              timeZone: t.claimEnd.timezone,
            }).format(now) > t.claimEnd.value;
    const window =
      started === null || ended === null
        ? "unknown"
        : !started
          ? "not_open"
          : ended
            ? "closed"
            : "open";
    const events = (
      await tx.query(
        "select *,occurred_on::text,quantity::text from activity_reward_events where reward_id=$1 and owner_user_id=$2 order by created_at,id",
        [id, owner],
      )
    ).rows;
    const receipts = events.filter((e) => e.event_type === "receipt"),
      received = receipts.reduce((n, e) => n + Number(e.quantity), 0),
      quantity = t.amountOrQuantity;
    const canClaim =
      t.acquisition === "manual" &&
      status === "met" &&
      window === "open" &&
      r.claim_status !== "confirmed";
    return {
      id: r.id,
      version: r.version,
      participationId: p.id,
      periodId: r.period_id,
      name: t.name,
      valueText: (quantity ?? "数量待核对") + " " + (t.unit ?? ""),
      scopeLabel: t.scope,
      conditionStatus: status,
      conditionText:
        status === "met" ? "成员已核对全部必要周期" : "奖励条件待核对",
      claimStatus: r.claim_status,
      claimText:
        r.claim_status === "confirmed"
          ? "官方确认领取"
          : r.claim_status === "submitted"
            ? "已提交，待确认"
            : "尚未提交",
      receiptStatus: r.receipt_status,
      receiptText:
        r.receipt_status === "received" ? "已记录实际到账" : "实际到账待核对",
      primaryAction: {
        kind: "reward_conditions",
        resourceId: r.id,
        participationId: p.id,
        label: "查看奖励及领取记录",
        enabled: true,
      },
      currency: "CNY",
      quantity,
      unit: t.unit ?? "",
      acquisition: t.acquisition,
      windowStatus: window,
      claimStart: t.claimStart,
      claimDeadline: t.claimEnd,
      channel: t.channel ?? "",
      officialUrl: t.officialUrl ?? undefined,
      instructions: t.conditionsText,
      expectedReceipt: t.expectedReceipt,
      receiptRuleText: t.receiptRuleText,
      receivedText: received.toFixed(2),
      remainingText:
        quantity && /^\d+(\.\d+)?$/.test(quantity)
          ? Math.max(0, Number(quantity) - received).toFixed(2)
          : "数量待核对",
      conditions,
      claimAttempts: events
        .filter((e) => e.event_type === "claim_submitted")
        .map((e) => ({
          id: e.id,
          version: 1,
          status: r.claim_status,
          occurredAt: e.created_at.toISOString(),
          note: e.note,
        })),
      receipts: receipts.map((e) => ({
        id: e.id,
        receivedOn: e.occurred_on,
        quantity: e.quantity,
        note: e.note,
      })),
      allowedCommands: [
        {
          kind: "open_official",
          enabled: canClaim && !!t.officialUrl,
          reason: canClaim ? undefined : "领取窗口和条件尚未同时满足",
        },
        {
          kind: "claim",
          enabled: canClaim,
          reason: canClaim ? undefined : "领取窗口和条件尚未同时满足",
        },
        {
          kind: "claim_result",
          enabled: events.some((e) => e.event_type === "claim_submitted"),
        },
        { kind: "receipt", enabled: t.acquisition !== "unknown" },
      ],
    };
  }
  async rewards(tx: PoolClient, p: PrivateParticipation) {
    const ids = (
      await tx.query(
        "select id from activity_rewards where participation_id=$1 and owner_user_id=$2 order by id",
        [p.id, p.owner_user_id],
      )
    ).rows;
    const result: Reward[] = [];
    for (const r of ids)
      result.push(await this.reward(tx, p.owner_user_id, r.id));
    return result;
  }
  async detail(
    tx: PoolClient,
    owner: string,
    id: string,
  ): Promise<ActivityDetail> {
    const p = await this.personal.owned(tx, owner, id),
      periods = await this.personal.periods(tx, p),
      rewards = await this.rewards(tx, p),
      today = new Intl.DateTimeFormat("sv-SE", {
        timeZone: p.content.periodTemplate.timezone ?? "Asia/Shanghai",
      }).format(new Date());
    const tasks = (
      await tx.query(
        "select id,period_id from spend_tasks where participation_id=$1 and owner_user_id=$2",
        [id, owner],
      )
    ).rows;
    const taskFacts = new Map<string, SpendTask>();
    for (const task of tasks)
      taskFacts.set(task.period_id, await this.task(tx, owner, task.id));
    const current = periods.find(
        (x) => x.start_on <= today && x.end_on >= today,
      ),
      content = p.content;
    const activity: ActivitySummary = {
      id: p.id,
      version: p.version,
      campaignId: p.campaign_id,
      ruleId: p.campaign_id,
      ruleVersion: p.rule_revision ?? 1,
      ruleVersionId: p.rule_version_id,
      name: content.name,
      card: p.card,
      lifecycle:
        p.card_status === "archived" || p.cancelled_at
          ? "cancelled"
          : dateDay(content.end) && dateDay(content.end)! < today
            ? "ended"
            : p.tracking_status === "active"
              ? "active"
              : "planned",
      start: content.start,
      end: content.end,
      source: {
        label: p.source_kind==='manual'?p.editor_draft?.sourceLabel||"私人录入":"银行活动目录 · 私人规则快照",
        url: content.sources[0]?.url,
        verifiedAt: content.sources[0]?.verifiedAt,
      },
      rulesText: content.periodTemplate.target.rulesText,
      currentPeriod: current
        ? {
            id: current.id,
            label: current.period_key,
            targetText: targetDescription(current.target),
            confirmedText:
              taskFacts.get(current.id)?.confirmed.text ?? "目标或阶段待核对",
            pendingText:
              taskFacts.get(current.id)?.pending.text ?? "预计值待核对",
            remainingText:
              taskFacts.get(current.id)?.remaining.text ?? "按本期规则核对",
            deadline: {
              kind: "date",
              value: current.end_on,
              timezone: current.timezone,
            },
          }
        : null,
      rewards,
      nextAction: null,
      nextActionDate: { kind: "unknown", reason: "待核对" },
      editorDraft:p.source_kind==='manual'?p.editor_draft as import("../../contracts/activities").ActivityDraft:undefined,
      allowedCommands:[{kind:"edit",enabled:p.source_kind==='manual'&&p.card_status==='active'},{kind:"plan",enabled:p.card_status==='active'&&!p.cancelled_at},{kind:"preferences",enabled:true},{kind:"cancel",enabled:!p.cancelled_at},{kind:"create_reward",enabled:true}],
    };
    const history = (
      await tx.query(
        "select * from catalog_personal_history where participation_id=$1 and owner_user_id=$2 order by occurred_at,id",
        [id, owner],
      )
    ).rows;
    return {
      activity,
      periods: periods.map((period) => ({
        id: period.id,
        version: period.version,
        participationId: p.id,
        planRevisionId: (period as any).plan_revision_id??period.rule_version_id,
        label: period.period_key,
        startOn: period.start_on,
        endOn: period.end_on,
        timezone: period.timezone,
        phase: period.stopped
          ? "cancelled"
          : period.start_on > today
            ? "planned"
            : period.end_on < today
              ? "ended"
              : "active",
        targetText: targetDescription(period.target),
        confirmedText:
          taskFacts.get(period.id)?.confirmed.text ?? "目标或资格规则待核对",
        pendingText: taskFacts.get(period.id)?.pending.text ?? "预计值待核对",
        remainingText:
          taskFacts.get(period.id)?.remaining.text ?? "查看本期任务",
        qualificationText:
          period.qualification === "met" ? "官方已确认达标" : "待核对",
        taskId: tasks.find((t) => t.period_id === period.id)?.id,
        allowedCommands: [
          {
            kind: "progress",
            enabled:
              p.card_status === "active" &&
              period.executable &&
              !period.stopped,
            reason:
              p.card_status !== "active"
                ? "卡片已归档或停用，保留历史与奖励核对"
                : undefined,
          },
        ],
      })),
      requirements: {
        enrollmentRequired: content.conditions.enrollmentRequired,
        enrollmentScope: content.conditions.enrollmentScope,
        enrollmentDeadline: content.conditions.enrollmentDeadline,
        // Manual rules have an explicit flag; their placeholder quota text is not a requirement.
        quotaRequired: p.source_kind === "manual" ? p.editor_draft?.quotaRequired === true : !!content.conditions.quotaText.trim(),
      },
      checks: [
        ...periods.filter(()=>content.conditions.enrollmentScope==='period').map(period=>({scope:'period' as const,periodId:period.id,label:period.period_key,eligibility:(period as any).eligibility??'unknown',enrollment:(period as any).enrollment??'unknown',quota:(period as any).quota??'unknown',allowedCommands:[{kind:'record_eligibility',enabled:true},{kind:'record_enrollment',enabled:true},{kind:'record_quota',enabled:true}]})),
        {
          scope: "participation",
          label: "全期资格与报名",
          eligibility: p.eligibility,
          enrollment: p.enrollment,
          quota: p.quota??"unknown",
          allowedCommands: [
            { kind: "record_eligibility", enabled: true },
            { kind: "record_quota", enabled: true },
            {
              kind: "record_enrollment",
              enabled: true,
              reason:
                content.conditions.enrollmentScope === "period"
                  ? "每期报名暂未开放，请先保留待核对计划"
                  : "",
            },
          ],
        },
      ],
      history: history.map((h) => ({
        id: h.id,
        label: h.action,
        occurredAt: h.occurred_at.toISOString(),
        note: h.note,
      })),
      plan: (await tx.query("select id,version,type,timezone from period_plan_revisions where id=(select active_plan_id from activity_participations where id=$1)",[p.id])).rows[0]??null,
      nodePreferences: p.node_preferences,
      catalogSource: p.catalog_activity_id?{ catalogActivityId: p.catalog_activity_id }:undefined,
      overallTasks: tasks.filter(t=>!t.period_id).map(t=>({id:t.id,name:"全期独立目标"})),
    };
  }
}
