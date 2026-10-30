<script lang="ts">
  import SectionHead from '$lib/components/section-head.svelte';
  import { downloadCsv } from '$lib/data/words/book-words';
  import {
    markedWords,
    markedWordsCsv,
    setWordMarks,
    wordMarks$,
    type WordStatus
  } from '$lib/data/words/word-marks';
  import { t$ } from '$lib/i18n';

  /** Words marked known or ignored by hand (word-marks.ts), with search and unmark. Not part of upstream. */

  const pageSize = 50;

  let search = '';
  let filter: WordStatus | 'all' = 'all';
  let limit = pageSize;

  $: marked = markedWords($wordMarks$);
  $: counts = {
    all: marked.length,
    known: marked.filter((word) => word.status === 'known').length,
    ignored: marked.filter((word) => word.status === 'ignored').length
  };
  $: shown = marked.filter(
    ({ form, reading, status }) =>
      (filter === 'all' || status === filter) &&
      (!search.trim() || `${form} ${reading}`.includes(search.trim()))
  );
  $: (filter, search, (limit = pageSize));
  $: filters = [
    { id: 'all', label: $t$('words.all', { count: counts.all }) },
    { id: 'known', label: $t$('words.knownCount', { count: counts.known }) },
    { id: 'ignored', label: $t$('words.ignoredCount', { count: counts.ignored }) }
  ] as const;

  const date = (ms: number) =>
    new Date(ms).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' });

  function exportCsv() {
    downloadCsv('marked words.csv', markedWordsCsv(shown));
  }
</script>

<section class="marked" aria-label={$t$('words.marked')}>
  <SectionHead number={1} title={$t$('words.marked')} count={counts.all} />

  <div class="marked-tools">
    <div class="app-segmented" role="group" aria-label={$t$('words.filter')}>
      {#each filters as option (option.id)}
        <button
          type="button"
          class="app-segment"
          class:app-segment-selected={filter === option.id}
          aria-pressed={filter === option.id}
          on:click={() => (filter = option.id)}
        >
          {option.label}
        </button>
      {/each}
    </div>
    <input
      type="search"
      class="app-input marked-search"
      aria-label={$t$('anki.markedWordsSearch')}
      placeholder={$t$('anki.markedWordsSearch')}
      bind:value={search}
    />
    <button
      type="button"
      class="app-button app-button-quiet marked-export marked-wide"
      disabled={!shown.length}
      on:click={exportCsv}
    >
      {$t$('words.exportCsv')}
    </button>
  </div>

  <table class="app-table marked-table">
    <thead>
      <tr>
        <th>{$t$('words.word')}</th>
        <th class="marked-wide">{$t$('words.reading')}</th>
        <th>{$t$('words.status')}</th>
        <th class="marked-wide">{$t$('words.markedOn')}</th>
        <th><span class="sr-only">{$t$('anki.unmark')}</span></th>
      </tr>
    </thead>
    <tbody>
      {#each shown.slice(0, limit) as { form, reading, status, modified } (`${form}\t${reading}`)}
        <tr>
          <td class="marked-word" lang="ja">
            {form}
            <span class="marked-reading">{reading || '—'}</span>
          </td>
          <td class="marked-wide marked-muted" lang="ja">{reading || '—'}</td>
          <td>
            <span class="app-tag" class:app-tag-muted={status === 'ignored'}>
              {$t$(status === 'known' ? 'anki.markedKnown' : 'anki.markedIgnored')}
            </span>
          </td>
          <td class="marked-wide">{date(modified)}</td>
          <td class="marked-action">
            <button
              type="button"
              class="app-button app-button-quiet"
              title={$t$('book.unmarkWord', { word: form })}
              on:click={() => setWordMarks([[form, reading || null]], null)}
            >
              {$t$('anki.unmark')}
            </button>
          </td>
        </tr>
      {:else}
        <tr><td colspan="5" class="marked-muted">{$t$('anki.noMarkedWords')}</td></tr>
      {/each}
    </tbody>
  </table>

  <p class="marked-footer">
    {#if shown.length}
      <span
        >{$t$('words.showing', {
          shown: Math.min(limit, shown.length).toLocaleString('en-US'),
          total: shown.length.toLocaleString('en-US')
        })}</span
      >
      {#if shown.length > limit}
        ·
        <button
          type="button"
          class="app-button app-button-quiet marked-more"
          on:click={() => (limit += pageSize)}
        >
          {$t$('words.showMore')}
        </button>
      {/if}
    {/if}
    <button
      type="button"
      class="app-button app-button-quiet marked-export marked-narrow"
      disabled={!shown.length}
      on:click={exportCsv}
    >
      {$t$('words.exportCsv')}
    </button>
  </p>
</section>

<style>
  .marked {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 1.25rem;
  }

  .marked-tools {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.75rem;
  }

  .marked-search {
    min-width: 0;
    flex: 0 1 15rem;
  }

  .marked-export {
    margin-left: auto;
  }

  .marked-table {
    margin-top: 0.25rem;
  }

  .marked-word {
    font-size: 1.05rem;
  }

  .marked-reading {
    display: none;
    color: var(--app-muted-fg);
    font-size: var(--type-label);
  }

  .marked-muted {
    color: var(--app-muted-fg);
  }

  .marked-action {
    text-align: right;
  }

  .marked-footer {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem;
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }

  .marked-more {
    color: inherit;
    font-weight: 400;
  }

  .marked-narrow {
    display: none;
  }

  @media (max-width: 639px) {
    .marked-search {
      flex-basis: 100%;
    }

    .marked-wide {
      display: none;
    }

    .marked-narrow {
      display: inline-flex;
    }

    .marked-reading {
      display: block;
    }
  }
</style>
