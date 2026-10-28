// Back navigation and library state for multi-page browse (index ↔ anime ↔ watchlist).

(function () {
  const SCROLL_KEY = 'anidub_library_scroll_y';

  /** Same-site .html paths only — used in ?from= on anime links. */
  function safeFromPage(page) {
    const value = page || (location.pathname.split('/').pop() || 'index.html') + location.search;
    return /^[a-z0-9.-]+\.html(\?[^#]*)?$/i.test(value) ? value : 'index.html';
  }

  function animeDetailHref(animeId, fromPage) {
    const from = safeFromPage(fromPage);
    const q = new URLSearchParams({ id: String(animeId), from });
    return `anime.html?${q.toString()}`;
  }

  function backTarget(fromRaw) {
    const from = fromRaw ? decodeURIComponent(fromRaw) : '';
    const href = safeFromPage(from || 'index.html');
    const base = href.split('?')[0].toLowerCase();
    const labels = {
      'index.html': 'Browse',
      'watchlist.html': 'My List',
      'schedule.html': 'Airing Now',
    };
    return { href, label: labels[base] || 'Previous page' };
  }

  function mountAnimeBackLink(container, fromRaw) {
    const { href, label } = backTarget(fromRaw);
    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    container.innerHTML = `<a class="back-link" href="${esc(href)}" id="animeBackLink">← Back to ${esc(label)}</a>`;
    const link = document.getElementById('animeBackLink');
    if (!link) return;
    link.addEventListener('click', (event) => {
      // Same as the browser back button when there is history (e.g. library → anime).
      if (window.history.length > 1) {
        event.preventDefault();
        window.history.back();
      }
    });
  }

  function saveLibraryScroll() {
    try { sessionStorage.setItem(SCROLL_KEY, String(window.scrollY)); } catch { /* private mode */ }
  }

  function takeLibraryScroll() {
    try {
      const y = sessionStorage.getItem(SCROLL_KEY);
      sessionStorage.removeItem(SCROLL_KEY);
      if (y == null) return null;
      const n = parseInt(y, 10);
      return Number.isFinite(n) ? n : null;
    } catch {
      return null;
    }
  }

  window.browseNav = {
    safeFromPage,
    animeDetailHref,
    backTarget,
    mountAnimeBackLink,
    saveLibraryScroll,
    takeLibraryScroll,
  };
})();
