# chimimouryou for KOReader

A [KOReader](https://koreader.rocks) plugin for a chimimouryou server: browse and search the library
with each book's difficulty level, download EPUBs and manga, and keep your place and reading time in step with
the web reader.

- **Library**: Continue reading (the books you are reading, last read first, as on the web's Home),
  your Home books and the other books on this device come first, then the server's books, newest
  first, with search. Each row shows your place (`42%`, `Done`) and the 1-10 level the web library
  shows. Tap a book to open it, downloading it first (into `chimimouryou/` in KOReader's home folder)
  when it isn't on the device; hold it for its statistics. Tools → chimimouryou → Continue opens the
  last book you were reading, without Wi-Fi.
- **Progress**: positions are the web reader's own character counts, so KOReader and the browser
  open at the same character. When you open a book, and when you sync, the plugin asks before it
  jumps to a place another device saved; it never overwrites a place saved after the one it last saw.
  Your place is sent about 90 s after a page turn, on close and on sleep, while Wi-Fi is on.
- **Reading time**: time and characters read per day go to the server's statistics (Statistics page,
  Home dashboard). Each page turn counts up to 2 minutes; KOReader's own statistics plugin is not read,
  so nothing is counted twice. A day starts at the hour set in the web app's statistics settings
  (read when a book opens). Off with Send reading time, which also shows the time not sent yet.
- **Reading folder**: a `Reading` folder in the download folder holds the books of your Continue
  reading and Home, as on the web's Home. Each time Wi-Fi connects (or with Tools → chimimouryou →
  Sync reading folder now) new ones are downloaded, and the books it downloaded that left Home
  (removed or finished) are deleted, after their place and reading time reached the server. Books
  you downloaded yourself are never deleted, nor the open book. Opening a folder book takes you to
  the place saved on another device without asking, unless this device has a newer place of its
  own. Open reading folder shows it in the file browser; switch it off with the Reading folder
  checkbox.
- **Manga**: CBZ volumes sync by page with the web's manga reader. Their reading time is sent, but no
  characters (the web counts the pages' OCR text, which the device doesn't have).
- **Statistics**: Tools → chimimouryou → Reading statistics (or a gesture: chimimouryou statistics)
  shows today, the last 7 days, your streak, total time and speed, from every device's reading; in a
  book also its time, speed, place, characters left and about how long it will take to finish.

Only books downloaded through the plugin sync (the book's sidecar remembers which server book it
is). When the server signs the device out (the token was revoked or expired) the plugin says so; time
read meanwhile is sent after you sign in again. Japanese books render horizontally: KOReader has no vertical text.

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
- `luajit tools/stats-check.lua chimimouryou.koplugin` checks the day start, the pending reading
  time (a lost PUT answer), the mirror, the statistics summary, the Home settings,
  `X-Expected-Account`, manga pages, the no-dialog jump and which books the Reading folder downloads and deletes, with KOReader's modules stubbed.

GPL-3.0-or-later. KOReader itself is AGPL-3.0; the GPLv3 allows the combination (section 13).
