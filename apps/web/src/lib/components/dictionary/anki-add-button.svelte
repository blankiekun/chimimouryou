<script lang="ts">
  /**
   * The lookup popup's Anki actions for one entry (lib/data/dictionary/anki-dictionary.ts), as
   * Yomitan's DisplayAnki: one add button per card format of the entry's type (term or kanji);
   * with AnkiConnect, its duplicate check first (the quick first-field check before it with
   * `noteDupeCheckFirst`), duplicates added again, overwritten or refused by
   * `duplicateBehavior`, a View note button (Anki's browser or editor, `noteGuiMode`) and the
   * duplicates' tags and flags (`displayTagsAndFlags`); with AnkiMobile, its add-note link.
   * Hidden until Settings → Anki has a card format with a deck, note type and fields. Not part
   * of upstream.
   */
  import { faEye, faFlag, faTag } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import {
    addAnkiNote,
    ankiMobileUrl,
    buildAnkiNote,
    checkNotes,
    dictionaryAnki$,
    dictionaryAnkiRoute$,
    dictionaryAnkiSettings,
    formatReady,
    invalidNoteId,
    overwriteAnkiNote,
    skeletonNote,
    tagsAndFlags,
    viewNotes,
    type NoteState,
    type ScreenshotSource
  } from '$lib/data/dictionary/anki-dictionary';
  import type { DictionarySummary } from '$lib/data/dictionary/dictionary';
  import { t$ } from '$lib/i18n';
  import type { AnkiNoteContext } from '$lib/vendor/yomitan/data/anki-note-builder';
  import type { DictionaryEntry } from '$lib/vendor/yomitan/types/dictionary';
  import type { ProfileOptions } from '$lib/vendor/yomitan/types/settings';

  interface Props {
    entry: DictionaryEntry;
    options: ProfileOptions;
    summaries: DictionarySummary[];
    context: AnkiNoteContext;
    screenshot?: ScreenshotSource;
    /** A popup shortcut for this entry: addNote / viewNotes with a card format index */
    command?: { action: string; argument: string; id: number };
  }

  let { entry, options, summaries, context, screenshot, command }: Props = $props();

  const settings = $derived(dictionaryAnkiSettings($dictionaryAnki$));
  const connect = $derived($dictionaryAnkiRoute$ === 'ankiconnect');
  /** The card formats for this entry, with their index in `cardFormats` (shortcut arguments) */
  const formats = $derived(
    settings.cardFormats
      .map((format, index) => ({ format, index }))
      .filter(({ format }) => format.type === entry.type && formatReady(format))
  );

  /** Per card format index: what Anki has (undefined while checking) */
  let states = $state<Record<number, NoteState | undefined>>({});
  let checked = $state(false);
  let busy = $state<number | null>(null);
  let message = $state('');
  let error = $state('');

  const request = (format: (typeof formats)[number]['format'], firstFieldOnly = false) => ({
    entry,
    format,
    context,
    settings,
    profile: options,
    summaries,
    firstFieldOnly,
    screenshot
  });

  $effect(() => {
    states = {};
    checked = false;
    message = '';
    error = '';
    if (!connect || !formats.length || !settings.checkForDuplicates) {
      checked = true;
      return;
    }
    let stale = false;
    const additional = settings.displayTagsAndFlags !== 'never';
    const apply = (results: NoteState[]) => {
      if (stale) return;
      states = Object.fromEntries(formats.map(({ index }, i) => [index, results[i]]));
    };
    (async () => {
      if (settings.noteDupeCheckFirst) {
        await checkNotes(
          formats.map(({ format }) => skeletonNote(entry, format, settings)),
          additional
        ).then(apply, () => {});
      }
      const notes = await Promise.all(
        formats.map(({ format }) => buildAnkiNote(request(format, true)))
      );
      apply(await checkNotes(notes, additional));
    })()
      .catch(() => {})
      .finally(() => !stale && (checked = true));
    return () => (stale = true);
  });

  const validIds = (state: NoteState | undefined) =>
    state?.noteIds?.filter((id) => id !== invalidNoteId) ?? [];

  function addTitle(name: string, state: NoteState | undefined) {
    if (!state?.noteIds?.length) return $t$('lookup.addNote', { format: name });
    if (settings.duplicateBehavior === 'prevent') return $t$('lookup.duplicatesDisabled');
    if (settings.duplicateBehavior === 'overwrite') {
      return $t$('lookup.overwriteNote', { format: name });
    }
    return $t$('lookup.addDuplicate', { format: name });
  }

  function addDisabled(state: NoteState | undefined) {
    if (busy !== null || (connect && settings.checkForDuplicates && !state && !checked))
      return true;
    if (!state?.noteIds?.length) return false;
    if (settings.duplicateBehavior === 'prevent') return true;
    return settings.duplicateBehavior === 'overwrite' && !validIds(state).length;
  }

  async function add(item: (typeof formats)[number]) {
    const state = states[item.index];
    if (addDisabled(state)) return;
    busy = item.index;
    message = '';
    error = '';
    try {
      const note = await buildAnkiNote(request(item.format));
      if (!connect) {
        location.href = ankiMobileUrl(note, location.href);
        return;
      }
      if (state?.noteIds?.length && settings.duplicateBehavior === 'overwrite') {
        await overwriteAnkiNote(note, entry, item.format, state.noteIds);
        message = $t$('lookup.overwritten');
        return;
      }
      const { noteId, errors } = await addAnkiNote(note, entry, item.format, settings);
      states = {
        ...states,
        [item.index]: { noteIds: [...validIds(state), noteId], noteInfos: state?.noteInfos ?? [] }
      };
      message = $t$('lookup.addedToAnki');
      if (errors.length) error = errors.join('\n');
    } catch (e: any) {
      error = e.message;
    } finally {
      busy = null;
    }
  }

  function view(index: number) {
    const ids = validIds(states[index]);
    if (ids.length) viewNotes(ids, settings.noteGuiMode).catch((e) => (error = e.message));
  }

  // Popup shortcuts (DisplayAnki's addNote / viewNotes hotkeys for the selected entry)
  let lastCommand = 0;
  $effect(() => {
    if (!command || command.id === lastCommand) return;
    lastCommand = command.id;
    const index = Number.parseInt(command.argument, 10);
    const item = formats.find((format) => format.index === index);
    if (!item) return;
    if (command.action === 'addNote') add(item);
    else if (command.action === 'viewNotes') view(index);
  });
</script>

{#each formats as item (item.index)}
  {@const state = states[item.index]}
  {@const ids = validIds(state)}
  {@const marks = tagsAndFlags(state?.noteInfos ?? [], settings)}
  <span class="entry-anki-format" data-card-format-index={item.index}>
    <button
      type="button"
      class="entry-action entry-anki"
      class:entry-anki-duplicate={!!state?.noteIds?.length}
      title={addTitle(item.format.name, state)}
      aria-label={addTitle(item.format.name, state)}
      disabled={addDisabled(state)}
      onclick={() => add(item)}
    >
      <span class="anki-icon" data-icon={item.format.icon} aria-hidden="true"></span>
      <span>{item.format.name}</span>
    </button>
    {#if connect && ids.length}
      <button
        type="button"
        class="entry-action"
        title={$t$('lookup.viewNotes', { count: ids.length })}
        aria-label={$t$('lookup.viewNotes', { count: ids.length })}
        onclick={() => view(item.index)}
      >
        <Fa icon={faEye} />
        {#if ids.length > 1}<span>{ids.length}</span>{/if}
      </button>
    {/if}
    {#if marks.tags.length}
      <button
        type="button"
        class="entry-action"
        title={$t$('lookup.cardTags', { tags: marks.tags.join(', ') })}
        aria-label={$t$('lookup.cardTags', { tags: marks.tags.join(', ') })}
        onclick={() => (message = $t$('lookup.cardTags', { tags: marks.tags.join(', ') }))}
      >
        <Fa icon={faTag} />
      </button>
    {/if}
    {#if marks.flags.length}
      <button
        type="button"
        class="entry-action"
        title={$t$('lookup.cardFlags', { flags: marks.flags.join(', ') })}
        aria-label={$t$('lookup.cardFlags', { flags: marks.flags.join(', ') })}
        onclick={() => (message = $t$('lookup.cardFlags', { flags: marks.flags.join(', ') }))}
      >
        <Fa icon={faFlag} />
      </button>
    {/if}
  </span>
{/each}
{#if message}<p class="entry-anki-note" role="status">{message}</p>{/if}
{#if error}<p class="entry-anki-error" role="alert">{error}</p>{/if}

<style>
  .entry-anki-format {
    display: inline-flex;
  }

  /* Yomitan's card format icons (big-circle, small-circle, big-square, big-diamond), in ink */
  .anki-icon {
    display: inline-block;
    width: 0.75rem;
    height: 0.75rem;
    border: 2px solid currentColor;
    border-radius: 50%;
  }

  .anki-icon[data-icon='small-circle'] {
    width: 0.5rem;
    height: 0.5rem;
  }

  .anki-icon[data-icon='big-square'] {
    border-radius: 2px;
  }

  .anki-icon[data-icon='big-diamond'] {
    width: 0.6rem;
    height: 0.6rem;
    border-radius: 1px;
    transform: rotate(45deg);
  }

  /* Already in Anki: the icon filled, as Yomitan's add-duplicate/overwrite icons mark it */
  .entry-anki-duplicate .anki-icon {
    background: currentColor;
  }

  .entry-anki:disabled {
    opacity: 0.5;
  }

  .entry-anki-note,
  .entry-anki-error {
    flex-basis: 100%;
    margin: 0;
    font-size: 0.75rem;
    text-align: right;
    white-space: pre-line;
  }

  .entry-anki-note {
    color: var(--app-muted-fg);
  }

  .entry-anki-error {
    color: var(--app-danger-color);
  }
</style>
