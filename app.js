/* app.js — routing, events, orchestration. */

import { Api, anivexaPlayback, playbackUrl } from './api.js';
import { Store } from './store.js';
import { Auth, authUrl } from './auth.js';
import * as V from './views.js';

const app = document.getElementById('app');
const nav = document.getElementById('nav');

let heroTimer = null;
let heroItems = [];
let heroIndex = 0;
let current = null;          // media on the open detail page
let epLimit = 24;
let searchState = { q: '', format: null, genre: null, seq: 0 };
let libTab = 'all';
let playerState = null;
let playerLandscape = false;
let playerRotateFullscreen = false;
let pendingUpdate = null;

const ctx = () => ({ source: Store.settings.source, adult: Store.settings.adult });

/* ── update check ────────────────────────────────────────────
 * The APK has no auto-update channel (it isn't on the Play Store), so the
 * app checks GitHub Releases for the source repo on every cold start and
 * points the user at the newest APK + the WhatsApp channel if it's behind.
 * Bump APP_VERSION here (and tag/release the same string on GitHub, e.g.
 * "v0.2.0") whenever you cut a new build. */
const APP_VERSION = '0.1.0';
const UPDATE_REPO = 'northernblader-sys/cloud-astral';
const UPDATE_RELEASES_API = `https://api.github.com/repos/${UPDATE_REPO}/releases/latest`;
const UPDATE_WHATSAPP_URL = 'https://whatsapp.com/channel/0029VaqhhiQA2pL54CiJ0x2p';
/* Set true to make the popup block the app until the user updates. */
const FORCE_UPDATE = false;

function parseVersion(v) {
  return String(v || '').trim().replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0);
}

function isNewer(remote, local) {
  const r = parseVersion(remote), l = parseVersion(local);
  for (let i = 0; i < Math.max(r.length, l.length); i++) {
    const rv = r[i] || 0, lv = l[i] || 0;
    if (rv !== lv) return rv > lv;
  }
  return false;
}

async function checkForUpdate() {
  try {
    const res = await fetch(UPDATE_RELEASES_API, { headers: { Accept: 'application/vnd.github+json' } });
    if (!res.ok) return; // no releases published yet, or offline — fail silently
    const rel = await res.json();
    const tag = rel.tag_name || rel.name || '';
    if (!tag || !isNewer(tag, APP_VERSION)) return;

    const cleanVersion = tag.replace(/^v/i, '');
    if (!FORCE_UPDATE && Store.settings.updateSkippedVersion === cleanVersion) return;

    const apkAsset = (rel.assets || []).find(a => /\.apk$/i.test(a.name || ''));
    const downloadUrl = apkAsset?.browser_download_url || rel.html_url
      || `https://github.com/${UPDATE_REPO}/releases/latest`;

    pendingUpdate = { version: cleanVersion };
    openSheet(V.updateView({
      version: cleanVersion,
      notes: (rel.body || '').split('\n').find(l => l.trim()) || '',
      downloadUrl,
      whatsappUrl: UPDATE_WHATSAPP_URL,
      force: FORCE_UPDATE
    }));
  } catch {
    /* offline, blocked network, or CORS in the browser preview — ignore */
  }
}

/* ── toast ───────────────────────────────────────────────── */

let toastTimer;
function toast(msg) {
  document.querySelector('.toast')?.remove();
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), 2200);
}

/* ── sheets ──────────────────────────────────────────────── */

function openSheet(html) {
  closeSheet();
  const host = document.createElement('div');
  host.id = 'sheet-host';
  host.innerHTML = html;
  document.body.appendChild(host);
}

function closeSheet() {
  document.getElementById('sheet-host')?.remove();
}

/* ── player ──────────────────────────────────────────────── */

function openPlayer(m, episode = null, language = Store.settings.playbackLanguage || 'sub') {
  closePlayer();
  const total = V.episodeRows(m).length;
  const progress = Store.entry(m.src, m.id)?.progress || 0;
  const chosen = Number(episode) || Math.min(progress + 1, total || 1);
  playerState = {
    media: m,
    episode: Math.max(1, chosen),
    language,
    playbackRequest: 0,
    anivexaPlayback: null
  };
  const state = playerState;
  const host = document.createElement('div');
  host.id = 'player-host';
  host.innerHTML = V.playerView(m, state.episode, state.language);
  document.body.appendChild(host);
  document.body.style.overflow = 'hidden';
  loadPlayerPlayback(state);
}

function closePlayer() {
  /* Remove the node so an iframe/video stops playing. */
  resetPlayerOrientation();
  document.getElementById('player-host')?.remove();
  playerState = null;
  document.body.style.overflow = '';
}

function setPlayerHint(text) {
  const hint = document.querySelector('[data-player-hint]');
  if (hint) hint.textContent = text;
}

function updatePlayerServers(state) {
  document.querySelectorAll('[data-player-server]').forEach(button => {
    const server = button.dataset.playerServer;
    const active = server === 'megaplay'
      ? state.playback?.provider === 'megaplay'
      : Boolean(state.anivexaPlayback) && state.playback?.provider !== 'megaplay';
    button.classList.toggle('on', active);
    button.disabled = server === 'anivexa' && !state.anivexaPlayback;
    button.setAttribute('aria-pressed', String(active));
  });
}

function renderPlayerPlayback(state, playback, hint) {
  if (playerState !== state) return;
  const frame = document.querySelector('#player .player-frame');
  if (!frame) return;

  state.playback = playback;
  frame.innerHTML = V.playerSurface(state.media, state.episode, playback);
  const quality = document.querySelector('[data-player-quality-container]');
  if (quality) quality.innerHTML = V.playerQualityControl(playback);
  setPlayerHint(hint);
  updatePlayerServers(state);

  const video = frame.querySelector('video');
  if (video) {
    video.addEventListener('error', () => {
      if (playerState !== state) return;
      renderMegaPlayFallback(state, 'Anivexa playback failed · MegaPlay fallback');
    }, { once: true });
    video.play?.().catch(() => {});
  }
}

function renderMegaPlayFallback(state, hint = 'Anivexa unavailable · MegaPlay fallback') {
  if (playerState !== state) return;
  const url = playbackUrl(state.media, state.episode, state.language);
  if (!url) {
    renderPlayerPlayback(state, null, 'No playable source available');
    return;
  }
  renderPlayerPlayback(state, { kind: 'iframe', url, provider: 'megaplay' }, hint);
}

async function loadPlayerPlayback(state) {
  if (playerState !== state || !V.episodeRows(state.media).length) return;
  const request = ++state.playbackRequest;

  try {
    const primary = await anivexaPlayback(state.media, state.episode, state.language);
    if (playerState !== state || state.playbackRequest !== request) return;
    if (primary) {
      state.anivexaPlayback = primary;
      const quality = primary.quality && primary.quality !== 'Auto'
        ? ` · ${primary.quality}`
        : '';
      renderPlayerPlayback(state, primary, `${primary.label || 'Anivexa'}${quality}`);
      return;
    }
    state.anivexaPlayback = null;
  } catch {
    /* The fallback below is the expected path when Anivexa is unreachable. */
    state.anivexaPlayback = null;
  }

  if (playerState === state && state.playbackRequest === request) {
    renderMegaPlayFallback(state);
  }
}

function updatePlayerOrientationButton() {
  const button = document.querySelector('[data-player-rotate]');
  if (!button) return;
  button.classList.toggle('on', playerLandscape);
  button.setAttribute('aria-pressed', String(playerLandscape));
  const label = playerLandscape ? 'Exit landscape' : 'Use landscape';
  button.setAttribute('aria-label', label);
  button.title = label;
}

function resetPlayerOrientation() {
  playerLandscape = false;
  if (screen.orientation?.unlock) {
    try { screen.orientation.unlock(); } catch {}
  }
  if (playerRotateFullscreen && document.fullscreenElement) {
    document.exitFullscreen?.().catch(() => {});
  }
  playerRotateFullscreen = false;
}

async function togglePlayerOrientation() {
  const host = document.getElementById('player-host');
  if (!host) return;

  if (playerLandscape) {
    resetPlayerOrientation();
    host.classList.remove('player-landscape');
    updatePlayerOrientationButton();
    return;
  }

  /*
   * Android requires fullscreen before allowing a web page to lock its
   * orientation. The player already covers the screen, so entering fullscreen
   * here keeps the transition seamless and also hides the system bars.
   */
  const requestFullscreen = host.requestFullscreen || host.webkitRequestFullscreen;
  if (requestFullscreen && !document.fullscreenElement) {
    try {
      await requestFullscreen.call(host);
      playerRotateFullscreen = true;
    } catch {}
  }

  let locked = false;
  if (screen.orientation?.lock) {
    try {
      await screen.orientation.lock('landscape');
      locked = true;
    } catch {}
  }

  if (!locked && !screen.orientation?.type?.startsWith('landscape')) {
    if (playerRotateFullscreen && document.fullscreenElement) {
      document.exitFullscreen?.().catch(() => {});
    }
    playerRotateFullscreen = false;
    toast('Landscape mode is not available on this device');
    return;
  }

  playerLandscape = true;
  host.classList.add('player-landscape');
  updatePlayerOrientationButton();
}

function markPlayerEpisode() {
  if (!playerState) return;
  const { media, episode } = playerState;
  if (!Store.isSeen(media.src, media.id, episode)) {
    Store.toggleSeen(media, episode);
    syncUp(media);
  }
  const button = document.querySelector('[data-player-mark]');
  if (button) {
    button.innerHTML = `${V.svg('check')}<span>Watched</span>`;
    button.classList.add('on');
  }
}

/* ── sync ────────────────────────────────────────────────── */

/** Mirror a local change up to AniList when the user is signed in. */
function syncUp(media) {
  if (!Auth.signedIn || !Store.settings.syncOnChange) return;
  const entry = Store.entry(media.src, media.id);
  if (entry) Auth.push(media, entry);
}

/* ── hero ────────────────────────────────────────────────── */

function stopHero() { clearInterval(heroTimer); heroTimer = null; }

/* Older WebViews can be missing matchMedia; never let that break a screen. */
const prefersReducedMotion = () => {
  try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
  catch { return false; }
};

function showHeroSlide(i) {
  heroIndex = i;
  const hero = document.getElementById('hero');
  if (!hero) return stopHero();
  hero.querySelectorAll('.hero-slide').forEach((s, n) => s.classList.toggle('on', n === i));
  hero.querySelectorAll('.hero-dots i').forEach((d, n) => d.classList.toggle('on', n === i));
  const body = document.getElementById('hero-body');
  const m = heroItems[i];
  if (body && m) {
    body.innerHTML = V.heroBody(m);
    document.documentElement.style.setProperty('--tint', V.tintOf(m));
  }
}

function startHero(items) {
  heroItems = items.slice(0, 6);
  const hero = document.getElementById('hero');
  if (!hero || !heroItems.length) return;
  hero.innerHTML = V.heroMarkup(heroItems);
  showHeroSlide(0);
  stopHero();
  if (!prefersReducedMotion()) {
    heroTimer = setInterval(() => showHeroSlide((heroIndex + 1) % heroItems.length), 7000);
  }
}

/** Open an external page: the system browser in the APK, a tab on the web. */
function openExternal(url) {
  const B = window.Capacitor?.Plugins?.Browser;
  if (B) B.open({ url, presentationStyle: 'popover' });
  else window.open(url, '_blank', 'noopener');
}

/**
 * Rebuild enough of a Media object from a saved library stub to open the
 * player without touching the network. The episode list is synthesised up to
 * the one being resumed, since a stub keeps no episode data of its own.
 */
function mediaFromEntry(e) {
  const s = e.stub || {};
  const upto = Math.max(1, Math.min((e.progress || 0) + 1, s.episodes || Infinity));
  return {
    src: e.src,
    id: e.id,
    malId: e.malId || null,
    title: s.title || {},
    cover: s.cover || '',
    color: s.color || null,
    episodes: s.episodes || null,
    format: s.format || null,
    year: s.year || null,
    score: s.score || null,
    status: s.status_ || null,
    genres: [],
    nextEp: null,
    streamEpisodes: Array.from({ length: upto }, (_, i) => ({ n: i + 1 }))
  };
}

/**
 * A player opened from a library stub knows the title and the episode but not
 * the full episode list. Fetch the real record and patch the few parts that
 * depend on it. The iframe is deliberately left alone — replacing or
 * reparenting it would restart playback.
 */
async function hydratePlayer(src, id, episode) {
  let full;
  try {
    full = await Api.detail(src, id);
  } catch {
    return;                       // offline is fine; the stub still plays
  }
  if (!full || !playerState) return;
  if (String(playerState.media.id) !== String(id) || playerState.episode !== episode) return;

  playerState.media = full;
  const host = document.getElementById('player-host');
  if (!host) return;

  const total = V.episodeRows(full).length;
  const label = host.querySelector('.player-bar .t span');
  if (label) label.textContent = `Episode ${episode}${total ? ` of ${total}` : ''}`;

  const count = host.querySelector('.player-episodes-head span');
  if (count) count.textContent = `${total || 0} available`;

  const grid = host.querySelector('.player-episode-grid');
  if (grid) grid.innerHTML = V.episodeGrid(full, episode);

  const controls = host.querySelectorAll('.player-toolbar .player-control');
  const nextBtn = controls[2];
  if (nextBtn && episode < total) {
    nextBtn.dataset.playerEpisode = String(episode + 1);
    nextBtn.classList.remove('disabled');
    nextBtn.removeAttribute('disabled');
  }

  /* A library stub may not contain the AniList ID needed by Anivexa. */
  loadPlayerPlayback(playerState);
}

/* ── routes ──────────────────────────────────────────────── */

async function renderHome() {
  stopHero();
  app.innerHTML = V.homeShell();
  const c = ctx();

  const jobs = [
    ['hero',     () => Api.airingNow(c)],
    ['trending', () => Api.trending(c)],
    ['top10',    () => Api.topRated({ ...c, perPage: 10 })],
    ['season',   () => Api.thisSeason(c)],
    ['popular',  () => Api.mostPopular(c)],
    ['movies',   () => Api.topMovies(c)],
    ['upcoming', () => Api.upcoming(c)],
    ['g1',       () => Api.byGenre('Action', c)],
    ['g2',       () => Api.byGenre('Slice of Life', c)]
  ];

  let failed = 0;
  for (const [id, run] of jobs) {
    try {
      const { items } = await run();
      if (id === 'hero') startHero(items);
      else V.fillRail(id, items, id === 'top10');
    } catch (err) {
      failed++;
      if (id === 'hero') {
        document.getElementById('hero')?.remove();
        app.insertAdjacentHTML('afterbegin', V.empty(
          'Could not reach the catalogue',
          err.message + ' Check your connection and pull the screen to try again.',
          '<button class="btn btn-line" data-retry>Try again</button>'
        ));
      } else {
        document.querySelector(`[data-rail="${id}"]`)?.remove();
      }
    }
  }
  if (failed && failed < jobs.length) console.warn(failed + ' section(s) unavailable');
}

function renderSearch() {
  stopHero();
  app.innerHTML = V.searchShell(searchState);
  const input = document.getElementById('q');
  const results = document.getElementById('results');
  if (searchState.q) runSearch();
  else if (searchState.genre || searchState.format) runSearch();
  else results.innerHTML = V.searchPrompt();
  setTimeout(() => input?.focus(), 60);
}

let searchTimer;
function queueSearch() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(runSearch, 320);
}

async function runSearch() {
  const results = document.getElementById('results');
  if (!results) return;

  /* Read the box itself rather than trusting that every keystroke reached us.
     Android keyboards using composition don't always fire `input` per letter. */
  const box = document.getElementById('q');
  if (box) searchState.q = box.value;

  const seq = ++searchState.seq;
  const { q, format, genre } = searchState;

  if (!q.trim() && !genre && !format) {
    results.innerHTML = V.searchPrompt();
    return;
  }

  results.innerHTML = `<div class="grid">${Array.from({ length: 9 }, () =>
    '<div class="card"><div class="skel" style="aspect-ratio:2/3"></div></div>').join('')}</div>`;

  try {
    const res = q.trim()
      ? await Api.search(q, { ...ctx(), format, genre })
      : genre
        ? await Api.byGenre(genre, ctx())
        : await Api.byFormat(format, ctx());
    if (seq !== searchState.seq) return;
    results.innerHTML = res.items.length
      ? V.searchResults(q, res.items)
      : V.searchNoResults(q || genre || format);
  } catch (err) {
    if (seq !== searchState.seq) return;
    console.error('Search failed:', err);
    results.innerHTML = V.empty('Search failed', err.message || 'Something went wrong reaching AniList.',
      '<button class="btn btn-line" data-retry>Try again</button>');
  }
}

async function renderCategory(title, note, load) {
  stopHero();
  app.innerHTML = V.categoryShell(title, note);
  const results = document.getElementById('category-results');
  try {
    const res = await load();
    results.innerHTML = res.items.length
      ? V.grid(res.items)
      : V.empty('Nothing here yet', 'There are no titles to show in this section.');
  } catch (err) {
    results.innerHTML = V.empty('Could not load this section', err.message,
      '<button class="btn btn-line" data-retry>Try again</button>');
  }
}

function renderBrowseCategory(kind) {
  const categories = {
    completed: ['Completed', 'Finished series and films', c => Api.completed(c)],
    popular: ['Most Popular', 'The titles people are watching most', c => Api.mostPopular(c)],
    movies: ['Movies', 'Films worth the evening', c => Api.topMovies(c)],
    tv: ['TV Series', 'Long-form series and seasonal favourites', c => Api.byFormat('TV', c)],
    ova: ['OVAs', 'Original video releases', c => Api.byFormat('OVA', c)],
    ona: ['ONAs', 'Original net releases', c => Api.byFormat('ONA', c)],
    special: ['Specials', 'Extra episodes and side stories', c => Api.byFormat('SPECIAL', c)]
  };
  const item = categories[kind];
  if (!item) return renderHome();
  return renderCategory(item[0], item[1], () => item[2](ctx()));
}

async function renderGenre(name) {
  const genre = decodeURIComponent(name || '');
  if (!genre) return renderHome();
  return renderCategory(genre, 'Browse anime by genre', () => Api.byGenre(genre, ctx()));
}

function renderLibrary() {
  stopHero();
  app.innerHTML = V.libraryShell(libTab);
  document.getElementById('libbody').innerHTML = V.libraryBody(libTab);
}

function renderSettings() {
  stopHero();
  app.innerHTML = V.settingsView();
}

async function renderDetail(src, id) {
  stopHero();
  epLimit = 24;
  app.innerHTML = V.detailShell();
  window.scrollTo(0, 0);
  try {
    current = await Api.detail(src, id);
    if (!current) throw new Error('That title is not in the catalogue.');
    app.innerHTML = V.detailView(current);
  } catch (err) {
    app.innerHTML = `<button class="back" data-back>${V.svg('back')}</button>` +
      V.empty('Could not load this title', err.message,
        '<button class="btn btn-line" data-back>Go back</button>');
  }
}

function redrawDetail() {
  if (!current) return;
  const y = window.scrollY;
  app.innerHTML = V.detailView(current);
  if (epLimit > 24) expandEpisodes();
  window.scrollTo(0, y);
}

function expandEpisodes() {
  const host = document.getElementById('episodes');
  if (!host || !current) return;
  host.outerHTML = V.episodeList(current, epLimit);
}

/* ── router ──────────────────────────────────────────────── */

function route() {
  closeSheet();
  closePlayer();
  const hash = location.hash.replace(/^#\/?/, '') || 'home';
  const parts = hash.split('/');

  if (parts[0] === 'anime' && parts[1] && parts[2]) {
    setNav(null);
    return renderDetail(parts[1], parts[2]);
  }

  current = null;
  setNav(parts[0]);

  switch (parts[0]) {
    case 'search':
      if (parts[1]) searchState = { ...searchState, q: decodeURIComponent(parts[1]), genre: null };
      return renderSearch();
    case 'completed':
    case 'popular':
    case 'movies':
    case 'tv':
    case 'ova':
    case 'ona':
    case 'special':
      return renderBrowseCategory(parts[0]);
    case 'genre':
      return renderGenre(parts.slice(1).join('/'));
    case 'library':  return renderLibrary();
    case 'settings': return renderSettings();
    default: return renderHome();
  }
}

function setNav(tab) {
  nav.querySelectorAll('button').forEach(b =>
    b.setAttribute('aria-current', b.dataset.go === tab ? 'page' : 'false'));
}

/* ── global events ───────────────────────────────────────── */

document.addEventListener('click', async e => {
  const t = e.target;

  const searchSuggestion = t.closest('[data-search-suggest]');
  if (searchSuggestion) {
    searchState.q = searchSuggestion.dataset.searchSuggest || '';
    searchState.format = null;
    searchState.genre = null;
    const input = document.getElementById('q');
    if (input) input.value = searchState.q;
    document.querySelector('[data-search-clear]')?.removeAttribute('hidden');
    document.querySelector('[data-search-clear]')?.classList.add('show');
    runSearch();
    return;
  }

  if (t.closest('[data-search-clear]')) {
    const input = document.getElementById('q');
    if (input) input.value = '';
    searchState.q = '';
    document.querySelector('[data-search-clear]')?.setAttribute('hidden', '');
    document.querySelector('[data-search-clear]')?.classList.remove('show');
    runSearch();
    return;
  }

  const navBtn = t.closest('[data-go]');
  if (navBtn) { location.hash = '#/' + navBtn.dataset.go; return; }

  if (t.closest('[data-back]')) {
    history.length > 1 ? history.back() : (location.hash = '#/home');
    return;
  }

  if (t.closest('[data-retry]')) { route(); return; }
  if (t.closest('[data-close]')) { closeSheet(); return; }
  if (t.closest('[data-player-close]')) { closePlayer(); return; }

  if (t.closest('[data-update-later]')) {
    if (pendingUpdate) Store.set({ updateSkippedVersion: pendingUpdate.version });
    closeSheet();
    return;
  }
  if (t.closest('[data-update-download]')) {
    // let the link open normally; just close the sheet behind it
    setTimeout(closeSheet, 200);
  }

  if (t.closest('[data-browse]')) {
    openSheet(V.browseSheet());
    return;
  }

  if (t.closest('[data-browse-toggle]')) {
    const toggle = t.closest('[data-browse-toggle]');
    const genres = document.getElementById('browse-genres');
    const open = toggle.getAttribute('aria-expanded') !== 'true';
    toggle.setAttribute('aria-expanded', String(open));
    genres?.classList.toggle('collapsed', !open);
    return;
  }

  if (t.closest('[data-play-trailer]') && current) {
    closeSheet();
    openPlayer(current);
    return;
  }

  const playerEpisode = t.closest('[data-player-episode]');
  if (playerEpisode && playerState) {
    const n = Number(playerEpisode.dataset.playerEpisode);
    if (n > 0) openPlayer(playerState.media, n, playerState.language);
    return;
  }

  const playerServer = t.closest('[data-player-server]');
  if (playerServer && playerState) {
    if (playerServer.dataset.playerServer === 'megaplay') {
      renderMegaPlayFallback(playerState, 'MegaPlay selected · Server 2');
      return;
    }

    if (playerState.anivexaPlayback) {
      const primary = playerState.anivexaPlayback;
      const quality = primary.quality && primary.quality !== 'Auto'
        ? ` · ${primary.quality}`
        : '';
      renderPlayerPlayback(
        playerState,
        primary,
        `${primary.label || 'Anivexa · Server 1'}${quality}`
      );
    } else {
      toast('Anivexa is unavailable for this episode');
    }
    return;
  }

  const playerLanguage = t.closest('[data-player-language]');
  if (playerLanguage && playerState) {
    Store.set({ playbackLanguage: playerLanguage.dataset.playerLanguage });
    openPlayer(playerState.media, playerState.episode, playerLanguage.dataset.playerLanguage);
    return;
  }

  if (t.closest('[data-player-mark]') && playerState) {
    markPlayerEpisode();
    return;
  }

  if (t.closest('[data-player-rotate]') && playerState) {
    await togglePlayerOrientation();
    return;
  }

  if (t.closest('[data-player-fullscreen]')) {
    const frame = document.querySelector('#player .player-frame');
    const enter = frame?.requestFullscreen || frame?.webkitRequestFullscreen;
    if (enter) enter.call(frame);
    return;
  }

  /* hero dots */
  const dot = t.closest('[data-dot]');
  if (dot) { stopHero(); showHeroSlide(+dot.dataset.dot); return; }

  /* quick track from hero */
  const qa = t.closest('[data-quickadd]');
  if (qa) {
    const [src, id] = qa.dataset.quickadd.split(':');
    const m = heroItems.find(x => String(x.id) === id);
    if (m) {
      Store.save(m, { status: 'planning' });
      syncUp(m);
      showHeroSlide(heroIndex);
      toast('Added to Plan to watch');
    }
    return;
  }

  /* continue watching */
  const resume = t.closest('[data-resume]');
  if (resume) {
    const [src, id, ep] = resume.dataset.resume.split(':');
    const entry = Store.entry(src, id);
    if (entry) {
      const episode = Number(ep);
      openPlayer(mediaFromEntry(entry), episode);
      hydratePlayer(src, id, episode);
    }
    return;
  }

  /* genre chip anywhere */
  const gchip = t.closest('[data-genre]');
  if (gchip && gchip.closest('#genres')) {
    searchState.genre = gchip.dataset.genre || null;
    searchState.q = document.getElementById('q')?.value || '';
    document.querySelectorAll('#genres .chip').forEach(c => c.classList.toggle('on', c === gchip));
    runSearch();
    return;
  }
  if (gchip) { searchState = { q: '', format: null, genre: gchip.dataset.genre, seq: searchState.seq }; location.hash = '#/search'; return; }

  const fchip = t.closest('[data-format]');
  if (fchip) {
    searchState.format = fchip.dataset.format || null;
    document.querySelectorAll('#filters .chip').forEach(c => c.classList.toggle('on', c === fchip));
    runSearch();
    return;
  }

  /* synopsis */
  if (t.closest('[data-expand]')) {
    const syn = document.getElementById('syn');
    syn.classList.remove('clip');
    t.closest('[data-expand]').remove();
    return;
  }

  /* detail actions */
  if (t.closest('[data-watch]') && current) {
    openPlayer(current);
    return;
  }
  if (t.closest('[data-track]') && current) { openSheet(V.trackSheet(current)); return; }

  if (t.closest('[data-fav]') && current) {
    const e2 = Store.toggleFav(current);
    toast(e2.fav ? 'Added to favourites' : 'Removed from favourites');
    redrawDetail();
    return;
  }

  const site = t.closest('.sheet a.opt');
  if (site && site.href) {
    e.preventDefault();
    closeSheet();
    openExternal(site.href);
    return;
  }

  /* track sheet */
  const st = t.closest('[data-status]');
  if (st && current) {
    Store.save(current, { status: st.dataset.status });
    syncUp(current);
    toast('Moved to ' + st.textContent.trim());
    closeSheet(); redrawDetail();
    return;
  }

  const pr = t.closest('[data-prog]');
  if (pr && current) {
    const e2 = Store.entry(current.src, current.id);
    Store.setProgress(current, (e2?.progress || 0) + Number(pr.dataset.prog));
    syncUp(current);
    openSheet(V.trackSheet(current));
    return;
  }

  const pmax = t.closest('[data-prog-max]');
  if (pmax && current) {
    Store.markThrough(current, Number(pmax.dataset.progMax));
    syncUp(current);
    toast('Marked as completed');
    closeSheet(); redrawDetail();
    return;
  }

  if (t.closest('[data-untrack]') && current) {
    Store.remove(current.src, current.id);
    toast('Removed from library');
    closeSheet(); redrawDetail();
    return;
  }

  /* episodes */
  const ep = t.closest('[data-ep]');
  if (ep && current) {
    const n = Number(ep.dataset.ep);
    openPlayer(current, n);
    return;
  }

  if (t.closest('[data-eps-more]')) { epLimit += 50; expandEpisodes(); return; }

  /* library tabs */
  const tab = t.closest('[data-tab]');
  if (tab) {
    libTab = tab.dataset.tab;
    document.querySelectorAll('#libtabs button').forEach(b => b.classList.toggle('on', b === tab));
    document.getElementById('libbody').innerHTML = V.libraryBody(libTab);
    return;
  }

  /* settings */
  const srcBtn = t.closest('[data-source]');
  if (srcBtn) {
    Store.set({ source: srcBtn.dataset.source });
    renderSettings();
    toast('Now using ' + (srcBtn.dataset.source === 'mal' ? 'MyAnimeList' : 'AniList'));
    return;
  }

  const lang = t.closest('[data-lang]');
  if (lang) { Store.set({ titleLang: lang.dataset.lang }); renderSettings(); return; }

  const playbackLang = t.closest('[data-default-language]');
  if (playbackLang) {
    Store.set({ playbackLanguage: playbackLang.dataset.defaultLanguage });
    renderSettings();
    return;
  }

  const tog = t.closest('[data-toggle]');
  if (tog) {
    const k = tog.dataset.toggle;
    Store.set({ [k]: !Store.settings[k] });
    renderSettings();
    return;
  }

  if (t.closest('[data-save-mal]')) {
    Store.set({ malClientId: document.getElementById('mal-id').value.trim() });
    toast('Client ID saved on this device');
    return;
  }

  if (t.closest('[data-authorise]')) {
    const id = document.getElementById('al-client').value.trim();
    if (!id) return toast('Enter your client ID first');
    Store.set({ anilistClientId: id });
    openExternal(authUrl(id));
    toast('Copy the token, then come back');
    return;
  }

  if (t.closest('[data-signin]')) {
    const btn = t.closest('[data-signin]');
    const token = document.getElementById('al-token').value;
    btn.disabled = true; btn.textContent = 'Signing in…';
    try {
      const u = await Auth.signIn(token);
      renderSettings();
      toast('Signed in as ' + u.name);
    } catch (err) {
      btn.disabled = false; btn.textContent = 'Sign in';
      toast(err.message);
    }
    return;
  }

  if (t.closest('[data-signout]')) {
    Auth.signOut();
    renderSettings();
    toast('Signed out. Your library stays on this device.');
    return;
  }

  if (t.closest('[data-pull]')) {
    const btn = t.closest('[data-pull]');
    btn.disabled = true; btn.textContent = 'Importing…';
    try {
      const n = await Auth.pull();
      renderSettings();
      toast(`Imported ${n} ${n === 1 ? 'title' : 'titles'}`);
    } catch (err) {
      btn.disabled = false; btn.textContent = 'Import my AniList list';
      toast(err.message);
    }
    return;
  }

  if (t.closest('[data-push]')) {
    const btn = t.closest('[data-push]');
    btn.disabled = true;
    try {
      const r = await Auth.pushAll((done, total) => {
        btn.textContent = `Uploading ${done} of ${total}…`;
      });
      renderSettings();
      toast(`Uploaded ${r.ok} of ${r.total}`);
    } catch (err) {
      btn.disabled = false; btn.textContent = 'Upload everything on this device';
      toast(err.message);
    }
    return;
  }

  if (t.closest('[data-export]')) {
    const blob = new Blob([Store.export()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `aniva-library-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast('Library exported');
    return;
  }

  if (t.closest('[data-import]')) { document.getElementById('importfile').click(); return; }

  if (t.closest('[data-wipe]')) {
    if (confirm('Delete every saved title and episode tick on this device? This cannot be undone.')) {
      Store.clear();
      renderSettings();
      toast('Library deleted');
    }
    return;
  }
});

document.addEventListener('change', async e => {
  const quality = e.target.closest('[data-player-quality]');
  if (quality && playerState) {
    const selected = playerState.playback?.variants?.find(
      variant => variant.url === quality.value
    );
    if (selected) {
      const source = playerState.playback;
      const label = source.label || `Anivexa · ${source.provider || 'provider'}`;
      const qualityLabel = selected.quality && selected.quality !== 'Auto'
        ? ` · ${selected.quality}`
        : '';
      renderPlayerPlayback(playerState, {
        ...source,
        ...selected,
        variants: source.variants
      }, `${label}${qualityLabel}`);
    }
    return;
  }

  if (e.target.id === 'importfile' && e.target.files[0]) {
    try {
      const n = Store.import(await e.target.files[0].text());
      renderSettings();
      toast(`Imported ${n} ${n === 1 ? 'title' : 'titles'}`);
    } catch (err) {
      toast(err.message);
    }
    e.target.value = '';
  }
});

document.addEventListener('input', e => {
  if (e.target.id === 'q') {
    searchState.q = e.target.value;
    const clear = document.querySelector('[data-search-clear]');
    if (clear) {
      clear.hidden = !e.target.value;
      clear.classList.toggle('show', !!e.target.value);
    }
    queueSearch();
  }
});

document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.id === 'q') {
    e.preventDefault();
    clearTimeout(searchTimer);
    searchState.q = e.target.value;
    runSearch();
    return;
  }
  if (e.key !== 'Escape') return;
  if (document.getElementById('player-host')) closePlayer();
  else closeSheet();
});

window.addEventListener('hashchange', route);

/* Playback events are sent by the embedded player. Only trust its origin. */
window.addEventListener('message', e => {
  if (!playerState || !['https://megaplay.buzz', 'https://www.megaplay.buzz'].includes(e.origin)) return;
  let data = e.data;
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch { return; }
  }
  if (data?.event === 'complete') {
    markPlayerEpisode();
    toast('Episode completed');
  }
});

/* Android hardware back button, when running inside Capacitor */
document.addEventListener('deviceready', () => {}, false);
window.addEventListener('load', () => {
  if (window.Capacitor?.Plugins?.App) {
    window.Capacitor.Plugins.App.addListener('backButton', ({ canGoBack }) => {
      if (document.getElementById('player-host')) return closePlayer();
      if (document.getElementById('sheet-host')) return closeSheet();
      if (canGoBack && location.hash && location.hash !== '#/home') history.back();
      else window.Capacitor.Plugins.App.exitApp();
    });
  }
});

/* keep the library screen live when the store changes elsewhere */
Store.subscribe(() => {
  if (location.hash.startsWith('#/library')) {
    const body = document.getElementById('libbody');
    if (body) body.innerHTML = V.libraryBody(libTab);
  }
  /* ticking an episode anywhere should move the home rail with it */
  const resume = document.getElementById('resume');
  if (resume) resume.innerHTML = V.resumeRail();
});

if (!location.hash) location.hash = '#/home';
route();
checkForUpdate();

/* drop the splash once the first screen is in the DOM */
function dropSplash() {
  const boot = document.getElementById('boot');
  if (!boot) return;
  boot.style.transition = 'opacity .25s ease';
  boot.style.opacity = '0';
  setTimeout(() => boot.remove(), 260);
}

if (typeof requestAnimationFrame === 'function') requestAnimationFrame(dropSplash);
else setTimeout(dropSplash, 0);
