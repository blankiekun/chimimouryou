# Visual novels on a Steam Deck

This guide sets up the desktop app on a Steam Deck to play Windows visual novels and learn from
them: the game's text arrives line by line, you look words up on the game's own text, and you
send lines to Anki with their sound and a screenshot.

**Not tested on a Deck yet.** The project has not run the app in Game Mode, or with Valve's
Proton, on a real Steam Deck. The steps below follow what the app does on other Linux computers.
If something fails or works, please
[open an issue](https://github.com/blankiekun/chimimouryou/issues) and say which step it was.
The manual test plan for the Deck is in [QA.md](QA.md) (sections 21 and 22).

Do steps 1 to 5 in Desktop Mode (Steam button → Power → Switch to Desktop).

## 1. Get the app

1. Download the AppImage (`chimimouryou-<version>.AppImage`) from the
   [latest release](https://github.com/blankiekun/chimimouryou/releases/latest).
2. Make it executable: right-click it in Dolphin → Properties → Permissions → "Is executable",
   or run `chmod +x chimimouryou-*.AppImage` in Konsole.
3. Start it once to check it opens.

The app checks for updates when it starts and offers "Restart to update". It never updates by
itself.

## 2. Install Proton

SteamOS has no Wine of its own, so the app starts games with Steam's Proton.

1. In Steam, open Library and show Tools.
2. Install a Proton build, for example "Proton 11.0".
3. Install the "Steam Linux Runtime" that build needs: 4.0 for Proton 11, 3.0 ("sniper") for
   Proton 8 to 10.

Steam does not need to be running when the app starts a game. The app finds Proton in Steam's
folders, also on an SD card. In the app, Settings → Desktop games → "Runs games with" shows which
build it will use. Automatic picks the newest Valve build whose runtime is installed. If the
runtime is missing, that page names the one to install.

## 3. Add the app to Steam

In Steam (Desktop Mode): Games → Add a Non-Steam Game to My Library → Browse → pick the AppImage
→ Add Selected Programs.

The app then shows in your library under Non-Steam. In Game Mode, start the app from there, and
start games from inside the app. Do not add the game itself to Steam: the app starts the game so
that both share one Steam entry, which is what lets the overlay sit on the game in Game Mode.

## 4. Link a game

1. Copy the game's installed folder to the Deck (internal drive or SD card).
2. In the app: Import → Installed game. Pick the game's folder, check the title, and pick its
   program from the list.
3. Open the game from the library. The app starts it.

The first start sets up a Proton prefix for the game. The app says "Setting up Proton … (first
start only, about a minute)". The game runs with a Japanese locale and Japan time, and Japanese
fonts the game asks for are replaced with ones Proton has.

The link (where the game is installed) stays on this device. Settings → Desktop games lists your
linked games, with Change folder and Forget.

## 5. Pick the text thread

When a game starts, the app opens the texthooker page. It hooks the game and lists the text
threads it finds.

- If one thread looks like the game's text, the app picks it ("Picked automatically").
- Otherwise, advance a few lines in the game and pick the thread that shows the game's text.
  The pick is saved for this game.
- If no thread has the text, use Add hook code… with an H-code or R-code for the game.

## 6. Choose an overlay mode

On the texthooker page, "Text overlay over the game" has three modes. Each game keeps its own.

- **Off**: no overlay. Read and look up words on the texthooker page.
- **Band**: the newest line on a band over the game's text box. Adjust area moves and resizes it.
- **Invisible**: nothing shows over the game. A moment after each line settles, the app finds the
  line in the game's window and lays invisible text on it. Hovering or tapping the game's own text
  then looks words up.

Invisible is the one to try first on a Deck. Restart the game after switching modes: a game only
leaves the pointer free for the overlay when it started with the overlay on. If a line can't be found on the screen (a menu, or a hook
that gives other text), nothing is placed for it and the texthooker page says why.

On the overlay, lookups need no key: hovering is enough with the built-in popup. A click off the
text advances the game; a click on the text itself does not, so advance with a click elsewhere or
a button mapped to a key.

## 7. Map the controls

Steam Input maps the Deck's buttons for the app's Steam entry. In Game Mode, open the app's page
in the library and its controller settings, then edit the layout. A suggested layout:

| Control             | Action                              |
| ------------------- | ----------------------------------- |
| A button            | Left mouse click (advance the game) |
| Right trackpad      | Mouse (hover words to look them up) |
| One back button     | Ctrl+Shift+M (Mine)                 |
| Another back button | Ctrl+Shift+H (Show)                 |

- **Mine** (Ctrl+Shift+M) puts the newest line, with its screenshot and sound, on your last Anki
  card. A notification says how it went.
- **Show** (Ctrl+Shift+H) brings the texthooker page to the front, and back again.

These shortcuts only work while a game runs from the app. You can change them in Settings →
Desktop games. The touchscreen works too: tap a word to look it up.

## 8. Set up a dictionary

Either:

- **The built-in lookup**: Settings → Dictionary lookups, then install JMdict with one tap. Other
  Yomitan dictionaries can be imported there too.
- **Yomitan**, which is built into the app: menu → Yomitan → Settings, and import dictionaries
  there. Yomitan keeps its own scan key; set it to no key so hovering is enough on the overlay.

## 9. Anki

Mining needs [AnkiConnect](https://ankiweb.net/shared/info/2055492159) running somewhere the
Deck can reach. [LEARNING.md](LEARNING.md#2-anki) explains Anki, AnkiConnect and the card fields.
There are two ways today:

- **Anki on the Deck.** Install Anki in Desktop Mode (for example from Discover) with the
  AnkiConnect add-on, and keep it running while you play. The app's default address works and
  AnkiConnect needs no extra setting for the app.
- **Anki on another computer.** In that Anki's AnkiConnect config, set `webBindAddress` to
  `0.0.0.0` so other devices can reach it, and set an `apiKey`. On the Deck, open Settings → Anki,
  set "AnkiConnect address" to `http://<that computer's address>:8765`, put the same key in "API key",
  and press Test connection. Anyone on your network can reach AnkiConnect this way, which is why
  the key matters.

Make cards with Yomitan or the built-in popup as usual. The app then fills the card's empty
picture and sound fields with the line's screenshot and sound.

## 10. Sync saves with a PC

Game saves sync through the same place as your books' progress.

1. On both devices: Settings → Sync, turn on Automatic sync, and mark the same Google Drive or
   folder source as Sync target in the storage sources.
2. On the PC, install the desktop app and link the same game with Import → Installed game. Give
   it the same title as on the Deck, since synced files are found by title.

Before a game starts, the app writes in any synced save that is newer than the one on this device.
When the game closes, it sends this device's saves. A newer save is never replaced by an older
one. If a game's saves are too big to sync, the texthooker page says so and they stay on the
device.

## 11. When something goes wrong

- **The texthooker page** shows the game's status: hook errors, why a line wasn't placed on the
  overlay, why a card got no sound, and save sync problems.
- **Settings → Desktop games** shows the Proton build in use and names a missing Steam Linux
  Runtime.
- **Notifications** say how each Mine went.
- **Konsole**: in Desktop Mode, start the app from a terminal (`./chimimouryou-*.AppImage`). The
  hook helper's errors print there.

When you report a problem, include which mode you were in (Game Mode or Desktop Mode), the Proton
build, the game, and what the texthooker page or the terminal said.
