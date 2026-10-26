// Accounts for every page: Google sign-in through Supabase Auth, the profile
// (username, preferred dub language, optional phone), the nav account menu,
// the mobile menu, and the one-time welcome popup.
//
// Load after supabase-config.js. Pages call window.auth; nothing else talks to
// Supabase Auth directly.

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const DUB_LANGUAGES = ['Tamil', 'Telugu', 'Hindi', 'Malayalam', 'Kannada'];
const COUNTRY_CODES = ['+91', '+977', '+94', '+880', '+971', '+966', '+65', '+60', '+1', '+44', '+61', '+81'];

/** Stored value is "+918707099999". The field itself is only the 10 digits. */
function splitStoredPhone(stored) {
  const codes = COUNTRY_CODES.slice().sort((a, b) => b.length - a.length);
  if (stored) {
    const code = codes.find((c) => stored.startsWith(c) && /^\d{10}$/.test(stored.slice(c.length)));
    if (code) return { code, number: stored.slice(code.length) };
  }
  return { code: '+91', number: stored || '' };
}

function phoneProblem(value) {
  if (value === '') return '';
  if (value !== value.trim() || /\s/.test(value)) {
    return 'Phone number cannot have spaces in it or at the end.';
  }
  if (!/^\d{10}$/.test(value)) {
    return 'Enter exactly 10 digits, or leave the phone number blank.';
  }
  return '';
}

/** Same-site page names only, so ?next= cannot send anyone to another origin. */
function safePage(page) {
  const fallback = location.pathname.split('/').pop() || 'index.html';
  const value = page || (fallback + location.search);
  return /^[a-z0-9.-]+\.html(\?[^#]*)?$/i.test(value) ? value : 'index.html';
}

// ── Session ──
// One profile read per page load, cached for the life of the page.

let sessionPromise = null;

async function loadUser() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) return null;

  const { data, error } = await supabaseClient
    .from('profiles')
    .select('username, preferred_language, phone, welcomed')
    .eq('user_id', session.user.id)
    .maybeSingle();
  if (error) console.error(error);

  return {
    id: session.user.id,
    email: session.user.email || '',
    username: data ? data.username : null,
    preferred_language: data ? data.preferred_language : null,
    phone: data ? data.phone : null,
    // No profile row yet (setup.sql not run) means no popup, not a broken page.
    welcomed: data ? data.welcomed : true,
  };
}

function currentUser({ fresh = false } = {}) {
  if (fresh || !sessionPromise) {
    sessionPromise = loadUser().catch((err) => {
      console.error(err);
      return null;
    });
  }
  return sessionPromise;
}

function profileError(error) {
  if (error.code === '23505') return 'That username is already taken.';
  const text = `${error.message || ''} ${error.details || ''}`;
  if (/profiles_username_format/.test(text)) return 'Username must be 3–20 letters, numbers, or underscores.';
  if (/profiles_phone_valid/.test(text)) return 'Enter exactly 10 digits, or leave the phone number blank.';
  if (/profiles_language_valid/.test(text)) return 'Choose one of the listed languages.';
  if (error.code === 'PGRST205' || error.code === '42P01') return 'Profiles are not set up yet. Run supabase/setup.sql.';
  return error.message || 'Could not save. Please try again.';
}

/**
 * Update the signed-in person's own profile. Each field is optional, but at
 * least one is needed. The same rules are enforced by check constraints in
 * the database, so a caller that skips this still cannot store bad values.
 */
async function updateProfile(fields) {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) throw new Error('Sign in required.');

  const row = {};
  const has = (key) => Object.prototype.hasOwnProperty.call(fields, key);

  if (has('username')) {
    const username = String(fields.username || '').trim();
    if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) {
      throw new Error('Username must be 3–20 letters, numbers, or underscores.');
    }
    row.username = username;
  }
  if (has('preferred_language')) {
    const language = fields.preferred_language || null;
    if (language !== null && !DUB_LANGUAGES.includes(language)) {
      throw new Error('Choose one of the listed languages.');
    }
    row.preferred_language = language;
  }
  if (has('phone')) {
    const phone = fields.phone == null ? '' : String(fields.phone);
    const problem = phoneProblem(phone);
    if (problem) throw new Error(problem);
    if (phone === '') {
      row.phone = null;
    } else {
      const code = fields.country_code || '+91';
      if (!COUNTRY_CODES.includes(code)) throw new Error('Choose a country code.');
      row.phone = code + phone;
    }
  }
  if (has('welcomed')) row.welcomed = Boolean(fields.welcomed);
  if (!Object.keys(row).length) throw new Error('Nothing to update.');

  row.user_id = session.user.id;
  row.updated_at = new Date().toISOString();

  const { data, error } = await supabaseClient
    .from('profiles')
    .upsert(row, { onConflict: 'user_id' })
    .select('username, preferred_language, phone')
    .single();
  if (error) throw new Error(profileError(error));

  sessionPromise = null;
  return data;
}

/** Login screen first; after Google, return to `page` (default: current page). */
function loginPageUrl(page) {
  const next = safePage(page);
  return `login.html?next=${encodeURIComponent(next)}`;
}

window.auth = {
  currentUser,
  updateProfile,
  loginPageUrl,

  /** Straight to Google, then back to `page` (default: the current page). */
  async signIn(page) {
    const redirectTo = new URL(safePage(page), location.href).href;
    const { error } = await supabaseClient.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo, queryParams: { prompt: 'select_account' } },
    });
    if (error) throw error;
  },

  async signOut() {
    await supabaseClient.auth.signOut();
    sessionPromise = null;
  },

  async isAdmin() {
    const { data, error } = await supabaseClient.rpc('is_admin');
    if (error) {
      console.error(error);
      return false;
    }
    return data === true;
  },
};

/**
 * The Google round trip comes back with ?code= (or an error) on the URL.
 * supabase-js has already exchanged the code by the time getSession()
 * resolves, so drop it from the address bar and from any later reload.
 */
async function tidyAuthParams() {
  await supabaseClient.auth.getSession();
  const params = new URLSearchParams(location.search);
  let changed = false;
  for (const key of ['code', 'error', 'error_code', 'error_description']) {
    if (params.has(key)) { params.delete(key); changed = true; }
  }
  if (/error_description=|access_token=/.test(location.hash)) changed = true;
  if (!changed) return;
  const query = params.toString();
  history.replaceState(null, '', location.pathname + (query ? `?${query}` : ''));
}

function accountStyle() {
  if (document.getElementById('accountStyle')) return;
  const style = document.createElement('style');
  style.id = 'accountStyle';
  style.textContent = `
    nav .nav-links { align-items: center; }
    #accountNav { position: relative; display: inline-flex; align-items: center; align-self: center; line-height: 1; }
    #accountMenuBtn, #accountNav a {
      color: var(--text-muted); text-decoration: none; font-size: 0.9rem; line-height: 1;
      background: none; border: none; margin: 0; padding: 0; cursor: pointer; font-family: inherit; font-weight: 400;
    }
    #accountMenuBtn:hover, #accountNav a:hover { color: var(--text); }
    #accountMenu {
      position: absolute; top: calc(100% + 10px); right: 0; min-width: 160px;
      background: var(--surface); border: 1px solid var(--border); border-radius: 10px;
      padding: 6px; box-shadow: 0 12px 32px rgba(0,0,0,0.35); z-index: 20;
    }
    #accountMenu button {
      width: 100%; text-align: left; background: none; border: none; color: var(--text);
      font: inherit; font-size: 0.88rem; padding: 8px 10px; border-radius: 8px; cursor: pointer;
    }
    #accountMenu button:hover { background: var(--surface2); }

    /* ── Mobile ──
       Four links plus an account control cannot fit a 375px phone, so below
       600px the links collapse behind a button. Desktop is untouched. */
    #navBurger { display: none; }

    @media (max-width: 600px) {
      #navBurger {
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        gap: 4px; margin-left: auto; flex: 0 0 auto;
        width: 36px; height: 36px; padding: 0;
        border: 1px solid var(--border); border-radius: 9px;
        background: var(--surface2); cursor: pointer;
      }
      #navBurger span { display: block; width: 16px; height: 2px; background: var(--text); border-radius: 2px; }

      nav .nav-links {
        position: absolute; top: 100%; left: 0; right: 0;
        display: none; flex-direction: column; align-items: stretch; gap: 0;
        margin: 0; padding: 6px 0;
        background: var(--surface); border-bottom: 1px solid var(--border);
        box-shadow: 0 14px 32px rgba(0,0,0,0.5);
      }
      nav .nav-links.open { display: flex; }
      nav .nav-links a,
      nav .nav-links #accountMenuBtn {
        display: block; width: 100%; text-align: left;
        padding: 13px 18px; font-size: 0.95rem;
      }
      /* The account slot stays in the bar. Its own dropdown still floats. */
      #accountNav { order: 2; margin-left: auto; }
      #navBurger { order: 3; margin-left: 8px; }
      #accountMenu { right: 0; left: auto; }
    }

    /* ── Welcome popup ──
       Shown once, the first time a new account loads any page. Only CSS
       variables defined on every page that loads this file are used here. */
    #welcomeOverlay {
      position: fixed; inset: 0; z-index: 1000;
      background: rgba(0,0,0,0.6);
      display: flex; align-items: center; justify-content: center;
      padding: 16px;
    }
    .welcome-card {
      width: 100%; max-width: 380px; box-sizing: border-box;
      background: var(--surface); border: 1px solid var(--border);
      border-radius: 14px; padding: 24px;
    }
    .welcome-card h2 { font-size: 1.2rem; margin: 0 0 6px; color: var(--text); }
    .welcome-lead { color: var(--text-muted); font-size: 0.88rem; margin: 0 0 16px; }
    .welcome-card label {
      display: block; font-size: 0.78rem; font-weight: 400; letter-spacing: normal;
      text-transform: none; color: var(--text-muted); margin: 12px 0 6px;
    }
    .welcome-card input, .welcome-card select {
      width: 100%; padding: 10px 12px; border-radius: 8px; border: 1px solid var(--border);
      background: var(--surface2); color: var(--text); font: inherit; box-sizing: border-box;
    }
    .welcome-card .phone-row { display: flex; gap: 8px; }
    .welcome-card .phone-row select { width: 142px; flex: 0 0 142px; }
    .welcome-card .phone-row input { flex: 1; width: auto; min-width: 0; }
    .welcome-card input[readonly] { color: var(--text-muted); }
    .welcome-msg { min-height: 18px; font-size: 0.82rem; color: var(--red); margin: 10px 0 0; }
    .welcome-actions { display: flex; gap: 8px; margin-top: 16px; }
    .welcome-actions button {
      flex: 1; padding: 10px; border-radius: 8px; border: none;
      font: inherit; font-weight: 700; cursor: pointer;
    }
    #welcomeSkip { background: var(--surface2); color: var(--text-muted); }
    #welcomeSave { background: var(--accent); color: #fff; }
    #welcomeSave:disabled { opacity: 0.6; cursor: default; }
  `;
  document.head.appendChild(style);
}

async function mountAccountNav() {
  await tidyAuthParams();
  // login.html draws its own sign-in and profile form.
  if (document.body.dataset.accountNav === 'off') return;

  accountStyle();
  const bar = document.querySelector('nav');
  const links = document.querySelector('nav .nav-links');

  // Pages with the shared nav get the account control. Admin has its own
  // logout button and no .nav-links, but a new admin can still land there
  // first, so the welcome popup runs either way.
  if (bar && links && !document.getElementById('accountNav')) {
    // Appended to <nav>, not to .nav-links: on mobile the link list collapses
    // behind the menu button, and signing in should never be hidden behind it.
    const slot = document.createElement('span');
    slot.id = 'accountNav';
    bar.appendChild(slot);

    mountBurger();
    const user = await refreshAccountNav();
    maybeShowWelcome(user);
    return;
  }

  maybeShowWelcome(await currentUser());
}

function maybeShowWelcome(user) {
  if (user && !user.welcomed) showWelcomePopup(user);
}

function showWelcomePopup(user) {
  if (document.getElementById('welcomeOverlay')) return;

  const options = ['<option value="">No preference</option>']
    .concat(DUB_LANGUAGES.map((l) => `<option value="${l}">${l}</option>`))
    .join('');

  const overlay = document.createElement('div');
  overlay.id = 'welcomeOverlay';
  overlay.innerHTML = `
    <div class="welcome-card" role="dialog" aria-modal="true" aria-labelledby="welcomeTitle">
      <h2 id="welcomeTitle">Welcome to AniDub India</h2>
      <p class="welcome-lead">Pick a username and the dub language you watch. A phone number is optional. You can change these later from Edit profile.</p>
      <label for="welcomeUsername">Username</label>
      <input id="welcomeUsername" type="text" minlength="3" maxlength="20"
             value="${escapeHtml(user.username || '')}" />
      <label for="welcomeEmail">Email</label>
      <input id="welcomeEmail" type="email" value="${escapeHtml(user.email || '')}" readonly />
      <label for="welcomePhone">Phone number (optional)</label>
      <div class="phone-row">
        <select id="welcomeCountry" aria-label="Country code">
          <option value="+91">India +91</option>
          <option value="+977">Nepal +977</option>
          <option value="+94">Sri Lanka +94</option>
          <option value="+880">Bangladesh +880</option>
          <option value="+971">UAE +971</option>
          <option value="+966">Saudi Arabia +966</option>
          <option value="+65">Singapore +65</option>
          <option value="+60">Malaysia +60</option>
          <option value="+1">US / Canada +1</option>
          <option value="+44">UK +44</option>
          <option value="+61">Australia +61</option>
          <option value="+81">Japan +81</option>
        </select>
        <input id="welcomePhone" type="tel" inputmode="numeric" autocomplete="tel" maxlength="16"
               placeholder="10 digits" />
      </div>
      <label for="welcomeLanguage">Preferred dub language</label>
      <select id="welcomeLanguage">${options}</select>
      <p class="welcome-msg" id="welcomeMsg"></p>
      <div class="welcome-actions">
        <button type="button" id="welcomeSkip">Skip for now</button>
        <button type="button" id="welcomeSave">Continue</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  document.getElementById('welcomeLanguage').value = user.preferred_language || '';
  const storedPhone = splitStoredPhone(user.phone);
  document.getElementById('welcomeCountry').value = storedPhone.code;
  document.getElementById('welcomePhone').value = storedPhone.number;
  document.getElementById('welcomeUsername').focus();

  // Skip, backdrop, and Escape keep the generated username and no language,
  // which is a valid permanent state. They only record that the popup was
  // seen, so it does not come back on the next page.
  const dismiss = () => {
    overlay.remove();
    updateProfile({ welcomed: true }).catch((err) => console.error(err));
  };
  overlay.addEventListener('click', (event) => { if (event.target === overlay) dismiss(); });
  overlay.addEventListener('welcome-dismiss', dismiss);
  document.getElementById('welcomeSkip').addEventListener('click', dismiss);

  document.getElementById('welcomeSave').addEventListener('click', async () => {
    const saveBtn = document.getElementById('welcomeSave');
    const msg = document.getElementById('welcomeMsg');
    const phone = document.getElementById('welcomePhone').value;
    const problem = phoneProblem(phone);
    if (problem) {
      msg.textContent = problem;
      return;
    }
    msg.textContent = '';
    saveBtn.disabled = true;
    try {
      await updateProfile({
        username: document.getElementById('welcomeUsername').value.trim(),
        preferred_language: document.getElementById('welcomeLanguage').value,
        country_code: document.getElementById('welcomeCountry').value,
        phone,
        welcomed: true,
      });
      overlay.remove();
      refreshAccountNav();   // picks up a changed username in the nav button
    } catch (err) {
      msg.textContent = err.message;
      saveBtn.disabled = false;
    }
  });
}

function displayName(user) {
  const username = String(user.username || '').trim();
  if (username) return username;
  return (user.email || '').split('@')[0] || 'Account';
}

/**
 * A direct "My List" link in the nav, for signed-in people only. Inserted as
 * the last real nav link, so it inherits `.nav-links a` styling on every page.
 */
function setWatchlistLink(show) {
  const existing = document.getElementById('watchlistLink');

  if (!show) {
    if (existing) existing.remove();
    return;
  }
  if (existing) return;

  const links = document.querySelector('nav .nav-links');
  if (!links) return;

  const link = document.createElement('a');
  link.id = 'watchlistLink';
  link.href = 'watchlist.html';
  link.textContent = 'My List';
  links.appendChild(link);
}

/** The mobile menu button, shared by every page that loads this file. */
function mountBurger() {
  const nav = document.querySelector('nav');
  const links = document.querySelector('nav .nav-links');
  if (!nav || !links || document.getElementById('navBurger')) return;

  nav.style.position = nav.style.position || 'relative';   // the sheet anchors to it

  const burger = document.createElement('button');
  burger.id = 'navBurger';
  burger.type = 'button';
  burger.setAttribute('aria-label', 'Menu');
  burger.setAttribute('aria-expanded', 'false');
  burger.innerHTML = '<span></span><span></span><span></span>';

  burger.addEventListener('click', (event) => {
    event.stopPropagation();
    const open = links.classList.toggle('open');
    burger.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (!open) closeAccountMenu();
  });

  nav.insertBefore(burger, links);

  // Tapping a destination should close the sheet behind you.
  links.addEventListener('click', (event) => {
    if (event.target.closest('a')) closeNavSheet();
  });
}

function closeNavSheet() {
  const links = document.querySelector('nav .nav-links');
  const burger = document.getElementById('navBurger');
  if (links) links.classList.remove('open');
  if (burger) burger.setAttribute('aria-expanded', 'false');
}

function closeAccountMenu() {
  const menu = document.getElementById('accountMenu');
  const button = document.getElementById('accountMenuBtn');
  if (menu) menu.hidden = true;
  if (button) button.setAttribute('aria-expanded', 'false');
}

async function refreshAccountNav() {
  const slot = document.getElementById('accountNav');
  if (!slot) return null;

  const user = await currentUser({ fresh: true });
  setWatchlistLink(Boolean(user));

  if (!user) {
    slot.innerHTML = `<a href="${loginPageUrl()}" id="accountLogin">Log in</a>`;
    return null;
  }

  slot.innerHTML = `
    <button type="button" id="accountMenuBtn" aria-haspopup="menu" aria-expanded="false">${escapeHtml(displayName(user))}</button>
    <div id="accountMenu" role="menu" hidden>
      <button type="button" id="accountList" role="menuitem">My list</button>
      <button type="button" id="accountEdit" role="menuitem">Edit profile</button>
      <button type="button" id="accountSignOut" role="menuitem">Log out</button>
    </div>`;

  document.getElementById('accountMenuBtn').addEventListener('click', () => {
    const menu = document.getElementById('accountMenu');
    const open = menu.hidden;
    menu.hidden = !open;
    document.getElementById('accountMenuBtn').setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  document.getElementById('accountList').addEventListener('click', () => {
    location.href = 'watchlist.html';
  });
  document.getElementById('accountEdit').addEventListener('click', () => {
    location.href = 'login.html?mode=profile';
  });
  document.getElementById('accountSignOut').addEventListener('click', async () => {
    await window.auth.signOut();
    location.href = 'index.html';
  });

  return user;
}

document.addEventListener('click', (event) => {
  const slot = document.getElementById('accountNav');
  if (!slot || !slot.contains(event.target)) closeAccountMenu();

  const nav = document.querySelector('nav');
  if (nav && !nav.contains(event.target)) closeNavSheet();
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  closeAccountMenu();
  closeNavSheet();
  document.getElementById('welcomeOverlay')?.dispatchEvent(new Event('welcome-dismiss'));
});

document.addEventListener('DOMContentLoaded', mountAccountNav);
