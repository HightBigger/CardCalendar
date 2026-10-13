-- Validate composite parent chains in addition to ownership.
alter table activity_participations add unique(id,owner_user_id,card_id,campaign_id);
alter table activity_periods add foreign key(participation_id,owner_user_id,card_id,campaign_id) references activity_participations(id,owner_user_id,card_id,campaign_id) on delete cascade;
alter table activity_rewards add foreign key(participation_id,owner_user_id,card_id,campaign_id) references activity_participations(id,owner_user_id,card_id,campaign_id) on delete cascade;
alter table period_plan_revisions add foreign key(participation_id,owner_user_id,card_id,campaign_id) references activity_participations(id,owner_user_id,card_id,campaign_id) on delete cascade;
alter table spend_tasks add foreign key(participation_id,owner_user_id,card_id,campaign_id) references activity_participations(id,owner_user_id,card_id,campaign_id) on delete cascade;
alter table todo_actions add column source_kind text generated always as (case when type='annual_fee' then 'annual_fee' when type='custom' then 'custom' else 'activity' end) stored;
create function reward_dependency_scope() returns trigger language plpgsql as $$
begin
 if new.required_period_ids is null then
  new.required_period_ids:=case when new.period_id is not null then array[new.period_id] else array(select id from activity_periods where participation_id=new.participation_id and owner_user_id=new.owner_user_id order by start_on,id) end;
 end if;
 if exists(select 1 from unnest(new.required_period_ids) pid where not exists(select 1 from activity_periods p where p.id=pid and p.participation_id=new.participation_id and p.owner_user_id=new.owner_user_id and p.card_id=new.card_id)) then
  raise exception 'reward dependencies must belong to the same participation';
 end if;
 return new;
end $$;
create trigger reward_dependency_scope before insert or update of required_period_ids on activity_rewards for each row execute function reward_dependency_scope();
create function schedule_node_scope() returns trigger language plpgsql as $$
begin
 if new.action_id is not null and new.node_id is not null and not exists(select 1 from todo_actions a where a.id=new.action_id and a.owner_user_id=new.owner_user_id and a.node_id=new.node_id) then raise exception 'schedule action/node chain mismatch'; end if;
 if exists(select 1 from todo_actions a where a.id=new.action_id and a.type='annual_fee') or exists(select 1 from business_date_nodes n where n.id=new.node_id and n.source_kind='annual_fee') then raise exception 'annual fee reminders retain original scheduler ownership'; end if;
 return new;
end $$;
create trigger schedule_node_scope before insert or update of action_id,node_id on todo_notification_schedules for each row execute function schedule_node_scope();
