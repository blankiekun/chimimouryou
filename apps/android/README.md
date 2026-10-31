# chimimouryou for Android

The standalone edition (`VITE_EDITION=standalone`, the same build as the desktop app) in an
Android WebView, packaged with [Capacitor](https://capacitorjs.com) 8. Package id
`moe.blankie.chimireader`: it can never change once released (Android treats another id as another
app, with its own data).

## Install

Every release (`v*` tag) attaches `chimimouryou-<version>.apk` to its GitHub release
(https://github.com/blankiekun/chimimouryou/releases/latest). On the phone, open it from the
browser's downloads and allow "Install unknown apps" for that browser when Android asks. A newer
APK installs over the old one and keeps its books, as long as it is signed with the same key.

Updates: on start, at most once a day, the app (the `github` flavor) asks GitHub for the latest
release; when it is newer, "chimimouryou X.Y.Z is out" offers Download (the APK, in the system
browser; install it the same way) or Later (asked again next start). Builds without a release
version (CI's debug APK, local builds) and the `play` flavor never ask.

CI builds a debug APK (the `github` flavor) when `apps/android` (or the Mihon host's `core`, the lockfile, the
workflows, `android-drive.ts`, `android-bars.ts`, `native-save.ts`) changes: the run's Summary → Artifacts →
`chimimouryou-debug-apk` (a zip holding `app-github-debug.apk`).
It is signed with a debug key, so it can't update a release install (uninstall first, which
deletes the app's books), and Drive sign-in works only once that key is registered (step 4 below).

## Build it

Needs JDK 21 and the Android SDK (`ANDROID_HOME`) with platform 37 (`sdkmanager 'platforms;android-37.0'`;
Gradle's own download of it fails the run it happens in). From this folder, after `pnpm install` at the
repository root:

```sh
pnpm run build:web                             # the standalone web build in ../web/build
pnpm run sync                                  # copies it into android/ (cap sync android)
cd android && ./gradlew assembleGithubDebug    # android/app/build/outputs/apk/github/debug/app-github-debug.apk
```

Two product flavors: `github` (the APK releases attach) and `play`, the same app without Mihon
extensions (below), for a Play Store build later. `assembleGithubRelease` signs with the key named by `ANDROID_KEYSTORE_FILE`, `ANDROID_KEYSTORE_PASSWORD`,
`ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD` (unsigned without them); `-PversionName=3.11.0
-PversionCode=3011000` sets the version. Install over USB with `adb install -r <apk>`.

## How it works

- The app is served from `https://chimimouryou.localhost` (`capacitor.config.json`:
  `androidScheme: https`, `hostname`). IndexedDB, localStorage and OPFS are per origin, so this
  must never change: a different scheme or hostname starts with an empty library. `.localhost` is
  reserved and never a real site, so no request to the internet is caught by the app.
- Capacitor injects its bridge as a document-start script (an inline script after `<head>` on
  WebViews too old for that, before the CSP meta tag), so `kit.csp` stays as it is.
- Back (`MainActivity.java`) goes back in the app's history and leaves the app at its first page.
- Safe areas: on targetSdk 36 the app is drawn edge to edge. The page has no `viewport-fit=cover`,
  so Capacitor's SystemBars pads the WebView by the status and navigation bars: the top bar and the
  phone tab bar sit between them.
- Immersive readers: `/b`, `/m` and `/v` hide the status and navigation bars
  (`apps/web/src/lib/data/standalone/android-bars.ts`, from the root layout on every route change,
  through Capacitor's built-in SystemBars `hide`/`show`; again when the app comes back from the
  background). `MainActivity.java` sets `BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE`, so a swipe from
  the edge shows them for a moment over the page. Hidden bars have no insets, so SystemBars' padding
  drops to the display cutout alone: nothing under a notch, no gap where the bars were. Other pages
  (`/hook` too: it is a desktop texthooker page with its own header) keep the bars.
- `<input type=file>` opens Android's file picker (Capacitor's `BridgeWebChromeClient`); links to
  other sites, `window.open` included, open in the browser (`Bridge.launchIntent`).
- CapacitorHttp's global `fetch` patch is off (the default): it breaks streaming and abort. Sources
  call `CapacitorHttp.request` directly (`transport.ts`), following redirects themselves, so sites
  without CORS work in the app.
- Downloads (Export → Zip File, CSVs, reports): the WebView drops `<a download>` saves, so
  `apps/web/src/lib/data/standalone/native-save.ts` (`catchDownloads`, from the root layout, in the app only)
  takes every `<a download>` of a blob/data URL (clicked, or a detached link's `click()`) and hands
  it to `FileSavePlugin.java` in 3 MB chunks; Android's "Save to" screen asks where (Downloads by
  default), so no storage permission is needed.
- `android:allowBackup="false"`: the WebView's storage holds API keys and tokens, which Android's
  backup to Google would copy. Readers back up through Drive or Export.
- Icon: the ち logo as an adaptive icon (`res/drawable/ic_launcher_foreground.xml`, a vector: the
  green circle with ち cut out on paper; also the themed-icon layer and the splash icon), a plain
  vector on Android 7. The launch screen is that icon on paper.

## Mihon extensions (`github` flavor)

The app runs Mihon/Tachiyomi extensions (keiyoushi's apks) in-process, with the desktop host's
`core` (`apps/mihon-host`, `implementation project(':mihon-core')`, built against the host's Android
stand-ins as compileOnly, so they never reach the APK). `src/github/kotlin`:
`MihonHostPlugin.kt` is the Capacitor plugin `MihonHost` (`install`, `call` with the host's op set,
`drop`), which `apps/web/src/lib/data/sources/mihon-runtime.ts` uses when the plugin exists;
`MihonApks.kt` downloads an apk through the host's guarded client, accepts it only when a signing
certificate's SHA-256 is the repository's `signingKey`, keeps it read-only as
`filesDir/exts/<sha256>.ext`, re-hashes it before loading, reads it with PackageManager and loads it
child-first (Mihon's DelegateLastClassLoader backport). Cookies go to the WebView's CookieManager,
preferences are the real SharedPreferences. Images come back as files under the cache that the
page reads through `Capacitor.convertFileSrc` and then drops. The host's libraries (OkHttp 5.5.1,
jsoup, kotlinx, Injekt) need compileSdk 37 (`variables.gradle`, `android.suppressUnsupportedCompileSdk`).

`play` has none of it (`src/play` registers no plugin): the web side then says extensions need the
app, as in a plain browser. Check with `dexdump` that its APK has no `eu/kanade`, `moe/chimimouryou`,
`okhttp3`, `org/jsoup` or `uy/kohesive` classes.

Phone E2E (not in CI; a phone with USB debugging, `adb`, python3, openssl): `node e2e/mihon.e2e.mjs`
from this folder builds the github debug APK, installs it and runs keiyoushi's real Rawkuma apk
against the fixture site of `server/tests/fixtures/sources/mihon.py` (its header says how: the
phone's proxy setting is pointed at the fixture through `adb reverse` and restored after, and the
debug build trusts a user-installed test CA, `src/debug`).

## Google Drive

Google refuses its web sign-in inside a WebView, so the app asks Play services' Authorization API
for a `drive.file` token instead (`DriveAuthPlugin.java`, used by
`apps/web/src/lib/data/standalone/android-drive.ts` from the storage OAuth manager when
`Capacitor.isNativePlatform()`; the web and desktop builds are unchanged). There is no refresh
token: when a token expires the app asks again, silently once the reader has consented. Without
Google Play services, signing in says "Google Drive needs Google Play services". OneDrive isn't
offered (the standalone edition has none).

Google matches the app by package name and signing key, so the APK holds no client id. The owner
sets it up once, in the **same Google Cloud project as the web client** (`drive.file` only shows
files made by that project's clients, so another project would see an empty Drive):

1. Google Cloud Console → that project → APIs & Services → Credentials → Create credentials →
   OAuth client ID → Application type **Android**.
2. Package name: `moe.blankie.chimireader`.
3. SHA-1 certificate fingerprint of the release key:
   `keytool -list -v -keystore chimimouryou-release.jks -alias chimimouryou` (the `SHA1:` line).
4. For the CI debug APK: make a debug key once
   (`keytool -genkeypair -keystore debug.keystore -alias androiddebugkey -storepass android
-keypass android -keyalg RSA -validity 10000 -dname "CN=Android Debug,O=Android,C=US"`), add it
   as the repository secret `ANDROID_DEBUG_KEYSTORE` (`base64 -w0 debug.keystore`; CI uses it in
   place of a new one each run) and make a second Android client with the same package name and its
   SHA-1 (`keytool -list -v -keystore debug.keystore -storepass android`). Copy it to
   `~/.android/debug.keystore` to sign local builds the same way.
5. The consent screen already lists the `drive.file` scope for the web client; nothing else
   changes. No client secret, no redirect URI.

## Release key

Make it once, on your own machine, and **back it up** (a password manager or two offline copies):
an APK signed with another key can't update an installed app, so losing it means every reader
uninstalls (losing books not synced) and starts over.

```sh
keytool -genkeypair -v -keystore chimimouryou-release.jks -alias chimimouryou \
  -keyalg RSA -keysize 4096 -validity 10000
```

Then add the repository secrets `ANDROID_KEYSTORE` (`base64 -w0 chimimouryou-release.jks`),
`ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` (`chimimouryou`) and `ANDROID_KEY_PASSWORD`.
`release.yml`'s `android` job builds the APK from the desktop job's web build (with the
`VITE_GDRIVE_*` secrets), versionName from the tag and versionCode `major × 1 000 000 + minor × 1000

- patch`(v3.10.1 → 3010001), and attaches it to the release. Without`ANDROID_KEYSTORE` it skips
  with a notice.

## Limits

- No Yomitan (Android WebViews have no extensions); the built-in dictionary works.
- No folder sync: `showDirectoryPicker` doesn't exist in the WebView. Books stay in the app or on
  Google Drive.
- The APK carries the same build as the desktop app: no analysis tools, JMdict or VNBox files
  (the published site serves those same-origin). Capacitor sends no COOP/COEP headers, so `/v` is
  never cross-origin isolated (no `SharedArrayBuffer`), as on GitHub Pages: even with VNBox's files
  it would run without its isolated audio path.
- About 180 MB, mostly the reader's fonts and ONNX Runtime's wasm.

## Later: a Play Store build

Not built yet (the `play` flavor exists, without Mihon extensions); a Play build would need:

- no sideloaded updates (Play updates it; the update offer runs only in the `github` flavor);
- no Mihon extensions (Play's policy on downloading code: the `play` flavor);
- an Android App Bundle (`bundleRelease`) and Play App Signing: the Android OAuth client then needs
  Play's app signing key's SHA-1 as well (Play Console → App integrity).
