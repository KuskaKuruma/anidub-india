-- Run once in Supabase SQL Editor if profile save shows
-- "permission denied for table profiles".
--
-- Usually means setup.sql was applied before INSERT grants / insert policy
-- were added. Safe to run again.

alter table public.profiles enable row level security;

grant select, insert, update on table public.profiles to authenticated;

drop policy if exists "Create own profile" on public.profiles;
create policy "Create own profile" on public.profiles
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "Read own profile" on public.profiles;
create policy "Read own profile" on public.profiles
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "Update own profile" on public.profiles;
create policy "Update own profile" on public.profiles
  for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
