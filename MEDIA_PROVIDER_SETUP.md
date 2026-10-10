# Authorized media provider setup

The app intentionally ships without a streaming service configured. Catalogue
records from AniList or MyAnimeList do not grant rights to stream or save a
title.

## Connect your provider

1. Deploy an HTTPS API that you own or are licensed to use.
2. In `media-provider.js`, set `ASTRAL_MEDIA_API_BASE` to that API's HTTPS
   origin.
3. Implement `GET /v1/playback` with these query parameters:
   - `source`: `anilist` or `mal`
   - `titleId`: catalogue ID
   - `malId`: optional MyAnimeList ID
   - `episode`: episode number
   - `language`: `sub` or `dub`
4. Return a single playback variant or a `variants` array:

```json
{
  "label": "My licensed catalog",
  "variants": [
    {
      "url": "https://media.example.com/episode-1.mp4",
      "quality": "1080p",
      "downloadAllowed": true,
      "downloadUrl": "https://media.example.com/episode-1.mp4"
    }
  ]
}
```

`url` must be a direct HTTPS MP4 or WebM file. A download is offered only when
the provider sets `downloadAllowed` to `true` and provides a direct HTTPS MP4
URL in `downloadUrl` (or uses the same URL for both). These client checks
improve safety and UI accuracy; they do not replace server-side authorization.
The API must verify rights and account entitlements before returning a
playback or offline URL. Keep provider secrets on the server, not in this app.

## Android download behavior

The Android app uses Capacitor File Transfer to save the authorized MP4 in its
private app data directory. It stores episode metadata locally, shows transfer
progress, opens completed files offline, and supports delete and clear-all.
The browser preview does not download files. The app does not download
embedded players, HLS/DASH playlists, or files from third-party streaming
services, and it does not convert or proxy media.

## Local preview and Android build

```bash
npm install
npm run serve
```

For a local Android build, install Java 21 and the Android SDK, then run:

```bash
npx cap add android
npm run android:build
```

The GitHub Actions workflow builds debug and release APKs after a push or
manual run. A release APK is signed only when the GitHub repository has
properly configured signing secrets.
