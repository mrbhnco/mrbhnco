-- Run this in Supabase SQL Editor before using the live sync endpoints.
create table if not exists public.store_state (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
create table if not exists public.store_webhook_events (
  event_id text primary key,
  event_type text not null,
  payload jsonb not null,
  received_at timestamptz not null default now()
);
alter table public.store_state enable row level security;
alter table public.store_webhook_events enable row level security;
-- Do not create public policies. The Vercel API uses the service-role key server-side.
