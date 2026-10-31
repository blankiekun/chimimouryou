# Mihon extension host

Runs Mihon/Tachiyomi extensions (keiyoushi's `.jar` builds) for the desktop app: one JVM process,
spoken to over stdin/stdout in JSON lines by `apps/desktop/mihon.js`. The protocol is in
`core/src/main/kotlin/moe/chimimouryou/mihon/Host.kt`.

- `core`: Mihon's source-api and network classes (Apache-2.0, RxJava removed), `Host` (the
  protocol), `Guard` (https only, public addresses only, on `network.client`) and `Remembered`
  (what Mihon's database keeps per work and chapter, such as `memo`). Android (phase 2) will build
  it against the real SDK.
- `android-compat`: the Android classes extensions call, on plain Java and `java.awt` (some from
  Suwayomi's AndroidCompat, MPL-2.0; see the repository's NOTICE).
- `desktop`: the jar loader (plain-text or binary `AndroidManifest.xml`, a child-first class loader
  per jar) and `Main.kt` (stdio).

## Build

Not built by PR or main CI (owner decision); the release workflow builds it for the desktop
packages. Locally, with a JDK 21:

```sh
cd apps/mihon-host
./gradlew :desktop:installDist      # jars in desktop/build/install/desktop/lib
```

`apps/desktop` (`pnpm start`) then finds the jars there. The app downloads its own Java runtime
(Settings → Mihon extensions), pinned by SHA-256 in `mihon.js`.

## Run by hand

```sh
java -Xmx256m -XX:+UseSerialGC -Dmihon.data=/tmp/mihon \
  -cp 'desktop/build/install/desktop/lib/*' moe.chimimouryou.mihon.MainKt
{"id":1,"op":"load","jar":"/path/to/tachiyomi-ja.rawkuma-v1.6.43.jar"}
{"id":2,"op":"popular","source":"<id from load>","page":1}
```

Extension jars are full-privilege JVM code: run only ones from repositories you trust.
