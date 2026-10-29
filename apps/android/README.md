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

There is no self-updater: install the next release's APK the same way.

CI builds a debug APK when `apps/android` (or the lockfile, the workflows, `android-drive.ts`)
changes: the run's Summary → Artifacts → `chimimouryou-debug-apk` (a zip holding `app-debug.apk`).
It is signed with a debug key, so it can't update a release install (uninstall first, which
deletes the app's books), and Drive sign-in works only once that key is registered (step 4 below).

## Build it

Needs JDK 21 and the Android SDK (`ANDROID_HOME`; Gradle installs missing platforms). From this
folder, after `pnpm install` at the repository root:

```sh
pnpm run build:web                       # the standalone web build in ../web/build
pnpm run sync                            # copies it into android/ (cap sync android)
cd android && ./gradlew assembleDebug    # android/app/build/outputs/apk/debug/app-debug.apk
```

`assembleRelease` signs with the key named by `ANDROID_KEYSTORE_FILE`, `ANDROID_KEYSTORE_PASSWORD`,
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
- `<input type=file>` opens Android's file picker (Capacitor's `BridgeWebChromeClient`); links to
  other sites, `window.open` included, open in the browser (`Bridge.launchIntent`).
- CapacitorHttp's global `fetch` patch is off (the default): it breaks streaming and abort.

## Google Drive

Google refuses its web sign-in inside a WebView, so the app asks Play services' Authorization API
for a `drive.file` token instead (`DriveAuthPlugin.java`, used by
`apps/web/src/lib/data/android-drive.ts` from the storage OAuth manager when
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
- Downloads from the page (Export → Zip File, saved files) don't work: the WebView has no
  download handler. Sync to Drive to keep a copy.
- The APK carries the same build as the desktop app: no analysis tools, JMdict or VNBox files
  (the published site serves those same-origin). Capacitor sends no COOP/COEP headers, so `/v` is
  never cross-origin isolated (no `SharedArrayBuffer`), as on GitHub Pages: even with VNBox's files
  it would run without its isolated audio path.
- About 180 MB, mostly the reader's fonts and ONNX Runtime's wasm.

## Later: a Play Store build

Not built yet; a Play build would need:

- no self-updater and no sideloaded updates (Play updates it);
- no extension repositories (Play's policy on downloading code);
- an Android App Bundle (`bundleRelease`) and Play App Signing: the Android OAuth client then needs
  Play's app signing key's SHA-1 as well (Play Console → App integrity).
