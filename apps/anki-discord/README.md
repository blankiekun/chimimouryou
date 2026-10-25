# chimimouryou Discord companion (Anki add-on)

Browsers can't talk to Discord, so chimimouryou (server build, GitHub Pages, desktop app) sends your
Discord status to this add-on. It runs inside Anki Desktop, listens on `127.0.0.1:41918` and passes
the status to the Discord desktop client over Discord's local IPC. It needs Anki Desktop and Discord
running on the same computer. Unless you pair it with the hub relay (below), nothing goes over the
internet.

Pure Python, standard library only (Anki's own Python is enough).

## Install

Until it is on AnkiWeb: build the package and open it with Anki.

```sh
python3 apps/anki-discord/build.py   # writes apps/anki-discord/chimimouryou-discord.ankiaddon
```

Then double-click the `.ankiaddon` file (or Anki → Tools → Add-ons → Install from file…) and restart
Anki. The companion starts when a profile opens and stops when it closes or Anki quits.

## Config

Tools → Add-ons → chimimouryou Discord companion → Config (`config.json`, explained in `config.md`):

- `port`: default `41918` (the desktop app uses 41917, AnkiConnect 8765).
- `extraOrigins`: your own chimimouryou servers, e.g. `["https://books.example.net"]`.
  `https://chimireader.github.io` and `http://127.0.0.1:41917` are always allowed.
- `hub`: the social hub used for pairing codes, default `https://chimi-hub.blankiekun.workers.dev`
  (`https://` only).

## Status from your other devices (hub relay)

Paired with your chimimouryou social account, the add-on also shows what you read on other devices
(a phone, a computer without Anki) in this computer's Discord: those devices send their status to the
social hub, and the add-on asks the hub for it, only while Discord is running: every 30 s, every 2
minutes after 10 minutes without a status, every 5 minutes after an hour, later when the hub asks
for that, and less often while the hub can't be reached.

- Automatic: signed in to Social on this computer, chimimouryou pairs the add-on itself
  (`PUT /v1/pair`).
- With a code: make a pairing code in chimimouryou (Settings → Discord; it works once and expires
  after 10 minutes), then Anki → Tools → **Pair chimimouryou Discord…**, type it and press Pair. The
  add-on names itself "Anki on <computer name>" in your list of paired devices.
- Unpair in the same dialog, or remove the device in chimimouryou's settings (the add-on notices the
  revoked key on its next request and forgets it).

A status sent by a page on this computer in the last 2 minutes, and not cleared, wins over the hub's.
When the hub has nothing current, only a status that came from the hub is cleared.

Privacy: unpaired, the add-on makes no internet requests. Paired, it only asks the hub for your current
status, with a presence key that can read nothing else; it never sends what this computer reads to the
hub (chimimouryou's pages do that, and only when you turn the relay on). The key and the hub address
are kept in `chimimouryou_discord/user_files/pairing.json` (kept across add-on updates, readable only
by you where the system has file modes, never packaged by `build.py`) and never logged. Requests don't
follow redirects, so the key only goes to the hub.

## Protocol

What chimimouryou's `discord` plugin implements. Base URL `http://127.0.0.1:41918`.

| Request               | Body                                  | Answer                                                                                                           |
| --------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `GET /v1/status`      |                                       | `200 {"version": "0.2.0", "discord": "connected" \| "closed", "lastSent": <epoch ms> \| null, "paired": <bool>}` |
| `PUT /v1/activity`    | the finished activity, JSON, ≤ 16 KB  | `204`; `400 {"error"}` if invalid, `413` if too large                                                            |
| `DELETE /v1/activity` |                                       | `204`: clears the status                                                                                         |
| `PUT /v1/pair`        | `{"hub": "https://…", "key": "pk_…"}` | `204`: paired (replaces an earlier pairing); `400` unless the hub is https and the key a presence key            |
| `DELETE /v1/pair`     |                                       | `204`: forgets the key                                                                                           |

Every request must come from a listed `Origin` (or none, e.g. curl) and carry `Host: 127.0.0.1:<port>`
or `localhost:<port>`, else `403`. Preflights (`OPTIONS`) answer with
`Access-Control-Allow-Origin`, `Allow-Methods: GET, PUT, DELETE`, `Allow-Headers: Content-Type` and
`Access-Control-Allow-Private-Network: true`. Send `Content-Type: application/json`.

The activity is rendered by the page; the add-on has no templates. Fields (all optional, but one of
`name`, `details`, `state` is required):

```json
{
  "name": "Reading 本好きの下剋上",
  "details": "Chapter 3",
  "details_url": "https://…",
  "state": "42% · 120 chars/min",
  "state_url": "https://…",
  "assets": {
    "large_image": "https://…/cover.jpg",
    "large_text": "Cover",
    "small_image": "logo",
    "small_text": "chimimouryou"
  },
  "timestamps": { "start": 1761350400000, "end": 1761354000000 },
  "party": { "size": [3, 12] },
  "buttons": [{ "label": "Open", "url": "https://…" }]
}
```

- `name` replaces the app's name in Discord's member list ("Next to your name"); `details` is the
  first line, `state` the second.
- Text is trimmed and whitespace collapsed; `name`, `details`, `state` and image texts must be 2–128
  characters (longer ones are cut with "…", shorter ones dropped).
- URLs must be `https://` (≤ 256; button URLs ≤ 512). An image is an https URL or an asset key of the
  Discord app. An image text without its image is dropped.
- `timestamps` are epoch milliseconds; `party.size` is `[current, max]` with 1 ≤ current ≤ max.
- At most 2 buttons, label 1–32 characters.
- `type` is always 0 (Playing); any other field is dropped.

Discord accepts about one update per 15 s. The add-on answers `204` at once and sends the newest
waiting activity when it may (the first one right away), so the page can PUT whenever something
changes. While Discord is closed it keeps the newest activity and sends it when Discord starts again.
Send `DELETE` when reading stops; Discord also clears the status when Anki quits.

## Development

```sh
python3 -m unittest discover -s apps/anki-discord/tests
```

The tests need no Anki or Discord: they run against a fake Discord on a Unix socket and a fake hub
(`tests/test_relay.py`). `aqt` is only
imported in `chimimouryou_discord/__init__.py`. The Discord application id is `CLIENT_ID` there.

## Licence

BSD 3-Clause (`chimimouryou_discord/LICENSE`, shipped in the package; the same terms as `LICENSE-BSD` at
the repository root), unlike the rest of chimimouryou (GPL-3.0-or-later), so it can go on AnkiWeb
and be reused freely.
