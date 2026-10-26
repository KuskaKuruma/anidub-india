// Public project values. The publishable key is safe in the browser: Row Level
// Security in supabase/setup.sql decides what it can read and write.
const SUPABASE_URL = 'https://xmnzvscwalwfvfyjwtqz.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_jZ5HP61okKAD8l79hq00iw_ux9yY09f';

// PKCE: Google sends the visitor back with ?code=, which supabase-js swaps
// for a session on page load.
window.supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { flowType: 'pkce' },
});
