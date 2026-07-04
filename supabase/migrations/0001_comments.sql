-- The Screen Report — comments backend (COMMENTS_SYSTEM_PLAN.md)
-- Run once in Supabase → SQL Editor (or via `supabase db push`).
-- Design: readers read APPROVED comments directly (anon key + RLS); all WRITES
-- that must be trusted (posting a comment) go through the post-comment Edge
-- Function using the service role, so the moderation pipeline can't be bypassed.

-- ============ profiles (one per signed-in user) ============
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  status text not null default 'active',  -- active | shadowed | banned
  created_at timestamptz not null default now()
);

-- Auto-create a profile on first sign-in, pulling name/avatar from the Google token.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
    coalesce(new.raw_user_meta_data->>'avatar_url', new.raw_user_meta_data->>'picture')
  )
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============ comments (+ one-level replies via parent_id) ============
create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  article_slug text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  parent_id uuid references public.comments(id) on delete cascade,  -- null = top-level
  body text not null check (char_length(body) between 1 and 2000),
  status text not null default 'approved',  -- approved | pending | rejected
  like_count int not null default 0,
  reply_count int not null default 0,
  mod_reason text,
  created_at timestamptz not null default now(),
  edited_at timestamptz
);
create index if not exists comments_slug_created_idx on public.comments (article_slug, created_at desc);
create index if not exists comments_parent_idx on public.comments (parent_id);
create index if not exists comments_user_idx on public.comments (user_id);

-- ============ likes (one per user per comment) ============
create table if not exists public.comment_likes (
  comment_id uuid not null references public.comments(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);
create index if not exists comment_likes_user_idx on public.comment_likes (user_id);

-- ============ reports (one per user per comment) ============
create table if not exists public.comment_reports (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references public.comments(id) on delete cascade,
  reporter_id uuid not null references auth.users(id) on delete cascade,
  reason text,
  created_at timestamptz not null default now(),
  unique (comment_id, reporter_id)
);

-- ============ counters (kept accurate by triggers) ============
create or replace function public.bump_like_count()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    update public.comments set like_count = like_count + 1 where id = new.comment_id;
  elsif tg_op = 'DELETE' then
    update public.comments set like_count = greatest(0, like_count - 1) where id = old.comment_id;
  end if;
  return null;
end; $$;
drop trigger if exists like_count_trg on public.comment_likes;
create trigger like_count_trg
  after insert or delete on public.comment_likes
  for each row execute function public.bump_like_count();

create or replace function public.bump_reply_count()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' and new.parent_id is not null and new.status = 'approved' then
    update public.comments set reply_count = reply_count + 1 where id = new.parent_id;
  elsif tg_op = 'DELETE' and old.parent_id is not null then
    update public.comments set reply_count = greatest(0, reply_count - 1) where id = old.parent_id;
  end if;
  return null;
end; $$;
drop trigger if exists reply_count_trg on public.comments;
create trigger reply_count_trg
  after insert or delete on public.comments
  for each row execute function public.bump_reply_count();

-- ============ auto-hide at 3 unique reports ============
create or replace function public.auto_hide_reported()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.comment_reports where comment_id = new.comment_id) >= 3 then
    update public.comments set status = 'pending', mod_reason = 'auto-hidden: reported'
      where id = new.comment_id and status = 'approved';
  end if;
  return null;
end; $$;
drop trigger if exists auto_hide_trg on public.comment_reports;
create trigger auto_hide_trg
  after insert on public.comment_reports
  for each row execute function public.auto_hide_reported();

-- ============ ROW LEVEL SECURITY ============
alter table public.profiles enable row level security;
alter table public.comments enable row level security;
alter table public.comment_likes enable row level security;
alter table public.comment_reports enable row level security;

-- profiles: world-readable (names/avatars shown on comments); you edit only your own
drop policy if exists p_select on public.profiles;
create policy p_select on public.profiles for select using (true);
drop policy if exists p_update_own on public.profiles;
create policy p_update_own on public.profiles for update to authenticated
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

-- comments: anyone reads APPROVED (or your own, so you see your held comment);
-- NO direct client insert — writes go through the Edge Function (service role,
-- which bypasses RLS). Owner may edit/delete their own.
drop policy if exists c_select on public.comments;
create policy c_select on public.comments for select
  using (status = 'approved' or (select auth.uid()) = user_id);
drop policy if exists c_update_own on public.comments;
create policy c_update_own on public.comments for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists c_delete_own on public.comments;
create policy c_delete_own on public.comments for delete to authenticated
  using ((select auth.uid()) = user_id);

-- likes: read all; like/unlike only as yourself
drop policy if exists l_select on public.comment_likes;
create policy l_select on public.comment_likes for select using (true);
drop policy if exists l_insert_own on public.comment_likes;
create policy l_insert_own on public.comment_likes for insert to authenticated
  with check ((select auth.uid()) = user_id);
drop policy if exists l_delete_own on public.comment_likes;
create policy l_delete_own on public.comment_likes for delete to authenticated
  using ((select auth.uid()) = user_id);

-- reports: insert/see only your own
drop policy if exists r_insert_own on public.comment_reports;
create policy r_insert_own on public.comment_reports for insert to authenticated
  with check ((select auth.uid()) = reporter_id);
drop policy if exists r_select_own on public.comment_reports;
create policy r_select_own on public.comment_reports for select to authenticated
  using ((select auth.uid()) = reporter_id);
