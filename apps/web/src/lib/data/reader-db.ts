/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * The browser database for reader extras (highlights, "Story so far" summaries,
 * lorebooks, audiobooks, kanji seen, visual novel pages read, Audiobookshelf subtitles,
 * generated furigana readings files, the analysis tools' difficulty estimates and word lists,
 * browser-stored manga's text, Whisper's audiobook subtitles and known words from Anki), separate from upstream's books
 * database. Not part of upstream.
 */

import { openDB, type DBSchema } from 'idb';
import type { BookAnnotations } from '$lib/data/reader/annotations';
import type { BookAudiobook } from '$lib/data/audio/audiobook';
import type { LocalEstimate, LocalWordList } from '$lib/data/analysis/analysis-tools';
import type { LocalMokuro } from '$lib/data/manga/mokuro';
import type { WhisperSubtitles } from '$lib/data/audio/whisper';
import type { CachedReadings } from '$lib/data/words/generated-furigana';
import type { ImmersionLog } from '$lib/data/stats/immersion-log';
import type { AbsSubtitles } from '$lib/data/audio/audiobookshelf';
import type { BookKanji } from '$lib/data/words/book-kanji';
import type { KanjiSeen } from '$lib/data/words/kanji-seen';
import type { CoverageCache, KnownWords } from '$lib/data/words/known-words';
import type { Lorebook } from '$lib/data/ai/lorebook';
import type { BookRecaps } from '$lib/data/ai/recap';
import type { VnRead } from '$lib/data/vn/vn';
import type { WordMarks } from '$lib/data/words/word-marks';
import type { HistoryCache } from '$lib/data/words/words-history';
import type { WordList, WordsMetCache } from '$lib/data/words/words-met';

interface ReaderDb extends DBSchema {
  annotations: { key: string; value: BookAnnotations };
  recaps: { key: string; value: BookRecaps };
  lorebooks: { key: string; value: Lorebook };
  audiobooks: { key: string; value: BookAudiobook };
  kanji: { key: string; value: KanjiSeen };
  vnRead: { key: string; value: VnRead };
  absSubtitles: { key: string; value: AbsSubtitles };
  readings: { key: string; value: CachedReadings };
  /** Local books' difficulty estimates and word lists, made by the analysis tools */
  estimates: { key: string; value: LocalEstimate };
  wordLists: { key: string; value: LocalWordList };
  /** Browser-stored manga's text (mokuro.ts) */
  mokuro: { key: string; value: LocalMokuro };
  /** Audiobook subtitles made by Whisper in this browser (whisper.ts) */
  whisperSubtitles: { key: string; value: WhisperSubtitles };
  /**
   * 'words' and 'coverage' (known-words.ts), 'met', 'ranks' and 'list:<id>' (words-met.ts), 'marks'
   * (word-marks.ts), 'history' (words-history.ts), 'kanji:<title>' (book-kanji.ts),
   * 'immersion' (immersion-log.ts)
   */
  known: {
    key: string;
    value:
      | KnownWords
      | CoverageCache
      | WordsMetCache
      | WordList
      | WordMarks
      | HistoryCache
      | BookKanji
      | ImmersionLog
      | Record<string, number | null>;
  };
}

let dbPromise: ReturnType<typeof openDB<ReaderDb>> | undefined;

/** Named ttu-annotations for historical reasons; it holds every reader extra. */
export function readerDb() {
  dbPromise ??= new Promise((resolve, reject) => {
    openDB<ReaderDb>('ttu-annotations', 8, {
      upgrade(database, oldVersion) {
        if (oldVersion < 1) {
          database.createObjectStore('annotations', { keyPath: 'title' });
          database.createObjectStore('recaps', { keyPath: 'title' });
        }
        if (oldVersion < 2) {
          database.createObjectStore('lorebooks', { keyPath: 'title' });
          database.createObjectStore('audiobooks', { keyPath: 'title' });
          database.createObjectStore('kanji', { keyPath: 'title' });
        }
        if (oldVersion < 3) {
          database.createObjectStore('vnRead', { keyPath: 'title' });
        }
        if (oldVersion < 4) {
          database.createObjectStore('absSubtitles', { keyPath: 'title' });
        }
        if (oldVersion < 5) {
          database.createObjectStore('known');
        }
        if (oldVersion < 6) {
          database.createObjectStore('readings', { keyPath: 'title' });
        }
        if (oldVersion < 7) {
          database.createObjectStore('estimates', { keyPath: 'title' });
          database.createObjectStore('wordLists', { keyPath: 'title' });
        }
        if (oldVersion < 8) {
          database.createObjectStore('mokuro', { keyPath: 'title' });
          database.createObjectStore('whisperSubtitles', { keyPath: 'title' });
        }
      },
      // Another tab still has the previous version open; the upgrade waits for it.
      blocked() {
        dbPromise = undefined;
        reject(
          new Error(
            'The reader was updated. Close or reload its other tabs, then try again (they still use the old version).'
          )
        );
      },
      // A newer version opened in another tab: let it upgrade.
      blocking(_current, _blocked, event) {
        (event.target as IDBDatabase).close();
        dbPromise = undefined;
      },
      terminated() {
        dbPromise = undefined;
      }
    }).then(resolve, reject);
  });

  return dbPromise;
}

/** Every store keyed by a book's title (not `known`, whose keys are its own). */
const bookStores = [
  'annotations',
  'recaps',
  'lorebooks',
  'audiobooks',
  'kanji',
  'vnRead',
  'absSubtitles',
  'readings',
  'estimates',
  'wordLists',
  'mokuro',
  'whisperSubtitles'
] as const;

/** Removes everything this browser kept for a deleted book. */
export async function deleteBookExtras(title: string) {
  const tx = (await readerDb()).transaction(bookStores, 'readwrite');

  await Promise.all([...bookStores.map((store) => tx.objectStore(store).delete(title)), tx.done]);
}
