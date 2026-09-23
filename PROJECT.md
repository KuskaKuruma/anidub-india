# AniDub India — Project Reference

A community-driven directory of Indian-language anime dubs, plus a weekly anime airing schedule in IST.

Import this file into any AI tool or editor to get full context on the codebase and make changes confidently.

---

## 1. Quick facts

| | |
|---|---|
| **Stack** | Static HTML + CSS + vanilla JS. No build step, no framework, no bundler. |
| **Backend** | Supabase (PostgreSQL + Storage + Auth) |
| **Hosting** | GitHub Pages — `https://kuskakuruma.github.io/anidub-india/` |
| **Repo** | `github.com/KuskaKuruma/anidub-india` (branch: `main`) |
| **Local path** | `/Users/siva-22834/Documents/website` |
| **Deploy** | `git push origin main` → GitHub Pages rebuilds in ~1 min |
| **External APIs** | AniList GraphQL (`https://graphql.anilist.co`), Google Forms (feedback) |

**There is no dev server.** Open any `.html` file directly in a browser to test. Supabase calls work from `file://` because the anon key is public and RLS is read-only.

---

## 2. File map

| File | Lines | Purpose |
|---|---|---|
| `index.html` | ~926 | **Dub Library** — homepage. Anime grid, filters, search, pagination, Recent Updates, feedback box. |
| `schedule.html` | ~728 | **Airing Now** — weekly anime schedule from AniList in IST. 7-day desktop grid / 3-day mobile slider. |
| `anime.html` | ~406 | Anime detail page. Read via `?id=<anime.id>`. Shows synopsis, seasons, dub table. |
| `submit.html` | ~412 | **Add a Dub** — public submission form → `submissions` table. |
| `admin.html` | ~1340 | Admin dashboard. Auth-gated CRUD for anime / seasons / dubs / submissions / recent updates. |
| `feedback.html` | ~136 | Standalone feedback page (Google Form iframe). Not linked in main nav. |
| `supabase-config.js` | 6 | Supabase URL + anon key, creates `window.supabaseClient`. |
| `fix-mal-ids.js` | 145 | **One-off Node script.** Fixes wrong MAL IDs + backfills posters from AniList. Not part of the site. |
| `_headers` | — | Cache-Control rules (Netlify-style; ignored by GitHub Pages). |

Directories `old/`, `Plan/`, `Dub Data/` are gitignored scratch/archive.

---

## 3. Architecture

Every page is **fully self-contained**: its own `<style>` block in `<head>`, its own `<script>` block before `</body>`. The only shared file is `supabase-config.js`.

```
┌─────────────────────────────────────────────────┐
│  Each .html page                                │
│  ┌───────────────┐                              │
│  │ <style>       │  full CSS, :root vars copied │
│  ├───────────────┤                              │
│  │ <nav>         │  hand-copied on every page   │
│  ├───────────────┤                              │
│  │ page content  │                              │
│  ├───────────────┤                              │
│  │ <script>      │  fetch → render → DOM        │
│  └───────────────┘                              │
└──────────────┬──────────────────────────────────┘
               │
   ┌───────────▼──────────┐    ┌──────────────────┐
   │ supabase-config.js   │    │ AniList GraphQL  │
   │ window.supabaseClient│    │ (schedule.html + │
   └───────────┬──────────┘    │  poster fallback)│
               │               └──────────────────┘
      ┌────────▼────────┐
      │    Supabase     │
      │ Postgres+Storage│
      └─────────────────┘
```

**Consequence of this design:** there is no shared CSS or nav component. A nav change or a color change must be applied to **every page separately**. See §8.

---

## 4. Database schema (Supabase)

Project URL: `https://xmnzvscwalwfvfyjwtqz.supabase.co`

### `anime`
Primary catalog table.

| Column | Type | Notes |
|---|---|---|
| `id` | int8 PK | |
| `title` | text | Required. English/romaji title. |
| `japanese_title` | text | Nullable |
| `mal_id` | int | MyAnimeList ID. Used for AniList poster lookup. |
| `type` | text | TV / Movie / OVA / ONA / Special |
| `status` | text | `active` etc. Schedule dub-matching filters on `active`. |
| `year` | int | Required |
| `total_episodes` | int | Defaults 0 |
| `poster_url` | text | External poster URL (usually AniList CDN) |
| `poster_path` | text | Supabase Storage path, e.g. `posters/12.jpg` |
| `synopsis` | text | Nullable |
| `genre` | text[] | Postgres array. Queried with `.contains('genre', [genre])` |
| `created_at` | timestamptz | Used for `recently_added` sort |

### `seasons`
| Column | Type | Notes |
|---|---|---|
| `id` | int8 PK | |
| `anime_id` | int8 FK → anime.id | |
| `season_number` | int | |
| `season_name` | text | e.g. "Season 1" |

Creating an anime in admin auto-creates "Season 1".

### `dubs`
One row per (anime, language).

| Column | Type | Notes |
|---|---|---|
| `id` | int8 PK | |
| `anime_id` | int8 FK | |
| `season_id` | int8 FK → seasons.id | Nullable |
| `language` | text | Hindi / Tamil / Telugu / Malayalam / Kannada |
| `platform` | text | Crunchyroll / Netflix / Disney+ Hotstar / Amazon Prime Video / Sony LIV / Zee5 / JioCinema / Other |
| `status` | text | Complete / Partial / Ongoing / Removed |
| `added_date` | date | |

### `submissions`
Public form submissions from `submit.html`.

| Column | Type | Notes |
|---|---|---|
| `id` | int8 PK | |
| `anime_title` | text | |
| `season`, `year` | text | Nullable |
| `languages` | text[] or text | |
| `dub_status` | text | |
| `episodes_dubbed` | text | Nullable |
| `notes` | text | Nullable |
| `submitter_name`, `submitter_email` | text | Nullable |
| `review_status` | text | `pending` \| `approved` \| `rejected`. Inserted as `pending`. |

### `recent_updates`
Manually curated site news shown on the homepage.

| Column | Type | Notes |
|---|---|---|
| `updates_id` | bigint PK identity | **Note the non-standard name** — not `id` |
| `title` | text | Required. Short headline. |
| `link` | text | Nullable. If set, the row becomes a clickable `<a>`. |
| `created_at` | timestamptz | `default now()`. Sort key (desc). |

DDL:
```sql
create table recent_updates (
  updates_id bigint generated always as identity primary key,
  title text not null,
  link text,
  created_at timestamptz default now()
);
alter table recent_updates enable row level security;
create policy "Public read" on recent_updates for select using (true);
create policy "Allow all writes" on recent_updates for all using (true) with check (true);
```

### Storage: `posters` bucket
Public bucket. Files at `posters/<anime_id>.<ext>`, uploaded with `upsert: true`.
Read via `supabaseClient.storage.from('posters').getPublicUrl(path)`.

### RLS model
- **Anon key** (in `supabase-config.js`, safe to commit): SELECT only on public tables; INSERT on `submissions`; full access on `recent_updates`.
- **Admin writes** go through Supabase Auth — `admin.html` calls `signInWithPassword`, and the authenticated session carries write permission.
- **Service role key**: only used by the local `fix-mal-ids.js` script. Never put it in an `.html` file.

---

## 5. Page details

### `index.html` — Dub Library

**Key functions:**
| Function | Role |
|---|---|
| `fetchAnime({lang,genre,type,status,sort,search,page})` | Main query builder. Language filter does a pre-query on `dubs` to get matching `anime_id`s, then `.in('id', dubIds)`. |
| `fetchDubsForAnime(ids)` | Batch-fetch languages per anime → `{anime_id: Set<language>}` for the card badges. |
| `fetchWithCache(params)` | In-memory cache keyed by `JSON.stringify(params)`. Cleared on reload. |
| `posterUrl(anime)` | `poster_path` (Storage) → `poster_url` → null. |
| `fillMissingPosters(list)` | AniList fallback. See below. |
| `renderCard(anime, dubSet)` | One grid card. |
| `renderPagination(total)` | `PAGE_SIZE` per page. |
| `loadUpdates()` | Fetches top 10 from `recent_updates`. |
| `submitFeedback()` | Builds prefilled Google Form URL, opens in new tab. |

**Sort options** → column map:
```js
recently_added: created_at desc   // default
title_asc / title_desc:  title
year_desc / year_asc:    year
```

**AniList poster fallback (`fillMissingPosters`)**
Runs after the grid renders, for anime with no local poster but a `mal_id`.
- Batches of 5, aliased GraphQL fields (`a0:`, `a1:`, …) to stay under rate limits.
- Looks up **by `idMal` only** — title search returned wrong anime too often.
- Verifies the returned AniList title matches ours before applying the image:
  ```js
  const normalize = s => (s||'').toLowerCase().replace(/[^a-z0-9]/g,'');
  ```
  Accepts exact match or either-direction substring match. Skips on mismatch.
- `renderCard` emits a hidden `<img class="poster-anilist" style="display:none">` placeholder for cards without a poster; this function fills and un-hides it.

### `schedule.html` — Airing Now

Pulls **all** currently-airing anime episodes for a week from AniList. Not dub-specific — it's the Japanese broadcast schedule, converted to IST.

**Key functions:**
| Function | Role |
|---|---|
| `getWeekBounds(offset)` | Mon 00:00 → Sun 23:59 for `weekOffset` (0 = current week) |
| `fetchSchedule(start, end)` | Paginated AniList query. **Must paginate** — see note below. |
| `toIST(unixSec)` | `toLocaleTimeString('en-IN', {timeZone:'Asia/Kolkata', hour12:true})` |
| `istDayIndex(unixSec)` | Returns 0=Mon … 6=Sun **in IST**, not local time |
| `fetchDubbedTitles()` | Titles from our `anime` table (status=active) → Set, for the dub badge |
| `updateSlider()` / `initSlider()` | Mobile 3-day slider |

**Pagination is mandatory.** A single 100-entry fetch silently truncates later days (Saturday alone can have 25 episodes). The loop:
```js
while (true) {
  // ...fetch page N with perPage: 50
  all.push(...(pageData.airingSchedules ?? []));
  if (!pageData.pageInfo?.hasNextPage) break;
  page++;
  if (page > 10) break; // safety cap
}
```

**Timezone rule:** never use `getDay()` on a raw `Date` for day bucketing. Always go through `istDayIndex()`, which reconstructs the date in `Asia/Kolkata` first:
```js
const ist = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
return (ist.getDay() + 6) % 7; // shift Sun=0 → Mon=0
```

**Day colors** (`:root`, Mon→Sun):
```css
--d0: #3b82f6;  /* Mon  blue    */
--d1: #f97316;  /* Tue  orange  — deliberately NOT purple, that's the site accent */
--d2: #10b981;  /* Wed  emerald */
--d3: #f59e0b;  /* Thu  amber   */
--d4: #ef4444;  /* Fri  red     */
--d5: #ec4899;  /* Sat  pink    */
--d6: #06b6d4;  /* Sun  cyan    */
```
Applied via `.day-col[data-day="N"] { --day-color: var(--dN); border-top: 3px solid var(--dN); }`.

**Responsive:** two mutually exclusive breakpoints.
- `@media (max-width: 768px)` — `.week-grid` becomes `display:flex`, each `.day-col` is `calc((100vw - 32px - 16px)/3)` wide with `margin-right: 8px`. `translateX` slides it. Defaults to today centred (`daySliderStart = clamp(todayIdx-1, 0, 4)`).
- `@media (min-width: 769px)` — explicitly restores `display:grid`, `repeat(7, minmax(160px,1fr))`, `transform: none !important`. **This override block is required** — without it the mobile flex rules leak onto desktop.

`initSlider()` is called at the **end of `render()`**, after columns exist. Calling it earlier measures `offsetWidth` as 0.

### `anime.html` — Detail page

Reads `?id=` from the URL. Fires three parallel queries (`anime`, `seasons`, `dubs`) then renders in one `innerHTML` pass. Renders a dub table grouped by language with platform + status.

### `submit.html` — Add a Dub

Public form → `submissions` with `review_status: 'pending'`.
Deliberately **does not** collect MAL URL, platform, or stream link — those are filled in by the admin.

### `admin.html` — Dashboard

Auth: `supabaseClient.auth.signInWithPassword({email, password})`. `checkAuth()` on load shows either `#loginScreen` or the dashboard.

Sidebar → panel mapping via `showPanel(name)`, which toggles `.panel.active` and lazy-loads data:

| Sidebar group | Button | Panel id | Loads |
|---|---|---|---|
| Anime | + Add Anime | `panel-addAnime` | — |
| Anime | Browse / Edit | `panel-listAnime` | `renderAnimeList(animeCache)` |
| Seasons & Dubs | + Add Season | `panel-addSeason` | `populateAnimeSelects()` |
| Seasons & Dubs | + Add Dub | `panel-addDub` | `populateAnimeSelects()` |
| Seasons & Dubs | Browse Dubs | `panel-listDubs` | `loadDubsList()` |
| Community | Submissions | `panel-submissions` | `loadSubmissions()` |
| Site | Recent Updates | `panel-recentUpdates` | `loadRecentUpdates()` |

**Submissions workflow:**
`pending` → Approve / Reject → approved rows get a "→ Add to Database" button that calls `prefillFromSubmission(s)`, which fills the Add Anime form and switches panels. Status stays `approved`; there is intentionally no separate "added to DB" state.

Filter tabs (`setSubFilter`) — All / Yet to Review / Approved / Rejected. Data cached in `_subsData`; `renderSubmissions()` re-renders from cache without refetching.

**Recent Updates CRUD:**
`addRecentUpdate()`, `saveRuEdit(id)`, `deleteRecentUpdate(id)` (with `confirm()`), plus inline-form toggles `showRuEditForm(id)` / `hideRuEditForm(id)`. Each row has a `-view` div and a hidden `-form` div, ids prefixed `ru-edit-<updates_id>`. Edit swaps their `display`. **All queries key on `updates_id`, not `id`.**

`GENRES` array (line ~634) drives the genre checkbox grid. Add a genre there and it appears in the form; it also needs to exist in the filter list in `index.html`.

---

## 6. Design system

Copied verbatim into the `:root` of every page:

```css
--bg:          #0d0d14;   /* page background        */
--surface:     #16161f;   /* cards, nav             */
--surface2:    #1e1e2c;   /* inputs, nested cards   */
--border:      #2a2a3d;
--accent:      #7c3aed;   /* purple — brand color   */
--accent-hover:#6d28d9;
--accent-soft: rgba(124,58,237,0.15);
--text:        #e2e2f0;
--text-muted:  #8888aa;
--green:       #22c55e;   /* Complete / success     */
--yellow:      #eab308;   /* Partial / pending      */
--red:         #ef4444;   /* Removed / error        */
--card-w:      180px;     /* 150px under 600px      */
```

**Conventions**
- Dark theme only. No light mode.
- Radii: 8px controls, 10–12px cards, 999px pills.
- Borders: `1px solid var(--border)`; hover → `var(--accent)`.
- Font: system stack — `-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`.
- Icons: inline SVG, `stroke="currentColor"`, `stroke-width="2.5"`. No icon library.
- Breakpoints: `768px` (schedule slider, layout) and `600px` (padding, card width).

**Time pill** (schedule cards) — sits *below* the poster, never overlaid, so it stays readable on any artwork:
```css
background: rgba(255,255,255,0.1);
border: 1px solid rgba(255,255,255,0.22);
color: #f1f5f9;
border-radius: 999px;
```
White/neutral was chosen over accent purple and colored variants for contrast against arbitrary poster art.

---

## 7. Navigation

Three links, identical on every public page. The current page gets `class="active"`.

```html
<nav>
  <a class="nav-logo" href="index.html">AniDub<span> India</span></a>
  <div class="nav-links">
    <a href="index.html">Dub Library</a>
    <a href="schedule.html">Airing Now</a>
    <a href="submit.html">Add a Dub</a>
  </div>
</nav>
```

`admin.html` has its own nav (logo + ADMIN badge + Log out). `feedback.html` is not linked from the nav.

---

## 8. How to make changes

### Golden rules
1. **No build step.** Edit the `.html`, open it in a browser, verify, commit, push.
2. **Changes to nav, colors, or shared UI must be repeated in every affected file.** There is no shared stylesheet. Grep before you assume one edit is enough:
   ```bash
   grep -l "nav-links" *.html
   ```
3. **Never commit the service role key.** Only the anon key belongs in `supabase-config.js`.
4. Verify visually before pushing — most bugs here are layout bugs.

### Add a nav link
Edit the `.nav-links` block in `index.html`, `schedule.html`, `anime.html`, `submit.html` — four files.

### Change a color
Edit `:root` in each page that uses it. `--accent` appears in all of them.

### Add a new field to an anime
1. `ALTER TABLE anime ADD COLUMN ...` in the Supabase SQL editor.
2. `admin.html`: add the input to the Add Anime panel, add it to the `row` object in `saveAnime()`, and to `updateAnime()` + `openEditModal()`.
3. `anime.html`: render it in `renderPage()`.
4. `index.html`: only if it should appear on cards or in filters.

### Add a new admin panel
1. Sidebar button: `<button class="sidebar-btn" onclick="showPanel('myPanel')">Label</button>`
2. Panel div: `<div class="panel" id="panel-myPanel">…</div>`
3. Lazy load inside `showPanel()`: `if (name === 'myPanel') loadMyPanel();`

### Add a language
Languages are hardcoded as `<option>`/checkbox values (Hindi, Tamil, Telugu, Malayalam, Kannada). Update: `admin.html` (Add Anime dub checkboxes, Add Dub select), `submit.html` (language checkboxes), `index.html` (language filter chips + `langColor()`).

### Find a Google Form entry ID
Needed when the feedback form gains a field. Entry IDs are **not** guessable — extract them:
```bash
curl -sL --user-agent "Mozilla/5.0" "https://docs.google.com/forms/d/e/<FORM_ID>/viewform" \
  | python3 -c "
import sys, re
m = re.search(r'FB_PUBLIC_LOAD_DATA_ = (.+?);\s*</script>', sys.stdin.read(), re.DOTALL)
print(m.group(1)[:3000] if m else 'not found')
"
```
Output shape: `[<question_id>,"<Label>",null,<type>,[[<ENTRY_ID>,null,<required>]],…]` — the number inside the nested array is the `entry.` value.

Current form (`1FAIpQLSfQK4kizZDcGZ11ajUAl71oC-ETQO-Ly7kdnjNB2hDP6Z0EzQ`):

| Field | Entry ID |
|---|---|
| Your Name or Insta ID | `entry.324713195` |
| Email Id | `entry.1871173715` |
| Feedback suggestion | `entry.457199079` |

Prefill URL pattern:
```
https://docs.google.com/forms/d/e/<FORM_ID>/viewform?entry.A=<val>&entry.B=<val>
```
`submitFeedback()` in `index.html` and `schedule.html` builds this and calls `window.open(url, '_blank')`. The user still clicks Submit on the form itself.

### Deploy
```bash
git add <files> && git commit -m "message" && git push origin main
```
GitHub Pages picks it up in about a minute. There is no staging environment.

---

## 9. Gotchas

| Gotcha | Detail |
|---|---|
| **`recent_updates` PK is `updates_id`** | Every `.eq()` / `.delete()` must use `updates_id`, not `id`. |
| **AniList pagination** | Without the `hasNextPage` loop, later days in the week silently lose episodes. |
| **IST day bucketing** | `getDay()` on a raw Date uses the browser's timezone. Use `istDayIndex()`. |
| **`position: sticky` + `overflow: hidden`** | Sticky day headers broke inside `.day-col` (which has `overflow:hidden`) — poster images rendered over the header text. Sticky was removed. Don't reintroduce it. |
| **Mobile/desktop CSS leakage** | The `@media (min-width: 769px)` block in `schedule.html` must explicitly reset `display`, `grid-template-columns`, and `transform`. |
| **`initSlider()` ordering** | Must run after columns are in the DOM, or `offsetWidth` reads 0. |
| **AniList by title is unreliable** | Always look up by `idMal` and verify the returned title before using the image. |
| **AniList rate limits** | Batch requests (5 aliased queries per call in the browser); ~1200ms between calls in Node scripts. |
| **Supabase SDK on Node 18** | `@supabase/realtime-js` needs native WebSocket (Node 22+). `fix-mal-ids.js` therefore uses the REST API via plain `fetch()`. |
| **Google Form entry IDs** | Not sequential, not guessable. Always extract from `FB_PUBLIC_LOAD_DATA_`. |
| **No offline/demo fallback** | Every page assumes Supabase is reachable. There was a `DEMO_MODE` seed-data path; it was permanently unreachable and was removed (Sep 2026). If a no-backend mode is ever wanted again, it needs rebuilding — don't expect a fallback to exist. |

---

## 10. Maintenance script: `fix-mal-ids.js`

Local Node script, **not** part of the deployed site and **not** committed (it holds a service role key).

Run: `node fix-mal-ids.js`

What it does: pulls `anime` rows where `poster_url IS NULL`, searches AniList by title, verifies the match, then writes back `mal_id` and `poster_url`. Uses Supabase REST + `fetch()` (see gotcha above), 1200ms between requests, filtering to `poster_url=is.null` so reruns stay small.

All 51 anime currently have correct `mal_id` and `poster_url`. Rerun only after adding anime without posters.

---

## 11. Security note

The `origin` remote currently embeds a GitHub personal access token in the URL:
```
https://KuskaKuruma:ghp_***@github.com/KuskaKuruma/anidub-india.git
```
It sits in `.git/config` in plaintext. Consider rotating that token and switching to SSH or the `gh` credential helper:
```bash
git remote set-url origin git@github.com:KuskaKuruma/anidub-india.git
```
