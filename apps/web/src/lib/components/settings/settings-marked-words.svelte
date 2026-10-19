<script lang="ts">
  import SettingsItemGroup from '$lib/components/settings/settings-item-group.svelte';
  import { buttonClasses, inputClasses } from '$lib/css-classes';
  import { getWordMarks, setWordMarks, wordMarks$ } from '$lib/data/word-marks';
  import { t$ } from '$lib/i18n';
  import { onMount } from 'svelte';

  /** Words marked known or ignored by hand (word-marks.ts), with search and unmark. Not part of upstream. */

  let search = '';

  onMount(() => {
    getWordMarks().catch(() => undefined);
  });

  $: marked = Object.entries($wordMarks$)
    .filter(([, mark]) => mark.status)
    .sort(([, a], [, b]) => b.modified - a.modified)
    .map(([key, mark]) => {
      const [form, reading] = key.split('\t');

      return { form, reading, status: mark.status };
    });
  $: shown = marked.filter(
    ({ form, reading }) => !search.trim() || `${form} ${reading}`.includes(search.trim())
  );
</script>

<SettingsItemGroup
  title={$t$('anki.markedWords')}
  tooltip={$t$('anki.markedWordsHint', { count: marked.length })}
  wide
>
  <input
    type="search"
    aria-label={$t$('anki.markedWordsSearch')}
    placeholder={$t$('anki.markedWordsSearch')}
    class={inputClasses}
    bind:value={search}
  />
  <ul class="mt-2 max-h-72 overflow-y-auto">
    {#each shown.slice(0, 200) as { form, reading, status } (`${form}\t${reading}`)}
      <li class="flex items-center gap-2 py-1">
        <span lang="ja" class="flex-1"
          >{form}{#if reading}<span class="text-xs text-[color:var(--app-muted-fg)]">
              （{reading}）</span
            >{/if}</span
        >
        <span class="text-xs text-[color:var(--app-muted-fg)]">
          {$t$(status === 'known' ? 'anki.markedKnown' : 'anki.markedIgnored')}
        </span>
        <button
          type="button"
          class={buttonClasses}
          title={$t$('book.unmarkWord', { word: form })}
          on:click={() => setWordMarks([[form, reading || null]], null)}
        >
          {$t$('anki.unmark')}
        </button>
      </li>
    {:else}
      <li class="py-1 text-xs text-[color:var(--app-muted-fg)]">{$t$('anki.noMarkedWords')}</li>
    {/each}
  </ul>
</SettingsItemGroup>
