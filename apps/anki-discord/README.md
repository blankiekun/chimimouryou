# chimimouryou Discord companion (Anki add-on)

Browsers can't talk to Discord, so chimimouryou (server build, GitHub Pages, desktop app) sends your
Discord status to this add-on. It runs inside Anki Desktop, listens on `127.0.0.1:41918` and passes
the status to the Discord desktop client over Discord's local IPC. It needs Anki Desktop and Discord
running on the same computer; nothing goes over the internet.

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

## Protocol

What chimimouryou's `discord` plugin implements. Base URL `http://127.0.0.1:41918`.

| Request               | Body                                 | Answer                                                                                         |
| --------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `GET /v1/status`      |                                      | `200 {"version": "0.1.0", "discord": "connected" \| "closed", "lastSent": <epoch ms> \| null}` |
| `PUT /v1/activity`    | the finished activity, JSON, ≤ 16 KB | `204`; `400 {"error"}` if invalid, `413` if too large                                          |
| `DELETE /v1/activity` |                                      | `204`: clears the status                                                                       |

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

The tests need no Anki or Discord: they run against a fake Discord on a Unix socket. `aqt` is only
imported in `chimimouryou_discord/__init__.py`. The Discord application id is `CLIENT_ID` there.

## Licence

BSD 3-Clause (`chimimouryou_discord/LICENSE`, shipped in the package; the same terms as `LICENSE-BSD` at
the repository root), unlike the rest of chimimouryou (GPL-3.0-or-later), so it can go on AnkiWeb
and be reused freely.
