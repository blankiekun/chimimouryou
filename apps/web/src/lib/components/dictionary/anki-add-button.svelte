<script lang="ts">
  /**
   * The lookup popup's Add to Anki for one entry (lib/data/anki-dictionary.ts): with
   * AnkiConnect, Yomitan's duplicate check first ("In Anki" opens the note) and the note added
   * in place; with AnkiMobile, its add-note link. Hidden until Settings → Anki has a deck, note
   * type and fields. Not part of upstream.
   */
  import { faCheck, faPlus } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import {
    addAnkiNote,
    ankiConfigured,
    ankiMobileUrl,
    browseNotes,
    buildAnkiNote,
    dictionaryAnki$,
    dictionaryAnkiRoute$,
    dictionaryAnkiSettings,
    findDuplicates
  } from '$lib/data/anki-dictionary';
  import type { DictionarySummary } from '$lib/data/dictionary';
  import { t$ } from '$lib/i18n';
  import type { AnkiNoteContext } from '$lib/vendor/yomitan/data/anki-note-builder';
  import type { TermDictionaryEntry } from '$lib/vendor/yomitan/types/dictionary';
  import type { ProfileOptions } from '$lib/vendor/yomitan/types/settings';

  interface Props {
    entry: TermDictionaryEntry;
    options: ProfileOptions;
    summaries: DictionarySummary[];
    context: AnkiNoteContext;
  }

  let { entry, options, summaries, context }: Props = $props();

  const settings = $derived(dictionaryAnkiSettings($dictionaryAnki$));
  const connect = $derived($dictionaryAnkiRoute$ === 'ankiconnect');

  let busy = $state(false);
  let noteIds = $state<number[]>([]);
  let added = $state(false);
  let error = $state('');

  const request = (firstFieldOnly = false) => ({
    entry,
    context,
    settings,
    profile: options,
    summaries,
    firstFieldOnly
  });

  $effect(() => {
    noteIds = [];
    added = false;
    error = '';
    if (!connect || !ankiConfigured(settings) || !settings.checkForDuplicates) return;
    let stale = false;
    buildAnkiNote(request(true))
      .then(findDuplicates)
      .then(
        (ids) => !stale && (noteIds = ids),
        () => {}
      );
    return () => (stale = true);
  });

  async function add() {
    busy = true;
    error = '';
    try {
      const note = await buildAnkiNote(request());
      if (!connect) {
        location.href = ankiMobileUrl(note, location.href);
        return;
      }
      noteIds = [await addAnkiNote(note, entry, settings)];
      added = true;
    } catch (e: any) {
      error = e.message;
    } finally {
      busy = false;
    }
  }
</script>

{#if ankiConfigured(settings)}
  {#if noteIds.length && connect}
    <button
      type="button"
      class="entry-action entry-anki"
      title={$t$('lookup.openInAnki')}
      onclick={() => browseNotes(noteIds).catch((e) => (error = e.message))}
    >
      <Fa icon={faCheck} />
      <span>{$t$(added ? 'lookup.addedToAnki' : 'lookup.inAnki')}</span>
    </button>
  {/if}
  {#if !added}
    <button
      type="button"
      class="entry-action entry-anki"
      title={$t$(noteIds.length ? 'lookup.addAgain' : 'lookup.addToAnki')}
      aria-label={$t$(noteIds.length ? 'lookup.addAgain' : 'lookup.addToAnki')}
      disabled={busy}
      onclick={add}
    >
      <Fa icon={faPlus} />
      {#if !noteIds.length}<span>{$t$('lookup.anki')}</span>{/if}
    </button>
  {/if}
  {#if error}<p class="entry-anki-error" role="alert">{error}</p>{/if}
{/if}

<style>
  .entry-anki-error {
    flex-basis: 100%;
    margin: 0;
    color: var(--app-danger-color);
    font-size: 0.75rem;
    text-align: right;
  }
</style>
