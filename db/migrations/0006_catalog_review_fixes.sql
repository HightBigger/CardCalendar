-- Existing observations did not record a milestone: never infer that they posted.
alter table catalog_spend_observations add column stage text not null default 'unknown'
  check(stage in ('unknown','occurred','posted','settled'));
-- New application writes must explicitly supply their observed milestone.
alter table catalog_spend_observations alter column stage drop default;

create table card_archive_commands (
 owner_user_id uuid not null references users(id) on delete cascade,
 card_id uuid not null,idempotency_key text not null,request_hash text not null,result jsonb not null,
 created_at timestamptz not null default now(),
 primary key(owner_user_id,card_id,idempotency_key),
 foreign key(card_id,owner_user_id) references cards(id,user_id) on delete cascade
);

-- Repair already confirmed facts without inventing milestones from legacy totals.
update todo_actions t set status='completed',version=t.version+1,
 history=t.history||jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'command','business_projection','occurredAt',now(),'actor',t.owner_user_id,'note','升级修复：已有资格及报名确认'))
from activity_participations p
where t.participation_id=p.id and t.node_kind='eligibility' and t.status='pending'
and p.eligibility='confirmed' and p.tracking_status<>'needs_review'
and exists(select 1 from private_rule_versions r where r.id=p.rule_version_id
  and (r.content->'conditions'->>'enrollmentRequired'='no'
    or (r.content->'conditions'->>'enrollmentRequired'='yes' and p.enrollment='confirmed')));
update todo_actions t set status='completed',version=t.version+1,
 primary_action=jsonb_set(t.primary_action,'{enabled}','false'::jsonb),
 history=t.history||jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'command','business_projection','occurredAt',now(),'actor',t.owner_user_id,'note','升级修复：已有官方达标确认'))
from activity_periods p
where t.participation_id=p.participation_id and t.action_key=p.participation_id::text||':'||p.id::text||':spend'
and p.qualification='met' and t.status='pending';

-- The old archive endpoint ignored the reward choice. Mark that missing evidence
-- for confirmation instead of treating its old default as an explicit keep choice.
update activity_participations p set reward_reminder_policy='needs_confirmation',version=p.version+1
from cards c where c.id=p.card_id and c.user_id=p.owner_user_id and c.status='archived';
update activity_periods p set stopped=true,version=p.version+1 from cards c
where c.id=p.card_id and c.user_id=p.owner_user_id and c.status='archived' and not p.stopped;
update spend_tasks t set version=t.version+1 from cards c
where c.id=t.card_id and c.user_id=t.owner_user_id and c.status='archived';
update todo_actions t set status='cancelled',version=t.version+1,
 primary_action=jsonb_set(t.primary_action,'{enabled}','false'::jsonb),
 history=t.history||jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'command','business_projection','occurredAt',now(),'actor',t.owner_user_id,'note','升级修复：卡片已归档，停止消费行动'))
from cards c where c.id=t.card_id and c.user_id=t.owner_user_id and c.status='archived'
and t.node_kind='spend_period' and t.status='pending';
insert into catalog_personal_history(owner_user_id,card_id,participation_id,action,note,payload)
select p.owner_user_id,p.card_id,p.id,'card.archive_upgrade','旧归档未保存奖励选择，请本人重新确认',jsonb_build_object('rewardReminderPolicy','needs_confirmation')
from activity_participations p join cards c on c.id=p.card_id and c.user_id=p.owner_user_id where c.status='archived';

-- Remove only undelivered schedules that were never selected by the member.
update todo_notification_schedules s set status='cancelled'
from todo_actions t,activity_participations p
where s.action_id=t.id and t.participation_id=p.id and s.status='pending'
and (t.status<>'pending' or s.action_version<>t.version
  or (t.node_kind like 'reward_%' and p.reward_reminder_policy<>'continue')
  or not exists(select 1 from jsonb_array_elements(p.node_preferences) pref
  where pref->>'nodeKind'=t.node_kind
  and (pref->'notifyDaysBefore') @> to_jsonb(s.days_before)));
