create table worker_heartbeats (
  name text primary key,
  instance_id uuid not null,
  status text not null default 'running',
  started_at timestamptz not null,
  heartbeat_at timestamptz not null,
  updated_at timestamptz not null default now(),
  constraint worker_heartbeats_status_check check (status in ('running', 'stopped'))
);

create index worker_heartbeats_heartbeat_idx on worker_heartbeats (status, heartbeat_at);
