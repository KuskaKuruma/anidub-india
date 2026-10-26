-- AniDub India — Supabase setup for Google sign-in, profiles, and My List.
--
-- Paste the whole file into Supabase Dashboard → SQL Editor → Run.
-- It is safe to run more than once.
--
-- What it does:
--   1. Admins are decided by a verified email on public.admin_emails, the same
--      rule the Cloudflare version used (ADMIN_EMAILS). public.is_admin() is
--      the one check every write policy uses.
--   2. public.profiles holds the username, preferred dub language, and
--      optional phone. A row is created automatically on first sign-in.
--      Only the owner can read or change their own row. The phone number is
--      never readable by anyone else.
--   3. public.watchlist is My List: one row per person per anime.
--   4. Catalog tables: anyone can read, only admins can write.
--      recent_updates used to accept writes from anyone. That is closed here.
--   5. Sequences are moved past the highest id, so rows copied in from
--      Cloudflare with their original ids do not collide with new ones.

-- ───────────────────────────── admins ─────────────────────────────

create table if not exists public.admin_emails (
  email text primary key check (email = lower(email))
);

insert into public.admin_emails (email) values
  ('animewithkavin@gmail.com'),
  ('sivaprasath77085@gmail.com')
on conflict (email) do nothing;

-- Nobody reads this list from the browser. is_admin() reads it as its owner.
alter table public.admin_emails enable row level security;
revoke all on public.admin_emails from anon, authenticated;

-- email_confirmed_at matters: an unverified address that happens to match an
-- admin's must not grant admin. Google sign-ins arrive already verified.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
      from auth.users u
      join public.admin_emails a on a.email = lower(u.email)
     where u.id = auth.uid()
       and u.email_confirmed_at is not null
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

-- ──────────────────────────── profiles ────────────────────────────

create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade
);

alter table public.profiles add column if not exists username text;
alter table public.profiles add column if not exists preferred_language text;
alter table public.profiles add column if not exists phone text;
alter table public.profiles add column if not exists welcomed boolean not null default false;
alter table public.profiles add column if not exists created_at timestamptz not null default now();
alter table public.profiles add column if not exists updated_at timestamptz;

alter table public.profiles drop constraint if exists profiles_username_check;
alter table public.profiles drop constraint if exists profiles_username_format;
alter table public.profiles add constraint profiles_username_format
  check (username ~ '^[A-Za-z0-9_]{3,20}$');

alter table public.profiles drop constraint if exists profiles_language_valid;
alter table public.profiles add constraint profiles_language_valid
  check (preferred_language in ('Tamil', 'Telugu', 'Hindi', 'Malayalam', 'Kannada'));

-- Country code from the profile dropdown, then exactly 10 digits.
alter table public.profiles drop constraint if exists profiles_phone_valid;
alter table public.profiles add constraint profiles_phone_valid
  check (phone ~ '^\+(91|977|94|880|971|966|65|60|1|44|61|81)[0-9]{10}$');

create unique index if not exists profiles_username_lower_idx
  on public.profiles (lower(username));

alter table public.profiles enable row level security;

-- Earlier versions let anyone read every profile. Start from nothing.
do $$
declare r record;
begin
  for r in select policyname from pg_policies
            where schemaname = 'public' and tablename = 'profiles'
  loop
    execute format('drop policy if exists %I on public.profiles', r.policyname);
  end loop;
end $$;

revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
-- Column grant: the browser can change these columns and nothing else, so
-- user_id cannot be rewritten to point at someone else.
grant insert (user_id, username, preferred_language, phone, welcomed, updated_at)
  on public.profiles to authenticated;
grant update (username, preferred_language, phone, welcomed, updated_at)
  on public.profiles to authenticated;

create policy "Read own profile" on public.profiles
  for select to authenticated using (user_id = auth.uid());

-- The trigger below creates the row on sign-up. This covers anyone whose row
-- is missing, so saving the profile still works for them.
create policy "Create own profile" on public.profiles
  for insert to authenticated with check (user_id = auth.uid());

create policy "Update own profile" on public.profiles
  for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- A free username from the Google name, the same way the Cloudflare version
-- picked one: the name with only letters, digits and underscores, then the
-- name plus 2–9, then the name plus a random number, then user_ plus hex.
create or replace function public.suggest_username(source text)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  base text;
  candidate text;
  i int;
begin
  base := left(regexp_replace(split_part(coalesce(source, ''), '@', 1), '[^A-Za-z0-9_]', '', 'g'), 14);
  if length(base) < 3 then base := 'user'; end if;

  if not exists (select 1 from public.profiles where lower(username) = lower(base)) then
    return base;
  end if;
  for i in 2..9 loop
    candidate := base || i;
    if not exists (select 1 from public.profiles where lower(username) = lower(candidate)) then
      return candidate;
    end if;
  end loop;
  for i in 1..5 loop
    candidate := base || (1000 + floor(random() * 9000))::int;
    if not exists (select 1 from public.profiles where lower(username) = lower(candidate)) then
      return candidate;
    end if;
  end loop;
  return 'user_' || substr(md5(random()::text), 1, 8);
end;
$$;

revoke all on function public.suggest_username(text) from public, anon, authenticated;

-- Runs on every new account. It must never stop a sign-in, so a failure here
-- is swallowed and the person simply has no profile row until they save one.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    insert into public.profiles (user_id, username, welcomed)
    values (
      new.id,
      public.suggest_username(coalesce(
        nullif(new.raw_user_meta_data->>'username', ''),
        nullif(new.raw_user_meta_data->>'full_name', ''),
        nullif(new.raw_user_meta_data->>'name', ''),
        new.email
      )),
      false
    )
    on conflict (user_id) do nothing;
  exception when others then
    raise warning 'handle_new_user: %', sqlerrm;
  end;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

drop function if exists public.handle_new_profile();

-- Accounts that already exist (the old email-and-password logins) get a
-- profile now. They have used the site before, so they skip the welcome popup.
insert into public.profiles (user_id, username, welcomed)
select u.id,
       public.suggest_username(coalesce(
         nullif(u.raw_user_meta_data->>'username', ''),
         nullif(u.raw_user_meta_data->>'full_name', ''),
         nullif(u.raw_user_meta_data->>'name', ''),
         u.email)),
       true
  from auth.users u
 where not exists (select 1 from public.profiles p where p.user_id = u.id);

-- ──────────────────────────── watchlist ───────────────────────────

create table if not exists public.watchlist (
  user_id    uuid   not null default auth.uid() references auth.users (id) on delete cascade,
  anime_id   bigint not null references public.anime (id) on delete cascade,
  status     text   not null default 'plan_to_watch'
             check (status in ('watching', 'completed', 'plan_to_watch')),
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  primary key (user_id, anime_id)
);

create index if not exists watchlist_user_status_idx on public.watchlist (user_id, status);

alter table public.watchlist enable row level security;

do $$
declare r record;
begin
  for r in select policyname from pg_policies
            where schemaname = 'public' and tablename = 'watchlist'
  loop
    execute format('drop policy if exists %I on public.watchlist', r.policyname);
  end loop;
end $$;

revoke all on public.watchlist from anon, authenticated;
grant select, insert, update, delete on public.watchlist to authenticated;

create policy "Read own list" on public.watchlist
  for select to authenticated using (user_id = auth.uid());
create policy "Add to own list" on public.watchlist
  for insert to authenticated with check (user_id = auth.uid());
create policy "Change own list" on public.watchlist
  for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "Remove from own list" on public.watchlist
  for delete to authenticated using (user_id = auth.uid());

-- ───────────────────────────── catalog ────────────────────────────
-- Every existing policy on these tables is dropped, then public read and
-- admin write are put back. That also removes the old "Allow all writes"
-- policy on recent_updates and the policies tied to the public.users list.

do $$
declare r record;
begin
  for r in select policyname, tablename from pg_policies
            where schemaname = 'public'
              and tablename in ('anime', 'seasons', 'dubs', 'recent_updates', 'submissions')
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

alter table public.anime          enable row level security;
alter table public.seasons        enable row level security;
alter table public.dubs           enable row level security;
alter table public.recent_updates enable row level security;
alter table public.submissions    enable row level security;

create policy "Anyone can read anime" on public.anime for select using (true);
create policy "Admins write anime" on public.anime for all
  using (public.is_admin()) with check (public.is_admin());

create policy "Anyone can read seasons" on public.seasons for select using (true);
create policy "Admins write seasons" on public.seasons for all
  using (public.is_admin()) with check (public.is_admin());

create policy "Anyone can read dubs" on public.dubs for select using (true);
create policy "Admins write dubs" on public.dubs for all
  using (public.is_admin()) with check (public.is_admin());

create policy "Anyone can read updates" on public.recent_updates for select using (true);
create policy "Admins write updates" on public.recent_updates for all
  using (public.is_admin()) with check (public.is_admin());

-- Public "Add a Dub" form. A visitor can only file a pending submission.
create policy "Anyone can submit a dub" on public.submissions
  for insert with check (coalesce(review_status, 'pending') = 'pending');
create policy "Admins read submissions" on public.submissions
  for select using (public.is_admin());
create policy "Admins update submissions" on public.submissions
  for update using (public.is_admin()) with check (public.is_admin());
create policy "Admins delete submissions" on public.submissions
  for delete using (public.is_admin());

-- Poster uploads from the admin panel go to the public "posters" bucket.
drop policy if exists "Admins upload posters" on storage.objects;
create policy "Admins upload posters" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'posters' and public.is_admin());
drop policy if exists "Admins replace posters" on storage.objects;
create policy "Admins replace posters" on storage.objects
  for update to authenticated
  using (bucket_id = 'posters' and public.is_admin())
  with check (bucket_id = 'posters' and public.is_admin());
drop policy if exists "Admins delete posters" on storage.objects;
create policy "Admins delete posters" on storage.objects
  for delete to authenticated
  using (bucket_id = 'posters' and public.is_admin());

-- ──────────────────────────── sequences ───────────────────────────
-- Called here and again by migrate/from-cloudflare.mjs after it copies rows.

create or replace function public.sync_id_sequences()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  t text;
  seq text;
  col text;
begin
  foreach t in array array['anime', 'seasons', 'dubs', 'submissions', 'recent_updates'] loop
    col := case when t = 'recent_updates' then 'updates_id' else 'id' end;
    seq := pg_get_serial_sequence('public.' || t, col);
    if seq is not null then
      execute format('select setval(%L, greatest((select coalesce(max(%I), 0) from public.%I), 1))',
                     seq, col, t);
    end if;
  end loop;
end;
$$;

revoke all on function public.sync_id_sequences() from public, anon, authenticated;
grant execute on function public.sync_id_sequences() to service_role;

select public.sync_id_sequences();
