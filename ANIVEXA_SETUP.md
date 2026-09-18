# Anivexa playback setup

The player now tries the Anivexa API before MegaPlay:

1. Reanime
2. AniKoto
3. AnimeGG
4. AniWaves
5. MKissa
6. 2dhive
7. AniZone
8. AniBD
9. KickassAnime

If Anivexa returns multiple stream qualities, the player shows a quality
selector. If Anivexa cannot be reached, a provider returns no playable URL,
or a direct video fails to load, the existing MegaPlay iframe is used.

The player also includes two manual server buttons:

- **Server 1 — Anivexa**
- **Server 2 — MegaPlay**

Anivexa is selected first when available, while MegaPlay can be selected
manually at any time.

## Local browser test

Run the Anivexa API in one terminal:

```bash
cd Anivexa-API
npm install
npm start
```

Run the Astralanime static app in another terminal:

```bash
npm install
npm run serve
```

Then open:

```text
http://localhost:5173
```

The packaged app is configured to use:

```text
https://anixera.up.railway.app
```

Open an AniList title, choose an episode, and the player will show whether it
selected an Anivexa provider or MegaPlay fallback.

## Android or hosted build

An Android app cannot reach a Node server running on your computer through
`localhost`. Deploy Anivexa to a public HTTPS host, then change
`DEFAULT_ANIVEXA_API_BASE` near the top of `api.js` to that URL before building
the APK. MegaPlay remains available if that API is down.

Railway's `8080` is the internal service port. Do not append `:8080` to the
public HTTPS domain in the APK.

## Vercel

The Astralanime frontend can be hosted on Vercel. Anivexa can also be made to
run on Vercel because the repository includes serverless handlers, but it is
not the recommended host for this API: shared Vercel IPs are commonly blocked
by the streaming providers, so the API may start successfully while returning
few or no sources. A VPS, Railway, or Render deployment is usually a better
choice for Anivexa.