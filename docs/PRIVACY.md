# Privacy policy

Last updated: 2026-10-25

This policy covers chimimouryou, an ebook reader, and the services the chimimouryou project runs
for it: the social hub and the Chimi Reader Discord application. It is written to match what the
code does; the code is public in this repository.

The short version: chimimouryou has no analytics, no ads and no tracking. Your books stay with
you. The project only receives what you send to the social hub after you sign up for it.

## Where your data lives

How you run chimimouryou decides who holds your data.

- **On your own server** (the Docker install): your books, reading progress, statistics,
  highlights, settings and server account are stored on that server, by whoever runs it. The
  chimimouryou project never sees them. If someone else runs the server for you, ask them how
  they handle your data.
- **The web version on GitHub Pages**: everything is stored in your browser (IndexedDB and local
  storage). There is no chimimouryou server behind it. If you turn on Google Drive or OneDrive
  sync, your data goes to your own Drive or OneDrive account, under Google's or Microsoft's
  terms. GitHub serves the pages and may log requests under
  [GitHub's privacy statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement).
- **The desktop app**: the same as the web version, stored on your computer.

Clearing your browser's site data (or uninstalling the desktop app) deletes what is stored
there.

## The social hub

Friends, profiles and the Community are run by the chimimouryou project on Cloudflare Workers,
with data in Cloudflare D1 and images in Cloudflare R2. Nothing is sent to the hub before you
sign up, or while the Social plugin is turned off, with one exception: opening the Community
tab, a Community line link or a book already matched to a work fetches public Community posts
without identifying you (no account token is sent).

What the hub stores once you sign up:

- **Your account**: username, display name, friend code, your choice of picture, your share
  settings and when you last used it. There is no email address. Your password is stretched in
  your browser before it is sent; the hub keeps only a salted hash of that, and only hashes of
  your recovery code and session tokens.
- **Friends**: your friends, friend requests and blocks.
- **What you choose to share**, each with its own switch in Settings → Social:
  - current books: up to three books you are reading (title, author, kind and how far along);
  - finished books: your last 50, with the month;
  - reading stats: streak, this week's reading, books finished this year, an 84-day activity
    strip, and words known only if you turn that on;
  - activity for friends: started, finished and streak events, kept 90 days.

  Turning a share off deletes that data from the hub at once. Books you hide on their book page
  are never sent.

- **Pictures**: your profile picture if you upload one (re-encoded in your browser, which drops
  EXIF and location data) and small cover thumbnails of the books you share, shown on your own
  rows, or of the book in your Discord status (see below). A thumbnail's address is public.
- **Community posts**: what you write, and for a post on a line, that line and up to about 600
  characters of the page around it, never whole books. Posts are public: anyone can read them,
  with the book's title and cover and your display name. Also stored: your "helpful" marks and
  which AniList or VNDB entry you confirmed a book as.
- **Reports** you make or that are made about you, kept 90 days.
- **Sending a book to a friend**: the book goes directly from your browser to theirs. The hub
  only passes the connection details between you (which include network addresses), with the
  title, kind and size, and deletes them once connected or after 10 minutes.
- **Rate limits**: counters per account and per hashed IP address, deleted after two days.

The hub keeps no IP address log and no book files. Cloudflare processes requests on the
project's behalf, including your IP address (used for rate limits), under
[Cloudflare's privacy policy](https://www.cloudflare.com/privacypolicy/).

Moderators (accounts with the Dev role) can see reports and a reader's account, current and
finished books, events and recent posts, to handle reports.

### Deleting your data

- Delete a post: it is removed (a post with replies stays as an empty placeholder).
- Delete your account (Settings → Social): your account, friends, shared books, stats, events,
  pictures, covers, reports, posts and marks are removed at once. Answered posts become empty
  placeholders; a cover you gave a Community work stays with the work.
- Automatic: sessions unused for 90 days and accounts unused for 12 months are deleted.

## Discord status

The Chimi Reader Discord application shows what you are reading as your Discord status, if you
set it up:

- The reader page builds the status in your browser and sends it to a small Anki add-on on the
  same computer, which passes it to the Discord app running there. This stays on your computer;
  the chimimouryou project receives nothing.
- If you turn on **Show activity from my other devices**, the hub also keeps your current
  status as it would appear in Discord, so an Anki add-on you paired can show it, and with
  **Show on my profile** also on, your friends see it on your profile. It is removed when you
  stop reading, or after your Away time (5 to 30 minutes, 10 by default) without an update.
- With **Book cover** as the large image and no cover picked in Find details, the book's own
  cover goes to the social hub as a small thumbnail when you open the book (only while you are
  signed in to Social with the social plugin on), so Discord can load it from a public address.
  Only when there is no cover that way is the book's series or title looked up on AniList (VNDB
  for visual novels), from your browser; an exact match's cover is kept in this browser and its
  details saved as the book's. Books hidden from friends and **Hide titles** send no thumbnail
  and are never looked up, and nothing is sent while the plugin or **Show my status** is off.

What Discord shows and stores is covered by
[Discord's privacy policy](https://discord.com/privacy).

## Services you choose to connect

chimimouryou only contacts these when you turn them on or use the feature that needs them.
Requests go from your browser (or your own server) straight to the service, and its own privacy
policy applies:

- AnkiConnect (Anki on your computer), for making cards;
- AI providers whose API key you enter (such as OpenRouter, OpenAI, Anthropic, Google, Groq,
  Mistral) and ElevenLabs for speech, which receive the text you send them;
- Audiobookshelf, through your own server;
- AniList and VNDB, to look up a book's details or its Discord status cover, match it to a
  Community work or mention a work;
- dictionary audio sources such as JapanesePod101;
- Google Drive and OneDrive sync.

Links to sites such as Jiten only open them in your browser.

AI API keys are stored only in the browser you enter them in and are never synced. Other tokens
(Audiobookshelf, the Community sign-in) are stored in your browser, and on a server build in your
server account's settings. None of them are ever sent to the project.

## Changes and contact

Changes to this policy are made in this repository; the date at the top shows the latest. For
questions or requests, open an issue at
[github.com/blankiekun/chimimouryou/issues](https://github.com/blankiekun/chimimouryou/issues).
