<script lang="ts">
  /**
   * The first book opened with the built-in lookups on says how to look a word up (a tap, or Shift
   * and hover), and offers JMdict when no dictionary is installed. Once per browser. Not part of
   * upstream.
   */
  import { onMount } from 'svelte';
  import InstallDictionary from '$lib/components/dictionary/install-dictionary.svelte';
  import Toast from '$lib/components/toast.svelte';
  import {
    builtInLookups$,
    loadYomitanOptions,
    noDictionaryNoteSeen$,
    refreshDictionaries
  } from '$lib/data/dictionary';
  import { writableBooleanLocalStorageSubject } from '$lib/data/internal/writable-boolean-local-storage-subject';
  import { t$ } from '$lib/i18n';

  const seen$ = writableBooleanLocalStorageSubject()('lookupHintSeen', false);

  let shown = $state(false);
  let empty = $state(false);
  const tap = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;

  onMount(() => {
    if (seen$.getValue() || !$builtInLookups$) return;
    loadYomitanOptions()
      .then(() => refreshDictionaries())
      .then((list) => {
        empty = !list.length;
        shown = true;
        seen$.next(true);
        // This note offers the dictionary already.
        if (empty) noDictionaryNoteSeen$.next(true);
      })
      .catch(() => undefined);
  });
</script>

{#if shown}
  <Toast label={$t$('lookup.hintTitle')} onclose={() => (shown = false)}>
    <p class="hint-title">{$t$('lookup.hintTitle')}</p>
    <p class="hint-text">{$t$(tap ? 'lookup.hintTap' : 'lookup.hintHover')}</p>
    {#if empty}
      <p class="hint-text">{$t$('lookup.hintNoDictionary')}</p>
      <InstallDictionary ondone={() => (shown = false)} />
    {/if}
  </Toast>
{/if}

<style>
  .hint-title {
    font-weight: 700;
  }

  .hint-text {
    margin: 0.25rem 0 0.75rem;
    font-size: var(--type-small);
    line-height: 1.5;
  }
</style>
