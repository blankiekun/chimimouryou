# Discord art assets

The small images the web app's Discord status can show (Settings → Discord → Edit → Small image).
Discord only shows art that is uploaded to the Discord app, so these PNGs must be uploaded to the
"Chimi Reader" app (the `CLIENT_ID` in `chimimouryou_discord/__init__.py`) under the file name
without `.png` as the asset key.

| Keys                                                | Shown for                                                                     |
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

1. Open the [Discord Developer Portal](https://discord.com/developers/applications), the
   "Chimi Reader" application → Rich Presence → Art Assets.
2. Add Image(s), pick all 25 PNGs; the names come from the file names (`ring-45`, `kind-vn`, …).
   Keep them exactly: the app sends these keys.
3. Save Changes. New assets can take a few minutes to show up in Discord.

Until they are uploaded, Discord shows no small image for Progress ring and Kind icon.
