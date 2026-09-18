/* api.js — two sources, one shape.
 *
 *  AniList : https://graphql.anilist.co       (GraphQL, no key needed)
 *  MAL     : https://api.jikan.moe/v4         (Jikan mirrors MyAnimeList, no key)
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

const AL_URL = 'https://graphql.anilist.co';
const JIKAN = 'https://api.jikan.moe/v4';
const PLAYBACK_BASE = 'https://megaplay.buzz';

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
  return `${PLAYBACK_BASE}/stream/${route}/${id}/${ep}/${audio}`;
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
  coverImage { extraLarge large color }
  bannerImage
  averageScore popularity episodes format status season seasonYear genres
  nextAiringEpisode { episode timeUntilAiring }
`;

const F_FULL = `
  ${F_CARD}
  description(asHtml: false)
  meanScore favourites duration source(version: 3) synonyms countryOfOrigin
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

export const Api = {
  currentSeason,
  nextSeason,

  /** Hero: what is airing right now, ordered by how hot it is. */
  async airingNow({ source, adult, page = 1 }) {
    if (source === 'mal') {
      const d = await jikan(`/seasons/now?limit=20&sfw=${adult ? 'false' : 'true'}&page=${page}`);
      return { items: d.map(fromJikan), hasNext: d.length === 20, page };
    }
    return alPage({ page, sort: ['TRENDING_DESC'], status: 'RELEASING', isAdult: !!adult ? undefined : false });
  },

  async trending({ source, adult, page = 1 }) {
    if (source === 'mal') {
      const d = await jikan(`/top/anime?filter=airing&limit=20&sfw=${adult ? 'false' : 'true'}&page=${page}`);
      return { items: d.map(fromJikan), hasNext: d.length === 20, page };
    }
    return alPage({ page, sort: ['TRENDING_DESC'], isAdult: adult ? undefined : false });
  },

  /** The ranked top ten — all time, by score. */
  async topRated({ source, adult, page = 1, perPage = 20 }) {
    if (source === 'mal') {
      const d = await jikan(`/top/anime?limit=${perPage}&sfw=${adult ? 'false' : 'true'}&page=${page}`);
      return { items: d.map(fromJikan), hasNext: d.length === perPage, page };
    }
    return alPage({ page, perPage, sort: ['SCORE_DESC'], isAdult: adult ? undefined : false });
  },

  async mostPopular({ source, adult, page = 1 }) {
    if (source === 'mal') {
      const d = await jikan(`/top/anime?filter=bypopularity&limit=20&sfw=${adult ? 'false' : 'true'}&page=${page}`);
      return { items: d.map(fromJikan), hasNext: d.length === 20, page };
    }
    return alPage({ page, sort: ['POPULARITY_DESC'], isAdult: adult ? undefined : false });
  },

  async completed({ source, adult, page = 1 }) {
    if (source === 'mal') {
      const d = await jikan(`/anime?status=complete&order_by=score&sort=desc&limit=20&sfw=${adult ? 'false' : 'true'}&page=${page}`);
      return { items: d.map(fromJikan), hasNext: d.length === 20, page };
    }
    return alPage({ page, sort: ['SCORE_DESC'], status: 'FINISHED', isAdult: adult ? undefined : false });
  },

  async byFormat(format, { source, adult, page = 1 }) {
    if (source === 'mal') {
      const d = await jikan(`/anime?type=${encodeURIComponent(format.toLowerCase())}&order_by=popularity&sort=desc&limit=20&sfw=${adult ? 'false' : 'true'}&page=${page}`);
      return { items: d.map(fromJikan), hasNext: d.length === 20, page };
    }
    return alPage({ page, sort: ['POPULARITY_DESC'], format, isAdult: adult ? undefined : false });
  },

  async thisSeason({ source, adult, page = 1 }) {
    if (source === 'mal') return Api.airingNow({ source, adult, page });
    return alPage({
      page, sort: ['POPULARITY_DESC'],
      season: currentSeason(), year: new Date().getFullYear(),
      isAdult: adult ? undefined : false
    });
  },

  async upcoming({ source, adult, page = 1 }) {
    if (source === 'mal') {
      const d = await jikan(`/seasons/upcoming?limit=20&sfw=${adult ? 'false' : 'true'}&page=${page}`);
      return { items: d.map(fromJikan), hasNext: d.length === 20, page };
    }
    const ns = nextSeason();
    return alPage({ page, sort: ['POPULARITY_DESC'], season: ns.season, year: ns.year, isAdult: adult ? undefined : false });
  },

  async topMovies({ source, adult, page = 1 }) {
    if (source === 'mal') {
      const d = await jikan(`/top/anime?type=movie&limit=20&sfw=${adult ? 'false' : 'true'}&page=${page}`);
      return { items: d.map(fromJikan), hasNext: d.length === 20, page };
    }
    return alPage({ page, sort: ['SCORE_DESC'], format: 'MOVIE', isAdult: adult ? undefined : false });
  },

  async byGenre(genre, { source, adult, page = 1 }) {
    if (source === 'mal') {
      const d = await jikan(`/anime?genres=${encodeURIComponent(genre)}&order_by=score&sort=desc&limit=20&sfw=${adult ? 'false' : 'true'}&page=${page}`);
      return { items: d.map(fromJikan), hasNext: d.length === 20, page };
    }
    return alPage({ page, sort: ['POPULARITY_DESC'], genre, isAdult: adult ? undefined : false });
  },

  async search(q, { source, adult, page = 1, format = null, genre = null }) {
    if (!q || !q.trim()) return { items: [], hasNext: false, page };
    if (source === 'mal') {
      const f = format ? `&type=${format.toLowerCase()}` : '';
      const g = genre ? `&genres=${encodeURIComponent(genre)}` : '';
      const d = await jikan(`/anime?q=${encodeURIComponent(q)}&limit=20&sfw=${adult ? 'false' : 'true'}${f}${g}&page=${page}`);
      return { items: d.map(fromJikan), hasNext: d.length === 20, page };
    }
    const Q = `
      query ($q:String,$page:Int,$format:MediaFormat,$genre:String,$isAdult:Boolean){
        Page(page:$page, perPage:20){
          pageInfo { hasNextPage currentPage }
          media(type:ANIME, search:$q, sort:[SEARCH_MATCH,POPULARITY_DESC],
                format:$format, genre:$genre, isAdult:$isAdult){ ${F_CARD} }
        }
      }`;
    const d = await anilist(Q, { q, page, format, genre, isAdult: adult ? undefined : false });
    return { items: d.Page.media.map(fromAniList), hasNext: d.Page.pageInfo.hasNextPage, page };
  },

  /** Full record for the detail page. */
  async detail(src, id) {
    if (src === 'mal') {
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
    }
    const Q = `query ($id:Int){ Media(id:$id, type:ANIME){ ${F_FULL} } }`;
    const d = await anilist(Q, { id: Number(id) });
    return fromAniList(d.Media);
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
