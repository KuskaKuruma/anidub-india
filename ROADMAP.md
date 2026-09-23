# AniDub India — Roadmap

Where the project stands and what comes next. Pairs with [PROJECT.md](PROJECT.md), which documents how the code works today.

> **Status legend:** ✅ done · 🔶 partial · ❌ not started · ↩️ changed from the original plan
>
> Items marked **(proposed)** have not been agreed — they're candidates, not commitments. Reprioritise freely.

---

## Where we are

**Live:** `https://kuskakuruma.github.io/anidub-india/`
**Content:** 51 anime, all with correct `mal_id` and poster
**Languages:** Hindi, Tamil, Telugu, Malayalam, Kannada

Phase 1 is functionally complete. Phase 2 is roughly half done. One significant unplanned feature — the weekly airing schedule — was built and shipped on top.

---

## Phase 1 — Foundation ✅ complete

| Item | Status | Notes |
|---|---|---|
| Supabase project + core tables | ✅ | `anime`, `seasons`, `dubs` |
| Row Level Security policies | ✅ | Anon read-only; admin writes via Supabase Auth |
| Storage bucket for posters | ✅ | `posters/<anime_id>.<ext>` |
| Homepage: search + language + genre filters | ✅ | |
| Pagination | ✅ | `PAGE_SIZE = 24` |
| Anime detail view (seasons + dubs) | ✅ | `anime.html?id=` |
| Admin panel with CRUD | ✅ | |
| Recent updates feed | ↩️ | **Changed.** Plan said auto-generate from `dubs`. Built instead as a manual `recent_updates` table with its own admin CRUD — gives editorial control over wording and lets updates link anywhere, not just to an anime page. |
| JS data cache | 🔶 | `fetchWithCache` exists but has no TTL and no eviction — it's an unbounded in-memory map, cleared only on reload. Plan called for 5-minute expiry. |
| `loading="lazy"` on posters | ✅ | |
| `_headers` cache rules | ↩️ | File exists but is Netlify-format. **GitHub Pages ignores it** — it's currently dead weight. Only becomes live if we move to Cloudflare Pages (Phase 3). |
| Deploy to GitHub Pages | ✅ | |
| Community submissions | ↩️ | Plan said Google Forms. Built a native `submit.html` → `submissions` table with an admin review queue instead. Google Forms is now used only for feedback. |
| Seed 50–100 anime | ✅ | 51 entries |

---

## Shipped but unplanned

Built after the original plan was written:

- **Weekly airing schedule** (`schedule.html`) — all currently-airing anime for a week from AniList, converted to IST. 7-column desktop grid, 3-day mobile slider, per-day colour coding, "Indian dub available" badges matched against our own DB.
- **AniList poster fallback** — anime with a `mal_id` but no stored poster get one pulled from AniList at render time, with title verification before the image is applied.
- **Feedback prefill boxes** — inline name/email/feedback fields on the Dub Library and Airing Now pages that open a pre-populated Google Form.
- **`fix-mal-ids.js`** — one-off maintenance script that corrected wrong MAL IDs across all 51 anime and backfilled posters.

---

## Phase 2 — Growth features 🔶 in progress

| Item | Status | Notes |
|---|---|---|
| Combined filtering (language + genre + type + status) | ✅ | |
| Sort options | 🔶 | Four implemented: recently added, A–Z, Z–A, year ↑/↓. **"Most languages available" not built** — would need a count aggregate over `dubs`. |
| Shareable per-anime URLs | ✅ | |
| Full updates / changelog page | ❌ | Homepage shows only the latest 10. No archive page. |
| Bulk import for admin (CSV) | ❌ | Currently one anime at a time. This is the main bottleneck for getting past 51 entries. |
| Image optimisation (WebP on upload) | ❌ | Uploads are stored as-is. |
| Mobile responsive pass | 🔶 | Schedule page has a dedicated mobile slider. Library and detail pages are responsive but haven't had a deliberate audit. |
| Posters into Supabase Storage | 🔶 | Most anime currently point at AniList CDN URLs rather than our own bucket. Works, but we don't control those URLs. |

### Suggested Phase 2 order

1. **Bulk import (CSV)** — biggest unblocker. 51 → 500 anime is the single highest-impact change to the site, and it's gated on data entry speed.
2. **Full updates page** — small, and makes the `recent_updates` table worth more.
3. **"Most languages" sort** — cheap, and surfaces the site's most complete entries.
4. **Mobile audit** on Library + Detail.
5. **Poster ownership** — decide whether to mirror AniList images into our bucket. Trade-off: storage cost and a migration script vs. dependency on an external CDN we don't control.

---

## Phase 3 — Domain, SEO, scale ❌ not started

| Item | Status | Notes |
|---|---|---|
| Custom domain + Cloudflare Pages | ❌ | ~₹800/year. Also makes `_headers` live. |
| SEO: sitemap, structured data | 🔶 | Basic OG tags exist on `index.html` only. No `sitemap.xml`, no JSON-LD, no per-anime OG tags. |
| PWA (installable, offline shell) | ❌ | |
| Analytics | ❌ | No analytics of any kind today — we have no visibility into what people actually use. |
| English + Bengali filters | ❌ | Languages are hardcoded in four files. See PROJECT.md §8. |
| Performance audit | ❌ | |
| Social presence | ❌ | |

**Worth pulling forward:** per-anime Open Graph tags and analytics. OG tags directly affect how links look when shared, which matters for a community site. Analytics would tell us whether the schedule page or the library is the real draw — that should shape Phase 4.

---

## Phase 4 — User accounts ❌ not started

Unchanged from the original plan. Existing tables stay untouched; adds `watchlist` and `reviews`.

- Supabase Auth signup/login (Google, email)
- Personal watchlist: Watching / Completed / Plan to watch
- Per-dub ratings — rate the Tamil dub separately from the Hindi one
- Notifications when a watchlist anime gets a new dub
- In-app submissions with moderation (replacing the current form)
- Public user profiles

**Gate:** don't start this until Phase 2's content problem is solved. Watchlists over 51 anime aren't compelling; watchlists over 500 are.

---

## Technical debt

Real issues in the current codebase, roughly by cost-of-inaction.

### 1. No shared CSS or nav component
Every page carries its own full `<style>` block and a hand-copied `<nav>`. A nav change is four edits; a colour change is five. This is the single largest ongoing tax on making changes.

**Options:** extract a `styles.css` plus a small `nav.js` that injects the markup — keeps the no-build-step constraint. Or accept the duplication and lean on grep. Worth deciding explicitly rather than drifting.

### 2. Dead `DEMO_MODE` branches
`window.DEMO_MODE` is `true` only when `SUPABASE_URL === 'YOUR_SUPABASE_URL'` — it has been permanently `false` since the real URL was set. Every `if (window.DEMO_MODE)` branch across `index.html`, `anime.html`, and `submit.html` is unreachable, along with the `data/seed.js` dependency. Removing it would meaningfully shrink the files.

### 3. GitHub token in the git remote (security)
`.git/config` has a personal access token embedded in the `origin` URL in plaintext. Rotate it and switch to SSH:
```bash
git remote set-url origin git@github.com:KuskaKuruma/anidub-india.git
```

### 4. Orphaned `feedback.html`
Not linked from any nav, and duplicated by the inline feedback boxes on the Library and Schedule pages. Either link it or delete it.

### 5. Dead `_headers` file
Netlify format; GitHub Pages does not read it. Harmless, but misleading — it looks like caching is configured when it isn't. Keep it only as preparation for a Cloudflare move, and note that in the file.

### 6. Dub matching on the schedule is title-based
`hasDub()` lowercases titles and compares strings against our `anime` table. Fragile — punctuation, season suffixes, and English-vs-romaji differences all cause misses. Storing `anilist_id` on `anime` and matching on ID would make this exact. Low effort, clear correctness win.

### 7. `showPanel()` relies on the implicit global `event`
`admin.html` uses `event.currentTarget` inside `showPanel()`. Works for click handlers, breaks if the function is ever called programmatically. Pass the element in instead.

### 8. Search covers `title` only
`ilike` on `title` — doesn't search `japanese_title`, and has no synonym or alias handling. Someone searching "Shingeki no Kyojin" won't find "Attack on Titan".

### 9. No duplicate detection on submissions
Nothing stops the same anime being submitted repeatedly, and the admin has no "this already exists" hint when reviewing.

---

## Ideas (proposed)

Not scheduled. Listed so they aren't lost.

- **Filter the schedule to dubbed anime only** — a toggle to show just anime with an Indian dub. Directly ties the two halves of the site together.
- **Show airing schedule on the anime detail page** for ongoing series.
- **"New in your language" view** — recent dubs filtered to one language, the closest thing to a personalised feed without accounts.
- **RSS / JSON feed for recent updates** — cheap, and useful for anyone wanting to syndicate.
- **Dub quality notes** — a short editorial line on notable dubs (good cast, censored, etc.). Distinct from Phase 4 user ratings.
- **Platform availability warnings** — flag dubs that were removed from a platform.
- **Admin bulk operations** — multi-select for status changes on the dubs list.
- **Keyboard navigation** on the library grid.

---

## Open questions

Decisions that will shape the phases above:

1. **Posters — ours or AniList's?** Mirroring into Supabase Storage costs space and needs a migration, but removes an external dependency. Currently drifting toward AniList by default rather than by decision.
2. **Shared CSS — extract or accept?** Tech debt item 1. Affects every future UI change.
3. **What's the content ceiling?** The plan targets 500–1000 anime. At 51, with manual entry, bulk import is the gate. Is CSV import enough, or should we pull from AniList/MAL directly?
4. **Is the schedule page a side feature or a main draw?** It was unplanned but is substantial. Analytics would answer this, and the answer changes Phase 3 and 4 priorities.
