/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * "Add to Anki" in the built-in dictionary's popup, the way Yomitan makes its notes (its
 * display-anki.js and the backend's Anki calls): Yomitan's `anki` options (card formats for terms
 * and kanji: deck, note type, fields with its {markers}; tags, duplicate check and behaviour,
 * suspend, sync, view mode, screenshot) rendered by its own note builder and Handlebars templates
 * (lib/vendor/yomitan/data, templates/), its default field templates unless a Yomitan settings
 * import brought custom ones. Notes go to AnkiConnect (`anki.ts`), or on iPhone and iPad to
 * AnkiMobile through its `anki://x-callback-url/addnote` link. The options follow the account
 * (`account-settings-sync.ts`) but for the per-browser address and API key; the route is per
 * browser too. Not part of upstream.
 */

import { ankiApiKey$, ankiConnectUrl$, ankiInvoke } from '$lib/data/dictionary/anki';
import { jpod101Url } from '$lib/data/dictionary/dictionary-audio';
import { writableObjectLocalStorageSubject } from '$lib/data/internal/writable-object-local-storage-subject';
import { writableStorageSubject } from '$lib/data/internal/writable-storage-subject';
import { localStorage } from '$lib/data/window/local-storage';
import type { DictionarySummary } from '$lib/vendor/yomitan/dictionary/dictionary-importer';
import type { AnkiNote, AnkiNoteContext } from '$lib/vendor/yomitan/data/anki-note-builder';
import type { DictionaryEntry } from '$lib/vendor/yomitan/types/dictionary';
import type {
  AnkiCardFormat,
  AnkiFields,
  AnkiNoteFieldOverwriteMode,
  AnkiNoteGuiMode,
  AnkiOptions,
  Options,
  ProfileOptions
} from '$lib/vendor/yomitan/types/settings';
import { record } from '$lib/data/setting-parsers';
import { minedCards } from '$lib/data/stats/day-counters';

/** Yomitan's `anki` options as this app keeps them: all but `enable` and the per-browser `server` and `apiKey`. */
export type DictionaryAnki = Omit<AnkiOptions, 'enable' | 'server' | 'apiKey'>;

const cardFormat = (
  name: string,
  type: AnkiCardFormat['type'],
  icon: AnkiCardFormat['icon'] = 'big-circle'
): AnkiCardFormat => ({ name, icon, deck: '', model: '', fields: {}, type });

/** Yomitan's defaults (options-schema.json), with this app's tag. */
export const defaultDictionaryAnki: DictionaryAnki = {
  tags: ['chimimouryou'],
  screenshot: { format: 'png', quality: 92 },
  cardFormats: [
    cardFormat('Expression', 'term'),
    cardFormat('Reading', 'term', 'small-circle'),
    cardFormat('Kanji', 'kanji')
  ],
  duplicateScope: 'collection',
  duplicateScopeCheckAllModels: false,
  duplicateBehavior: 'new',
  checkForDuplicates: true,
  fieldTemplates: null,
  suspendNewCards: false,
  displayTagsAndFlags: 'never',
  targetTags: [],
  noteGuiMode: 'browse',
  downloadTimeout: 0,
  forceSync: false,
  noteDupeCheckFirst: false
};

export const dictionaryAnki$ = writableObjectLocalStorageSubject<Partial<DictionaryAnki>>()(
  'dictionaryAnki',
  {},
  record
);

export type DictionaryAnkiRoute = 'ankiconnect' | 'ankimobile';

/** iOS and iPadOS (iPadOS reports a Mac with touch): no AnkiConnect there. */
export function isAppleMobile(userAgent: string, maxTouchPoints: number) {
  return /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
}

const appleMobile =
  typeof navigator !== 'undefined' && isAppleMobile(navigator.userAgent, navigator.maxTouchPoints);

/** How this browser adds notes. */
export const dictionaryAnkiRoute$ = writableStorageSubject<DictionaryAnkiRoute>(
  localStorage,
  (value) => (value === 'ankimobile' ? 'ankimobile' : 'ankiconnect'),
  (value) => value
)('dictionaryAnkiRoute', appleMobile ? 'ankimobile' : 'ankiconnect');

const isObject = (value: unknown): value is Record<string, any> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/**
 * The single term card format of earlier versions ({deck, model, fields} beside the options) as
 * Yomitan's card formats, the way its OptionsUtil._updateVersion64 turned `anki.terms` into them:
 * an Expression format, a Reading one when a field uses {expression}, and an empty Kanji one.
 */
function upgradeCardFormats(stored: Record<string, any>): Record<string, any> {
  if (
    Array.isArray(stored.cardFormats) ||
    !('deck' in stored || 'model' in stored || 'fields' in stored)
  ) {
    return stored;
  }
  const { deck, model, fields, ...rest } = stored;
  const oldFields: AnkiFields = isObject(fields) ? fields : {};
  const expression = {
    ...cardFormat('Expression', 'term'),
    deck: typeof deck === 'string' ? deck : '',
    model: typeof model === 'string' ? model : ''
  };
  const cardFormats: AnkiCardFormat[] = [{ ...expression, fields: oldFields }];
  if (Object.values(oldFields).some((field) => field?.value?.includes('{expression}'))) {
    cardFormats.push({
      ...expression,
      name: 'Reading',
      icon: 'small-circle',
      fields: Object.fromEntries(
        Object.entries(oldFields).map(([key, field]) => [
          key,
          { ...field, value: field.value.replace(/{expression}/g, '{reading}') }
        ])
      )
    });
  }
  cardFormats.push(cardFormat('Kanji', 'kanji'));
  return { ...rest, cardFormats };
}

const isCardFormat = (format: unknown): format is AnkiCardFormat =>
  isObject(format) &&
  (format.type === 'term' || format.type === 'kanji') &&
  typeof format.deck === 'string' &&
  typeof format.model === 'string' &&
  isObject(format.fields);

/** The stored options (any version, from this browser or the account) with Yomitan's defaults. */
export function dictionaryAnkiSettings(stored: Record<string, any>): DictionaryAnki {
  const upgraded = upgradeCardFormats(stored);
  return {
    ...defaultDictionaryAnki,
    ...upgraded,
    screenshot: { ...defaultDictionaryAnki.screenshot, ...upgraded.screenshot },
    cardFormats: Array.isArray(upgraded.cardFormats)
      ? upgraded.cardFormats
          .filter(isCardFormat)
          .map((format: AnkiCardFormat) => ({ ...cardFormat(format.name, format.type), ...format }))
      : defaultDictionaryAnki.cardFormats
  };
}

/** A card format notes can be made with: deck, note type and fields set. */
export const formatReady = (format: AnkiCardFormat) =>
  !!format.deck && !!format.model && Object.keys(format.fields).length > 0;

export const ankiConfigured = (settings: DictionaryAnki) => settings.cardFormats.some(formatReady);

/**
 * The `anki` options of a Yomitan settings export (or bare options object, upgraded by its
 * OptionsUtil first), current profile. Undefined when no card format has a deck and note type.
 */
export function dictionaryAnkiFromYomitan(options: Options) {
  const anki = options.profiles[options.profileCurrent]?.options.anki;
  if (!anki?.cardFormats.some(({ deck, model }) => deck && model)) return undefined;
  const { enable: _enable, server, apiKey, ...settings } = anki;
  return { settings: dictionaryAnkiSettings(settings), server, apiKey };
}

/**
 * Takes a Yomitan export's Anki options: the synced ones, this browser's address (http(s) only)
 * and its key when the file has one (this app's own export leaves it out). `server` is the
 * address when the file changed it, for the import's message.
 */
export function applyYomitanAnki(options: Options) {
  const anki = dictionaryAnkiFromYomitan(options);
  if (!anki) return undefined;
  dictionaryAnki$.next(anki.settings);
  const changed = /^https?:\/\//i.test(anki.server) && anki.server !== ankiConnectUrl$.getValue();
  if (changed) ankiConnectUrl$.next(anki.server);
  if (anki.apiKey) ankiApiKey$.next(anki.apiKey);
  return { settings: anki.settings, server: changed ? anki.server : undefined };
}

/**
 * Yomitan's `anki` options with this app's, for a settings export Yomitan imports. The API key
 * is left out: export files get shared, and keys stay out of shared files (import still reads it).
 */
export function dictionaryAnkiToYomitan(anki: AnkiOptions): AnkiOptions {
  return {
    ...anki,
    ...dictionaryAnkiSettings(dictionaryAnki$.getValue()),
    server: ankiConnectUrl$.getValue(),
    apiKey: ''
  };
}

/** Settings → Anki's import: only the Anki options of a Yomitan settings file. */
export async function importDictionaryAnki(json: string) {
  const data = JSON.parse(json);
  const { OptionsUtil } = await import('$lib/vendor/yomitan/data/options-util');
  const util = new OptionsUtil();
  await util.prepare();
  const anki = applyYomitanAnki(
    await util.update(data && typeof data === 'object' && 'options' in data ? data.options : data)
  );
  if (!anki) throw new Error('no card format with a deck and note type');
  return anki;
}

/**
 * The value Yomitan gives a note type's field (AnkiController._getDefaultFieldValue): the first
 * field is the expression (the character for kanji), others by name ("Reading", "Meaning", …),
 * else empty.
 */
export function defaultFieldValue(
  fieldName: string,
  index: number,
  markers: string[],
  type: AnkiCardFormat['type'] = 'term'
) {
  if (index === 0) return type === 'kanji' ? '{character}' : '{expression}';
  const aliases = new Map([
    ['expression', ['phrase', 'term', 'word']],
    ['reading', ['expression-reading', 'term-reading', 'word-reading']],
    ['furigana', ['expression-furigana', 'term-furigana', 'word-furigana']],
    ['glossary', ['definition', 'meaning']],
    ['audio', ['sound', 'word-audio', 'term-audio', 'expression-audio']],
    ['dictionary', ['dict']],
    ['pitch-accents', ['pitch', 'pitch-accent', 'pitch-pattern']],
    ['sentence', ['example-sentence']],
    ['frequency-harmonic-rank', ['freq', 'frequency', 'freq-sort', 'freqency-sort']],
    ['popup-selection-text', ['selection', 'selection-text']],
    ['pitch-accent-positions', ['pitch-position']],
    ['pitch-accent-categories', ['pitch-categories']]
  ]);
  for (const marker of markers) {
    const names = [marker, ...(aliases.get(marker) ?? [])];
    const pattern = new RegExp(
      `^(?:${names.map((n) => n.replace(/-/g, '[-_ ]*')).join('|')})$`,
      'i'
    );
    if (pattern.test(fieldName)) return `{${marker}}`;
  }
  return '';
}

let renderer:
  | Promise<{
      templateRenderer: unknown;
      AnkiNoteBuilder: typeof import('$lib/vendor/yomitan/data/anki-note-builder').AnkiNoteBuilder;
      defaultTemplates: string;
      getDynamicTemplates: typeof import('$lib/vendor/yomitan/data/anki-template-util').getDynamicTemplates;
      generateAnkiNoteMediaFileName: (prefix: string, extension: string, suffix: number) => string;
    }>
  | undefined;

/** Yomitan's renderer, loaded on first use (Handlebars is big). */
function getRenderer() {
  renderer ??= Promise.all([
    import('$lib/vendor/yomitan/templates/anki-template-renderer'),
    import('$lib/vendor/yomitan/data/anki-note-builder'),
    import('$lib/vendor/yomitan/data/anki-template-util'),
    import('$lib/vendor/yomitan/data/templates/default-anki-field-templates.handlebars?raw'),
    import('$lib/vendor/yomitan/data/anki-util')
  ]).then(async ([{ AnkiTemplateRenderer }, { AnkiNoteBuilder }, util, templates, ankiUtil]) => {
    const instance = new AnkiTemplateRenderer(document, window);
    await instance.prepare();
    return {
      templateRenderer: instance.templateRenderer,
      AnkiNoteBuilder,
      defaultTemplates: templates.default,
      getDynamicTemplates: util.getDynamicTemplates,
      generateAnkiNoteMediaFileName: ankiUtil.generateAnkiNoteMediaFileName
    };
  });
  return renderer;
}

/**
 * The picture `{screenshot}` takes: Yomitan captures the tab, which a page can't, so the host
 * gives what is on screen (`/v` the game frame, `/m` the manga page); none in `/b`.
 */
export type ScreenshotSource = (
  match?: Element | null
) => Promise<CanvasImageSource | null> | CanvasImageSource | null;

/** The source drawn and encoded as Yomitan's `anki.screenshot` asks (quality applies to JPEG). */
async function encodeScreenshot(
  source: CanvasImageSource,
  { format, quality }: DictionaryAnki['screenshot']
) {
  const image = source as HTMLImageElement & HTMLCanvasElement;
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')!.drawImage(source, 0, 0, width, height);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, `image/${format}`, quality / 100)
  );
  if (!blob) throw new Error('The screenshot could not be made');
  return blob;
}

async function toBase64(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export interface NoteRequest {
  entry: DictionaryEntry;
  format: AnkiCardFormat;
  context: AnkiNoteContext;
  settings: DictionaryAnki;
  profile: ProfileOptions;
  summaries: DictionarySummary[];
  /** Only the first field (enough for the duplicate check); no media */
  firstFieldOnly?: boolean;
  /** For {screenshot}, stored in Anki through AnkiConnect */
  screenshot?: ScreenshotSource;
}

/** The note Yomitan would make for the entry with the card format (fields rendered from their markers). */
export async function buildAnkiNote({
  entry,
  format,
  context,
  settings,
  profile,
  summaries,
  firstFieldOnly,
  screenshot
}: NoteRequest): Promise<AnkiNote> {
  const {
    templateRenderer,
    AnkiNoteBuilder,
    defaultTemplates,
    getDynamicTemplates,
    generateAnkiNoteMediaFileName
  } = await getRenderer();
  const fields = firstFieldOnly
    ? Object.fromEntries(Object.entries(format.fields).slice(0, 1))
    : format.fields;
  const wantsScreenshot =
    !firstFieldOnly &&
    !!screenshot &&
    Object.values(fields).some(({ value }) => value.includes('{screenshot}'));
  // Yomitan's backend API as the note builder calls it: only the screenshot is injected here.
  const api = {
    async injectAnkiNoteMedia(
      timestamp: number,
      _entry: unknown,
      _audio: unknown,
      screenshotDetails: unknown
    ) {
      let screenshotFileName: string | null = null;
      const errors: unknown[] = [];
      const source = screenshotDetails ? await screenshot?.() : null;
      if (source) {
        try {
          const blob = await encodeScreenshot(source, settings.screenshot);
          const name = generateAnkiNoteMediaFileName(
            'yomitan_browser_screenshot',
            settings.screenshot.format === 'jpeg' ? '.jpeg' : '.png',
            timestamp
          );
          screenshotFileName = await ankiInvoke<string>('storeMediaFile', {
            filename: name,
            data: await toBase64(blob)
          });
        } catch (e: any) {
          errors.push({ name: 'Error', message: e?.message ?? String(e) });
        }
      }
      return {
        audioFileName: null,
        screenshotFileName,
        clipboardImageFileName: null,
        clipboardText: null,
        dictionaryMedia: [],
        errors
      };
    },
    parseText: async () => {
      throw new Error('Not supported');
    }
  };
  const builder = new AnkiNoteBuilder(api, templateRenderer);
  const { note, errors } = await builder.createNote({
    dictionaryEntry: entry,
    cardFormat: { ...format, fields },
    context,
    template:
      (settings.fieldTemplates ?? defaultTemplates) + getDynamicTemplates(profile, summaries),
    tags: settings.tags,
    duplicateScope: settings.duplicateScope,
    duplicateScopeCheckAllModels: settings.duplicateScopeCheckAllModels,
    resultOutputMode: profile.general.resultOutputMode,
    glossaryLayoutMode: profile.general.glossaryLayoutMode,
    compactTags: profile.general.compactTags,
    dictionaryStylesMap: builder.getDictionaryStylesMap(profile.dictionaries),
    ...(wantsScreenshot && {
      requirements: [{ type: 'screenshot' }],
      mediaOptions: {
        audio: null,
        textParsing: null,
        screenshot: { ...settings.screenshot, contentOrigin: { tabId: 0, frameId: 0 } }
      }
    })
  });
  if (errors.length) throw errors[0];
  return note;
}

/**
 * Yomitan's quick duplicate check note (DisplayAnki._quickDupeCheck): the card format's first
 * field holding the bare term or character, no templates rendered.
 */
export function skeletonNote(
  entry: DictionaryEntry,
  format: AnkiCardFormat,
  settings: DictionaryAnki
): AnkiNote {
  const [first] = Object.keys(format.fields);
  const value = entry.type === 'kanji' ? entry.character : entry.headwords[0].term;
  const root = settings.duplicateScope === 'deck-root';
  return {
    fields: first ? { [first]: value } : {},
    tags: [],
    deckName: format.deck,
    modelName: format.model,
    options: {
      allowDuplicate: true,
      duplicateScope: root ? 'deck' : settings.duplicateScope,
      duplicateScopeOptions: {
        deckName: root ? format.deck.split('::')[0] : null,
        checkChildren: root,
        checkAllModels: settings.duplicateScopeCheckAllModels
      }
    }
  };
}

const escapeQuery = (text: string) => text.replace(/"/g, '');

/** AnkiConnect._getNoteQuery: the first field's value, within the deck for a deck scope. */
export function duplicateQuery(note: AnkiNote) {
  const [field] = Object.keys(note.fields);
  const { duplicateScope } = note.options;
  const deck =
    duplicateScope === 'deck'
      ? note.deckName
      : duplicateScope === 'deck-root'
        ? note.deckName.split('::')[0]
        : '';
  return [
    deck && `"deck:${escapeQuery(deck)}"`,
    field && `"${field.toLowerCase()}:${escapeQuery(note.fields[field])}"`
  ]
    .filter(Boolean)
    .join(' ');
}

/** AnkiConnect's notesInfo, with each note's cards (cardsInfo) for their flags. */
export interface AnkiNoteInfo {
  noteId: number;
  tags: string[];
  fields: Record<string, { value: string; order: number }>;
  cards: number[];
  cardsInfo: { cardId: number; note: number; flags: number }[];
}

/** Yomitan's INVALID_NOTE_ID: a duplicate AnkiConnect reports but its query can't find. */
export const invalidNoteId = -1;

export interface NoteState {
  /** Ids of the notes this one duplicates; null when it is not a duplicate */
  noteIds: number[] | null;
  noteInfos: AnkiNoteInfo[];
}

async function notesCardsInfo(noteIds: number[]) {
  const notes = (await ankiInvoke<(AnkiNoteInfo | null)[]>('notesInfo', { notes: noteIds })).filter(
    (note): note is AnkiNoteInfo => !!note && typeof note.noteId === 'number'
  );
  const cards = await ankiInvoke<AnkiNoteInfo['cardsInfo']>('cardsInfo', {
    cards: notes.flatMap((note) => note.cards ?? [])
  });
  return notes.map((note) => ({
    ...note,
    cardsInfo: cards.filter((card) => card?.note === note.noteId)
  }));
}

/**
 * Yomitan's getAnkiNoteInfo (Backend.partitionAddibleNotes): AnkiConnect says which notes are
 * duplicates under their duplicate scope and models (first field only, duplicates not allowed),
 * then the duplicates' ids are found and, with `additional`, their tags and card flags.
 */
export async function checkNotes(notes: AnkiNote[], additional: boolean): Promise<NoteState[]> {
  const stripped = notes.map((note) => {
    const [first] = Object.entries(note.fields);
    return { ...note, fields: first ? { [first[0]]: first[1] } : {} };
  });
  const strict = stripped.map((note) => ({
    ...note,
    options: { ...note.options, allowDuplicate: false }
  }));
  let duplicate: boolean[];
  try {
    const results = await ankiInvoke<{ canAdd: boolean; error?: string | null }[]>(
      'canAddNotesWithErrorDetail',
      { notes: strict }
    );
    duplicate = results.map(
      ({ error }) => !!error && error.includes('cannot create note because it is a duplicate')
    );
  } catch (e: any) {
    if (!String(e?.message).includes('unsupported action')) throw e;
    // older AnkiConnect: whether allowing duplicates changes the answer
    const [loose, tight] = await Promise.all([
      ankiInvoke<boolean[]>('canAddNotes', { notes: stripped }),
      ankiInvoke<boolean[]>('canAddNotes', { notes: strict })
    ]);
    duplicate = loose.map((canAdd, i) => canAdd !== tight[i]);
  }
  return Promise.all(
    notes.map(async (note, i) => {
      if (!duplicate[i]) return { noteIds: null, noteInfos: [] };
      const found = await ankiInvoke<number[]>('findNotes', { query: duplicateQuery(note) });
      const noteIds = found.length ? found : [invalidNoteId];
      const valid = noteIds.filter((id) => id !== invalidNoteId);
      return {
        noteIds,
        noteInfos: additional && valid.length ? await notesCardsInfo(valid) : []
      };
    })
  );
}

/** Hash AnkiConnect skips: JapanesePod101's "audio not available" clip (its README). */
const jpod101Missing = '7e2c2f954ef6051373ba916f000168dc';

/** Fields with {audio} get the word's JapanesePod101 audio, which AnkiConnect downloads itself. */
function wordAudio(entry: DictionaryEntry, format: AnkiCardFormat) {
  if (entry.type !== 'term') return {};
  const fields = Object.entries(format.fields)
    .filter(([, { value }]) => value.includes('{audio}'))
    .map(([name]) => name);
  if (!fields.length) return {};
  const [{ term, reading }] = entry.headwords;
  return {
    audio: [
      {
        url: jpod101Url(term, reading),
        filename: `chimimouryou_${reading}_${term}.mp3`,
        skipHash: jpod101Missing,
        fields
      }
    ]
  };
}

/**
 * Adds the note with AnkiConnect, then, as Yomitan does, suspends its new cards and syncs when
 * the options say so. Returns the new note's id and what failed after it was added.
 */
export async function addAnkiNote(
  note: AnkiNote,
  entry: DictionaryEntry,
  format: AnkiCardFormat,
  settings: DictionaryAnki
) {
  const noteId = await ankiInvoke<number | null>('addNote', {
    note: { ...note, ...wordAudio(entry, format) }
  });
  if (noteId === null) throw new Error('Note could not be added');
  // {cardsMinedToday}; the store is loaded lazily (it opens IndexedDB).
  import('$lib/data/store')
    .then(({ startDayHoursForTracker$ }) => minedCards.add(startDayHoursForTracker$.getValue()))
    .catch(() => undefined);
  const errors: string[] = [];
  if (settings.suspendNewCards) {
    try {
      const cards = await ankiInvoke<number[]>('findCards', { query: `nid:${noteId}` });
      await ankiInvoke('suspend', { cards });
    } catch (e: any) {
      errors.push(e.message);
    }
  }
  if (settings.forceSync) {
    try {
      await ankiInvoke('sync');
    } catch (e: any) {
      errors.push(e.message);
    }
  }
  return { noteId, errors };
}

/** DisplayAnki._getOverwrittenField: a field's new value under its overwrite mode. */
export function overwrittenField(
  existing: string,
  value: string,
  mode: AnkiNoteFieldOverwriteMode
) {
  switch (mode) {
    case 'overwrite':
      return value;
    case 'skip':
      return existing;
    case 'append':
      return existing + value;
    case 'prepend':
      return value + existing;
    case 'coalesce-new':
      return value || existing;
    case 'coalesce':
    default:
      return existing || value;
  }
}

/**
 * duplicateBehavior "overwrite" (DisplayAnki._getOverwrittenNote): the first note it duplicates
 * gets each field per its card format's overwrite mode. Returns that note's id.
 */
export async function overwriteAnkiNote(
  note: AnkiNote,
  entry: DictionaryEntry,
  format: AnkiCardFormat,
  noteIds: number[]
) {
  const id = noteIds.find((noteId) => noteId !== invalidNoteId);
  if (id === undefined) throw new Error('No note to overwrite');
  const [existing] = await notesCardsInfo([id]);
  if (!existing) throw new Error('No note to overwrite');
  const fields = Object.fromEntries(
    Object.entries(note.fields).map(([name, value]) => [
      name,
      overwrittenField(
        existing.fields[name]?.value ?? '',
        value,
        format.fields[name]?.overwriteMode ?? 'coalesce'
      )
    ])
  );
  await ankiInvoke('updateNoteFields', {
    note: { ...note, ...wordAudio(entry, format), fields, id }
  });
  return id;
}

/** Backend._onApiViewNotes: one note in Anki's editor (`edit`), else the browser. */
export async function viewNotes(noteIds: number[], mode: AnkiNoteGuiMode) {
  if (noteIds.length === 1 && mode === 'edit') {
    try {
      await ankiInvoke('guiEditNote', { note: noteIds[0] });
      return;
    } catch (e: any) {
      if (!String(e?.message).includes('unsupported action')) throw e;
    }
  }
  await ankiInvoke('guiBrowse', { query: `nid:${noteIds.join(',')}` });
}

const flagNames: Record<number, string> = {
  1: 'Red',
  2: 'Orange',
  3: 'Green',
  4: 'Blue',
  5: 'Pink',
  6: 'Turquoise',
  7: 'Purple'
};

/**
 * The tags and card flags DisplayAnki shows for duplicates (`displayTagsAndFlags`): all tags,
 * those not among the note tags (`non-standard`) or only `targetTags` (`custom`).
 */
export function tagsAndFlags(noteInfos: AnkiNoteInfo[], settings: DictionaryAnki) {
  const mode = settings.displayTagsAndFlags;
  if (mode === 'never') return { tags: [], flags: [] };
  let tags = [...new Set(noteInfos.flatMap((info) => info.tags ?? []))];
  if (mode === 'non-standard') tags = tags.filter((tag) => !settings.tags.includes(tag));
  if (mode === 'custom') tags = tags.filter((tag) => settings.targetTags.includes(tag));
  const flags = [
    ...new Set(
      noteInfos.flatMap((info) =>
        info.cardsInfo.filter(({ flags }) => flags !== 0).map(({ flags }) => flagNames[flags] ?? '')
      )
    )
  ];
  return { tags, flags };
}

/**
 * AnkiMobile's add-note link (its manual, "x-callback-url"): note type, deck, each field as
 * `fld<Name>`, tags. Without `dupes=1` AnkiMobile itself refuses a duplicate first field.
 * Back to `returnUrl` once it is added.
 */
export function ankiMobileUrl(note: AnkiNote, returnUrl: string) {
  const params = new URLSearchParams({ type: note.modelName, deck: note.deckName });
  for (const [name, value] of Object.entries(note.fields)) params.set(`fld${name}`, value);
  if (note.tags.length) params.set('tags', note.tags.join(' '));
  params.set('x-success', returnUrl);
  return `anki://x-callback-url/addnote?${params.toString().replace(/\+/g, '%20')}`;
}
