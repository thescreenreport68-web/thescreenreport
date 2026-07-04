-- Table-level GRANTs for the PostgREST roles. Tables created via raw SQL (rather
-- than the dashboard) don't inherit Supabase's default anon/authenticated grants,
-- so the API returns "permission denied" until these run. RLS policies (0001)
-- still do the row-level filtering on top of these grants. Trusted writes
-- (posting a comment) go through the Edge Function as service_role, which
-- bypasses both grants and RLS.
grant usage on schema public to anon, authenticated;

grant select on public.comments to anon, authenticated;
grant update, delete on public.comments to authenticated;

grant select on public.profiles to anon, authenticated;
grant update on public.profiles to authenticated;

grant select on public.comment_likes to anon, authenticated;
grant insert, delete on public.comment_likes to authenticated;

grant insert, select on public.comment_reports to authenticated;
