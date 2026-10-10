/*
 * Optional first-party playback adapter.
 *
 * Set ASTRAL_MEDIA_API_BASE to the HTTPS origin of a media API you own or are
 * licensed to use. The API must check viewing/offline rights itself and
 * return short-lived URLs. Do not put provider credentials in this app.
 */
const ASTRAL_MEDIA_API_BASE = '';

globalThis.ASTRAL_MEDIA_PROVIDER = Object.freeze({
  async getPlayback({ source, titleId, malId, episode, language }) {
    if (!ASTRAL_MEDIA_API_BASE) return null;

    const base = new URL(ASTRAL_MEDIA_API_BASE);
    if (base.protocol !== 'https:') {
      throw new Error('The media API must use HTTPS');
    }

    const url = new URL('/v1/playback', base);
    url.searchParams.set('source', String(source || 'anilist'));
    url.searchParams.set('titleId', String(titleId || ''));
    if (malId) url.searchParams.set('malId', String(malId));
    url.searchParams.set('episode', String(episode));
    url.searchParams.set('language', language === 'dub' ? 'dub' : 'sub');

    const response = await fetch(url, {
      headers: { Accept: 'application/json' }
    });
    if (!response.ok) {
      throw new Error(`Media provider returned ${response.status}`);
    }
    return response.json();
  }
});
