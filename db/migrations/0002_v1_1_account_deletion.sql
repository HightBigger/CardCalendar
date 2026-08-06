-- CardCalendar V1.1 account deletion observability.
alter table users add column if not exists deletion_requested_at timestamptz;
alter table users add column if not exists deletion_cleanup_completed_at timestamptz;
alter table users add column if not exists deletion_cleanup_result jsonb not null default '{}'::jsonb;
alter table users add column if not exists deletion_retry_count integer not null default 0;
