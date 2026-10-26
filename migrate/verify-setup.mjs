// After Step 1 (setup.sql), checks that key objects exist.
// Uses the public anon key only — no secrets.

const SUPABASE_URL = 'https://xmnzvscwalwfvfyjwtqz.supabase.co';
const ANON = 'sb_publishable_jZ5HP61okKAD8l79hq00iw_ux9yY09f';
const headers = { apikey: ANON, Authorization: `Bearer ${ANON}` };

async function probe(label, url, init = {}) {
  const res = await fetch(url, { ...init, headers: { ...headers, ...init.headers } });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  const ok = res.ok || (body?.code !== 'PGRST205' && body?.code !== '42P01');
  const missing = /Could not find the table|Could not find the function/i.test(text);
  console.log(`${missing ? '✗' : '✓'} ${label}: ${missing ? 'missing — run Step 1' : 'ok'}`);
  return !missing;
}

let pass = true;
pass = (await probe('public.profiles', `${SUPABASE_URL}/rest/v1/profiles?select=user_id&limit=0`)) && pass;
pass = (await probe('public.watchlist', `${SUPABASE_URL}/rest/v1/watchlist?select=user_id&limit=0`)) && pass;
pass = (await probe('public.is_admin()', `${SUPABASE_URL}/rest/v1/rpc/is_admin`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: '{}',
})) && pass;

process.exit(pass ? 0 : 1);
