-- Platform-owned directory; no exception to private owner/card authorization.
create table bank_directory (
  id text primary key,
  name text not null,
  official_domains text[] not null check (cardinality(official_domains) > 0)
);
insert into bank_directory values
 ('cmb', '招商银行', array['cmbchina.com']),
 ('icbc', '工商银行', array['icbc.com.cn']),
 ('ccb', '建设银行', array['ccb.com']),
 ('boc', '中国银行', array['boc.cn']),
 ('abc', '农业银行', array['abchina.com']),
 ('bocom', '交通银行', array['bankcomm.com']),
 ('citic', '中信银行', array['citicbank.com']),
 ('cmbc', '民生银行', array['cmbc.com.cn']),
 ('cib', '兴业银行', array['cib.com.cn']),
 ('spdb', '浦发银行', array['spdb.com.cn']),
 ('pingan', '平安银行', array['bank.pingan.com']);

create table user_role_grants (
  user_id uuid primary key references users(id) on delete cascade,
  role text not null check (role = 'catalog_admin'),
  version integer not null default 1 check (version > 0),
  granted_at timestamptz not null default now(),
  revoked_at timestamptz
);
-- Explicitly confirmed bank association; existing issuer text is never fuzzy matched.
alter table cards add column bank_id text references bank_directory(id);
alter table cards add constraint cards_id_user_unique unique (id, user_id);

create table catalog_activities (
 id uuid primary key default gen_random_uuid(),
 activity_instance_key uuid not null default gen_random_uuid(),
 version integer not null default 1 check (version > 0),
 publication_status text not null default 'unpublished' check (publication_status in ('unpublished','published','withdrawn')),
 current_release_id uuid,
 current_draft_id uuid,
 withdrawal_reason text,
 last_modified_by uuid not null references users(id),
 updated_at timestamptz not null default now(),
 check (publication_status <> 'withdrawn' or length(trim(withdrawal_reason)) > 0),
 unique (id, activity_instance_key)
);
create table catalog_drafts (
 id uuid primary key default gen_random_uuid(),
 catalog_activity_id uuid not null references catalog_activities(id),
 version integer not null default 1 check (version > 0),
 based_on_release_id uuid,
 content jsonb not null check (jsonb_typeof(content) = 'object'),
 updated_at timestamptz not null default now(),
 unique (id, catalog_activity_id)
);
create table catalog_releases (
 id uuid primary key default gen_random_uuid(),
 catalog_activity_id uuid not null references catalog_activities(id),
 release_number integer not null check (release_number > 0),
 activity_instance_key uuid not null,
 published_at timestamptz not null default now(),
 published_by uuid not null references users(id),
 content_hash char(64) not null check (content_hash ~ '^[a-f0-9]{64}$'),
 change_note text not null check (length(trim(change_note)) > 0),
 content jsonb not null check (jsonb_typeof(content) = 'object'),
 unique (catalog_activity_id, release_number),
 unique (id, catalog_activity_id),
 foreign key (catalog_activity_id, activity_instance_key) references catalog_activities(id, activity_instance_key)
);
alter table catalog_activities add foreign key (current_release_id,id) references catalog_releases(id,catalog_activity_id);
alter table catalog_activities add foreign key (current_draft_id,id) references catalog_drafts(id,catalog_activity_id);
alter table catalog_drafts add foreign key (based_on_release_id,catalog_activity_id) references catalog_releases(id,catalog_activity_id);
create function catalog_release_immutable() returns trigger language plpgsql as $$
begin raise exception 'catalog releases are immutable'; end $$;
create trigger catalog_release_no_change before update or delete on catalog_releases for each row execute function catalog_release_immutable();
create table catalog_history (
 id uuid primary key default gen_random_uuid(),
 catalog_activity_id uuid not null references catalog_activities(id),
 actor_id uuid not null references users(id),
 action text not null,
 occurred_at timestamptz not null default now(),
 catalog_version integer not null,
 draft_version integer,
 release_id uuid,
 note text not null,
 foreign key (release_id,catalog_activity_id) references catalog_releases(id,catalog_activity_id)
);
create table catalog_command_results (
 owner_user_id uuid not null references users(id) on delete cascade,
 command_scope text not null,
 idempotency_key text not null check (length(idempotency_key) between 1 and 200),
 request_hash char(64) not null,
 result jsonb not null,
 created_at timestamptz not null default now(),
 primary key (owner_user_id,command_scope,idempotency_key)
);
-- Platform events contain no member facts. Private fanout is a system consumer's work.
create table catalog_outbox (
 id uuid primary key default gen_random_uuid(),
 aggregate_id uuid not null references catalog_activities(id),
 sequence integer not null,
 event_type text not null,
 payload jsonb not null,
 occurred_at timestamptz not null default now(),
 delivered_at timestamptz,
 unique (aggregate_id, sequence, event_type)
);
create index catalog_visible_idx on catalog_activities(publication_status,updated_at desc);
create index catalog_history_idx on catalog_history(catalog_activity_id,occurred_at);
