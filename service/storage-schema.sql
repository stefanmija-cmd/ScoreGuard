-- Optional free Supabase project. Run in its SQL Editor; credentials go only in Streamlit Secrets.
create table if not exists public.scoreguard_state (
  id text primary key,
  payload jsonb not null,
  revision bigint not null check (revision > 0),
  updated_at timestamptz not null default now()
);
alter table public.scoreguard_state enable row level security;
revoke all on public.scoreguard_state from anon, authenticated;
grant select, insert, update on public.scoreguard_state to service_role;
