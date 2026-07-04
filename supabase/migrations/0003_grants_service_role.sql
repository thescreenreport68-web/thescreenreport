-- The Edge Function writes comments as the service_role. Tables created via raw
-- SQL don't inherit Supabase's default service_role grants, so inserts were
-- denied ("permission denied for table comments") — the "couldn't post" error.
-- Grant the trusted server role full access; RLS doesn't apply to service_role.
grant usage on schema public to service_role;
grant select, insert, update, delete on public.comments to service_role;
grant select, insert, update, delete on public.comment_likes to service_role;
grant select, insert, update, delete on public.comment_reports to service_role;
grant select, insert, update, delete on public.profiles to service_role;
