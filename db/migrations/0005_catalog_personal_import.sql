-- Minimal private PRD 21/22 facts needed by explicit catalog joins.
create table private_campaigns (
 id uuid primary key default gen_random_uuid(),
 owner_user_id uuid not null references users(id) on delete cascade,
 catalog_activity_id uuid not null references catalog_activities(id),
 activity_instance_key uuid not null,
 initial_release_id uuid not null,
 unique(owner_user_id,catalog_activity_id,activity_instance_key),
 unique(id,owner_user_id),
 foreign key(catalog_activity_id,activity_instance_key) references catalog_activities(id,activity_instance_key),
 foreign key(initial_release_id,catalog_activity_id) references catalog_releases(id,catalog_activity_id)
);
create table private_rule_versions (
 id uuid primary key default gen_random_uuid(),
 owner_user_id uuid not null,
 campaign_id uuid not null,
 release_id uuid not null references catalog_releases(id),
 content jsonb not null,
 created_at timestamptz not null default now(),
 foreign key(campaign_id,owner_user_id) references private_campaigns(id,owner_user_id) on delete cascade,
 unique(id,owner_user_id,campaign_id),
 unique(campaign_id,release_id)
);
create table activity_participations (
 id uuid primary key default gen_random_uuid(),
 owner_user_id uuid not null,
 card_id uuid not null,
 campaign_id uuid not null,
 rule_version_id uuid not null,
 activity_instance_key uuid not null,
 version integer not null default 1,
 tracking_status text not null check(tracking_status in ('needs_review','planned','active')),
 tracking_decision text not null default 'continue' check(tracking_decision in ('continue','stop_future','needs_confirmation')),
 reward_reminder_policy text not null default 'continue' check(reward_reminder_policy in ('continue','stop','needs_confirmation')),
 eligibility text not null default 'unknown',
 enrollment text not null default 'unknown',
 node_preferences jsonb not null,
 created_at timestamptz not null default now(),
 foreign key(card_id,owner_user_id) references cards(id,user_id) on delete cascade,
 foreign key(campaign_id,owner_user_id) references private_campaigns(id,owner_user_id) on delete cascade,
 foreign key(rule_version_id,owner_user_id,campaign_id) references private_rule_versions(id,owner_user_id,campaign_id),
 unique(owner_user_id,campaign_id,card_id,activity_instance_key),
 unique(id,owner_user_id,card_id)
);
create table activity_periods (
 id uuid primary key default gen_random_uuid(),
 owner_user_id uuid not null,
 card_id uuid not null,
 participation_id uuid not null,
 rule_version_id uuid not null,
 campaign_id uuid not null,
 version integer not null default 1,
 period_key text not null,
 start_on date not null,
 end_on date not null,
 timezone text not null,
 target jsonb not null,
 executable boolean not null,
 qualification text not null default 'unknown',
 stopped boolean not null default false,
 foreign key(participation_id,owner_user_id,card_id) references activity_participations(id,owner_user_id,card_id) on delete cascade,
 foreign key(rule_version_id,owner_user_id,campaign_id) references private_rule_versions(id,owner_user_id,campaign_id),
 unique(participation_id,period_key),
 unique(id,owner_user_id,card_id,participation_id),
 check(end_on >= start_on)
);
create table activity_period_revisions (
 id uuid primary key default gen_random_uuid(),owner_user_id uuid not null,card_id uuid not null,participation_id uuid not null,period_id uuid not null,
 campaign_id uuid not null,old_rule_version_id uuid not null,new_rule_version_id uuid not null,
 decision text not null,note text not null,created_at timestamptz not null default now(),
 foreign key(period_id,owner_user_id,card_id,participation_id) references activity_periods(id,owner_user_id,card_id,participation_id) on delete cascade,
 foreign key(old_rule_version_id,owner_user_id,campaign_id) references private_rule_versions(id,owner_user_id,campaign_id),
 foreign key(new_rule_version_id,owner_user_id,campaign_id) references private_rule_versions(id,owner_user_id,campaign_id)
);
create table spend_tasks (
 id uuid primary key default gen_random_uuid(),owner_user_id uuid not null,card_id uuid not null,participation_id uuid not null,period_id uuid not null,
 version integer not null default 1,
 qualification text not null default 'unknown',
 unique(period_id),
 unique(id,owner_user_id,card_id,participation_id),
 foreign key(period_id,owner_user_id,card_id,participation_id) references activity_periods(id,owner_user_id,card_id,participation_id) on delete cascade
);
create table catalog_spend_observations (
 id uuid primary key default gen_random_uuid(),owner_user_id uuid not null,card_id uuid not null,participation_id uuid not null,task_id uuid not null,
 occurred_on date not null,count integer not null check(count>=0),amount numeric(14,2) not null check(amount>=0),note text not null,
 created_at timestamptz not null default now(),
 foreign key(task_id,owner_user_id,card_id,participation_id) references spend_tasks(id,owner_user_id,card_id,participation_id) on delete cascade
);
create table activity_rewards (
 id uuid primary key default gen_random_uuid(),owner_user_id uuid not null,card_id uuid not null,participation_id uuid not null,period_id uuid,
 reward_key text not null,version integer not null default 1,template jsonb not null,
 campaign_id uuid not null,rule_version_id uuid not null,
 condition_status text not null default 'unknown',claim_status text not null default 'not_submitted',receipt_status text not null default 'not_received',
 unique(participation_id,reward_key),
 unique(id,owner_user_id,card_id,participation_id),
 foreign key(participation_id,owner_user_id,card_id) references activity_participations(id,owner_user_id,card_id) on delete cascade,
 foreign key(period_id,owner_user_id,card_id,participation_id) references activity_periods(id,owner_user_id,card_id,participation_id),
 foreign key(rule_version_id,owner_user_id,campaign_id) references private_rule_versions(id,owner_user_id,campaign_id)
);
create table activity_reward_events (
 id uuid primary key default gen_random_uuid(),owner_user_id uuid not null,card_id uuid not null,participation_id uuid not null,reward_id uuid not null,
 event_type text not null,quantity numeric(14,2),occurred_on date not null,note text not null,created_at timestamptz not null default now(),
 foreign key(reward_id,owner_user_id,card_id,participation_id) references activity_rewards(id,owner_user_id,card_id,participation_id) on delete cascade
);
create table todo_actions (
 id uuid primary key default gen_random_uuid(),owner_user_id uuid not null,card_id uuid not null,participation_id uuid not null,
 action_key text not null,version integer not null default 1,
 title text not null,type text not null,node_kind text not null,
 status text not null default 'pending' check(status in ('pending','completed','ignored','cancelled')),
 deadline jsonb not null,planned_for jsonb not null,snoozed_until jsonb not null,
 show_in_calendar boolean not null default true,create_todo boolean not null default true,
 primary_action jsonb not null,source_version integer not null,
 history jsonb not null default '[]',
 unique(owner_user_id,action_key),
 unique(id,owner_user_id),
 foreign key(participation_id,owner_user_id,card_id) references activity_participations(id,owner_user_id,card_id) on delete cascade
);
create table todo_notification_schedules (
 id uuid primary key default gen_random_uuid(),owner_user_id uuid not null,action_id uuid not null,action_version integer not null,
 days_before integer not null check(days_before>=0),deadline jsonb not null,status text not null default 'pending',
 foreign key(action_id,owner_user_id) references todo_actions(id,owner_user_id) on delete cascade,
 unique(action_id,action_version,days_before)
);
create table catalog_personal_history (
 id uuid primary key default gen_random_uuid(),owner_user_id uuid not null,card_id uuid not null,participation_id uuid not null,
 action text not null,payload jsonb not null,note text not null,occurred_at timestamptz not null default now(),
 foreign key(participation_id,owner_user_id,card_id) references activity_participations(id,owner_user_id,card_id) on delete cascade
);
create table catalog_personal_outbox (
 id uuid primary key default gen_random_uuid(),owner_user_id uuid not null references users(id) on delete cascade,
 aggregate_id uuid not null,sequence integer not null,event_type text not null,payload jsonb not null,
 occurred_at timestamptz not null default now(),unique(aggregate_id,sequence,event_type)
);
create table catalog_inbox (
 event_id uuid not null references catalog_outbox(id),
 participation_id uuid not null references activity_participations(id) on delete cascade,
 handled_at timestamptz not null default now(),primary key(event_id,participation_id)
);
create index catalog_private_owner_idx on activity_participations(owner_user_id,created_at);
create index todo_action_owner_idx on todo_actions(owner_user_id,status);
-- Preserve campaign instance and rule provenance on the same ownership chain.
alter table private_campaigns add unique(id,owner_user_id,activity_instance_key);
alter table activity_participations add foreign key(campaign_id,owner_user_id,activity_instance_key) references private_campaigns(id,owner_user_id,activity_instance_key);
create function private_catalog_rule_scope() returns trigger language plpgsql as $$
begin
 if not exists(select 1 from private_campaigns c join catalog_releases r on r.catalog_activity_id=c.catalog_activity_id where c.id=new.campaign_id and c.owner_user_id=new.owner_user_id and r.id=new.release_id and r.content=new.content) then
  raise exception 'private rule must snapshot its campaign catalog release';
 end if;
 return new;
end $$;
create trigger private_catalog_rule_scope_check before insert or update on private_rule_versions for each row execute function private_catalog_rule_scope();
create table todo_notifications (
 id uuid primary key default gen_random_uuid(),owner_user_id uuid not null,action_id uuid not null,schedule_id uuid not null references todo_notification_schedules(id) on delete cascade,
 title text not null,delivered_at timestamptz not null default now(),
 unique(schedule_id),foreign key(action_id,owner_user_id) references todo_actions(id,owner_user_id) on delete cascade
);

create function private_rule_no_rewrite() returns trigger language plpgsql as $$
begin if old is distinct from new then raise exception 'private rule snapshots are immutable'; end if; return new; end $$;
create trigger private_rule_no_rewrite before update on private_rule_versions for each row execute function private_rule_no_rewrite();
