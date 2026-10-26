// Copy everything the Cloudflare (D1) site has that Supabase is missing.
//
// 1. Export D1 into a local SQLite file (from the anidub-cloudflare folder):
//      npx wrangler d1 export anidub --remote --output /tmp/d1.sql
//      sqlite3 /tmp/d1.db < /tmp/d1.sql
// 2. Run, with the service_role key from Supabase -> Project Settings -> API:
//      SUPABASE_SERVICE_KEY=... node migrate/from-cloudflare.mjs /tmp/d1.db [catalog|accounts|all] [--dry-run]
//
// catalog  : anime, seasons, dubs, recent_updates, submissions. Rows missing
//            from Supabase are added; rows that differ take the D1 values.
//            Nothing is deleted.
// accounts : D1 users become Supabase auth users (matched by email, so an
//            existing account is reused), with their profile and My List.
//            Needs supabase/setup.sql to have been run first.
//
// Safe to run more than once.

import { execFileSync } from 'node:child_process';

const SUPABASE_URL = 'https://xmnzvscwalwfvfyjwtqz.supabase.co';
const KEY = process.env.SUPABASE_SERVICE_KEY;
const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const [dbPath, mode = 'all'] = args.filter((a) => !a.startsWith('--'));

if (!KEY) throw new Error('Set SUPABASE_SERVICE_KEY (service_role key; never commit it).');
if (!dbPath) throw new Error('Usage: node migrate/from-cloudflare.mjs <d1.db> [catalog|accounts|all] [--dry-run]');
if (!['catalog', 'accounts', 'all'].includes(mode)) throw new Error(`Unknown mode "${mode}".`);

const HEADERS = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

function d1(sql) {
  const text = execFileSync('sqlite3', ['-json', dbPath, sql]).toString().trim();
  return text ? JSON.parse(text) : [];
}

async function call(path, { method = 'GET', body, prefer } = {}) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    method,
    headers: prefer ? { ...HEADERS, Prefer: prefer } : HEADERS,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const err = new Error(`${method} ${path}: ${res.status} ${text}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

async function selectAll(table) {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await call(`/rest/v1/${table}?select=*&limit=1000&offset=${offset}`);
    rows.push(...page);
    if (page.length < 1000) break;
  }
  return rows;
}

// ── Value conversion: D1 stores arrays as JSON text and times without a zone ──

const ARRAY_COLS = new Set(['genre', 'languages']);
const TIME_COLS = new Set(['created_at', 'updated_at', 'added_date']);

function toIso(value) {
  const text = String(value);
  const zoned = /[zZ]|[+-]\d\d:?\d\d$/.test(text);
  const t = Date.parse(text.replace(' ', 'T') + (zoned ? '' : 'Z'));
  return Number.isNaN(t) ? text : new Date(t).toISOString();
}

function convert(value, col) {
  if (value === undefined || value === '') return null;
  if (value === null) return null;
  if (ARRAY_COLS.has(col)) {
    if (Array.isArray(value)) return value;
    try { return JSON.parse(value); } catch { return [value]; }
  }
  if (TIME_COLS.has(col)) return toIso(value);
  if (col === 'episodes_dubbed') return String(value).replace(/\.0$/, '');
  return value;
}

function same(a, b, col) {
  const norm = (v) => {
    const c = convert(v, col);
    if (c === null) return null;
    if (TIME_COLS.has(col)) return toIso(c);
    return JSON.stringify(c);
  };
  return norm(a) === norm(b);
}

// ── Catalog ──

const CATALOG = [
  // Order matters: seasons and dubs point at anime, dubs at seasons.
  { table: 'anime', pk: 'id' },
  { table: 'seasons', pk: 'id' },
  { table: 'dubs', pk: 'id' },
  { table: 'recent_updates', pk: 'updates_id' },
  { table: 'submissions', pk: 'id' },
];

/** Column names Supabase actually has, from the REST schema. */
async function supabaseColumns() {
  const spec = await call('/rest/v1/');
  const out = {};
  for (const [name, def] of Object.entries(spec.definitions || {})) {
    out[name] = new Set(Object.keys(def.properties || {}));
  }
  return out;
}

async function syncCatalog() {
  const columns = await supabaseColumns();

  for (const { table, pk } of CATALOG) {
    const cols = columns[table];
    if (!cols) { console.log(`${table}: not in Supabase, skipped`); continue; }

    const left = d1(`SELECT * FROM ${table}`);
    const right = new Map((await selectAll(table)).map((r) => [String(r[pk]), r]));
    const shared = Object.keys(left[0] || {}).filter((c) => cols.has(c));

    const pending = [];
    for (const row of left) {
      const other = right.get(String(row[pk]));
      const differs = !other || shared.some((c) => !same(row[c], other[c], c));
      if (!differs) continue;
      pending.push(Object.fromEntries(shared.map((c) => [c, convert(row[c], c)])));
    }

    console.log(`${table.padEnd(15)} d1=${left.length} supabase=${right.size} to_write=${pending.length}`);
    for (const row of pending) console.log(`  ${pk}=${row[pk]}`);
    if (DRY || !pending.length) continue;

    await call(`/rest/v1/${table}?on_conflict=${pk}`, {
      method: 'POST',
      body: pending,
      prefer: 'resolution=merge-duplicates,return=minimal',
    });
  }

  // Rows were written with explicit ids; move each id sequence past them so
  // the next insert from the admin page does not collide.
  if (!DRY) {
    try {
      await call('/rest/v1/rpc/sync_id_sequences', { method: 'POST', body: {} });
      console.log('id sequences synced');
    } catch (err) {
      console.warn('Could not sync id sequences (run supabase/setup.sql, which does it too):', err.message);
    }
  }
}

// ── Accounts ──

async function authUsersByEmail() {
  const byEmail = new Map();
  for (let page = 1; ; page += 1) {
    const data = await call(`/auth/v1/admin/users?page=${page}&per_page=1000`);
    const users = data.users || [];
    for (const u of users) if (u.email) byEmail.set(u.email.toLowerCase(), u);
    if (users.length < 1000) break;
  }
  return byEmail;
}

async function ensureAuthUser(d1User, byEmail) {
  const email = d1User.email.toLowerCase();
  const existing = byEmail.get(email);
  if (existing) return { id: existing.id, created: false };
  if (DRY) return { id: `(new user for ${email})`, created: true };

  const created = await call('/auth/v1/admin/users', {
    method: 'POST',
    body: {
      email,
      email_confirm: true,
      user_metadata: { username: d1User.username, full_name: d1User.username, avatar_url: d1User.picture || undefined },
    },
  });
  return { id: created.id, created: true };
}

/** Upsert the profile, adding a number to the username if someone else has it. */
async function saveProfile(userId, d1User) {
  const base = d1User.username;
  const candidates = [base, ...Array.from({ length: 8 }, (_, i) => `${base.slice(0, 19)}${i + 2}`)];
  for (const username of candidates) {
    try {
      await call('/rest/v1/profiles?on_conflict=user_id', {
        method: 'POST',
        prefer: 'resolution=merge-duplicates,return=minimal',
        body: {
          user_id: userId,
          username,
          preferred_language: d1User.preferred_language || null,
          phone: d1User.phone || null,
          welcomed: true,
          updated_at: new Date().toISOString(),
        },
      });
      return username;
    } catch (err) {
      if (err.data && err.data.code === '23505') continue;
      throw err;
    }
  }
  throw new Error(`No free username near "${base}".`);
}

async function syncAccounts() {
  const users = d1('SELECT * FROM users ORDER BY id');
  const watch = d1('SELECT * FROM watchlist');
  const byEmail = await authUsersByEmail();
  const idMap = new Map();

  for (const u of users) {
    if (!u.email) { console.log(`user ${u.id}: no email, skipped`); continue; }
    const { id, created } = await ensureAuthUser(u, byEmail);
    idMap.set(u.id, id);
    const username = DRY ? u.username : await saveProfile(id, u);
    console.log(`user ${u.id} (${username}): ${created ? 'created' : 'existing'} auth user`);
  }

  const rows = watch
    .filter((w) => idMap.has(w.user_id))
    .map((w) => ({
      user_id: idMap.get(w.user_id),
      anime_id: w.anime_id,
      status: w.status,
      created_at: toIso(w.created_at),
      updated_at: w.updated_at ? toIso(w.updated_at) : null,
    }));
  console.log(`watchlist rows to write: ${rows.length}`);
  if (DRY || !rows.length) return;

  await call('/rest/v1/watchlist?on_conflict=user_id,anime_id', {
    method: 'POST',
    body: rows,
    prefer: 'resolution=merge-duplicates,return=minimal',
  });
}

if (DRY) console.log('Dry run: nothing will be written.\n');
if (mode === 'catalog' || mode === 'all') await syncCatalog();
if (mode === 'accounts' || mode === 'all') await syncAccounts();
console.log('\nDone.');
