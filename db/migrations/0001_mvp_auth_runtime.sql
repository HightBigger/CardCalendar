-- Add optional display name for real account sessions.
alter table users add column if not exists name text;
