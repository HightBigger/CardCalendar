-- CardCalendar MVP baseline. Execute with a PostgreSQL 15+ role that can create extensions.
create extension if not exists pgcrypto;
create extension if not exists citext;

create table users (
  id uuid primary key default gen_random_uuid(),
  email citext not null,
  password_hash text not null,
  name text,
  timezone text not null default 'Asia/Shanghai',
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint users_email_unique unique (email),
  constraint users_status_check check (status in ('active', 'deletion_requested', 'anonymized'))
);

create table sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token_hash char(64) not null,
  expires_at timestamptz not null,
  last_seen_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_ip_hash text,
  constraint sessions_token_hash_unique unique (token_hash),
  constraint sessions_expiry_check check (expires_at > created_at),
  constraint sessions_token_hash_check check (token_hash ~ '^[0-9a-f]{64}$')
);

create table cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  issuer_name text not null,
  name text not null,
  last4 char(4) not null,
  status text not null default 'active',
  annual_fee_amount numeric(14,2) not null default 0,
  currency char(3) not null default 'CNY',
  fee_cycle_type text not null,
  opened_on date,
  fee_month smallint,
  fee_day smallint,
  next_fee_date date not null,
  waive_rule_type text not null default 'none',
  target_count integer,
  target_amount numeric(14,2),
  progress_period_start date,
  progress_period_end date,
  custom_rule_text text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint cards_issuer_name_check check (length(trim(issuer_name)) between 1 and 100),
  constraint cards_name_check check (length(trim(name)) between 1 and 120),
  constraint cards_last4_check check (last4 ~ '^[0-9]{4}$'),
  constraint cards_status_check check (status in ('active', 'suspended', 'archived')),
  constraint cards_fee_amount_check check (annual_fee_amount >= 0),
  constraint cards_currency_check check (currency ~ '^[A-Z]{3}$'),
  constraint cards_cycle_check check (
    (fee_cycle_type = 'anniversary' and opened_on is not null)
    or (fee_cycle_type = 'fixed_date' and fee_month between 1 and 12 and fee_day between 1 and 31)
    or fee_cycle_type = 'custom'
  ),
  constraint cards_waive_rule_type_check check (
    waive_rule_type in ('none', 'count', 'amount', 'count_and_amount', 'custom')
  ),
  constraint cards_target_count_check check (target_count is null or target_count >= 0),
  constraint cards_target_amount_check check (target_amount is null or target_amount >= 0),
  constraint cards_progress_period_check check (
    progress_period_start is null
    or progress_period_end is null
    or progress_period_end >= progress_period_start
  ),
  constraint cards_rule_target_check check (
    (waive_rule_type not in ('count', 'count_and_amount') or target_count is not null)
    and (waive_rule_type not in ('amount', 'count_and_amount') or target_amount is not null)
    and (waive_rule_type <> 'custom' or nullif(trim(custom_rule_text), '') is not null)
  )
);

create table fee_cycles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  card_id uuid not null references cards(id) on delete restrict,
  period_start date not null,
  period_end date not null,
  fee_due_date date not null,
  waive_rule_type text not null,
  target_count integer,
  target_amount numeric(14,2),
  custom_rule_text text,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fee_cycles_card_period_unique unique (card_id, period_start, period_end),
  constraint fee_cycles_period_check check (period_end >= period_start),
  constraint fee_cycles_status_check check (status in ('open', 'qualified', 'closed')),
  constraint fee_cycles_rule_type_check check (
    waive_rule_type in ('none', 'count', 'amount', 'count_and_amount', 'custom')
  ),
  constraint fee_cycles_target_count_check check (target_count is null or target_count >= 0),
  constraint fee_cycles_target_amount_check check (target_amount is null or target_amount >= 0),
  constraint fee_cycles_custom_rule_check check (
    waive_rule_type <> 'custom' or nullif(trim(custom_rule_text), '') is not null
  ),
  constraint fee_cycles_rule_target_check check (
    (waive_rule_type not in ('count', 'count_and_amount') or target_count is not null)
    and (waive_rule_type not in ('amount', 'count_and_amount') or target_amount is not null)
  )
);

create table fee_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  card_id uuid not null references cards(id) on delete restrict,
  fee_cycle_id uuid not null references fee_cycles(id) on delete restrict,
  due_date date not null,
  expected_amount numeric(14,2) not null default 0,
  status text not null default 'pending',
  actual_amount numeric(14,2),
  occurred_on date,
  notes text,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fee_events_cycle_unique unique (fee_cycle_id),
  constraint fee_events_status_check check (
    status in ('pending', 'waived', 'charged', 'refunded', 'not_applicable')
  ),
  constraint fee_events_actual_amount_check check (actual_amount is null or actual_amount >= 0),
  constraint fee_events_resolution_check check (
    (status not in ('charged', 'refunded') or (actual_amount is not null and occurred_on is not null))
    and (status in ('pending', 'waived') or resolved_at is not null)
  )
);

create table progress_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  card_id uuid not null references cards(id) on delete restrict,
  fee_cycle_id uuid not null references fee_cycles(id) on delete restrict,
  entry_date date not null,
  count_delta integer not null default 0,
  amount_delta numeric(14,2) not null default 0,
  entry_type text not null default 'manual',
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references users(id) on delete set null,
  reversed_at timestamptz,
  constraint progress_entries_delta_check check (count_delta <> 0 or amount_delta <> 0),
  constraint progress_entries_type_check check (entry_type in ('manual', 'correction', 'reversal'))
);

create table reminder_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  card_id uuid references cards(id) on delete cascade,
  kind text not null,
  days_before integer not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reminder_rules_scope_unique unique (user_id, card_id, kind, days_before),
  constraint reminder_rules_kind_check check (kind in ('fee_event', 'progress')),
  constraint reminder_rules_days_check check (days_before between 0 and 3650)
);

create table reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  card_id uuid references cards(id) on delete cascade,
  fee_event_id uuid references fee_events(id) on delete cascade,
  fee_cycle_id uuid references fee_cycles(id) on delete cascade,
  kind text not null,
  days_before integer not null default 0,
  scheduled_for timestamptz not null,
  status text not null default 'pending',
  snoozed_until timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reminders_kind_check check (kind in ('fee_event', 'progress')),
  constraint reminders_target_check check (
    (kind = 'fee_event' and fee_event_id is not null and fee_cycle_id is null)
    or (kind = 'progress' and fee_cycle_id is not null and fee_event_id is null)
  ),
  constraint reminders_status_check check (
    status in ('pending', 'completed', 'snoozed', 'ignored', 'cancelled')
  ),
  constraint reminders_completed_check check (status <> 'completed' or completed_at is not null)
);

create table audit_logs (
  id bigint generated always as identity primary key,
  user_id uuid references users(id) on delete set null,
  actor_type text not null,
  actor_id uuid,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  request_id text,
  occurred_at timestamptz not null default now(),
  ip_hash text,
  metadata jsonb not null default '{}'::jsonb,
  constraint audit_logs_actor_type_check check (actor_type in ('user', 'system', 'admin'))
);

create index sessions_user_active_idx on sessions (user_id, expires_at)
  where revoked_at is null;
create index cards_user_status_idx on cards (user_id, status, created_at desc);
create index cards_user_fee_date_idx on cards (user_id, next_fee_date)
  where status <> 'archived';
create index cards_user_search_idx on cards (user_id, issuer_name, name, last4);
create index fee_cycles_user_period_idx on fee_cycles (user_id, period_start desc);
create index fee_events_user_due_idx on fee_events (user_id, due_date, status);
create index fee_events_card_due_idx on fee_events (card_id, due_date desc);
create index progress_entries_cycle_date_idx on progress_entries (fee_cycle_id, entry_date desc, created_at desc);
create index progress_entries_user_card_idx on progress_entries (user_id, card_id, entry_date desc);
create unique index reminders_event_schedule_unique on reminders (fee_event_id, scheduled_for, kind)
  where fee_event_id is not null;
create unique index reminders_cycle_schedule_unique on reminders (fee_cycle_id, scheduled_for, kind)
  where fee_cycle_id is not null;
create index reminders_user_inbox_idx on reminders (user_id, status, scheduled_for);
create index audit_logs_user_time_idx on audit_logs (user_id, occurred_at desc);
create index audit_logs_entity_idx on audit_logs (entity_type, entity_id, occurred_at desc);

create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger users_set_updated_at before update on users
  for each row execute function set_updated_at();
create trigger sessions_set_updated_at before update on sessions
  for each row execute function set_updated_at();
create trigger cards_set_updated_at before update on cards
  for each row execute function set_updated_at();
create trigger fee_cycles_set_updated_at before update on fee_cycles
  for each row execute function set_updated_at();
create trigger fee_events_set_updated_at before update on fee_events
  for each row execute function set_updated_at();
create trigger progress_entries_set_updated_at before update on progress_entries
  for each row execute function set_updated_at();
create trigger reminder_rules_set_updated_at before update on reminder_rules
  for each row execute function set_updated_at();
create trigger reminders_set_updated_at before update on reminders
  for each row execute function set_updated_at();
