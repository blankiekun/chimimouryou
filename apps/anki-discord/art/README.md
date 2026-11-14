# Discord art assets

The small images the web app's Discord status can show (Settings → Discord → Edit → Small image).
The social hub serves them from its R2 bucket at `https://<hub>/v1/art/<name>.png`, and the status
sends that URL as `small_image` (Discord shows https images through its media proxy), so nothing is
uploaded to the Discord app.

| Names                                               | Shown for                                                                     |
| --------------------------------------------------- | ----------------------------------------------------------------------------- |
| `ring-0`, `ring-5` … `ring-100` (21 images)         | Progress ring: `{percent}` rounded down to 5% steps                           |
| `kind-book`, `kind-manga`, `kind-vn`, `kind-listen` | Kind icon: the activity (book, manga, visual novel, Audiobookshelf Listening) |

The app logo (`applogo`) is uploaded separately and isn't generated here.

## Regenerate

The images are drawn by `apps/web/src/lib/data/discord/discord-art.ts` (the settings preview uses
the same SVG). After changing it, from `apps/web`:

```sh
node scripts/discord-art.mjs
```

It needs Playwright's Chromium (`pnpm exec playwright install --only-shell chromium`) and writes
the 25 PNGs, 512×512, into this folder. Commit them.

## Upload

From `deploy/social-hub`, for each PNG (the hub only serves these 25 names):

```sh
for f in ../../apps/anki-discord/art/*.png; do
  npx wrangler@4.147.0 r2 object put "chimi-hub-media/art/$(basename "$f")" --file "$f" \
    --content-type image/png --remote
done
```

The URLs are cached for a year, so redrawn art needs new file names (and the names in
`ringKey`/`kindKey` and the hub's art route).
