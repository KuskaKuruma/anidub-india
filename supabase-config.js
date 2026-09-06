// Replace these with your actual Supabase project values
// Go to: Supabase Dashboard → Settings → API
const SUPABASE_URL = 'https://xmnzvscwalwfvfyjwtqz.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_jZ5HP61okKAD8l79hq00iw_ux9yY09f';

// Demo mode: uses seed data from data/seed.js when Supabase isn't configured
window.DEMO_MODE = (SUPABASE_URL === 'YOUR_SUPABASE_URL');

if (!window.DEMO_MODE) {
  window.supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}
