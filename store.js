/* store.js — everything lives on the device.
 *
 *  astralanime.library  { "anilist:21": { src,id,status,progress,score,fav,updatedAt,stub } }
 *  astralanime.settings { source, titleLang, adult, autoTrack, malClientId, anilistToken }
 *  astralanime.seen     { "anilist:21": [1,2,3] }   episodes ticked off
 */

const K_LIB = 'astralanime.library';
const K_SET = 'astralanime.settings';
const K_SEEN = 'astralanime.seen';

export const STATUSES = [
  { v: 'watching',  label: 'Watching' },
  { v: 'planning',  label: 'Plan to watch' },
  { v: 'completed', label: 'Completed' },
  { v: 'paused',    label: 'On hold' },
  { v: 'dropped',   label: 'Dropped' }
];

const DEFAULTS = {
  source: 'anilist',      // 'anilist' | 'mal'
  titleLang: 'romaji',    // 'romaji' | 'english' | 'native'
  adult: false,
  autoTrack: true,        // ticking an episode bumps progress
  tintFromCover: false,     // the app is black and red unless you turn this on
  playbackLanguage: 'sub',  // 'sub' | 'dub'
  malClientId: '',
  anilistClientId: '',
  anilistToken: '',
  anilistUser: null,
  syncOnChange: true        // push progress to AniList as you watch
};

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

let library = read(K_LIB, {});
let settings = { ...DEFAULTS, ...read(K_SET, {}) };
let seen = read(K_SEEN, {});

const subs = new Set();
function emit() { subs.forEach(fn => fn()); }

export const key = (src, id) => `${src}:${id}`;

/** Keep only what a poster card needs, so the library renders offline. */
function stubOf(m) {
  return {
    title: m.title,
    cover: m.cover,
    color: m.color,
    episodes: m.episodes,
    format: m.format,
    year: m.year,
    score: m.score,
    status_: m.status
  };
}

export const Store = {
  subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },

  /* ── settings ── */
  get settings() { return settings; },

  set(patch) {
    settings = { ...settings, ...patch };
    write(K_SET, settings);
    emit();
  },

  /** Title in the language the user picked, with sensible fallbacks. */
  titleOf(m) {
    if (!m) return '';
    const t = m.title || {};
    const order = settings.titleLang === 'english' ? ['english', 'romaji', 'native']
                : settings.titleLang === 'native'  ? ['native', 'romaji', 'english']
                : ['romaji', 'english', 'native'];
    for (const k of order) if (t[k]) return t[k];
    return '';
  },

  /* ── library ── */
  get library() { return library; },

  entry(src, id) { return library[key(src, id)] || null; },

  list(status) {
    const all = Object.values(library);
    const rows = status === 'favourites'
      ? all.filter(e => e.fav)
      : status ? all.filter(e => e.status === status) : all;
    return rows.sort((a, b) => b.updatedAt - a.updatedAt);
  },

  counts() {
    const c = { all: 0, favourites: 0 };
    STATUSES.forEach(s => { c[s.v] = 0; });
    Object.values(library).forEach(e => {
      c.all++;
      if (e.fav) c.favourites++;
      if (c[e.status] !== undefined) c[e.status]++;
    });
    return c;
  },

  /** Force a redraw without changing anything — used after a bulk import. */
  touch() { emit(); },

  save(media, patch = {}, opts = {}) {
    const k = key(media.src, media.id);
    const prev = library[k] || {
      src: media.src, id: media.id, malId: media.malId || null,
      status: 'planning', progress: 0, score: null, fav: false
    };
    library[k] = {
      ...prev, ...patch,
      malId: media.malId ?? prev.malId,
      stub: stubOf(media),
      updatedAt: Date.now()
    };
    write(K_LIB, library);
    if (!opts.silent) emit();
    return library[k];
  },

  remove(src, id) {
    delete library[key(src, id)];
    delete seen[key(src, id)];
    write(K_LIB, library);
    write(K_SEEN, seen);
    emit();
  },

  toggleFav(media) {
    const e = library[key(media.src, media.id)];
    return Store.save(media, { fav: !(e && e.fav) });
  },

  setProgress(media, n) {
    const max = media.episodes || Infinity;
    const p = Math.max(0, Math.min(n, max === Infinity ? n : max));
    const patch = { progress: p };
    if (media.episodes && p >= media.episodes) patch.status = 'completed';
    else if (p > 0) {
      const cur = library[key(media.src, media.id)];
      if (!cur || cur.status === 'planning') patch.status = 'watching';
    }
    return Store.save(media, patch);
  },

  /* ── episode ticks ── */
  seenList(src, id) { return seen[key(src, id)] || []; },

  isSeen(src, id, n) { return (seen[key(src, id)] || []).includes(n); },

  toggleSeen(media, n) {
    const k = key(media.src, media.id);
    const arr = new Set(seen[k] || []);
    arr.has(n) ? arr.delete(n) : arr.add(n);
    seen[k] = [...arr].sort((a, b) => a - b);
    write(K_SEEN, seen);
    if (settings.autoTrack) {
      Store.setProgress(media, seen[k].length ? Math.max(...seen[k]) : 0);
    } else {
      emit();
    }
    return seen[k];
  },

  markThrough(media, n) {
    const k = key(media.src, media.id);
    seen[k] = Array.from({ length: n }, (_, i) => i + 1);
    write(K_SEEN, seen);
    Store.setProgress(media, n);
    return seen[k];
  },

  /* ── backup ── */
  export() {
    return JSON.stringify({
      app: 'astralanime', version: 1, exportedAt: new Date().toISOString(),
      settings, library, seen
    }, null, 2);
  },

  import(text) {
    const data = JSON.parse(text);
    if (data.app !== 'astralanime' && data.app !== 'aniva')
      throw new Error('That file was not exported from Astralanime.');
    library = { ...library, ...(data.library || {}) };
    seen = { ...seen, ...(data.seen || {}) };
    settings = { ...settings, ...(data.settings || {}) };
    write(K_LIB, library); write(K_SEEN, seen); write(K_SET, settings);
    emit();
    return Object.keys(data.library || {}).length;
  },

  clear() {
    library = {}; seen = {};
    write(K_LIB, library); write(K_SEEN, seen);
    emit();
  }
};
