-- Undo the season episode_count / notes columns (run once in SQL Editor).
-- Safe to re-run. Episodes and notes live on dubs, not seasons.

alter table public.seasons drop column if exists episode_count;
alter table public.seasons drop column if exists notes;
