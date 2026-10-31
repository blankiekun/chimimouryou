# chimimouryou for KOReader

A [KOReader](https://koreader.rocks) plugin for a chimimouryou server: browse and search the library
with each book's difficulty level, download EPUBs, and keep your place and reading time in step with
the web reader.

- **Library**: the server's books, newest first, with search and the 1-10 level the web library shows.
  Tap a book to download it (into `chimimouryou/` in KOReader's home folder) and open it.
- **Progress**: positions are the web reader's own character counts, so KOReader and the browser
  open at the same character. When you open a book, and when you sync, the plugin asks before it
  jumps to a place another device saved; it never overwrites a place saved after the one it last saw.
  Your place is sent about 90 s after a page turn, on close and on sleep, while Wi-Fi is on.
- **Reading time**: time and characters read per day go to the server's statistics (Statistics page,
  Home dashboard). Each page turn counts up to 2 minutes; KOReader's own statistics plugin is not read,
  so nothing is counted twice. Off with Send reading time.

Only books downloaded through the plugin sync (the book's sidecar remembers which server book it
is). Japanese books render horizontally: KOReader has no vertical text.

## Install

1. Download `chimimouryou.koplugin.zip` from the [latest release](https://github.com/blankiekun/chimimouryou/releases/latest)
   and unzip it, keeping the `chimimouryou.koplugin` folder.
2. Connect the e-reader by USB and copy the folder into KOReader's `plugins` folder:
   - Kobo: `.adds/koreader/plugins/`
   - Kindle: `koreader/plugins/` (`/mnt/us/koreader/plugins/`)
   - PocketBook: `applications/koreader/plugins/`
   - Android: `koreader/plugins/` on the internal storage
   - Linux: `~/.config/koreader/plugins/`
3. Restart KOReader. The plugin is in the Tools menu → chimimouryou.

To update, replace the folder with the new one.

## Set up

1. Tools → chimimouryou → Set server address: the address you open the server at, e.g.
   `https://books.example.org`.
2. Sign in with your account. KOReader gets its own token (it shows under Settings → Account → Devices
   on the server, where you can revoke it); your password isn't kept. Signing in needs the server's
   **https://** address. Over plain `http://` the plugin works only signed out, on a network the server
   trusts (`TRUSTED_NETWORKS`).
3. Tools → chimimouryou → Library.

The token is kept in KOReader's settings folder (`settings/chimimouryou.lua`) and never logged.

## For developers

- `chimimouryou.koplugin/`: `main.lua` (menu, sign-in, sync, reading time), `library.lua`,
  `api.lua` (the server's `/api/v1` and `/account/api/token`), `charcount.lua` (character counts).
- `tools/count-compare.sh <KOReader folder> <book.epub>…` runs the web reader's counter and
  `charcount.lua` inside KOReader over the same books and compares every spine item, sample positions
  both ways and every page start. Use KOReader's Linux AppImage, extracted
  (`./koreader-*.AppImage --appimage-extract`, then `squashfs-root/usr/lib/koreader`), and run
  `pnpm install` first.
- `tools/e2e.sh` drives the plugin in a real KOReader under Xvfb against a test server.

GPL-3.0-or-later. KOReader itself is AGPL-3.0; the GPLv3 allows the combination (section 13).
