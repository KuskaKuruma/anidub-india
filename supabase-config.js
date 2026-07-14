// Replace these with your actual Supabase project values
// Go to: Supabase Dashboard → Settings → API
const SUPABASE_URL = 'YOUR_SUPABASE_URL';
const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY';

// Demo mode: uses seed data from data/seed.js when Supabase isn't configured
window.DEMO_MODE = (SUPABASE_URL === 'YOUR_SUPABASE_URL');

if (!window.DEMO_MODE) {
  window.supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}
