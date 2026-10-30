# Yomitan engine (vendored)

Part of [Yomitan](https://github.com/yomidevs/yomitan) (GPL-3.0-or-later, `LICENSE` here),
tag **26.10.12.0** (commit `e7334a96106a6c74e6fa75bd33a5ea1219d92712`), the same release the
desktop app loads (`apps/desktop/scripts/fetch-yomitan.sh`). It powers the built-in dictionary
(`lib/data/dictionary/dictionary.ts`, worker `lib/functions/dictionary/`). Paths mirror Yomitan's `ext/js/`
(`types/` is its `types/ext/`, `data/schemas/` its `ext/data/schemas/`), so a newer release can be
diffed file by file.

## Copied unchanged

`language/translator.js`, `language-transformer.js`, `multi-language-transformer.js`,
`languages.js`, `language-transforms.js`, `text-processors.js`, `CJK-util.js`, `language/ja/*`
except the preprocessors, `language/ko/korean.js` and `language/zh/chinese.js` (code-point helpers
the translator imports), `data/database.js`, `data/json-schema.js`, `general/cache-map.js`,
`general/regex-util.js`, `media/media-util.js`, `core/{json,object-utilities,safe-performance,to-error,utilities}.js`,
`data/string-util.js`, `dom/dom-text-scanner.js`, `dom/document-util.js`, `display/pronunciation-generator.js`,
`language/text-utilities.js`, `core/extension-error.js`, `data/anki-util.js`, `data/anki-template-util.js`,
`templates/template-renderer.js`, `templates/anki-template-renderer-content-manager.js`,
`templates/template-renderer-media-provider.js`, ext's `data/anki-compact-gloss-style.js`,
`data/structured-content-style.json`, `data/pronunciation-style.json` and
`data/templates/default-anki-field-templates.handlebars` (ext's `data/`, here beside `data/schemas/`),
`data/schemas/options-schema.json` and the type files in `types/`.

`lib/handlebars.js` is ext's `lib/handlebars.js`: [yomitan-handlebars](https://github.com/yomidevs/yomitan-handlebars)
(MIT, Elasticsearch B.V. and Yehuda Katz; Handlebars that renders templates without `eval`, so the
site's CSP holds) at the commit Yomitan pins (`12aff5e3550954d7d3a98a5917ff7d579f3cce25`) with
`handlebars` 4.7.8, bundled as Yomitan's build does (`esbuild --bundle --format=esm` of
`export {Handlebars} from 'yomitan-handlebars/src/handlebars.ts'`).

## Changed (each change is marked `chimimouryou:` in the file)

- `language/language-descriptors.js`: Japanese only.
- `language/ja/japanese-text-preprocessors.js`: imports the `kanji-processor` package (MIT)
  instead of Yomitan's bundled copy of it.
- `dictionary/dictionary-database.js`: no nested worker, no resvg/`drawMedia` (the extension's
  canvas rendering) and no parent-worker messaging; the app's worker does the schema upgrades.
- `dictionary/dictionary-importer.js`: `@zip.js/zip.js` from npm without its own workers; the
  compiled ajv schemas (a build-time bundle) are replaced by shape checks (index is an object,
  every bank an array of rows); `compareRevisions` copied in from `dictionary-data-util.js`.
- `data/options-util.js`: the schema is bundled instead of fetched; `load`/`save`
  (`chrome.storage`) removed, as the app stores the options itself; the Anki field template
  patches and the welcome page in the upgrades are skipped (custom field templates from older
  Yomitan versions are used as they are).
- `core/log.js`: the console instead of the extension's logger.
- `dictionary/dictionary-data-util.js`: `getFrequencyNumbers`/`getFrequencyHarmonic` copied in from
  `data/anki-note-data-creator.js` (the rest of that module is Anki's).
- `display/structured-content-generator.js`: one content manager from the app
  (`components/dictionary/structured-content.ts`) instead of the display and Anki ones: images are
  `<img>` from blob URLs out of the dictionary database (the Anki renderer's path, not the
  extension's canvas drawing), links are checked there (only http(s) opens, in a new tab; internal
  `?query=` links do a nested lookup).
- `dom/text-source-generator.js`: only the text path of `getRangeFromPoint` (`_caretRangeFromPoint`,
  `_caretPositionFromPoint`, `_isPointInRange`) as a function; no imposters for inputs, shadow
  roots, images or deep DOM scan. `extractSentence` as a function over the match's start and
  length, the text around it read with DOMTextScanner as TextSourceRange does.
- `templates/anki-template-renderer.js`, `template-renderer.js`, `template-renderer-media-provider.js`:
  Handlebars from `../lib/` (ext's `lib/` sits inside this folder); NodeFilter is the page's,
  not linkedom's (the renderer runs in the page, not in Yomitan's sandboxed frame).
- `dom/css-style-applier.js`: the two style files are imported instead of fetched.
- `data/anki-note-data-creator.js`: imports `anki-compact-gloss-style.js` from beside it.
- `data/anki-note-builder.js`: no blanking of `{url}` when the page shares the module's protocol
  (here the page is the book, not an extension page).
- `app/popup-position.js`: `Popup._getPosition` and its helpers from `app/popup.js`, as functions
  taking the frame size and offsets.
- `background/find-terms-options.js`: `Backend._getTranslatorFindTermsOptions` and its helpers
  from `background/backend.js`, as functions.
- `*.d.ts` beside the entry modules: declarations for the TypeScript side (Yomitan types its
  JavaScript with JSDoc).

The popup itself is the app's (`components/dictionary/lookup-popup.svelte`, `term-entry.svelte`):
the entry layout follows `display/display-generator.js` with Yomitan's class names, so custom popup
CSS and dictionary styles (scoped with `addScopeToCssLegacy`, as `display.js` does) still apply.
Word audio follows `media/audio-downloader.js` and `audio-system.js` in `lib/data/dictionary/dictionary-audio.ts`
for the sources a web page can reach.

Anki notes (`lib/data/dictionary/anki-dictionary.ts`) are built by `data/anki-note-builder.js` with the
`AnkiTemplateRenderer` called directly, as Yomitan's own tests do, instead of through its
sandboxed template-renderer frame; media injection (`injectAnkiNoteMedia`: dictionary images,
screenshots, clipboard, Yomitan's audio download) is not used.

Left out: the extension (backend, messaging, `chrome.*`), the display's templates and its text
scanner (`language/text-scanner.js`; the app's `functions/dictionary/scan.ts` uses the scanner pieces
above), the settings pages, AnkiConnect (`comm/anki-connect.js`; the app's `lib/data/dictionary/anki.ts`
talks to it), the kanji lookup path's UI, and every language but Japanese.
