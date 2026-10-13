create table business_date_nodes (
 id uuid primary key default gen_random_uuid(),owner_user_id uuid not null references users(id) on delete cascade,
 card_id uuid,participation_id uuid,fee_event_id uuid,
 source_kind text not null check(source_kind in ('activity','annual_fee','custom')),
 node_key text not null,node_kind text not null,title text not null,date_value jsonb not null,
 source_version integer not null,version integer not null default 1,show_in_calendar boolean not null,
 notify_days integer[] not null default '{}',primary_action jsonb not null,
 unique(owner_user_id,node_key),unique(id,owner_user_id),
 foreign key(card_id,owner_user_id) references cards(id,user_id) on delete cascade,
 foreign key(participation_id,owner_user_id,card_id) references activity_participations(id,owner_user_id,card_id) on delete cascade,
 foreign key(fee_event_id,owner_user_id,card_id) references fee_events(id,user_id,card_id) on delete cascade,
 check((source_kind='activity' and participation_id is not null and card_id is not null and fee_event_id is null)
 or (source_kind='annual_fee' and fee_event_id is not null and card_id is not null and participation_id is null)
 or (source_kind='custom' and participation_id is null and fee_event_id is null)));
alter table todo_actions add column node_id uuid;
alter table todo_actions add foreign key(node_id,owner_user_id) references business_date_nodes(id,owner_user_id) on delete cascade;
alter table todo_actions add column completion_origin text check(completion_origin in ('manual','business'));
alter table todo_notification_schedules alter column action_id drop not null;
alter table todo_notification_schedules add column node_id uuid;
alter table todo_notification_schedules add foreign key(node_id,owner_user_id) references business_date_nodes(id,owner_user_id) on delete cascade;
alter table todo_notification_schedules add check(action_id is not null or node_id is not null);
create unique index todo_node_schedule_unique on todo_notification_schedules(node_id,action_version,days_before) where action_id is null;
alter table todo_notifications alter column action_id drop not null;
alter table todo_notifications add column node_id uuid;
alter table todo_notifications add foreign key(node_id,owner_user_id) references business_date_nodes(id,owner_user_id) on delete cascade;
create or replace function todo_schedule_identity() returns trigger language plpgsql as $$
begin new.delivery_key:=coalesce(new.action_id,new.node_id)::text||':'||new.days_before::text||':'||new.deadline::text; return new; end $$;
-- Existing IDs, action keys and manual histories survive node backfill.
insert into business_date_nodes(owner_user_id,card_id,participation_id,source_kind,node_key,node_kind,title,date_value,source_version,show_in_calendar,primary_action)
select owner_user_id,card_id,participation_id,'activity',action_key,node_kind,title,deadline,source_version,show_in_calendar,primary_action from todo_actions where participation_id is not null;
update todo_actions t set node_id=n.id from business_date_nodes n where n.owner_user_id=t.owner_user_id and n.node_key=t.action_key;
update todo_notification_schedules s set node_id=t.node_id from todo_actions t where t.id=s.action_id;
alter table reminders add column action_id uuid;
alter table reminders add column node_id uuid;
alter table reminders add foreign key(action_id,user_id) references todo_actions(id,owner_user_id) on delete set null;
alter table reminders add foreign key(node_id,user_id) references business_date_nodes(id,owner_user_id) on delete set null;
-- Original reminders remain the sole annual-fee scheduling owner. No annual fee rows
-- are inserted into todo_notification_schedules.
create function project_annual_fee(event_id uuid) returns void language plpgsql as $$
declare e record; aid uuid; nid uuid; old_action record; d jsonb; changed boolean; next_status text;
begin
 select f.*,u.timezone,c.status as card_status,c.name from fee_events f join users u on u.id=f.user_id join cards c on c.id=f.card_id and c.user_id=f.user_id where f.id=event_id into e;
 if not found then return; end if;
 d:=jsonb_build_object('kind','date','value',e.due_date::text,'timezone',e.timezone);
 insert into business_date_nodes(owner_user_id,card_id,fee_event_id,source_kind,node_key,node_kind,title,date_value,source_version,show_in_calendar,primary_action)
 values(e.user_id,e.card_id,e.id,'annual_fee','annual_fee:'||e.id||':resolve','annual_fee','确认年费处理结果',d,1,true,jsonb_build_object('kind','annual_fee','resourceId',e.id,'label','处理年费','enabled',e.card_status='active'))
 on conflict(owner_user_id,node_key) do update set date_value=excluded.date_value,title=excluded.title,version=business_date_nodes.version+1
 where business_date_nodes.date_value is distinct from excluded.date_value or business_date_nodes.title is distinct from excluded.title;
 select id into nid from business_date_nodes where owner_user_id=e.user_id and node_key='annual_fee:'||e.id||':resolve';
 select * into old_action from todo_actions where owner_user_id=e.user_id and action_key='annual_fee:'||e.id||':resolve' for update;
 next_status:=case when e.status<>'pending' then 'completed' when e.card_status<>'active' then 'cancelled' else 'pending' end;
 if old_action.id is null then
  insert into todo_actions(owner_user_id,card_id,fee_event_id,node_id,action_key,title,type,node_kind,status,deadline,planned_for,snoozed_until,primary_action,source_version,completion_origin)
  values(e.user_id,e.card_id,e.id,nid,'annual_fee:'||e.id||':resolve','确认年费处理结果','annual_fee','annual_fee',next_status,d,'{"kind":"unknown","reason":"未设置"}','{"kind":"unknown","reason":"未设置"}',jsonb_build_object('kind','annual_fee','resourceId',e.id,'label','处理年费','enabled',e.card_status='active'),1,case when e.status<>'pending' then 'business' end) returning id into aid;
 else
  aid:=old_action.id;
  -- Reconcile is a projection, not permission to undo manual dismissal or a bank result.
  if next_status='pending' and old_action.status<>'cancelled' then next_status:=old_action.status; end if;
  if old_action.status='cancelled' and (e.status='pending' or e.card_status='archived') then
   -- An archived card keeps its frozen action snapshot while metadata edits update the fee source.
   null;
  elsif old_action.deadline is distinct from d or old_action.status<>next_status or old_action.title<>'确认年费处理结果' then
   update todo_actions set deadline=d,title='确认年费处理结果',status=next_status,version=version+1,
    completion_origin=case when e.status<>'pending' then 'business' else completion_origin end,
    history=history||jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'command','annual_fee_projection','actor',e.user_id,'occurredAt',now(),'note','年费来源状态/日期更新')) where id=aid;
  end if;
 end if;
 update reminders set action_id=aid,node_id=nid where fee_event_id=e.id and (action_id is distinct from aid or node_id is distinct from nid);
 if next_status<>'pending' then update reminders set status='cancelled',snoozed_until=null where fee_event_id=e.id and status in ('pending','snoozed'); end if;
end $$;
create function annual_fee_projection_trigger() returns trigger language plpgsql as $$
begin perform project_annual_fee(new.id); return new; end $$;
create trigger annual_fee_projection after insert or update of due_date,status on fee_events for each row execute function annual_fee_projection_trigger();
create function annual_reminder_link() returns trigger language plpgsql as $$
begin
 if new.fee_event_id is not null then
  select t.id,t.node_id into new.action_id,new.node_id from todo_actions t where t.fee_event_id=new.fee_event_id and t.owner_user_id=new.user_id;
  if exists(select 1 from todo_actions where id=new.action_id and status<>'pending') and new.status in ('pending','snoozed') then new.status:='cancelled'; end if;
 end if;
 return new;
end $$;
create trigger annual_reminder_link before insert or update of fee_event_id,status on reminders for each row execute function annual_reminder_link();
select project_annual_fee(id) from fee_events;
-- Backfill legacy plans without inferring facts or altering child identities.
insert into period_plan_revisions(owner_user_id,card_id,participation_id,rule_version_id,campaign_id,type,timezone,partial_policy,start_on,end_on,proposal)
select p.owner_user_id,p.card_id,p.id,p.rule_version_id,p.campaign_id,
 coalesce(r.content->'periodTemplate'->>'type','custom'),coalesce(r.content->'periodTemplate'->>'timezone','Asia/Shanghai'),
 coalesce(r.content->'periodTemplate'->>'partialPolicy','needs_review'),min(ap.start_on),max(ap.end_on),jsonb_build_object('legacy',true)
from activity_participations p join private_rule_versions r on r.id=p.rule_version_id join activity_periods ap on ap.participation_id=p.id group by p.id,r.id;
update activity_participations p set active_plan_id=pr.id from period_plan_revisions pr where pr.participation_id=p.id;
update activity_periods ap set plan_revision_id=p.active_plan_id from activity_participations p where p.id=ap.participation_id;
create table participation_checks (
 id uuid primary key default gen_random_uuid(),owner_user_id uuid not null,card_id uuid not null,participation_id uuid not null,period_id uuid,
 scope_key text not null,kind text not null,status text not null,note text not null,sequence integer not null,occurred_at timestamptz not null default now(),
 unique(participation_id,scope_key,kind,sequence),
 foreign key(participation_id,owner_user_id,card_id) references activity_participations(id,owner_user_id,card_id) on delete cascade,
 foreign key(period_id,owner_user_id,card_id,participation_id) references activity_periods(id,owner_user_id,card_id,participation_id));
alter table workbench_jobs add column input_hash text not null default '';
alter table workbench_jobs add column attempt integer not null default 1;
alter table workbench_jobs add column lease_token uuid;
alter table workbench_jobs add column result jsonb;

create function card_annual_projection() returns trigger language plpgsql as $$
begin perform project_annual_fee(id) from fee_events where card_id=new.id and user_id=new.user_id; return new; end $$;
create trigger card_annual_projection after update of status on cards for each row when (old.status is distinct from new.status) execute function card_annual_projection();
