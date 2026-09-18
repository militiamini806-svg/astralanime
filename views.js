/* views.js — rendering only. No fetching happens here except through Api. */

import { GENRES, FORMATS, playbackUrl, releasedEpisodeCount } from './api.js';
import { Store, STATUSES } from './store.js';
import { Auth, authUrl } from './auth.js';

/* ── brand ───────────────────────────────────────────────── */

export const LOGO = `
  <svg viewBox="0 0 64 64" aria-hidden="true">
    <defs>
      <linearGradient id="astral" x1="16" y1="8" x2="50" y2="56" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="#FF3B52"/>
        <stop offset=".55" stop-color="#E8102F"/>
        <stop offset="1" stop-color="#8E0018"/>
      </linearGradient>
    </defs>
    <path d="M13 53 L32 11 L51 53" fill="none" stroke="url(#astral)" stroke-width="7.5"
          stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M32 30 C32.8 36.4 34.6 38.2 40 39 C34.6 39.8 32.8 41.6 32 48 C31.2 41.6 29.4 39.8 24 39 C29.4 38.2 31.2 36.4 32 30 Z"
          fill="#FFF1F2"/>
  </svg>`;

export function brandBar() {
  const u = Auth.user;
  return `
    <header class="brand">
      ${LOGO}
      <b>Astralanime</b>
      <button class="menu-btn" data-browse aria-label="Browse sections">${svg('menu')}</button>
      <span class="spacer"></span>
      ${u ? `<a class="who" href="#/settings">
               <img src="${esc(u.avatar)}" alt="">${esc(u.name)}
             </a>`
          : `<a class="who" href="#/settings">Sign in</a>`}
    </header>`;
}

/* ── helpers ─────────────────────────────────────────────── */

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const ICON = {
  home:   '<path d="M3 10.2 12 3l9 7.2V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  books:  '<path d="M4 4h6v16H4zM14 4h6v16h-6z"/><path d="M4 9h6M14 9h6"/>',
  gear:   '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1"/>',
  menu:   '<path d="M4 7h16M4 12h16M4 17h16"/>',
  close:  '<path d="m6 6 12 12M18 6 6 18"/>',
  down:   '<path d="m6 9 6 6 6-6"/>',
  play:   '<path d="M6 4.5 19 12 6 19.5z" fill="currentColor" stroke="none"/>',
  plus:   '<path d="M12 5v14M5 12h14"/>',
  check:  '<path d="m4 12.5 5 5L20 6.5"/>',
  heart:  '<path d="M12 20s-7-4.6-7-9.5A4 4 0 0 1 12 7a4 4 0 0 1 7 3.5C19 15.4 12 20 12 20z"/>',
  ext:    '<path d="M14 4h6v6M20 4l-8.5 8.5"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  back:   '<path d="M15 5l-7 7 7 7"/>',
  previous: '<path d="m15 18-6-6 6-6"/><path d="M20 18l-6-6 6-6"/>',
  next:    '<path d="m9 18 6-6-6-6"/><path d="m4 18 6-6-6-6"/>',
  expand:  '<path d="M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5"/>',
  info:   '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>'
};

export const svg = (n, cls = '') =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
        stroke-linecap="round" stroke-linejoin="round" class="${cls}">${ICON[n] || ''}</svg>`;

const FORMAT_LABEL = {
  TV: 'TV', TV_SHORT: 'Short', MOVIE: 'Film', SPECIAL: 'Special',
  OVA: 'OVA', ONA: 'ONA', MUSIC: 'Music'
};

const STATUS_LABEL = {
  RELEASING: 'Airing', FINISHED: 'Finished', NOT_YET_RELEASED: 'Not yet aired',
  CANCELLED: 'Cancelled', HIATUS: 'On hiatus'
};

export const fmt = m => FORMAT_LABEL[m?.format] || m?.format || '';

export function metaLine(m) {
  const bits = [];
  if (m.year) bits.push(m.year);
  if (fmt(m)) bits.push(fmt(m));
  if (m.episodes) bits.push(m.episodes + (m.episodes === 1 ? ' ep' : ' eps'));
  return bits.join('  ');
}

export function countdown(sec) {
  if (!sec) return '';
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), mi = Math.floor((sec % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${mi}m`;
  return `${mi}m`;
}

/** AniList hands back a cover colour per title; use it, or fall back. */
export const tintOf = m =>
  (Store.settings.tintFromCover && m && m.color) ? m.color : 'var(--accent)';

/* ── cards ───────────────────────────────────────────────── */

export function card(m, opts = {}) {
  if (!m) return '';
  const entry = Store.entry(m.src, m.id);
  const pct = entry && m.episodes ? Math.min(100, (entry.progress / m.episodes) * 100) : 0;
  const t = Store.titleOf(m);
  return `
    <a class="card" href="#/anime/${m.src}/${m.id}" style="--tint:${esc(tintOf(m))}">
      <div class="card-art">
        <img src="${esc(m.cover)}" alt="" loading="lazy" decoding="async">
        ${m.score ? `<span class="score">${(m.score / 10).toFixed(1)}</span>` : ''}
        ${pct > 0 ? `<span class="prog"><i style="width:${pct}%"></i></span>` : ''}
      </div>
      <h4>${esc(t)}</h4>
      <span>${esc(opts.sub || metaLine(m))}</span>
    </a>`;
}

export function rankCard(m, i) {
  if (!m) return '';
  return `
    <a class="card card-rank" href="#/anime/${m.src}/${m.id}" style="--tint:${esc(tintOf(m))}">
      <b class="num">${i + 1}</b>
      <div style="min-width:0">
        <div class="card-art">
          <img src="${esc(m.cover)}" alt="" loading="lazy" decoding="async">
          ${m.score ? `<span class="score">${(m.score / 10).toFixed(1)}</span>` : ''}
        </div>
        <h4>${esc(Store.titleOf(m))}</h4>
      </div>
    </a>`;
}

export const skeletonRail = (n = 6) => `
  <div class="rail">
    <div class="rail-head"><div class="skel" style="width:140px;height:18px"></div></div>
    <div class="rail-track">
      ${Array.from({ length: n }, () => `
        <div class="card"><div class="skel" style="aspect-ratio:2/3"></div>
        <div class="skel" style="height:12px;margin-top:8px"></div></div>`).join('')}
    </div>
  </div>`;

export function rail({ id, title, note }) {
  return `
    <section class="rail" data-rail="${id}">
      <div class="rail-head">
        <div>
          <h3 class="t-rail">${esc(title)}</h3>
          ${note ? `<p>${esc(note)}</p>` : ''}
        </div>
      </div>
      <div class="rail-track" data-track="${id}">
        ${Array.from({ length: 5 }, () => `
          <div class="card"><div class="skel" style="aspect-ratio:2/3"></div></div>`).join('')}
      </div>
    </section>`;
}

export function fillRail(id, items, ranked) {
  const track = document.querySelector(`[data-track="${id}"]`);
  if (!track) return;
  if (!items || !items.length) {
    track.closest('.rail')?.remove();
    return;
  }
  track.innerHTML = ranked
    ? items.map((m, i) => rankCard(m, i)).join('')
    : items.map(m => card(m)).join('');
}

/* ── home ────────────────────────────────────────────────── */

export function homeShell() {
  return `
    <div class="view">
      ${brandBar()}
      <section class="hero" id="hero">
        <div class="hero-slide on"><div class="skel" style="width:100%;height:100%"></div></div>
      </section>
      <div id="rails">
        ${rail({ id: 'trending', title: 'Trending now', note: 'What everyone is picking up this week' })}
        ${rail({ id: 'top10', title: 'The top ten', note: 'Highest rated anime ever made', ranked: true })}
        ${rail({ id: 'season', title: 'Airing this season' })}
        ${rail({ id: 'popular', title: 'Most watched of all time' })}
        ${rail({ id: 'movies', title: 'Films worth the evening' })}
        ${rail({ id: 'upcoming', title: 'Coming next season' })}
        ${rail({ id: 'g1', title: 'Action' })}
        ${rail({ id: 'g2', title: 'Slice of life' })}
      </div>
    </div>`;
}

export function heroMarkup(items) {
  if (!items.length) return '';
  const slides = items.map((m, i) => `
    <div class="hero-slide${i === 0 ? ' on' : ''}" data-slide="${i}">
      <img src="${esc(m.banner || m.cover)}" alt="">
    </div>`).join('');

  const dots = items.map((_, i) =>
    `<i data-dot="${i}" class="${i === 0 ? 'on' : ''}"></i>`).join('');

  return `${slides}
    <div class="hero-dots">${dots}</div>
    <div class="hero-body" id="hero-body"></div>`;
}

export function heroBody(m) {
  const next = m.nextEp
    ? `Episode ${m.nextEp.n} in ${countdown(m.nextEp.inSec)}`
    : 'Airing now';
  const tracked = Store.entry(m.src, m.id);
  return `
    <span class="airing-tag"><i class="pulse"></i>${esc(next)}</span>
    <h2 class="t-display">${esc(Store.titleOf(m))}</h2>
    <p class="hero-genres">${esc(m.genres.slice(0, 3).join('   '))}</p>
    <div class="hero-actions">
      <a class="btn btn-solid" href="#/anime/${m.src}/${m.id}">${svg('play')} Open</a>
      <button class="btn btn-ghost${tracked ? ' tracked' : ''}" data-quickadd="${m.src}:${m.id}">
        ${svg(tracked ? 'check' : 'plus')} ${tracked ? 'Tracked' : 'Track'}
      </button>
    </div>`;
}

/* ── search ──────────────────────────────────────────────── */

export function searchShell(state) {
  return `
    <div class="view">
      ${brandBar()}
      <div class="searchbar">
        <div>
          ${svg('search')}
          <input id="q" type="search" placeholder="Search anime" autocomplete="off"
                 value="${esc(state.q || '')}" enterkeyhint="search">
        </div>
      </div>
      <div class="filters" id="filters">
        <button class="chip${!state.format ? ' on' : ''}" data-format="">Any format</button>
        ${FORMATS.map(f => `<button class="chip${state.format === f.v ? ' on' : ''}" data-format="${f.v}">${esc(f.label)}</button>`).join('')}
      </div>
      <div class="filters" id="genres">
        <button class="chip${!state.genre ? ' on' : ''}" data-genre="">All genres</button>
        ${GENRES.map(g => `<button class="chip${state.genre === g ? ' on' : ''}" data-genre="${esc(g)}">${esc(g)}</button>`).join('')}
      </div>
      <div id="results"></div>
    </div>`;
}

export const grid = items => `<div class="grid">${items.map(m => card(m)).join('')}</div>`;

export const loadingGrid = (n = 8) => `<div class="grid">${Array.from({ length: n }, () => `
  <div class="card"><div class="skel" style="aspect-ratio:2/3"></div>
  <div class="skel" style="height:12px;margin-top:8px"></div></div>`).join('')}</div>`;

export const empty = (h, p, action = '') =>
  `<div class="empty"><h3>${esc(h)}</h3><p>${esc(p)}</p>${action}</div>`;

export function categoryShell(title, note) {
  return `
    <div class="view">
      ${brandBar()}
      <header class="page-head category-head">
        <div>
          <h1 class="t-display">${esc(title)}</h1>
          <p>${esc(note)}</p>
        </div>
        <button class="btn btn-line browse-action" data-browse>${svg('menu')} Browse</button>
      </header>
      <div id="category-results">${loadingGrid()}</div>
    </div>`;
}

export function browseSheet() {
  const links = [
    ['Home', '#/home'],
    ['Completed', '#/completed'],
    ['Most Popular', '#/popular'],
    ['Movies', '#/movies'],
    ['TV Series', '#/tv'],
    ['OVAs', '#/ova'],
    ['ONAs', '#/ona'],
    ['Specials', '#/special']
  ];
  return `
    <div class="scrim" data-close></div>
    <aside class="browse-panel" role="dialog" aria-label="Browse sections">
      <div class="browse-head">
        <div>
          <span class="browse-kicker">Astralanime</span>
          <h2>Browse</h2>
        </div>
        <button class="browse-close" data-close aria-label="Close browse menu">${svg('close')}</button>
      </div>
      <nav class="browse-links">
        ${links.map(([label, href]) => `<a class="browse-item" href="${href}">${esc(label)}</a>`).join('')}
        <button class="browse-item browse-toggle" data-browse-toggle aria-expanded="true">
          <span>${svg('down')} Genre</span>
          <span class="browse-count">${GENRES.length}</span>
        </button>
        <div class="browse-genres" id="browse-genres">
          ${GENRES.map(g => `<a href="#/genre/${encodeURIComponent(g)}">${esc(g)}</a>`).join('')}
        </div>
      </nav>
    </aside>`;
}

/* ── library ─────────────────────────────────────────────── */

export function libraryShell(tab) {
  const c = Store.counts();
  const tabs = [
    { v: 'all', label: 'Everything' },
    ...STATUSES,
    { v: 'favourites', label: 'Favourites' }
  ];
  return `
    <div class="view">
      ${brandBar()}
      <header class="page-head">
        <h1 class="t-display">Your library</h1>
        <p>Saved on this device. Nothing leaves the phone unless you export it.</p>
      </header>
      <div class="tabs" id="libtabs">
        ${tabs.map(t => `
          <button class="${tab === t.v ? 'on' : ''}" data-tab="${t.v}">
            ${esc(t.label)}${c[t.v] ? ` ${c[t.v]}` : ''}
          </button>`).join('')}
      </div>
      <div id="libbody"></div>
    </div>`;
}

export function libraryBody(tab) {
  const rows = Store.list(tab === 'all' ? null : tab);
  if (!rows.length) {
    return empty(
      'Nothing here yet',
      'Open any title and press Track to add it to this shelf.',
      `<a class="btn btn-line" href="#/home">Browse anime</a>`
    );
  }
  const cards = rows.map(e => {
    const m = { src: e.src, id: e.id, ...e.stub, title: e.stub.title, color: e.stub.color };
    const sub = e.stub.episodes
      ? `${e.progress} of ${e.stub.episodes}`
      : e.progress ? `${e.progress} watched` : metaLine(m);
    return card({ ...m, episodes: e.stub.episodes, score: e.stub.score, year: e.stub.year, format: e.stub.format }, { sub });
  });
  return `<div class="grid">${cards.join('')}</div>`;
}

/* ── detail ──────────────────────────────────────────────── */

export function detailShell() {
  return `
    <div class="view">
      <button class="back" data-back aria-label="Go back">${svg('back')}</button>
      <div class="d-banner"><div class="skel" style="width:100%;height:100%"></div></div>
      <div class="d-top">
        <div class="d-cover skel"></div>
        <div class="d-head"><div class="skel" style="width:180px;height:22px"></div></div>
      </div>
    </div>`;
}

export function detailView(m) {
  const e = Store.entry(m.src, m.id);
  const tint = tintOf(m);
  const alt = [m.title.english, m.title.native].filter(t => t && t !== Store.titleOf(m))[0];
  const statusLabel = e ? (STATUSES.find(s => s.v === e.status)?.label || 'Tracked') : 'Track';

  const stats = [
    m.score ? { v: (m.score / 10).toFixed(1), l: 'Score' } : null,
    m.episodes ? { v: m.episodes, l: m.episodes === 1 ? 'Episode' : 'Episodes' } : null,
    m.duration ? { v: m.duration + 'm', l: 'Per episode' } : null,
    m.popularity ? { v: shortNum(m.popularity), l: 'Following' } : null
  ].filter(Boolean);

  const eps = episodeList(m);

  return `
    <div class="view" style="--tint:${esc(tint)}">
      <button class="back" data-back aria-label="Go back">${svg('back')}</button>

      <div class="d-banner">
        <img src="${esc(m.banner || m.cover)}" alt="">
      </div>

      <div class="d-top">
        <div class="d-cover"><img src="${esc(m.cover)}" alt=""></div>
        <div class="d-head">
          <h1>${esc(Store.titleOf(m))}</h1>
          ${alt ? `<div class="alt">${esc(alt)}</div>` : ''}
          <div class="alt">${esc([STATUS_LABEL[m.status], m.studios[0]].filter(Boolean).join('   '))}</div>
        </div>
      </div>

      ${stats.length ? `<div class="d-stats">
        ${stats.map(s => `<div><strong>${esc(s.v)}</strong><span>${esc(s.l)}</span></div>`).join('')}
      </div>` : ''}

      <div class="d-actions">
         <button class="btn btn-tint" data-watch>${svg('play')} Play</button>
        <button class="btn btn-line${e ? ' tracked' : ''}" data-track>
          ${svg(e ? 'check' : 'plus')} ${esc(e ? 'Tracked' : statusLabel)}
        </button>
        <button class="btn btn-line btn-icon" data-fav aria-label="Favourite"
                style="${e && e.fav ? `color:${esc(tint)}` : ''}">${svg('heart')}</button>
      </div>

      ${m.nextEp ? `<div class="pad" style="margin-top:16px">
        <span class="airing-tag"><i class="pulse"></i>Episode ${m.nextEp.n} airs in ${countdown(m.nextEp.inSec)}</span>
      </div>` : ''}

      ${m.genres.length ? `<div class="chips">
        ${m.genres.map(g => `<button class="chip" data-genre="${esc(g)}">${esc(g)}</button>`).join('')}
      </div>` : ''}

      ${m.description ? `<div class="synopsis clip" id="syn">
        <p class="t-body">${esc(m.description)}</p>
        <button data-expand>Read more</button>
      </div>` : ''}

      ${eps}

      ${m.characters.length ? `<section class="sec">
        <h3>Characters</h3>
        <div class="rail-track">
          ${m.characters.map(c => `
            <div class="char">
              <img src="${esc(c.img)}" alt="" loading="lazy">
              <b>${esc(c.name)}</b>
              <span>${esc((c.role || '').toLowerCase())}</span>
            </div>`).join('')}
        </div>
      </section>` : ''}

      <section class="sec">
        <h3>Details</h3>
        <dl class="facts">
          ${fact('Format', fmt(m))}
          ${fact('Status', STATUS_LABEL[m.status])}
          ${fact('Season', m.season ? `${m.season[0] + m.season.slice(1).toLowerCase()} ${m.year || ''}`.trim() : m.year)}
          ${fact('Studio', m.studios.join(', '))}
          ${fact('Source material', m.source ? m.source.replace(/_/g, ' ').toLowerCase() : '')}
          ${fact('Also known as', m.synonyms.slice(0, 2).join(' / '))}
          ${fact('Catalogue', `AniList ${m.src === 'anilist' ? m.id : '—'}${m.malId ? `  ·  MAL ${m.malId}` : ''}`)}
        </dl>
      </section>

      ${m.relations.length ? `<section class="sec">
        <h3>Related</h3>
        <div class="rail-track">
          ${m.relations.slice(0, 12).map(r => card({
            src: r.src, id: r.id, title: r.title, cover: r.cover, color: r.color, format: r.format
          }, { sub: (r.relation || '').replace(/_/g, ' ').toLowerCase() })).join('')}
        </div>
      </section>` : ''}

      ${m.recommendations.length ? `<section class="sec">
        <h3>If you liked this</h3>
        <div class="rail-track">
          ${m.recommendations.map(r => card({
            src: r.src, id: r.id, title: r.title, cover: r.cover, color: r.color,
            score: r.score, format: r.format, year: r.year
          })).join('')}
        </div>
      </section>` : ''}

      <div style="height:30px"></div>
    </div>`;
}

const fact = (k, v) => v ? `<div class="fact"><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>` : '';

export function shortNum(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace('.0', '') + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace('.0', '') + 'k';
  return String(n);
}

/* ── episode list ────────────────────────────────────────── */

export function episodeList(m, limit = 24) {
  const total = episodeCount(m);
  if (!total) return '';

  const byNum = new Map(m.streamEpisodes.map(e => [e.n, e]));
  const rows = [];
  for (let n = 1; n <= Math.min(total, limit); n++) {
    const info = byNum.get(n);
    const isSeen = Store.isSeen(m.src, m.id, n);
    rows.push(`
      <button class="ep${isSeen ? ' seen' : ''}" data-ep="${n}">
        <span class="ep-n">${n}</span>
        <span class="ep-b">
          <b>${esc(info?.title || `Episode ${n}`)}</b>
           <span>${esc(isSeen ? 'Watched' : info ? 'Ready to play' : 'Not watched')}</span>
         </span>
         <span class="ep-go">${svg(isSeen ? 'check' : 'play')}</span>
      </button>`);
  }

  const hidden = total - Math.min(total, limit);
  return `
    <section class="sec" id="episodes">
      <h3>Episodes</h3>
      <div class="eps">
        ${rows.join('')}
        ${hidden > 0 ? `<button class="ep-more" data-eps-more>Show ${hidden} more</button>` : ''}
      </div>
    </section>`;
}

export function episodeCount(m) {
  return releasedEpisodeCount(m);
}

export function episodeRows(m) {
  const byNum = new Map((m?.streamEpisodes || []).map(e => [Number(e.n), e]));
  return Array.from({ length: episodeCount(m) }, (_, i) => {
    const n = i + 1;
    return { n, ...(byNum.get(n) || {}) };
  });
}


/* ── player ──────────────────────────────────────────────── */

/** In-app episode player. The iframe is the only playback surface. */
export function playerView(m, episode = 1, language = 'sub') {
  const episodes = episodeRows(m);
  const current = episodes.find(e => e.n === Number(episode)) || episodes[0];
  const n = current?.n || Number(episode) || 1;
  const title = Store.titleOf(m);
  const total = episodes.length;
  const src = total ? playbackUrl(m, n, language) : '';
  const previous = n > 1 ? n - 1 : null;
  const next = n < total ? n + 1 : null;

  return `
    <div class="player" id="player" style="--tint:${esc(tintOf(m))}">
      <div class="player-bar">
        <button data-player-close aria-label="Close player">${svg('back')}</button>
        <span class="t">
           <b>${esc(title)}</b>
           <span>Episode ${n}${total ? ` of ${total}` : ''}</span>
        </span>
         <button class="player-fullscreen" data-player-fullscreen aria-label="Fullscreen">${svg('expand')}</button>
      </div>
      <div class="player-stage">
        <div class="player-frame">
           ${src ? `<iframe
               src="${esc(src)}"
               title="${esc(title)} episode ${n}"
               allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
               referrerpolicy="strict-origin-when-cross-origin"
               allowfullscreen></iframe>`
             : `<div class="player-empty"><div class="player-empty-mark">${svg('play')}</div>
                   <h3>${total ? 'Episode unavailable' : 'No released episodes yet'}</h3>
                   <p>${total
                     ? 'This title does not have a playable catalogue ID yet.'
                     : 'The episode list will appear after an official release.'}</p></div>`}
        </div>
      </div>
       <div class="player-toolbar">
         <button class="player-control${previous ? '' : ' disabled'}" data-player-episode="${previous || ''}" ${previous ? '' : 'disabled'} aria-label="Previous episode">
           ${svg('previous')}<span>Previous</span>
         </button>
         <button class="player-control player-control-main" data-player-mark="${n}" aria-label="Mark episode watched">
           ${svg(Store.isSeen(m.src, m.id, n) ? 'check' : 'plus')}<span>${Store.isSeen(m.src, m.id, n) ? 'Watched' : 'Mark watched'}</span>
         </button>
         <button class="player-control${next ? '' : ' disabled'}" data-player-episode="${next || ''}" ${next ? '' : 'disabled'} aria-label="Next episode">
           <span>Next</span>${svg('next')}
         </button>
       </div>
       <div class="player-options">
         <div class="player-languages" role="group" aria-label="Audio">
           <button class="${language === 'sub' ? 'on' : ''}" data-player-language="sub">Sub</button>
           <button class="${language === 'dub' ? 'on' : ''}" data-player-language="dub">Dub</button>
         </div>
         <span class="player-hint">Choose an episode</span>
       </div>
       <div class="player-episodes">
         <div class="player-episodes-head"><b>Episodes</b><span>${total || 0} available</span></div>
         <div class="player-episode-grid">
           ${episodes.length ? episodes.map(e => `
             <button class="player-episode${e.n === n ? ' on' : ''}${Store.isSeen(m.src, m.id, e.n) ? ' seen' : ''}" data-player-episode="${e.n}">
               <span>${e.n}</span>${Store.isSeen(m.src, m.id, e.n) ? svg('check') : ''}
             </button>`).join('') : `
             <p class="player-no-episodes">No episodes are listed for this title.</p>`}
         </div>
      </div>
    </div>`;
}

/* ── sheets ──────────────────────────────────────────────── */

export function sheet(inner) {
  return `<div class="scrim" data-close></div><div class="sheet" role="dialog">
    <div class="sheet-grip"></div>${inner}</div>`;
}

export function watchSheet(m) {
  const sites = m.links || [];
  const body = sites.length
    ? sites.map(s => `
        <a class="opt" href="${esc(s.url)}" target="_blank" rel="noopener">
          <i class="site-dot" style="background:${esc(s.color || 'var(--tint)')}"></i>
          ${esc(s.site)}<em>Opens the app or site</em>
        </a>`).join('')
    : `<p class="t-meta" style="margin:0 0 14px">
         No licensed streaming service is listed for this title in your region's catalogue.
         Searching the title on a service you already pay for is usually the fastest route.
       </p>`;

  return sheet(`
    <h3>Watch ${esc(Store.titleOf(m))}</h3>
    <p>Official streaming services carrying this title.</p>
    ${body}
  `);
}

export function trackSheet(m) {
  const e = Store.entry(m.src, m.id);
  const max = releasedEpisodeCount(m);
  return sheet(`
    <h3>${esc(Store.titleOf(m))}</h3>
    <p>${e ? 'On your shelf' : 'Add to your shelf'}</p>
    ${STATUSES.map(s => `
      <button class="opt${e && e.status === s.v ? ' on' : ''}" data-status="${s.v}">
        ${e && e.status === s.v ? svg('check') : ''}${esc(s.label)}
      </button>`).join('')}
    <div class="row" style="border:0">
      <div class="row-b"><b>Progress</b><span>${esc(max ? `of ${max} released episodes` : 'released episodes watched')}</span></div>
      <button class="btn btn-line" data-prog="-1" style="width:42px;padding:0">−</button>
      <em style="min-width:34px;text-align:center;font-size:16px;color:var(--paper)">${e?.progress || 0}</em>
      <button class="btn btn-line" data-prog="1" style="width:42px;padding:0">+</button>
    </div>
    ${max ? `<button class="opt" data-prog-max="${max}">Mark all ${max} released episodes as watched</button>` : ''}
    ${e ? `<button class="opt" data-untrack style="color:var(--accent)">Remove from library</button>` : ''}
  `);
}


/* ── account block ───────────────────────────────────────── */

export function accountBlock() {
  const s = Store.settings;
  const u = Auth.user;

  if (Auth.signedIn) {
    return `
      <div class="account">
        <img src="${esc(u.avatar)}" alt="">
        <div>
          <b>${esc(u.name)}</b>
          <span>${u.count} titles · ${u.watched} episodes on AniList</span>
        </div>
      </div>
      <button class="row" data-toggle="syncOnChange">
        <span class="row-b"><b>Sync as you watch</b><span>Send progress up whenever you tick an episode</span></span>
        <span class="switch${s.syncOnChange ? ' on' : ''}"></span>
      </button>
      <button class="btn btn-line btn-wide" data-pull style="margin-top:12px">
        Import my AniList list
      </button>
      <button class="btn btn-line btn-wide" data-push style="margin-top:8px">
        Upload everything on this device
      </button>
      <button class="btn btn-line btn-wide" data-signout style="margin-top:8px;color:var(--accent)">
        Sign out
      </button>`;
  }

  return `
    <p style="margin:0 0 14px;font-size:12.5px;color:var(--muted);max-width:60ch">
      Browsing needs no account. Sign in only if you want your watchlist and
      progress to live on anilist.co as well as on this phone.
    </p>
    <ol class="steps">
      <li>Open anilist.co → Settings → Developer → Create New Client. Name it
          Astralanime and set the redirect URL to
          <code>https://anilist.co/api/v2/oauth/pin</code>.</li>
      <li>Paste the client ID below and press Authorise.</li>
      <li>AniList shows you a token. Copy it, come back, paste it, press Sign in.</li>
    </ol>
    <input class="field" id="al-client" type="text" inputmode="numeric"
           placeholder="Client ID" value="${esc(s.anilistClientId)}">
    <button class="btn btn-line btn-wide" data-authorise style="margin-top:10px">
      ${svg('ext')} Authorise on AniList
    </button>
    <input class="field" id="al-token" type="password" placeholder="Paste the token"
           style="margin-top:14px">
    <button class="btn btn-tint btn-wide" data-signin style="margin-top:10px">Sign in</button>`;
}

/* ── settings ────────────────────────────────────────────── */

export function settingsView() {
  const s = Store.settings;
  const c = Store.counts();
  const row = (label, sub, right, attr = '') =>
    `<button class="row" ${attr}><span class="row-b"><b>${esc(label)}</b>${sub ? `<span>${esc(sub)}</span>` : ''}</span>${right}</button>`;
  const toggle = on => `<span class="switch${on ? ' on' : ''}"></span>`;

  return `
    <div class="view">
      ${brandBar()}
      <header class="page-head">
        <h1 class="t-display">Settings</h1>
        <p>Choose where your anime data comes from and how titles are shown.</p>
      </header>

      <section class="set-group">
        <h3>Catalogue</h3>
        <p>AniList needs no account to browse. MyAnimeList data comes through Jikan, which is slower but covers older titles well.</p>
        <button class="opt${s.source === 'anilist' ? ' on' : ''}" data-source="anilist">
          AniList<em>${s.source === 'anilist' ? 'In use' : 'Fast, rich artwork'}</em></button>
        <button class="opt${s.source === 'mal' ? ' on' : ''}" data-source="mal">
          MyAnimeList<em>${s.source === 'mal' ? 'In use' : 'Deep back catalogue'}</em></button>
      </section>

      <section class="set-group">
        <h3>Titles</h3>
        ${['romaji', 'english', 'native'].map(v => `
          <button class="opt${s.titleLang === v ? ' on' : ''}" data-lang="${v}">
            ${v === 'romaji' ? 'Romaji' : v === 'english' ? 'English' : 'Japanese'}
            <em>${v === 'romaji' ? 'Shingeki no Kyojin' : v === 'english' ? 'Attack on Titan' : '進撃の巨人'}</em>
          </button>`).join('')}
      </section>

      <section class="set-group">
        <h3>Behaviour</h3>
        ${row('Tint pages with cover art', 'Each title colours its own page', toggle(s.tintFromCover), 'data-toggle="tintFromCover"')}
        ${row('Ticking an episode updates progress', '', toggle(s.autoTrack), 'data-toggle="autoTrack"')}
        ${row('Show adult titles', 'Hidden by default', toggle(s.adult), 'data-toggle="adult"')}
      </section>

      <section class="set-group">
        <h3>Playback</h3>
        <p>Choose the audio track the player opens with. You can change it inside the player at any time.</p>
        <button class="opt${s.playbackLanguage === 'sub' ? ' on' : ''}" data-default-language="sub">
          Subtitles<em>${s.playbackLanguage === 'sub' ? 'Default' : 'Use subtitles'}</em></button>
        <button class="opt${s.playbackLanguage === 'dub' ? ' on' : ''}" data-default-language="dub">
          Dubbed audio<em>${s.playbackLanguage === 'dub' ? 'Default' : 'Use dubbed audio'}</em></button>
      </section>

      <section class="set-group">
        <h3>AniList account</h3>
        ${accountBlock()}
      </section>

      <section class="set-group">
        <h3>MyAnimeList</h3>
        <p>Optional. A client ID unlocks MAL's own API later; browsing works without one.</p>
        <input class="field" id="mal-id" type="text" placeholder="Client ID" value="${esc(s.malClientId)}">
        <button class="btn btn-line btn-wide" data-save-mal style="margin-top:10px">Save client ID</button>
      </section>

      <section class="set-group">
        <h3>Your data</h3>
        <p>${c.all} ${c.all === 1 ? 'title' : 'titles'} saved on this device.</p>
        <button class="btn btn-line btn-wide" data-export style="margin-bottom:8px">Export library as a file</button>
        <button class="btn btn-line btn-wide" data-import style="margin-bottom:8px">Import a backup</button>
        <input type="file" id="importfile" accept="application/json" hidden>
        <button class="btn btn-line btn-wide" data-wipe style="color:var(--accent)">Delete everything</button>
      </section>

      <section class="set-group">
        <h3>About</h3>
        <p>Astralanime is a discovery and tracking app. Metadata comes from AniList and MyAnimeList; playback points at the services that license each show.</p>
      </section>

      <p style="text-align:center;color:var(--muted);font-size:12px;margin:24px 0 0">
        This app is owned by “Sukuna &amp; Akaza lol”.
      </p>
      <div style="height:20px"></div>
    </div>`;
}
