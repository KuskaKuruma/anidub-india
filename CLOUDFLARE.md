# Move to Cloudflare when Supabase Free is full

Do this only after the AniDub India Supabase project outgrows the Free plan. Until then, stay on Supabase. Login and watchlists fit on Free (about 50,000 people a month, 500 MB database).

Checked against the usage page on 19 Oct 2026: database 0.028 GB of 0.5 GB, file storage under 1 GB, egress 0.113 GB of 5 GB, 2 monthly users. Organization: AniDub India, project `xmnzvscwalwfvfyjwtqz`.

## When to move

Move when any of these is true for a whole billing cycle, not for a single spike:

- Database size stays near **500 MB**.
- Monthly active users stay near **50,000**.
- Egress stays near **5 GB**, or cached egress near **5 GB**.
- The project is paused so often that a weekly keep-alive is not enough.

Do not move just to avoid the $25 Supabase Pro plan. Cloudflare Workers Paid is $5 a month and has no data-transfer fee, but the site has to be rebuilt first. Supabase Free already serves the pages directly. Cloudflare D1 does not.

## What moves, and what does not

| Data | Move |
|---|---|
| `anime`, `seasons`, `dubs`, `submissions`, `recent_updates`, `profiles` | Export and import |
| Poster files in the `posters` bucket | Copy to Cloudflare R2. Almost every cover is an AniList URL in `poster_url` and does not need copying |
| Logins (email and password) | Do **not** export password hashes. Keep Auth on Supabase, or ask each person to set a password once on the new system. See below |
| Row Level Security policies | Rewrite them inside the Worker. D1 has no Supabase Auth and no policies the browser can use |

`genre` is a Postgres text array. Store it as a JSON text column in D1. `recent_updates` uses `updates_id`, not `id`. Keep that name or update every query that reads it.

## How accounts stay smooth

Copying `auth.users.encrypted_password` into D1 is not the plan. Those hashes are not meant to leave Supabase, a CSV of them is a leak risk, and a home-grown login on a Worker is easy to get wrong.

**Preferred: keep Auth on Supabase.** Move only the catalog, posters, and `profiles` to Cloudflare. The site still signs people in with Supabase Auth. Email and password never move. Usernames stay linked by the same `user_id`. This is the smooth path.

**If Auth must leave Supabase later:** export only `id` and `email` (no passwords). Create matching accounts on the new login system with those emails, keep the same ids so `profiles` still match, and send a one-time “set your password” mail. People use the same email; they choose a password once. That is slower for visitors than the hybrid path, but it is honest and safe.

Do not store passwords in `profiles` or any public table now. That would not help a future move.

## Order of work

1. **Add a Worker in front of D1.** The library, anime page, schedule, submit form, and admin panel all call `supabaseClient.from(...)` in the browser. Each of those calls becomes a request to the Worker. Static files can stay on GitHub Pages or move to Cloudflare Pages. Pages alone cannot read D1.
2. **Create the D1 tables** with the same columns the pages use today. See [PROJECT.md](PROJECT.md) for the live shape. Treat that file as newer than older notes in it (`poster_path` is not a real column; `dubs` has `notes` and `episodes_dubbed`).
3. **Export from Supabase.** From the SQL editor: `copy` each table to CSV, or use the dashboard table export. Import with `wrangler d1 execute`.
4. **Copy the one stored poster** (`posters/51.webp`, about 125 KB) into an R2 bucket. Leave AniList `poster_url` values unchanged.
5. **Point the site at the Worker** only after a local copy of the library, an anime page, and an admin save all succeed against D1.
6. **Keep Supabase read-only for a week** so a bad import can be re-exported. Then pause the Supabase project.

## Free versus paid on Cloudflare

Workers Free is enough for the copy itself: 500 MB per D1 database, 5 GB across the account, 5 million row reads a day, 100,000 row writes a day. Over the daily cap, queries fail until midnight UTC. R2 includes 10 GB of files with no transfer fee.

Workers Paid ($5 a month) is the plan to turn on if daily reads or writes hit those caps, or one database needs more than 500 MB. It includes 5 GB of D1 storage, then $0.75 per GB, up to 10 GB per database, and 10 million Worker requests a month. It still does not include user accounts. Keep Supabase Auth Free for logins until that part is replaced on purpose.

## What not to do in the same change

- Do not rebuild login during the catalog move. Leave Auth on Supabase until the library and anime pages work on Cloudflare.
- Do not export or copy password hashes into D1, CSVs, or git.
- Do not commit API tokens, the Supabase service role key, or Cloudflare API tokens.
- Do not delete the Supabase project in the same week as the import.
