-- Extend the existing imported/private model in place; no historical IDs change.
alter table private_campaigns add column source_kind text not null default 'catalog' check(source_kind in ('manual','catalog'));
alter table private_campaigns add column version integer not null default 1;
alter table private_campaigns add column created_at timestamptz not null default now();
alter table private_campaigns alter column catalog_activity_id drop not null;
alter table private_campaigns alter column initial_release_id drop not null;
alter table private_campaigns add constraint private_campaign_origin check (
 (source_kind='catalog' and catalog_activity_id is not null and initial_release_id is not null)
 or (source_kind='manual' and catalog_activity_id is null and initial_release_id is null));
alter table private_rule_versions alter column release_id drop not null;
alter table private_rule_versions add column source_kind text not null default 'catalog' check(source_kind in ('manual','catalog'));
alter table private_rule_versions add column revision integer not null default 1;
alter table private_rule_versions add column editor_draft jsonb;
-- Existing catalog releases are distinct snapshots; number them without rewriting content.
alter table private_rule_versions disable trigger private_rule_no_rewrite;
with revisions as (select id,row_number() over(partition by campaign_id order by created_at,id) as n from private_rule_versions)
update private_rule_versions r set revision=n from revisions v where v.id=r.id;
alter table private_rule_versions enable trigger private_rule_no_rewrite;
alter table private_rule_versions add unique(campaign_id,revision);
create or replace function private_catalog_rule_scope() returns trigger language plpgsql as $$
begin
 if new.source_kind='catalog' then
  if not exists(select 1 from private_campaigns c join catalog_releases r on r.catalog_activity_id=c.catalog_activity_id
    where c.id=new.campaign_id and c.owner_user_id=new.owner_user_id and c.source_kind='catalog' and r.id=new.release_id and r.content=new.content) then
   raise exception 'private rule must snapshot its campaign catalog release';
  end if;
 else
  if new.release_id is not null or not exists(select 1 from private_campaigns c where c.id=new.campaign_id and c.owner_user_id=new.owner_user_id and c.source_kind='manual') then
   raise exception 'manual rule must belong to a manual campaign';
  end if;
 end if;
 return new;
end $$;
-- Catalog import used implicit revision 1. Assign its next revision under the campaign fence.
create function private_rule_assign_revision() returns trigger language plpgsql as $$
begin
 perform id from private_campaigns where id=new.campaign_id for update;
 if new.source_kind='catalog' then
  new.revision:=coalesce((select revision from private_rule_versions where campaign_id=new.campaign_id and release_id=new.release_id),
    (select coalesce(max(revision),0)+1 from private_rule_versions where campaign_id=new.campaign_id));
 end if;
 return new;
end $$;
create trigger private_rule_assign_revision before insert on private_rule_versions for each row execute function private_rule_assign_revision();
alter table activity_participations add column cancelled_at timestamptz;
alter table activity_participations add column quota text not null default 'unknown';
alter table activity_periods add column eligibility text not null default 'unknown';
alter table activity_periods add column enrollment text not null default 'unknown';
alter table activity_periods add column quota text not null default 'unknown';
alter table activity_reward_events add column attempt_id uuid references activity_reward_events(id);
alter table activity_reward_events add column occurred_at timestamptz;

alter table todo_actions alter column card_id drop not null;
alter table todo_actions alter column participation_id drop not null;
alter table todo_actions add column fee_event_id uuid;
alter table fee_events add unique(id,user_id,card_id);
alter table todo_actions add foreign key(card_id,owner_user_id) references cards(id,user_id) on delete cascade;
alter table todo_actions add foreign key(fee_event_id,owner_user_id,card_id) references fee_events(id,user_id,card_id) on delete cascade;
alter table todo_actions add foreign key(owner_user_id) references users(id) on delete cascade;
alter table todo_actions add column description text not null default '';
alter table todo_actions add column priority text not null default 'normal' check(priority in ('normal','important'));
alter table todo_actions add column created_at timestamptz not null default now();
alter table todo_actions add constraint todo_owner_shape check (
 (type='custom' and participation_id is null and fee_event_id is null)
 or (type='annual_fee' and card_id is not null and fee_event_id is not null and participation_id is null)
 or (type in ('enrollment','spend_period','reward_claim','reward_receipt') and card_id is not null and participation_id is not null and fee_event_id is null));
alter table todo_notification_schedules add column legacy_reminder_id uuid references reminders(id) on delete set null;
-- Stable delivery identity survives action version changes and preference edits.
alter table todo_notification_schedules add column delivery_key text;
update todo_notification_schedules set delivery_key=action_id::text||':'||days_before::text||':'||deadline::text;
alter table todo_notification_schedules alter column delivery_key set not null;
create function todo_schedule_identity() returns trigger language plpgsql as $$
begin new.delivery_key:=new.action_id::text||':'||new.days_before::text||':'||new.deadline::text; return new; end $$;
create trigger todo_schedule_identity before insert or update of deadline,days_before on todo_notification_schedules for each row execute function todo_schedule_identity();
alter table todo_notifications add column delivery_key text;
update todo_notifications n set delivery_key=s.delivery_key from todo_notification_schedules s where s.id=n.schedule_id;
alter table todo_notifications alter column delivery_key set not null;
create unique index todo_notification_delivery_unique on todo_notifications(owner_user_id,delivery_key);
create function todo_notification_identity() returns trigger language plpgsql as $$
begin select delivery_key into new.delivery_key from todo_notification_schedules where id=new.schedule_id; return new; end $$;
create trigger todo_notification_identity before insert on todo_notifications for each row execute function todo_notification_identity();

create table period_plan_revisions (
 id uuid primary key default gen_random_uuid(),owner_user_id uuid not null,card_id uuid not null,participation_id uuid not null,
 rule_version_id uuid not null,campaign_id uuid not null,version integer not null default 1,
 type text not null check(type in ('month','billing','custom','once')),timezone text not null,
 partial_policy text not null check(partial_policy in ('full_target','source_defined','needs_review')),
 start_on date not null,end_on date not null,proposal jsonb not null,created_at timestamptz not null default now(),
 unique(id,owner_user_id,card_id,participation_id),
 foreign key(participation_id,owner_user_id,card_id) references activity_participations(id,owner_user_id,card_id) on delete cascade,
 foreign key(rule_version_id,owner_user_id,campaign_id) references private_rule_versions(id,owner_user_id,campaign_id),check(end_on>=start_on));
alter table activity_participations add column active_plan_id uuid;
alter table activity_participations add foreign key(active_plan_id,owner_user_id,card_id,id) references period_plan_revisions(id,owner_user_id,card_id,participation_id) deferrable initially deferred;
alter table activity_periods add column plan_revision_id uuid;
alter table activity_periods add foreign key(plan_revision_id,owner_user_id,card_id,participation_id) references period_plan_revisions(id,owner_user_id,card_id,participation_id);
alter table spend_tasks alter column period_id drop not null;
alter table spend_tasks add column mode text not null default 'snapshot' check(mode in ('snapshot','entries'));
alter table spend_tasks add column overall_target jsonb;
alter table spend_tasks add column start_on date;
alter table spend_tasks add column end_on date;
alter table spend_tasks add column timezone text;
alter table spend_tasks add column rule_version_id uuid;
alter table spend_tasks add column campaign_id uuid;
alter table spend_tasks add foreign key(participation_id,owner_user_id,card_id) references activity_participations(id,owner_user_id,card_id) on delete cascade;
alter table spend_tasks add foreign key(rule_version_id,owner_user_id,campaign_id) references private_rule_versions(id,owner_user_id,campaign_id);
alter table spend_tasks add constraint spend_task_shape check(period_id is not null or (overall_target is not null and start_on is not null and end_on>=start_on and timezone is not null and rule_version_id is not null and campaign_id is not null));
create table activity_reward_dependencies (
 owner_user_id uuid not null,card_id uuid not null,participation_id uuid not null,reward_id uuid not null,task_id uuid not null,
 primary key(reward_id,task_id),
 foreign key(reward_id,owner_user_id,card_id,participation_id) references activity_rewards(id,owner_user_id,card_id,participation_id) on delete cascade,
 foreign key(task_id,owner_user_id,card_id,participation_id) references spend_tasks(id,owner_user_id,card_id,participation_id) on delete cascade);
-- Freeze the existing dependency set on upgrade, including blocked periods without a task.
alter table activity_rewards add column required_period_ids uuid[];
update activity_rewards r set required_period_ids=case when r.period_id is not null then array[r.period_id]
 else array(select id from activity_periods p where p.participation_id=r.participation_id order by p.start_on,p.id) end;
create table spend_facts (
 id uuid primary key default gen_random_uuid(),owner_user_id uuid not null references users(id) on delete cascade,card_id uuid not null,
 version integer not null default 1,occurred_on date not null,posted_on date,settled_on date,
 count integer not null check(count>0),amount numeric(14,2) not null check(amount>=0),currency text not null,channel text not null default '',
 refunded_amount numeric(14,2) not null default 0 check(refunded_amount>=0 and refunded_amount<=amount),note text not null,
 created_at timestamptz not null default now(),unique(id,owner_user_id,card_id),
 foreign key(card_id,owner_user_id) references cards(id,user_id) on delete cascade);
create table spend_fact_events (
 id uuid primary key default gen_random_uuid(),owner_user_id uuid not null,card_id uuid not null,fact_id uuid not null,
 event_type text not null,payload jsonb not null,occurred_at timestamptz not null default now(),
 foreign key(fact_id,owner_user_id,card_id) references spend_facts(id,owner_user_id,card_id) on delete cascade);
create table task_evaluations (
 owner_user_id uuid not null,card_id uuid not null,participation_id uuid not null,task_id uuid not null,fact_id uuid not null,
 fact_version integer not null,decision text not null check(decision in ('included','excluded','pending','needs_review')),
 count integer not null,amount numeric(14,2) not null,basis_on date,reason text not null,updated_at timestamptz not null default now(),
 primary key(task_id,fact_id),
 foreign key(task_id,owner_user_id,card_id,participation_id) references spend_tasks(id,owner_user_id,card_id,participation_id) on delete cascade,
 foreign key(fact_id,owner_user_id,card_id) references spend_facts(id,owner_user_id,card_id) on delete cascade);
create table workbench_jobs (
 id uuid primary key default gen_random_uuid(),owner_user_id uuid not null references users(id) on delete cascade,card_id uuid not null,participation_id uuid not null,
 status text not null default 'queued' check(status in ('queued','running','succeeded','failed')),input jsonb not null,
 expected_version integer not null,progress integer not null default 0,message text,retryable boolean not null default true,
 lease_until timestamptz,created_at timestamptz not null default now(),
 foreign key(participation_id,owner_user_id,card_id) references activity_participations(id,owner_user_id,card_id) on delete cascade);
create table period_plan_candidates (
 job_id uuid not null references workbench_jobs(id) on delete cascade,ordinal integer not null,content jsonb not null,
 primary key(job_id,ordinal));
create table workbench_inbox (
 consumer text not null,event_id uuid not null references catalog_personal_outbox(id) on delete cascade,
 handled_at timestamptz not null default now(),primary key(consumer,event_id));
