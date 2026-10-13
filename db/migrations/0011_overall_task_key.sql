alter table spend_tasks add column task_key text;
update spend_tasks set task_key='period:'||period_id::text where period_id is not null;
create unique index spend_task_key_unique on spend_tasks(participation_id,task_key)
  where task_key is not null;
alter table spend_tasks add constraint overall_task_key_required
  check (period_id is not null or task_key is not null);
