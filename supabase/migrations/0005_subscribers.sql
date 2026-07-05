-- Newsletter subscribers — the single source of truth for the email list
-- (double opt-in). Only the service role (edge functions) ever touches it; RLS is
-- on with NO policies so anon/authenticated clients have zero access. Raw-SQL
-- tables don't inherit Supabase default grants, so grant service_role explicitly.
create extension if not exists pgcrypto;

create table if not exists public.subscribers (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'unsubscribed')),
  confirm_token text unique,
  unsub_token text unique,
  source text,                 -- where they signed up (footer, homepage, article)
  consent_ip text,             -- GDPR consent evidence
  consent_ts timestamptz,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  unsubscribed_at timestamptz
);

create index if not exists subscribers_status_idx on public.subscribers (status);
create index if not exists subscribers_confirm_token_idx on public.subscribers (confirm_token);
create index if not exists subscribers_unsub_token_idx on public.subscribers (unsub_token);

alter table public.subscribers enable row level security;
grant all on public.subscribers to service_role;
