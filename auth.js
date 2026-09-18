/* auth.js — AniList sign-in and list sync.
 *
 *  Reading the catalogue needs nothing. A token is only needed to write your
 *  progress back to anilist.co, which is what signing in buys you.
 *
 *  Flow: the implicit grant with AniList's own pin page as the redirect. The
 *  user authorises in a browser, AniList shows the token, they paste it back.
 *  No deep link, no custom scheme, no server — works the same in the APK and
 *  in a desktop browser.
 */

import { alRaw } from './api.js';
import { Store } from './store.js';

/* local status  ->  AniList MediaListStatus */
const TO_AL = {
  watching: 'CURRENT',
  planning: 'PLANNING',
  completed: 'COMPLETED',
  paused: 'PAUSED',
  dropped: 'DROPPED'
};

const FROM_AL = {
  CURRENT: 'watching',
  REPEATING: 'watching',
  PLANNING: 'planning',
  COMPLETED: 'completed',
  PAUSED: 'paused',
  DROPPED: 'dropped'
};

export const authUrl = clientId =>
  `https://anilist.co/api/v2/oauth/authorize?client_id=${encodeURIComponent(clientId)}&response_type=token`;

const Q_VIEWER = `
  query {
    Viewer {
      id name siteUrl
      avatar { large medium }
      options { titleLanguage }
      statistics { anime { count episodesWatched minutesWatched } }
    }
  }`;

const Q_LIST = `
  query ($userId: Int) {
    MediaListCollection(userId: $userId, type: ANIME) {
      lists {
        entries {
          status progress score(format: POINT_100) updatedAt
          media {
            id idMal
            title { romaji english native }
            coverImage { extraLarge large color }
            episodes format seasonYear averageScore status
          }
        }
      }
    }
  }`;

const M_SAVE = `
  mutation ($mediaId: Int, $status: MediaListStatus, $progress: Int, $score: Float) {
    SaveMediaListEntry(mediaId: $mediaId, status: $status, progress: $progress, score: $score) {
      id status progress
    }
  }`;

const M_DELETE = `
  mutation ($id: Int) { DeleteMediaListEntry(id: $id) { deleted } }`;

export const Auth = {
  get token() { return Store.settings.anilistToken || ''; },
  get user() { return Store.settings.anilistUser || null; },
  get signedIn() { return !!(this.token && this.user); },

  /** Verify a pasted token and remember who it belongs to. */
  async signIn(token) {
    const clean = (token || '').trim().replace(/^Bearer\s+/i, '');
    if (!clean) throw new Error('Paste the token AniList showed you.');
    const d = await alRaw(Q_VIEWER, {}, clean);
    const v = d.Viewer;
    if (!v) throw new Error('That token did not identify an account.');
    const user = {
      id: v.id,
      name: v.name,
      avatar: v.avatar?.large || v.avatar?.medium || '',
      url: v.siteUrl,
      watched: v.statistics?.anime?.episodesWatched || 0,
      count: v.statistics?.anime?.count || 0
    };
    Store.set({ anilistToken: clean, anilistUser: user, source: 'anilist' });
    return user;
  },

  signOut() {
    Store.set({ anilistToken: '', anilistUser: null });
  },

  /** Copy the account's AniList list into the local library. */
  async pull() {
    if (!Auth.signedIn) throw new Error('Sign in to AniList first.');
    const d = await alRaw(Q_LIST, { userId: Auth.user.id }, Auth.token);
    const lists = d.MediaListCollection?.lists || [];
    let n = 0;
    lists.forEach(l => (l.entries || []).forEach(e => {
      const m = e.media;
      if (!m) return;
      Store.save({
        src: 'anilist',
        id: m.id,
        malId: m.idMal || null,
        title: m.title,
        cover: m.coverImage?.extraLarge || m.coverImage?.large || '',
        color: m.coverImage?.color || null,
        episodes: m.episodes,
        format: m.format,
        year: m.seasonYear,
        score: m.averageScore,
        status: m.status
      }, {
        status: FROM_AL[e.status] || 'planning',
        progress: e.progress || 0,
        score: e.score || null
      }, { silent: true });
      n++;
    }));
    Store.touch();
    return n;
  },

  /** Push one local entry up. Fails quietly — the local library is the truth. */
  async push(media, entry) {
    if (!Auth.signedIn || media.src !== 'anilist') return false;
    try {
      await alRaw(M_SAVE, {
        mediaId: Number(media.id),
        status: TO_AL[entry.status] || 'PLANNING',
        progress: Number(entry.progress) || 0,
        score: entry.score ? Number(entry.score) : 0
      }, Auth.token);
      return true;
    } catch (err) {
      if (err.code === 'auth') Auth.signOut();
      console.warn('AniList sync failed:', err.message);
      return false;
    }
  },

  /** Send every locally tracked AniList title up in one go. */
  async pushAll(onProgress) {
    if (!Auth.signedIn) throw new Error('Sign in to AniList first.');
    const rows = Object.values(Store.library).filter(e => e.src === 'anilist');
    let done = 0, ok = 0;
    for (const e of rows) {
      const sent = await Auth.push({ src: 'anilist', id: e.id }, e);
      if (sent) ok++;
      done++;
      onProgress?.(done, rows.length);
      await new Promise(r => setTimeout(r, 720));   // AniList allows 90/min
    }
    return { ok, total: rows.length };
  }
};

export { TO_AL, FROM_AL, M_DELETE };
