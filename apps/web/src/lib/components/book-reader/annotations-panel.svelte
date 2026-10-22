<script lang="ts">
  import { highlightsToMarkdown, type Highlight } from '$lib/data/annotations';
  import { downloadBlob } from '$lib/functions/file-dom/download-blob';
  import { createEventDispatcher } from 'svelte';
  import { t$ } from '$lib/i18n';

  export let title: string;
  export let highlights: Highlight[];
  export let syncError = '';

  const dispatch = createEventDispatcher<{
    jump: Highlight;
    edit: Highlight;
  }>();

  let notesOnly = false;
  let copied = false;

  $: shown = notesOnly ? highlights.filter((h) => h.note) : highlights;
  $: groups = shown.reduce<{ chapter: string; items: Highlight[] }[]>((acc, highlight) => {
    const last = acc[acc.length - 1];

    if (last && last.chapter === highlight.chapter) {
      last.items.push(highlight);
    } else {
      acc.push({ chapter: highlight.chapter, items: [highlight] });
    }

    return acc;
  }, []);

  function download() {
    downloadBlob(
      new Blob([highlightsToMarkdown(title, highlights)], { type: 'text/markdown' }),
      `${title.replace(/[\\/:*?"<>|]/g, '_')} - highlights.md`
    );
  }

  async function copy() {
    await navigator.clipboard.writeText(highlightsToMarkdown(title, highlights));
    copied = true;
    setTimeout(() => (copied = false), 1500);
  }
</script>

<div class="flex min-h-0 flex-1 flex-col">
  <div class="ann-tools">
    <label class="flex items-center gap-1.5">
      <input type="checkbox" bind:checked={notesOnly} />
      {$t$('reader.notesOnly')}
    </label>
    <span class="ann-count ml-auto">
      {copied
        ? $t$('reader.copied')
        : $t$(highlights.length === 1 ? 'reader.highlightCountOne' : 'reader.highlightCount', {
            count: highlights.length
          })}
    </span>
    <button
      class="app-button-quiet"
      title={$t$('reader.copyMarkdown')}
      disabled={!highlights.length}
      on:click={copy}
    >
      {$t$('reader.copy')}
    </button>
    <button
      class="app-button-quiet"
      title={$t$('reader.downloadMarkdown')}
      disabled={!highlights.length}
      on:click={download}
    >
      {$t$('reader.download')}
    </button>
  </div>

  {#if syncError}
    <p class="px-4 pb-2 text-xs text-panel-danger md:px-6">{syncError}</p>
  {/if}

  <div class="ann-list">
    {#if !shown.length}
      <p class="ann-empty">
        {notesOnly ? $t$('reader.noNotes') : $t$('reader.noHighlights')}
      </p>
    {/if}
    {#each groups as group, groupIndex (groupIndex)}
      {#if group.chapter}
        <h3 class="ann-chapter" lang="ja">{group.chapter}</h3>
      {/if}
      {#each group.items as highlight (highlight.id)}
        <div class="annotation">
          <button
            type="button"
            class="min-w-0 flex-1 text-left"
            title={$t$('reader.goToHighlight')}
            on:click={() => dispatch('jump', highlight)}
          >
            <span
              class="annotation-text"
              style:border-color="var(--highlight-{highlight.color})"
              lang="ja">{highlight.text}</span
            >
            {#if highlight.note}
              <span class="annotation-note">{highlight.note}</span>
            {/if}
          </button>
          <button
            type="button"
            class="app-button-quiet self-start"
            on:click={() => dispatch('edit', highlight)}
          >
            {$t$('reader.edit')}
          </button>
        </div>
      {/each}
    {/each}
  </div>
</div>

<style>
  .ann-tools {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 1rem;
    margin: 0 1rem;
    padding: 0.75rem 0;
    border-bottom: 2px solid var(--reader-panel-fg);
  }

  .ann-count,
  .ann-empty,
  .ann-chapter {
    color: color-mix(in srgb, var(--reader-panel-fg) 68%, transparent);
    font-size: var(--type-small);
  }

  .ann-count {
    font-variant-numeric: tabular-nums;
  }

  .ann-list {
    min-height: 0;
    flex: 1;
    overflow-y: auto;
    padding: 0 1rem 1rem;
  }

  .ann-empty {
    padding: 1.5rem 0;
  }

  .ann-chapter {
    margin: 0;
    padding: 1rem 0 0.4rem;
    font-weight: 700;
  }

  .annotation {
    display: flex;
    gap: 0.75rem;
    padding: 0.75rem 0;
    border-bottom: 1px solid color-mix(in srgb, var(--reader-panel-fg) 16%, transparent);
  }

  .annotation:hover {
    background: color-mix(in srgb, var(--reader-panel-fg) 4%, transparent);
  }

  /* The bar carries the highlight's colour, so it says which one this is. */
  .annotation-text {
    display: -webkit-box;
    overflow: hidden;
    padding-left: 0.75rem;
    border-left: 3px solid;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 4;
    line-clamp: 4;
  }

  .annotation-note {
    display: block;
    margin-top: 0.3rem;
    padding-left: calc(0.75rem + 3px);
    color: var(--accent-strong-color);
    font-size: var(--type-small);
    white-space: pre-wrap;
  }

  @media (min-width: 768px) {
    .ann-tools {
      margin: 0 1.5rem;
    }

    .ann-list {
      padding: 0 1.5rem 1.5rem;
    }
  }
</style>
