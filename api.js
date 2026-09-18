/* api.js — two sources, one shape.
 *
 *  AniList : https://graphql.anilist.co       (GraphQL, no key needed)
 *  MAL     : https://api.myanimelist.net/v2   (official, needs a Client ID)
 *            https://api.jikan.moe/v4         (unofficial mirror, used as fallback)
 *
 *  The MyAnimeList branch talks to the official v2 API the way the
 *  myanimelist-api-v2 client does: every read goes to api.myanimelist.net/v2
 *  with the Client ID in an X-MAL-CLIENT-ID header. When no Client ID has been
 *  entered in Settings, or the call fails, it drops back to Jikan so the
 *  catalogue never goes blank.
 *
 *  Both are normalised into the Media shape below so every view can render
 *  either source without knowing which one it got.
 *
 *  Media = {
 *    src, id, malId, title{romaji,english,native}, cover, banner, color,
 *    description, score, popularity, episodes, duration, format, status,
 *    season, year, genres[], studios[], trailer, nextEp{n,inSec},
 *    links[{site,url,color}], streamEpisodes[{n,title,thumb,url,site}]
 *  }
 */

import { Store } from './store.js';

const AL_URL = 'https://graphql.anilist.co';
const JIKAN = 'https://api.jikan.moe/v4';
const MAL_API = Object.freeze({
  baseUrl: 'https://api.myanimelist.net/v2',
  clientIdHeader: 'X-MAL-CLIENT-ID',
  reference: 'https://myanimelist.net/apiconfig/references/api/v2'
});
/* Public MAL client identifier supplied for this app. Never embed a client secret. */
export const MAL_CLIENT_ID = '9d0b4b170abeb96077a4933abfae80b3';
const MEGAPLAY_BASE = 'https://megaplay.buzz';

/*
 * The Anivexa API is a separate Node service. For local testing, run it on
 * port 4000. For an APK or hosted web build, replace this value with the
 * public HTTPS URL where you deploy Anivexa, or define
 * window.ANIVEXA_API_BASE before this module loads.
 */
const DEFAULT_ANIVEXA_API_BASE = 'https://anixera.up.railway.app';
export const ANIVEXA_API_BASE = String(
  globalThis.ANIVEXA_API_BASE || DEFAULT_ANIVEXA_API_BASE
).replace(/\/+$/, '');

/* The order is intentional: the first healthy provider wins. */
export const ANIVEXA_PROVIDER_ORDER = [
  'reanime',
  'anikoto',
  'animegg',
  'aniwaves',
  'mkissa',
  '2dhive',
  'anizone',
  'anibd',
  'kaa'
].map(name => name.toLowerCase());

/**
 * Build the private playback route for a title.
 * The embed is intentionally kept here so views never need to know which
 * catalogue supplied the title or how the playback service is addressed.
 */
export function playbackUrl(media, episode, language = 'sub') {
  const id = Number(media?.src === 'mal' ? (media.malId || media.id) : media?.id);
  const ep = Number(episode);
  if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(ep) || ep <= 0) return '';

  const route = media.src === 'mal' ? 'mal' : 'ani';
  const audio = language === 'dub' ? 'dub' : 'sub';
  return `${MEGAPLAY_BASE}/stream/${route}/${id}/${ep}/${audio}`;
}

function anivexaWatchUrl(provider, anilistId, episode, language) {
  const audio = language === 'dub' ? 'dub' : 'sub';
  return `${ANIVEXA_API_BASE}/watch/${provider}/${anilistId}/${audio}/${provider}-${episode}`;
}

function candidateUrl(value) {
  if (typeof value !== 'string') return '';
  const url = value.trim();
  if (!/^https?:\/\//i.test(url)) return '';
  return url;
}

function candidateKind(url) {
  return /\.(?:m3u8|mp4|webm)(?:$|[?#])/i.test(url) ? 'video' : 'iframe';
}

function candidateQuality(value) {
  if (!value || typeof value !== 'object') return '';
  return String(
    value.quality ||
    value.resolution ||
    value.label ||
    value.name ||
    value.type ||
    ''
  ).trim();
}

/*
 * Provider response shapes differ slightly. Keep the normalisation here so
 * the player does not need to know whether a source came from `streams`,
 * `sources`, `allServers`, or a direct `stream_url` field.
 */
function collectPlaybackCandidates(data) {
  const candidates = [];
  const seen = new Set();

  const add = (value, preferredKind = '', quality = '') => {
    if (Array.isArray(value)) {
      value.forEach(item => add(item, preferredKind));
      return;
    }

    const direct = candidateUrl(value);
    if (direct) {
      if (!seen.has(direct)) {
        seen.add(direct);
        candidates.push({
          url: direct,
          kind: preferredKind || candidateKind(direct),
          quality: quality || 'Auto'
        });
      }
      return;
    }

    if (!value || typeof value !== 'object') return;

    const itemQuality = candidateQuality(value) || quality;
    if (value.embed) add(value.embed, 'iframe', itemQuality);
    if (value.stream_url) add(value.stream_url, '', itemQuality);
    if (value.url) add(value.url, '', itemQuality);
    if (value.file) add(value.file, '', itemQuality);
    if (value.src) add(value.src, '', itemQuality);
    if (value.link) add(value.link, '', itemQuality);
  };

  add(data?.stream_url);
  add(data?.streams);
  add(data?.sources);
  add(data?.allServers);
  add(data?.embeds, 'iframe');
  return candidates;
}

function fetchWithTimeout(url, timeoutMs = 9000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, {
    headers: { Accept: 'application/json' },
    signal: controller.signal
  }).finally(() => clearTimeout(timer));
}

/**
 * Try Anivexa first and return a normalised playback surface.
 * Anivexa uses AniList IDs, so MAL-only catalogue records intentionally skip
 * this branch and go straight to the existing MegaPlay fallback.
 */
export async function anivexaPlayback(media, episode, language = 'sub') {
  const anilistId = Number(media?.src === 'anilist' ? media.id : 0);
  const ep = Number(episode);
  if (!Number.isInteger(anilistId) || anilistId <= 0 || !Number.isInteger(ep) || ep <= 0) {
    return null;
  }

  for (const provider of ANIVEXA_PROVIDER_ORDER) {
    try {
      const response = await fetchWithTimeout(
        anivexaWatchUrl(provider, anilistId, ep, language)
      );
      if (!response.ok) continue;

      const data = await response.json();
      if (data?.error) continue;

      const variants = collectPlaybackCandidates(data);
      const candidate = variants[0];
      if (candidate) {
        return {
          ...candidate,
          variants,
          provider,
          label: `Anivexa · ${provider}`
        };
      }
    } catch {
      /* A dead provider must not prevent the next provider or MegaPlay. */
    }
  }

  return null;
}

/**
 * Return the number of episodes that have officially been released.
 * AniList gives us the next airing episode, while Jikan and AniList can
 * provide an already released episode list. Never expose the catalogue's
 * planned total for an airing title when that total includes future episodes.
 */
export function releasedEpisodeCount(media) {
  const total = Number(media?.episodes);
  const known = (media?.streamEpisodes || [])
    .map(e => Number(e.n))
    .filter(Number.isInteger)
    .reduce((max, n) => Math.max(max, n), 0);

  if (media?.status === 'NOT_YET_RELEASED') return 0;

  if (Number(media?.nextEp?.n) > 0) {
    const next = Number(media.nextEp.n);
    return Math.max(0, Math.min(next - 1, Number.isInteger(total) ? total : next - 1));
  }

  if (media?.status === 'RELEASING') {
    return known ? Math.min(known, Number.isInteger(total) ? total : known) : 0;
  }

  if (media?.status === 'FINISHED') {
    return Math.max(known, Number.isInteger(total) ? total : 0);
  }

  if (media?.status === 'CANCELLED' || media?.status === 'HIATUS') {
    return known || (Number.isInteger(total) ? total : 0);
  }

  return known || (media?.format === 'MOVIE' ? 1 : (Number.isInteger(total) ? total : 0));
}

/* ── tiny request plumbing ───────────────────────────────── */

const memo = new Map();
const MEMO_TTL = 5 * 60 * 1000;

function cacheGet(key) {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.t < MEMO_TTL) return hit.v;
  memo.delete(key);
  return null;
}

function cacheSet(key, v) {
  memo.set(key, { t: Date.now(), v });
  if (memo.size > 90) memo.delete(memo.keys().next().value);
  return v;
}

/* Jikan allows ~3 req/sec. Serialise with a small gap so we never get 429'd. */
let jikanChain = Promise.resolve();

function jikanQueue(fn) {
  const next = jikanChain.then(() => new Promise(r => setTimeout(r, 380))).then(fn);
  jikanChain = next.catch(() => {});
  return next;
}

async function jikan(path) {
  const key = 'j:' + path;
  const hit = cacheGet(key);
  if (hit) return hit;
  return jikanQueue(async () => {
    const res = await fetch(JIKAN + path, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error('MyAnimeList is not responding right now (' + res.status + ')');
    const json = await res.json();
    return cacheSet(key, json.data);
  });
}

/* ── official MyAnimeList v2 ─────────────────────────────── */

/* The fields the official API will hand back. Anything not asked for is
 * simply absent from the response, so these lists decide what a card and a
 * detail page can show. my_list_status is left out on purpose: it needs a
 * user token, and reading the catalogue only needs the Client ID. */
const MAL_LIST_FIELDS = [
  'id', 'title', 'main_picture', 'alternative_titles', 'start_date', 'end_date',
  'synopsis', 'mean', 'rank', 'popularity', 'num_list_users', 'num_scoring_users',
  'nsfw', 'genres', 'media_type', 'status', 'num_episodes', 'start_season',
  'broadcast', 'source', 'average_episode_duration', 'rating', 'studios',
  'created_at', 'updated_at'
].join(',');

const MAL_FULL_FIELDS =
  MAL_LIST_FIELDS + ',background,related_anime,recommendations,statistics';

const malClientId = () => (Store.settings.malClientId || MAL_CLIENT_ID).trim();

/**
 * api.myanimelist.net sends no CORS headers, so a plain fetch from inside a
 * WebView tab is refused — that part is unfixable in JS. Capacitor's fix for
 * exactly this is the "CapacitorHttp" config flag in capacitor.config.json:
 * once it's `enabled: true` (it now is) and the native project has been
 * rebuilt, Capacitor transparently rewrites this very `fetch()` call to go
 * out through native code instead of the WebView, so it is no longer subject
 * to CORS at all. No plugin object to call by hand, no extra code — the
 * catch is real, though: this only ever takes effect inside the installed
 * APK. A browser tab (including `npm run serve`) has no Capacitor runtime,
 * so this call will always fail there and fall back to Jikan below, which is
 * expected, not a bug.
 */
async function httpGetJson(url, headers = {}) {
  const res = await fetch(url, { headers: { Accept: 'application/json', ...headers } });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const detail = body?.message || body?.error;
    const e = new Error(detail
      ? `MyAnimeList API error: ${detail} (${res.status})`
      : `MyAnimeList API error (${res.status})`);
    e.status = res.status;
    e.code = body?.error || `http-${res.status}`;
    throw e;
  }
  return res.json();
}

async function mal(path, params = {}) {
  const clientId = malClientId();
  if (!clientId) {
    const e = new Error('No MyAnimeList Client ID set');
    e.code = 'no-client-id';
    throw e;
  }
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') qs.set(k, v);
  });
  const url = MAL_API.baseUrl + path + (qs.toString() ? '?' + qs : '');
  const key = 'm:' + url;
  const hit = cacheGet(key);
  if (hit) return hit;
  return cacheSet(key, await httpGetJson(url, {
    [MAL_API.clientIdHeader]: clientId
  }));
}

/** Any of the official list endpoints, normalised into the shared page shape. */
async function malPage(path, params, { adult, page = 1, limit = 20, keep = null }) {
  const json = await mal(path, {
    ...params,
    limit,
    offset: (Math.max(1, Number(page) || 1) - 1) * limit,
    fields: MAL_LIST_FIELDS,
    nsfw: adult ? 'true' : 'false'
  });
  let nodes = (json?.data || []).map(row => row.node || row).filter(Boolean);
  if (!adult) nodes = nodes.filter(n => !n.nsfw || n.nsfw === 'white');
  if (keep) nodes = nodes.filter(keep);
  return {
    items: nodes.map(fromMal).filter(Boolean),
    hasNext: !!json?.paging?.next,
    page
  };
}

/**
 * Prefer official MAL, then Jikan, then the independent AniList catalogue.
 * MAL and Jikan can both return gateway errors, so a failed mirror must not
 * take down the whole home screen or leave search with a false empty state.
 */
async function malThenJikan(official, mirror, fallback = null) {
  if (malClientId()) {
    try {
      const result = await official();
      /*
       * A valid MAL response can still be empty when the endpoint has
       * rejected a filter or returned a page with no usable records. Do not
       * leave the catalogue blank in that case; Jikan is the same MAL-backed
       * catalogue and is the reliable read-only fallback.
       */
      if (result && (!Array.isArray(result.items) || result.items.length)) return result;
    } catch (err) {
      if (err.code !== 'no-client-id') {
        console.warn('MyAnimeList API unavailable, using Jikan:', err.message);
      }
    }
  }

  try {
    const result = await mirror();
    /* Detail records do not have an items array; a page does. */
    if (result && (!Array.isArray(result.items) || result.items.length || !fallback)) {
      return result;
    }
  } catch (err) {
    console.warn('Jikan unavailable, using AniList:', err.message);
    if (!fallback) throw err;
  }

  if (fallback) return fallback();
  return { items: [], hasNext: false, page: 1 };
}

const MAL_SEASON = s => String(s || '').toLowerCase();

const MAL_RANKING_BY_FORMAT = {
  TV: 'tv', MOVIE: 'movie', OVA: 'ova', SPECIAL: 'special'
};

async function anilist(query, variables) {
  const key = 'a:' + query + JSON.stringify(variables);
  const hit = cacheGet(key);
  if (hit) return hit;
  const res = await fetch(AL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query, variables })
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json || json.errors) {
    const msg = json?.errors?.[0]?.message || 'AniList is not responding right now';
    throw new Error(msg);
  }
  return cacheSet(key, json.data);
}

/** Uncached call, optionally authenticated. Used for Viewer data and mutations. */
export async function alRaw(query, variables, token) {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(AL_URL, {
    method: 'POST', headers, body: JSON.stringify({ query, variables })
  });
  const json = await res.json().catch(() => null);
  if (res.status === 401 || res.status === 400 && /token/i.test(JSON.stringify(json || ''))) {
    const e = new Error('Your AniList sign-in has expired. Sign in again in Settings.');
    e.code = 'auth';
    throw e;
  }
  if (!res.ok || !json || json.errors) {
    throw new Error(json?.errors?.[0]?.message || 'AniList rejected that request');
  }
  return json.data;
}

/* ── AniList selection set ───────────────────────────────── */

const F_CARD = `
  id idMal
  title { romaji english native }
  synonyms
  coverImage { extraLarge large color }
  bannerImage
  averageScore popularity episodes format status season seasonYear genres
  nextAiringEpisode { episode timeUntilAiring }
`;

const F_FULL = `
  ${F_CARD}
  description(asHtml: false)
  meanScore favourites duration source(version: 3) countryOfOrigin
  startDate { year month day } endDate { year month day }
  studios(isMain: true) { nodes { id name } }
  trailer { id site thumbnail }
  externalLinks { site url type color }
  streamingEpisodes { title thumbnail url site }
  tags { name rank isMediaSpoiler }
  characters(sort: ROLE, perPage: 14) {
    edges { role node { id name { full } image { large } } }
  }
  relations {
    edges { relationType(version: 2) node {
      id type title { romaji english } coverImage { large color } format
    } }
  }
  recommendations(sort: RATING_DESC, perPage: 12) {
    nodes { mediaRecommendation {
      id title { romaji english } coverImage { large color } averageScore format seasonYear
    } }
  }
`;

/* ── normalisers ─────────────────────────────────────────── */

function stripTags(s) {
  if (!s) return '';
  return s.replace(/<br\s*\/?>/gi, '\n')
          .replace(/<[^>]+>/g, '')
          .replace(/\n{3,}/g, '\n\n')
          .trim();
}

function fromAniList(m) {
  if (!m) return null;
  return {
    src: 'anilist',
    id: m.id,
    malId: m.idMal || null,
    title: {
      romaji: m.title?.romaji || '',
      english: m.title?.english || '',
      native: m.title?.native || ''
    },
    synonyms: m.synonyms || [],
    cover: m.coverImage?.extraLarge || m.coverImage?.large || '',
    banner: m.bannerImage || m.coverImage?.extraLarge || '',
    color: m.coverImage?.color || null,
    description: stripTags(m.description),
    score: m.averageScore ?? null,
    popularity: m.popularity ?? null,
    favourites: m.favourites ?? null,
    episodes: m.episodes ?? null,
    duration: m.duration ?? null,
    format: m.format || null,
    status: m.status || null,
    season: m.season || null,
    year: m.seasonYear || m.startDate?.year || null,
    startDate: m.startDate || null,
    endDate: m.endDate || null,
    source: m.source || null,
    synonyms: m.synonyms || [],
    genres: m.genres || [],
    studios: (m.studios?.nodes || []).map(s => s.name),
    trailer: m.trailer?.site === 'youtube' && m.trailer.id
      ? { yt: m.trailer.id, thumb: m.trailer.thumbnail } : null,
    nextEp: m.nextAiringEpisode
      ? { n: m.nextAiringEpisode.episode, inSec: m.nextAiringEpisode.timeUntilAiring } : null,
    links: (m.externalLinks || [])
      .filter(l => l.type === 'STREAMING')
      .map(l => ({ site: l.site, url: l.url, color: l.color })),
    otherLinks: (m.externalLinks || [])
      .filter(l => l.type !== 'STREAMING')
      .map(l => ({ site: l.site, url: l.url, color: l.color })),
    streamEpisodes: (m.streamingEpisodes || []).map((e, i) => ({
      n: parseInt((e.title || '').match(/Episode\s+(\d+)/i)?.[1] || i + 1, 10),
      title: (e.title || '').replace(/^Episode\s+\d+\s*-\s*/i, '').trim(),
      thumb: e.thumbnail || '',
      url: e.url,
      site: e.site
    })),
    tags: (m.tags || []).filter(t => !t.isMediaSpoiler).slice(0, 10).map(t => t.name),
    characters: (m.characters?.edges || []).map(e => ({
      id: e.node.id, name: e.node.name?.full, img: e.node.image?.large, role: e.role
    })),
    relations: (m.relations?.edges || [])
      .filter(e => e.node.type === 'ANIME')
      .map(e => ({
        id: e.node.id, src: 'anilist',
        title: { romaji: e.node.title?.romaji, english: e.node.title?.english },
        cover: e.node.coverImage?.large, color: e.node.coverImage?.color,
        format: e.node.format, relation: e.relationType
      })),
    recommendations: (m.recommendations?.nodes || [])
      .map(n => n.mediaRecommendation)
      .filter(Boolean)
      .map(r => ({
        src: 'anilist', id: r.id,
        title: { romaji: r.title?.romaji, english: r.title?.english },
        cover: r.coverImage?.large, color: r.coverImage?.color,
        score: r.averageScore, format: r.format, year: r.seasonYear
      }))
  };
}

function fromJikan(m) {
  if (!m) return null;
  const en = m.titles?.find(t => t.type === 'English')?.title;
  const jp = m.titles?.find(t => t.type === 'Japanese')?.title;
  return {
    src: 'mal',
    id: m.mal_id,
    malId: m.mal_id,
    title: { romaji: m.title || '', english: en || m.title_english || '', native: jp || m.title_japanese || '' },
    cover: m.images?.jpg?.large_image_url || m.images?.jpg?.image_url || '',
    banner: m.trailer?.images?.maximum_image_url || m.images?.jpg?.large_image_url || '',
    color: null,
    description: (m.synopsis || '').replace(/\[Written by MAL Rewrite\]/g, '').trim(),
    score: m.score ? Math.round(m.score * 10) : null,
    popularity: m.members ?? null,
    favourites: m.favorites ?? null,
    episodes: m.episodes ?? null,
    duration: parseInt((m.duration || '').match(/(\d+)\s*min/)?.[1] || '', 10) || null,
    format: (m.type || '').toUpperCase() || null,
    status: /finished/i.test(m.status) ? 'FINISHED'
          : /airing/i.test(m.status) ? 'RELEASING'
          : /not yet/i.test(m.status) ? 'NOT_YET_RELEASED' : null,
    season: m.season ? m.season.toUpperCase() : null,
    year: m.year || (m.aired?.prop?.from?.year ?? null),
    startDate: m.aired?.prop?.from || null,
    endDate: m.aired?.prop?.to || null,
    source: m.source || null,
    synonyms: m.title_synonyms || [],
    genres: (m.genres || []).concat(m.themes || []).map(g => g.name),
    studios: (m.studios || []).map(s => s.name),
    trailer: m.trailer?.youtube_id ? { yt: m.trailer.youtube_id, thumb: m.trailer.images?.maximum_image_url } : null,
    nextEp: null,
    links: (m.streaming || []).map(s => ({ site: s.name, url: s.url, color: null })),
    otherLinks: m.url ? [{ site: 'MyAnimeList', url: m.url, color: '#2E51A2' }] : [],
    streamEpisodes: [],
    tags: (m.themes || []).map(t => t.name),
    characters: [],
    relations: [],
    recommendations: []
  };
}

/* The official API speaks its own vocabulary; line it up with AniList's. */
const MAL_FORMAT = {
  tv: 'TV', tv_special: 'SPECIAL', movie: 'MOVIE', ova: 'OVA',
  ona: 'ONA', special: 'SPECIAL', music: 'MUSIC', unknown: null
};

const MAL_STATUS = {
  finished_airing: 'FINISHED',
  currently_airing: 'RELEASING',
  not_yet_aired: 'NOT_YET_RELEASED'
};

function malDate(s) {
  if (!s) return null;
  const [year, month, day] = String(s).split('-').map(n => parseInt(n, 10));
  return { year: year || null, month: month || null, day: day || null };
}

function malStub(n) {
  if (!n) return null;
  return {
    src: 'mal',
    id: n.id,
    title: { romaji: n.title || '', english: n.alternative_titles?.en || '' },
    cover: n.main_picture?.large || n.main_picture?.medium || '',
    color: null,
    score: n.mean ? Math.round(n.mean * 10) : null,
    format: MAL_FORMAT[n.media_type] || null,
    year: n.start_season?.year || malDate(n.start_date)?.year || null
  };
}

function fromMal(m) {
  if (!m) return null;
  const alt = m.alternative_titles || {};
  return {
    src: 'mal',
    id: m.id,
    malId: m.id,
    title: { romaji: m.title || '', english: alt.en || '', native: alt.ja || '' },
    cover: m.main_picture?.large || m.main_picture?.medium || '',
    banner: m.main_picture?.large || m.main_picture?.medium || '',
    color: null,
    description: (m.synopsis || '').replace(/\[Written by MAL Rewrite\]/g, '').trim(),
    score: m.mean ? Math.round(m.mean * 10) : null,
    popularity: m.num_list_users ?? null,
    favourites: m.statistics?.num_list_users ?? null,
    episodes: m.num_episodes || null,
    duration: m.average_episode_duration ? Math.round(m.average_episode_duration / 60) : null,
    format: MAL_FORMAT[m.media_type] || (m.media_type || '').toUpperCase() || null,
    status: MAL_STATUS[m.status] || null,
    season: m.start_season?.season ? m.start_season.season.toUpperCase() : null,
    year: m.start_season?.year || malDate(m.start_date)?.year || null,
    startDate: malDate(m.start_date),
    endDate: malDate(m.end_date),
    source: m.source || null,
    synonyms: alt.synonyms || [],
    genres: (m.genres || []).map(g => g.name),
    studios: (m.studios || []).map(s => s.name),
    trailer: null,
    nextEp: null,
    links: [],
    otherLinks: [{ site: 'MyAnimeList', url: `https://myanimelist.net/anime/${m.id}`, color: '#2E51A2' }],
    streamEpisodes: [],
    tags: (m.genres || []).map(g => g.name).slice(0, 10),
    characters: [],
    relations: (m.related_anime || []).map(r => {
      const stub = malStub(r.node);
      return stub && { ...stub, relation: (r.relation_type_formatted || r.relation_type || '').toUpperCase() };
    }).filter(Boolean),
    recommendations: (m.recommendations || []).map(r => malStub(r.node)).filter(Boolean)
  };
}

/* Keep title matching predictable even when a provider's relevance ordering
 * changes. Exact and prefix matches always appear before loose matches. */
function searchKey(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[\s\-_:/.!,?'"()[\]{}]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function titleVariants(media) {
  return [
    media?.title?.english,
    media?.title?.romaji,
    media?.title?.native,
    ...(media?.synonyms || [])
  ].map(searchKey).filter(Boolean);
}

function sortSearchResults(items, query) {
  const needle = searchKey(query);
  if (!needle) return items;

  return items
    .map((item, index) => {
      const variants = titleVariants(item);
      const rank = variants.reduce((best, title) => {
        const words = title.split(' ');
        const score = title === needle ? 0
          : title.startsWith(needle) ? 1
          : words.some(word => word.startsWith(needle)) ? 2
          : title.includes(needle) ? 3 : 4;
        return Math.min(best, score);
      }, 4);
      return { item, index, rank };
    })
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(row => row.item);
}

/* ── seasons ─────────────────────────────────────────────── */

function currentSeason(d = new Date()) {
  const m = d.getMonth();
  return m < 3 ? 'WINTER' : m < 6 ? 'SPRING' : m < 9 ? 'SUMMER' : 'FALL';
}

function nextSeason() {
  const order = ['WINTER', 'SPRING', 'SUMMER', 'FALL'];
  const i = order.indexOf(currentSeason());
  const year = new Date().getFullYear() + (i === 3 ? 1 : 0);
  return { season: order[(i + 1) % 4], year };
}

/* ── public queries ──────────────────────────────────────── */

const PAGE_Q = `
  query ($page:Int,$perPage:Int,$sort:[MediaSort],$status:MediaStatus,
         $season:MediaSeason,$year:Int,$format:MediaFormat,$genre:String,$isAdult:Boolean){
    Page(page:$page, perPage:$perPage){
      pageInfo { hasNextPage currentPage }
      media(type:ANIME, sort:$sort, status:$status, season:$season, seasonYear:$year,
            format:$format, genre:$genre, isAdult:$isAdult){ ${F_CARD} }
    }
  }
`;

async function alPage(vars) {
  const d = await anilist(PAGE_Q, { page: 1, perPage: 20, ...vars });
  return {
    items: d.Page.media.map(fromAniList),
    hasNext: d.Page.pageInfo.hasNextPage,
    page: d.Page.pageInfo.currentPage
  };
}

async function aniSearch(query, { adult, page = 1, format = null, genre = null }) {
  const Q = `
    query ($search:String!,$page:Int,$format:[MediaFormat],$genres:[String],$isAdult:Boolean){
      Page(page:$page, perPage:20){
        pageInfo { hasNextPage currentPage }
        media(
          type: ANIME
          search: $search
          format_in: $format
          genre_in: $genres
          isAdult: $isAdult
          sort: [SEARCH_MATCH]
        ) { ${F_CARD} }
      }
    }`;
  const d = await anilist(Q, {
    search: query,
    page,
    format: format ? [format] : undefined,
    genres: genre ? [genre] : undefined,
    isAdult: adult ? undefined : false
  });
  const items = (d?.Page?.media || []).map(fromAniList).filter(Boolean);
  return {
    items: sortSearchResults(items, query),
    hasNext: !!d?.Page?.pageInfo?.hasNextPage,
    page
  };
}

export const Api = {
  currentSeason,
  nextSeason,

  /** Hero: what is airing right now, ordered by how hot it is. */
  async airingNow({ source, adult, page = 1 }) {
    if (source === 'mal') {
      return malThenJikan(
        () => malPage(`/anime/season/${new Date().getFullYear()}/${MAL_SEASON(currentSeason())}`,
                      { sort: 'anime_num_list_users' }, { adult, page, keep: n => n.status === 'currently_airing' }),
        async () => {
          const d = await jikan(`/seasons/now?limit=20&sfw=${adult ? 'false' : 'true'}&page=${page}`);
          return { items: d.map(fromJikan), hasNext: d.length === 20, page };
        },
        () => alPage({ page, sort: ['TRENDING_DESC'], status: 'RELEASING', isAdult: adult ? undefined : false }));
    }
    return alPage({ page, sort: ['TRENDING_DESC'], status: 'RELEASING', isAdult: !!adult ? undefined : false });
  },

  async trending({ source, adult, page = 1 }) {
    if (source === 'mal') {
      return malThenJikan(
        () => malPage('/anime/ranking', { ranking_type: 'airing' }, { adult, page }),
        async () => {
          const d = await jikan(`/top/anime?filter=airing&limit=20&sfw=${adult ? 'false' : 'true'}&page=${page}`);
          return { items: d.map(fromJikan), hasNext: d.length === 20, page };
        },
        () => alPage({ page, sort: ['TRENDING_DESC'], isAdult: adult ? undefined : false }));
    }
    return alPage({ page, sort: ['TRENDING_DESC'], isAdult: adult ? undefined : false });
  },

  /** The ranked top ten — all time, by score. */
  async topRated({ source, adult, page = 1, perPage = 20 }) {
    if (source === 'mal') {
      return malThenJikan(
        () => malPage('/anime/ranking', { ranking_type: 'all' }, { adult, page, limit: perPage }),
        async () => {
          const d = await jikan(`/top/anime?limit=${perPage}&sfw=${adult ? 'false' : 'true'}&page=${page}`);
          return { items: d.map(fromJikan), hasNext: d.length === perPage, page };
        },
        () => alPage({ page, perPage, sort: ['SCORE_DESC'], isAdult: adult ? undefined : false }));
    }
    return alPage({ page, perPage, sort: ['SCORE_DESC'], isAdult: adult ? undefined : false });
  },

  async mostPopular({ source, adult, page = 1 }) {
    if (source === 'mal') {
      return malThenJikan(
        () => malPage('/anime/ranking', { ranking_type: 'bypopularity' }, { adult, page }),
        async () => {
          const d = await jikan(`/top/anime?filter=bypopularity&limit=20&sfw=${adult ? 'false' : 'true'}&page=${page}`);
          return { items: d.map(fromJikan), hasNext: d.length === 20, page };
        },
        () => alPage({ page, sort: ['POPULARITY_DESC'], isAdult: adult ? undefined : false }));
    }
    return alPage({ page, sort: ['POPULARITY_DESC'], isAdult: adult ? undefined : false });
  },

  async completed({ source, adult, page = 1 }) {
    if (source === 'mal') {
      return malThenJikan(
        /* v2 has no "finished" filter, so take the ranked list and keep the finished ones. */
        () => malPage('/anime/ranking', { ranking_type: 'all' },
                      { adult, page, limit: 40, keep: n => n.status === 'finished_airing' }),
        async () => {
          const d = await jikan(`/anime?status=complete&order_by=score&sort=desc&limit=20&sfw=${adult ? 'false' : 'true'}&page=${page}`);
          return { items: d.map(fromJikan), hasNext: d.length === 20, page };
        },
        () => alPage({ page, sort: ['SCORE_DESC'], status: 'FINISHED', isAdult: adult ? undefined : false }));
    }
    return alPage({ page, sort: ['SCORE_DESC'], status: 'FINISHED', isAdult: adult ? undefined : false });
  },

  async byFormat(format, { source, adult, page = 1 }) {
    if (source === 'mal') {
      const ranking = MAL_RANKING_BY_FORMAT[format];
      return malThenJikan(
        /* ONA has no ranking of its own; sift it out of the overall ranking. */
        () => ranking
          ? malPage('/anime/ranking', { ranking_type: ranking }, { adult, page })
          : malPage('/anime/ranking', { ranking_type: 'bypopularity' },
                    { adult, page, limit: 50, keep: n => MAL_FORMAT[n.media_type] === format }),
        async () => {
          const d = await jikan(`/anime?type=${encodeURIComponent(format.toLowerCase())}&order_by=popularity&sort=desc&limit=20&sfw=${adult ? 'false' : 'true'}&page=${page}`);
          return { items: d.map(fromJikan), hasNext: d.length === 20, page };
        },
        () => alPage({ page, sort: ['POPULARITY_DESC'], format, isAdult: adult ? undefined : false }));
    }
    return alPage({ page, sort: ['POPULARITY_DESC'], format, isAdult: adult ? undefined : false });
  },

  async thisSeason({ source, adult, page = 1 }) {
    if (source === 'mal') {
      return malThenJikan(
        () => malPage(`/anime/season/${new Date().getFullYear()}/${MAL_SEASON(currentSeason())}`,
                      { sort: 'anime_num_list_users' }, { adult, page }),
        async () => {
          const d = await jikan(`/seasons/now?limit=20&sfw=${adult ? 'false' : 'true'}&page=${page}`);
          return { items: d.map(fromJikan), hasNext: d.length === 20, page };
        },
        () => alPage({
          page, sort: ['POPULARITY_DESC'],
          season: currentSeason(), year: new Date().getFullYear(),
          isAdult: adult ? undefined : false
        }));
    }
    return alPage({
      page, sort: ['POPULARITY_DESC'],
      season: currentSeason(), year: new Date().getFullYear(),
      isAdult: adult ? undefined : false
    });
  },

  async upcoming({ source, adult, page = 1 }) {
    if (source === 'mal') {
      return malThenJikan(
        () => malPage('/anime/ranking', { ranking_type: 'upcoming' }, { adult, page }),
        async () => {
          const d = await jikan(`/seasons/upcoming?limit=20&sfw=${adult ? 'false' : 'true'}&page=${page}`);
          return { items: d.map(fromJikan), hasNext: d.length === 20, page };
        },
        () => {
          const ns = nextSeason();
          return alPage({ page, sort: ['POPULARITY_DESC'], season: ns.season, year: ns.year, isAdult: adult ? undefined : false });
        });
    }
    const ns = nextSeason();
    return alPage({ page, sort: ['POPULARITY_DESC'], season: ns.season, year: ns.year, isAdult: adult ? undefined : false });
  },

  async topMovies({ source, adult, page = 1 }) {
    if (source === 'mal') {
      return malThenJikan(
        () => malPage('/anime/ranking', { ranking_type: 'movie' }, { adult, page }),
        async () => {
          const d = await jikan(`/top/anime?type=movie&limit=20&sfw=${adult ? 'false' : 'true'}&page=${page}`);
          return { items: d.map(fromJikan), hasNext: d.length === 20, page };
        },
        () => alPage({ page, sort: ['SCORE_DESC'], format: 'MOVIE', isAdult: adult ? undefined : false }));
    }
    return alPage({ page, sort: ['SCORE_DESC'], format: 'MOVIE', isAdult: adult ? undefined : false });
  },

  async byGenre(genre, { source, adult, page = 1 }) {
    /* The official v2 API has no genre filter, so try Jikan then AniList. */
    if (source === 'mal') {
      try {
        const d = await jikan(`/anime?genres=${encodeURIComponent(genre)}&order_by=score&sort=desc&limit=20&sfw=${adult ? 'false' : 'true'}&page=${page}`);
        if (d.length) return { items: d.map(fromJikan), hasNext: d.length === 20, page };
      } catch (err) {
        console.warn('Jikan unavailable, using AniList:', err.message);
      }
      return alPage({ page, sort: ['POPULARITY_DESC'], genre, isAdult: adult ? undefined : false });
    }
    return alPage({ page, sort: ['POPULARITY_DESC'], genre, isAdult: adult ? undefined : false });
  },

  /** Search AniList regardless of the browse source and put the best title match first. */
  async search(q, { source = 'anilist', adult, page = 1, format = null, genre = null }) {
    const query = String(q || '').trim();
    if (!query) return { items: [], hasNext: false, page };

    if (source === 'mal') {
      return malThenJikan(
        () => malPage('/anime', {
          q: query,
          sort: 'anime_num_list_users'
        }, {
          adult,
          page,
          limit: 20,
          keep: n => {
            const formatOk = !format || MAL_FORMAT[n.media_type] === format;
            const genreOk = !genre || (n.genres || []).some(g => g.name === genre);
            return formatOk && genreOk;
          }
        }).then(result => ({
          ...result,
          items: sortSearchResults(result.items, query)
        })),
        async () => {
          const params = new URLSearchParams({
            q: query,
            order_by: 'score',
            sort: 'desc',
            limit: '25',
            sfw: adult ? 'false' : 'true',
            page: String(page)
          });
          const d = await jikan(`/anime?${params}`);
          let items = d.map(fromJikan).filter(Boolean);
          if (format) items = items.filter(m => m.format === format);
          if (genre) items = items.filter(m => m.genres?.includes(genre));
          return {
            items: sortSearchResults(items, query),
            hasNext: d.length === 25,
            page
          };
        },
        () => aniSearch(query, { adult, page, format, genre })
      );
    }
    return aniSearch(query, { adult, page, format, genre });
  },

  /** Full record for the detail page. */
  async detail(src, id) {
    if (src === 'mal') {
      const media = await malThenJikan(
        async () => {
          const record = await mal(`/anime/${Number(id)}`, { fields: MAL_FULL_FIELDS });
          const full = fromMal(record);
          /* v2 exposes no cast or episode list; Jikan fills those two in. */
          const [chars, eps] = await Promise.all([
            jikan(`/anime/${id}/characters`).catch(() => []),
            jikan(`/anime/${id}/episodes`).catch(() => [])
          ]);
          full.characters = (chars || []).slice(0, 14).map(c => ({
            id: c.character.mal_id, name: c.character.name,
            img: c.character.images?.jpg?.image_url, role: (c.role || '').toUpperCase()
          }));
          full.streamEpisodes = (eps || []).map(e => ({
            n: e.mal_id, title: e.title || '', thumb: '', url: e.url, site: 'MyAnimeList'
          }));
          return full;
        },
        () => Api.jikanDetail(id),
        () => Api.byMalId(id));
      return media;
    }
    const Q = `query ($id:Int){ Media(id:$id, type:ANIME){ ${F_FULL} } }`;
    const d = await anilist(Q, { id: Number(id) });
    return fromAniList(d.Media);
  },

  /** The Jikan version of a detail page, kept as the fallback path. */
  async jikanDetail(id) {
    const m = await jikan(`/anime/${id}/full`);
    const media = fromJikan(m);
    const [chars, recs, eps] = await Promise.all([
      jikan(`/anime/${id}/characters`).catch(() => []),
      jikan(`/anime/${id}/recommendations`).catch(() => []),
      jikan(`/anime/${id}/episodes`).catch(() => [])
    ]);
    media.characters = (chars || []).slice(0, 14).map(c => ({
      id: c.character.mal_id, name: c.character.name,
      img: c.character.images?.jpg?.image_url, role: (c.role || '').toUpperCase()
    }));
    media.recommendations = (recs || []).slice(0, 12).map(r => ({
      src: 'mal', id: r.entry.mal_id,
      title: { romaji: r.entry.title, english: '' },
      cover: r.entry.images?.jpg?.large_image_url, score: null
    }));
    media.streamEpisodes = (eps || []).map(e => ({
      n: e.mal_id, title: e.title || '', thumb: '', url: e.url, site: 'MyAnimeList'
    }));
    return media;
  },

  /** Cross-source lookup, used when the library holds an id from the other source. */
  async byMalId(malId) {
    const Q = `query ($id:Int){ Media(idMal:$id, type:ANIME){ ${F_FULL} } }`;
    const d = await anilist(Q, { id: Number(malId) });
    return fromAniList(d.Media);
  },

  /** Hydrate saved library entries that only kept a stub. */
  async hydrate(entries) {
    const al = entries.filter(e => e.src === 'anilist').map(e => Number(e.id));
    if (!al.length) return {};
    const Q = `
      query ($ids:[Int]){
        Page(page:1, perPage:50){ media(id_in:$ids, type:ANIME){ ${F_CARD} } }
      }`;
    const d = await anilist(Q, { ids: al });
    const out = {};
    d.Page.media.forEach(m => { out['anilist:' + m.id] = fromAniList(m); });
    return out;
  }
};

export const GENRES = [
  'Action', 'Adventure', 'Comedy', 'Drama', 'Fantasy', 'Horror', 'Mahou Shoujo',
  'Mecha', 'Music', 'Mystery', 'Psychological', 'Romance', 'Sci-Fi',
  'Slice of Life', 'Sports', 'Supernatural', 'Thriller'
];

export const FORMATS = [
  { v: 'TV', label: 'TV series' },
  { v: 'MOVIE', label: 'Film' },
  { v: 'OVA', label: 'OVA' },
  { v: 'ONA', label: 'ONA' },
  { v: 'SPECIAL', label: 'Special' }
];
