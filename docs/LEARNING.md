# Learning Japanese with chimimouryou

A setup guide for readers: look words up while you read, turn them into Anki
cards with the sentence's audio or a screenshot, and pick books you can handle.
The server side (difficulty estimates, manga text) is in
[INSTALL.md](INSTALL.md).

## 1. Yomitan

[Yomitan](https://yomitan.wiki/) is a browser extension (Chrome, Firefox, Edge)
that shows a dictionary popup for the word under the pointer, usually while you
hold <kbd>Shift</kbd>. It works on the reader's text, on manga with page text
(below) and on visual novels, whose text is laid over the game.

Install it from your browser's extension store, then import dictionaries in its
settings → Dictionaries. Yomitan installs none itself; its
[dictionaries page](https://yomitan.wiki/dictionaries/) lists them with download
links. A good start:

- **A Japanese-English dictionary**: Jitendex (based on JMdict), or JMdict
  itself.
- **Names**: JMnedict, so character and place names don't look like unknown
  words.
- **A frequency list**, which shows how common a word is: for example Jiten's
  (jiten.moe → Frequency dictionaries), the same list the server's difficulty
  estimates use, or JPDB's.
- **Kanji**: KANJIDIC, for readings and meanings of a single kanji.
- **Pitch accent** (optional): e.g. Kanjium.

Once you are comfortable, a monolingual (Japanese-Japanese) dictionary is a
common next step; the same page lists some.

### "Secure Container" and the reading tracker

Yomitan's settings have **Use a secure container around popups** (Security section,
shown with Advanced on). It hides the popup from the page, which is a sensible
default on the open web.

The reading tracker (Settings → Tracking → Statistics) can pause when the page
loses focus. With **Tracker Auto Pause** set to Strict, every dictionary popup
counts as losing focus, so looking up a word pauses the tracker. **Dictionary
Detection** stops that: the tracker notices an open Yomitan (or
jpdb-browser-reader) popup and keeps running. It can only see the popup when
Yomitan's secure container is **off**, so turn that setting off if you use
Dictionary Detection. Lookups work either way; you don't need to change it
otherwise.

## 2. Anki

Yomitan makes the cards; chimimouryou adds media to them afterwards.

### AnkiConnect

1. Install [Anki](https://apps.ankiweb.net/) and its
   [AnkiConnect](https://ankiweb.net/shared/info/2055492159) add-on
   (Tools → Add-ons → Get Add-ons, code `2055492159`), then restart Anki.
2. Allow this site to talk to it: Tools → Add-ons → AnkiConnect → Config, and
   add the site's address (the address bar up to the first `/` after the host,
   e.g. `https://books.example.com`) to `webCorsOriginList`:

   ```json
   "webCorsOriginList": ["http://localhost", "https://books.example.com"]
   ```

   Restart Anki after saving. Settings → Anki → AnkiConnect shows the exact
   address to add in its tooltip.
3. Set up Yomitan's Anki settings (enable Anki, pick a deck and note type, map
   the fields), as described in [Yomitan's Anki guide](https://yomitan.wiki/anki/).
   Put the sentence (`{sentence}`) in a field of its own.
4. In chimimouryou, open Settings → Anki, keep the address
   (`http://127.0.0.1:8765` unless you changed AnkiConnect's), and press
   **Test connection**. If the browser asks whether the site may reach devices on
   your local network, allow it.

Anki has to be running while you read.

### Card media

Turn on **Add media to mined cards** in Settings → Anki. While a book or a
visual novel is open, the reader checks Anki every couple of seconds for notes
added since then, and fills two fields of each new note:

| Setting        | Default         | What goes in                                                         |
| -------------- | --------------- | -------------------------------------------------------------------- |
| Sentence field | `Sentence`      | Read, not written: tells the reader which sentence you mined.       |
| Audio field    | `SentenceAudio` | The sentence's audio (books) or the line's sound (visual novels).    |
| Picture field  | `Picture`       | The game's screen (visual novels only).                             |

Use your note type's field names. A field that is missing or already filled is
left alone, so map Yomitan's word audio (`{audio}`) and any screenshot to other
fields, or leave these empty in Yomitan.

What the audio is (Settings → Anki → Card Media):

- **Books** (**Book audio**): the sentence's lines from the book's audiobook
  (Listen → Audiobook, with subtitles), recorded in real time, so the card takes
  as long as the sentence to arrive. With the AI tools plugin on, **Use ElevenLabs
  audio if no audiobook file present** has the AI voice read the sentence instead
  (each card uses ElevenLabs credits). Otherwise a book without an audiobook gets
  no audio.
- **Visual novels**: **Visual novel screenshot** is the screen showing the line, and **Visual novel audio** the line's voice or the game's sound since
  your click (this one applies to games started after you change it). The
  sentence has to match a line you saw recently; notes that match none are left
  alone.

Manga cards get no media.

## 3. Furigana

Books: Settings → Reader → Writing → **Hide furigana**, then pick a style:

- **Hide**: never shown.
- **Partial**: shown greyed out; hovering a word shows it fully, clicking keeps it shown.
- **Toggle**: hidden; hovering shows it, clicking shows or hides it again.
- **Full**: hidden; hovering shows it, clicking shows it for good.
- **Known**: hidden only over words whose kanji you have all met at least 10 times,
  and only when the furigana is an ordinary hiragana reading; clicking shows it.
  Furigana the author chose for effect (マジ over 本気, スキル over 異能, そら over 宇宙)
  always shows, as do special readings (きょう over 今日) and rarer kanji.

Search and the AI voice ignore furigana either way. In visual novels, the header's
furigana button turns the game's readings on or off (from the next text; the
text panel keeps them).

## 4. Text on manga (mokuro)

Manga are pictures, so Yomitan needs text laid over them. That text comes from
[mokuro](https://github.com/kha-white/mokuro), per volume, on the book's page
(**Text** row; making or uploading text needs the `import` permission):

- **Make text on the server**: needs the server's `mokuro` service (see
  [INSTALL.md](INSTALL.md#manga-text-mokuro)); about 5 seconds a page on a CPU,
  one volume at a time.
- **Upload .mokuro**: a file made by running mokuro on your own computer.

In the manga reader, Reader settings → **Page text** shows it under the pointer
(default), always, or not at all. Page text isn't kept for offline reading.

## 5. Choosing what to read next

A book's page (click its cover) shows under **Difficulty**, once an estimate
exists (made by the server's `difficulty` service; readers with the
`difficulty` permission start it with **Difficulty details**):

- **A score from 0 to 5** with its band: Beginner (0-1), Easy, Average, Hard,
  Expert (4-5), the same bands as jiten.moe, and the **likely range**, which holds
  jiten.moe's score for about 8 books in 10. A narrow range is a surer estimate.
- **The most common words that cover 95%** of the book: how many words you would
  need to know to understand 95% of it. Lower is easier.
- **Different kanji** in the book, and how many of them you have **already met**:
  the share of the book's kanji (counted every time they appear) that you have
  read before in other books, and the number of kanji that would be new. Kanji
  met are recorded as you read books and visual novels and, while you are signed
  in, synced to your account so every device sees them; the first time a book is
  counted, everything before your position counts as read.

Home shows **Words met** and **Words known**. They are estimated, not counted word by
word: each Calibre book with a difficulty estimate has a list of its 2,000 most
frequent words, and reading a share of the book counts that share of each word's
occurrences (spread evenly). A word is met once it reaches one occurrence, and known
once met 8 times or mature in Anki (Settings → Anki → Known words). Particles (は, が,
から…) don't count, nor does text you jumped over; a visual novel counts the share of
its script read. Books read before this existed count as far as you got. Books without
an estimate, manga and books outside Calibre add nothing.

Manga have no estimate. In the Store, filter by difficulty band and sort by
difficulty (easiest first) or length to find the next book: one a little harder
than the last, with most of its kanji already met, is usually a good pick.
