/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * "Add to Anki" in the built-in dictionary's popup, the way Yomitan makes its notes: the card
 * format (deck, note type, fields with Yomitan's {markers}, tags, duplicate check) is rendered
 * by Yomitan's own note builder and Handlebars templates (lib/vendor/yomitan/data,
 * templates/), its default field templates unless a Yomitan settings import brought custom
 * ones. Notes go to AnkiConnect (`anki.ts`), or on iPhone and iPad to AnkiMobile through its
 * `anki://x-callback-url/addnote` link. The card format follows the account
 * (`account-settings-sync.ts`); the route is per browser. Not part of upstream.
 */

import { ankiInvoke } from '$lib/data/dictionary/anki';
import { jpod101Url } from '$lib/data/dictionary/dictionary-audio';
import { writableObjectLocalStorageSubject } from '$lib/data/internal/writable-object-local-storage-subject';
import { writableStorageSubject } from '$lib/data/internal/writable-storage-subject';
import { localStorage } from '$lib/data/window/local-storage';
import type { DictionarySummary } from '$lib/vendor/yomitan/dictionary/dictionary-importer';
import type { AnkiNote, AnkiNoteContext } from '$lib/vendor/yomitan/data/anki-note-builder';
import type { TermDictionaryEntry } from '$lib/vendor/yomitan/types/dictionary';
import type {
  AnkiDuplicateScope,
  AnkiFields,
  Options,
  ProfileOptions
} from '$lib/vendor/yomitan/types/settings';
import { record } from '$lib/data/setting-parsers';

/** Yomitan's term card format and the Anki options the note builder reads. */
export interface DictionaryAnki {
  deck: string;
  model: string;
  /** Field name → value with markers, in the note type's order (the first is the duplicate key) */
  fields: AnkiFields;
  tags: string[];
  checkForDuplicates: boolean;
  duplicateScope: AnkiDuplicateScope;
  duplicateScopeCheckAllModels: boolean;
  /** Custom Handlebars field templates from Yomitan, or null for its defaults */
  fieldTemplates: string | null;
}

export const defaultDictionaryAnki: DictionaryAnki = {
  deck: '',
  model: '',
  fields: {},
  tags: ['chimimouryou'],
  checkForDuplicates: true,
  duplicateScope: 'collection',
  duplicateScopeCheckAllModels: false,
  fieldTemplates: null
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

export function dictionaryAnkiSettings(stored: Partial<DictionaryAnki>): DictionaryAnki {
  return { ...defaultDictionaryAnki, ...stored };
}

export const ankiConfigured = (settings: DictionaryAnki) =>
  !!settings.deck && !!settings.model && Object.keys(settings.fields).length > 0;

/**
 * The card format of a Yomitan settings export (or bare options object, upgraded by its
 * OptionsUtil first): the current profile's first term card format and its Anki options.
 * Undefined when that profile has no deck and note type.
 */
export function dictionaryAnkiFromYomitan(options: Options): DictionaryAnki | undefined {
  const anki = options.profiles[options.profileCurrent]?.options.anki;
  const format = anki?.cardFormats.find(({ type }) => type === 'term');
  if (!anki || !format?.deck || !format.model) return undefined;
  return {
    deck: format.deck,
    model: format.model,
    fields: format.fields,
    tags: anki.tags,
    checkForDuplicates: anki.checkForDuplicates,
    duplicateScope: anki.duplicateScope,
    duplicateScopeCheckAllModels: anki.duplicateScopeCheckAllModels,
    fieldTemplates: anki.fieldTemplates
  };
}

/** Settings → Anki's import: only the card format of a Yomitan settings file. */
export async function importDictionaryAnki(json: string) {
  const data = JSON.parse(json);
  const { OptionsUtil } = await import('$lib/vendor/yomitan/data/options-util');
  const util = new OptionsUtil();
  await util.prepare();
  const anki = dictionaryAnkiFromYomitan(
    await util.update(data && typeof data === 'object' && 'options' in data ? data.options : data)
  );
  if (!anki) throw new Error('no term card format with a deck and note type');
  dictionaryAnki$.next(anki);
  return anki;
}

/**
 * The value Yomitan gives a note type's field (AnkiController._getDefaultFieldValue): the first
 * field is the expression, others by name ("Reading", "Meaning", "Sentence", …), else empty.
 */
export function defaultFieldValue(fieldName: string, index: number, markers: string[]) {
  if (index === 0) return '{expression}';
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

let builder:
  | Promise<{
      builder: import('$lib/vendor/yomitan/data/anki-note-builder').AnkiNoteBuilder;
      defaultTemplates: string;
      getDynamicTemplates: typeof import('$lib/vendor/yomitan/data/anki-template-util').getDynamicTemplates;
    }>
  | undefined;

/** Yomitan's renderer, loaded on first use (Handlebars is big). */
function getBuilder() {
  builder ??= Promise.all([
    import('$lib/vendor/yomitan/templates/anki-template-renderer'),
    import('$lib/vendor/yomitan/data/anki-note-builder'),
    import('$lib/vendor/yomitan/data/anki-template-util'),
    import('$lib/vendor/yomitan/data/templates/default-anki-field-templates.handlebars?raw')
  ]).then(async ([{ AnkiTemplateRenderer }, { AnkiNoteBuilder }, util, templates]) => {
    const renderer = new AnkiTemplateRenderer(document, window);
    await renderer.prepare();
    const unsupported = async () => {
      throw new Error('Not supported');
    };
    return {
      builder: new AnkiNoteBuilder(
        { injectAnkiNoteMedia: unsupported, parseText: unsupported },
        renderer.templateRenderer
      ),
      defaultTemplates: templates.default,
      getDynamicTemplates: util.getDynamicTemplates
    };
  });
  return builder;
}

export interface NoteRequest {
  entry: TermDictionaryEntry;
  context: AnkiNoteContext;
  settings: DictionaryAnki;
  profile: ProfileOptions;
  summaries: DictionarySummary[];
  /** Only the first field (enough for the duplicate check) */
  firstFieldOnly?: boolean;
}

/** The note Yomitan would make for the entry (fields rendered from their markers). */
export async function buildAnkiNote({
  entry,
  context,
  settings,
  profile,
  summaries,
  firstFieldOnly
}: NoteRequest): Promise<AnkiNote> {
  const { builder, defaultTemplates, getDynamicTemplates } = await getBuilder();
  const fields = firstFieldOnly
    ? Object.fromEntries(Object.entries(settings.fields).slice(0, 1))
    : settings.fields;
  const { note, errors } = await builder.createNote({
    dictionaryEntry: entry,
    cardFormat: {
      type: 'term',
      name: 'chimimouryou',
      deck: settings.deck,
      model: settings.model,
      fields,
      icon: 'big-circle'
    },
    context,
    template:
      (settings.fieldTemplates ?? defaultTemplates) + getDynamicTemplates(profile, summaries),
    tags: settings.tags,
    duplicateScope: settings.duplicateScope,
    duplicateScopeCheckAllModels: settings.duplicateScopeCheckAllModels,
    resultOutputMode: profile.general.resultOutputMode,
    glossaryLayoutMode: profile.general.glossaryLayoutMode,
    compactTags: profile.general.compactTags,
    dictionaryStylesMap: builder.getDictionaryStylesMap(profile.dictionaries)
  });
  if (errors.length) throw errors[0];
  return note;
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

/** Ids of the notes the note would duplicate (none without a first field). */
export async function findDuplicates(note: AnkiNote) {
  const query = duplicateQuery(note);
  return query.includes(':') ? ankiInvoke<number[]>('findNotes', { query }) : [];
}

/** Hash AnkiConnect skips: JapanesePod101's "audio not available" clip (its README). */
const jpod101Missing = '7e2c2f954ef6051373ba916f000168dc';

/**
 * Adds the note with AnkiConnect. Fields with {audio} get the word's JapanesePod101 audio,
 * which AnkiConnect downloads itself. Returns the new note's id.
 */
export async function addAnkiNote(
  note: AnkiNote,
  entry: TermDictionaryEntry,
  settings: DictionaryAnki
) {
  const audioFields = Object.entries(settings.fields)
    .filter(([, { value }]) => value.includes('{audio}'))
    .map(([name]) => name);
  const [{ term, reading }] = entry.headwords;
  return ankiInvoke<number>('addNote', {
    note: {
      ...note,
      ...(audioFields.length && {
        audio: [
          {
            url: jpod101Url(term, reading),
            filename: `chimimouryou_${reading}_${term}.mp3`,
            skipHash: jpod101Missing,
            fields: audioFields
          }
        ]
      })
    }
  });
}

export function browseNotes(ids: number[]) {
  return ankiInvoke('guiBrowse', { query: `nid:${ids.join(',')}` });
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
