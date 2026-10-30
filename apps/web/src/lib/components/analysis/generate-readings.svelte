<script lang="ts">
  /**
   * Standalone, beside Generated furigana: makes the stored books' missing readings files now
   * rather than at the next start, and offers to redo word lists made before the furigana tools
   * were installed (background-analysis.ts). Both opt-in.
   */
  import { analysisToolsState$ } from '$lib/data/analysis/analysis-tools';
  import {
    analyseInBackground,
    backgroundAnalysis$,
    booksWithoutReadings,
    redoWordLists,
    wordListsWithoutReader
  } from '$lib/data/analysis/background-analysis';
  import { generatedFurigana$ } from '$lib/data/store';

  let readings: string[] = [];
  let lists: string[] = [];

  $: ready = $generatedFurigana$ && $analysisToolsState$.furigana === 'ready';
  // Counted again whenever the queue empties, so books just done drop out.
  $: if (ready && !$backgroundAnalysis$) count();

  async function count() {
    [readings, lists] = await Promise.all([
      booksWithoutReadings().catch(() => []),
      wordListsWithoutReader().catch(() => [])
    ]);
  }

  const books = (n: number) => `${n.toLocaleString('en-US')} ${n === 1 ? 'book' : 'books'}`;

  function generate() {
    analyseInBackground(readings);
    readings = [];
  }

  function redo() {
    redoWordLists(lists);
    lists = [];
  }
</script>

{#if ready}
  {#if $backgroundAnalysis$}
    <p class="generate-note" role="status">
      Analysing {$backgroundAnalysis$.current} of {$backgroundAnalysis$.total}… {$backgroundAnalysis$.percent}%
    </p>
  {:else if readings.length || lists.length}
    <div class="generate-actions">
      {#if readings.length}
        <button type="button" class="app-button" on:click={generate}>
          Generate readings for {books(readings.length)}
        </button>
      {/if}
      {#if lists.length}
        <button
          type="button"
          class="app-button app-button-quiet"
          title="Reads each word in context; difficulty stays the same."
          on:click={redo}
        >
          Redo word lists with readings ({books(lists.length)})
        </button>
      {/if}
    </div>
  {/if}
{/if}

<style>
  .generate-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-top: 0.5rem;
  }

  .generate-note {
    margin-top: 0.5rem;
    font-size: var(--type-small);
    font-variant-numeric: tabular-nums;
    color: var(--app-muted-fg);
  }
</style>
