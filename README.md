# Astralanime

Anime discovery and tracking. Browse AniList or MyAnimeList, open a title to
read everything about it, keep a watchlist on your own device, tick episodes off
as you watch, and optionally sign in to AniList so your progress lives up there
too.

Deep black, one red. No backend, no framework, no build step.

---

## Contents

```
www/
  index.html            shell, splash, bottom nav
  img/logo.svg          the A mark
  css/app.css           the whole visual system
  js/api.js             AniList GraphQL + MyAnimeList (Jikan), one shared shape
  js/auth.js            AniList sign-in and two-way list sync
  js/store.js           localStorage: library, progress, episode ticks, settings
  js/views.js           every screen's markup
  js/app.js             hash router, events, orchestration
resources/
  icon.svg              source artwork
  android/              launcher icons at every density + colours
capacitor.config.json
package.json
.github/workflows/android.yml
```

About 100 KB of source, 150 KB of icons. The `www` folder ships into the APK
exactly as it is, which is why the build stays small.

## Screens

**Home** — the logo bar floats over a rotating hero of what's airing now, then
**Continue watching** (anything you're partway through, jumping straight to the
next episode — drawn from the local library, so it renders instantly and works
with no connection), trending, a ranked top ten, this season, most watched ever,
films, next season, and two genre rails.

**Browse:** a full-screen section menu for completed titles, most popular,
movies, TV series, OVAs, ONAs, specials, and genres.

**Anime page** — banner, cover, score, episodes, runtime, following count,
airing countdown, genres, synopsis, episode list with per-episode ticks,
characters, details, related titles, recommendations.

**Player** — an in-app episode player opened from the Play button, with
episode selection, subtitle/dub switching, previous/next controls, watched
state, fullscreen, and the embedded playback controls.

**Library** — Watching, Plan to watch, Completed, On hold, Dropped, Favourites,
with progress bars on the posters. Export and import as JSON.

**Settings** — catalogue source, title language, cover tinting, auto-progress,
adult filter, AniList account, MAL client ID, wipe.

## Data sources

| | endpoint | key |
|---|---|---|
| AniList | `https://graphql.anilist.co` | none for reading |
| MyAnimeList | `https://api.myanimelist.net/v2` | Client ID in Settings |

AniList reading needs no credentials. MyAnimeList API v2 reading uses the
app's public Client ID by default and sends it in the `X-MAL-CLIENT-ID`
header; a different Client ID can be entered in Settings. The app falls back
to AniList if the official MAL request is unavailable. Jikan is kept only as a
read fallback and is rate limited to about 3 requests a second, so `api.js`
queues its calls.

## Signing in to AniList

The app uses the implicit grant with AniList's own pin page as the redirect, so
there's no deep link, no custom URL scheme and no server involved. It behaves
identically in the APK and in a desktop browser.

1. On anilist.co go to **Settings → Developer → Create New Client**. Name it
   Astralanime and set the redirect URL to
   `https://anilist.co/api/v2/oauth/pin`.
2. Paste the client ID into Settings in the app, press **Authorise on AniList**.
3. AniList shows a token. Copy it, return to the app, paste it, press **Sign in**.

Once signed in you get **Import my AniList list** (pulls your entries down),
**Upload everything on this device** (pushes local entries up, throttled to stay
under AniList's 90-requests-a-minute limit), and **Sync as you watch**, which
fires `SaveMediaListEntry` whenever you tick an episode or change a status.
Signing out leaves the local library untouched.

## Running it locally

```bash
npm install
npm run serve      # http://localhost:5173
```

ES modules need a server — opening `index.html` from the filesystem won't work.

---

# Packing it to GitHub and building the APK

## 1. Put it on GitHub

```bash
cd astralanime
git init
git branch -M main
git add .
git commit -m "Astralanime: base app"
```

Create an empty repository on github.com — **no** README, licence or gitignore,
since you already have them — then:

```bash
git remote add origin https://github.com/YOUR-NAME/astralanime.git
git push -u origin main
```

`node_modules/` and `android/` are gitignored on purpose. The Android project is
generated during the build; committing it causes merge pain for no benefit.

## 2. Let the Action build it

The push triggers `.github/workflows/android.yml`. Watch it under the **Actions**
tab. It installs Node and Java, generates the Android project, copies your
launcher icons in, enables shrinking, and builds a debug and a release APK.

When it finishes, open the run and download the **astralanime-apk** artifact
from the bottom of the page. It's a zip; the APKs are inside. Expect roughly
4 MB debug and 3 MB release.

To rebuild without pushing, use **Actions → Build Astralanime APK → Run
workflow**.

## 3. Install it on your phone

Copy the debug APK across and open it. Android will ask you to allow installing
from that source — that's normal for anything outside the Play Store.

Debug APKs are fine for testing but are signed with a throwaway key, so you
can't upgrade over them cleanly and can't publish them. For anything you intend
to keep, sign it.

## 4. Sign the release build

Make a key once and keep it safe forever — losing it means you can never ship an
update to the same app again:

```bash
keytool -genkey -v -keystore astralanime.jks -keyalg RSA \
  -keysize 2048 -validity 10000 -alias astralanime
base64 -w0 astralanime.jks       # macOS: base64 -i astralanime.jks
```

In the repo go to **Settings → Secrets and variables → Actions → New repository
secret** and add four:

| name | value |
|---|---|
| `KEYSTORE_B64` | the base64 output above |
| `KEYSTORE_PASSWORD` | the keystore password |
| `KEY_ALIAS` | `astralanime` |
| `KEY_PASSWORD` | the key password |

Push again. The signing step skips itself when the secrets are missing and runs
when they exist, producing `astralanime-release.apk` in the same artifact.

Never commit the `.jks` file — it's already in `.gitignore`.

## 5. Optional: publish releases

To attach the APK to a GitHub Release instead of an artifact, add this step at
the end of the workflow and push a tag like `v1.0.0`:

```yaml
      - name: Publish release
        if: startsWith(github.ref, 'refs/tags/')
        uses: softprops/action-gh-release@v2
        with:
          files: astralanime-release.apk
```

## Building locally instead

```bash
npm install
npx cap add android
cp -r resources/android/. android/app/src/main/res/
npm run android:build        # android/app/build/outputs/apk/debug/
```

Needs Java 21 and the Android SDK. `npx cap open android` opens it in Android
Studio if you'd rather build there.

---

## Editing notes

- **New home rail** — one `rail({...})` in `homeShell()` in `views.js`, one entry
  in the `jobs` array in `app.js`.
- **New AniList field** — add it to `F_CARD` or `F_FULL` in `api.js`, map it in
  `fromAniList`, and keep `fromJikan` in step or it'll read as undefined when the
  user switches catalogue.
- **Palette** — the custom properties at the top of `app.css`. `--tint` is the
  only one rewritten at runtime; turning on cover tinting in Settings lets each
  title repaint it with its own artwork colour.
- **Logo** — `www/img/logo.svg` is the source. After changing it, regenerate the
  launcher icons with `cairosvg` at the densities listed in
  `resources/android/`.

## Licence

MIT for this code. Metadata belongs to AniList and MyAnimeList under their
terms; artwork belongs to the respective rights holders.
