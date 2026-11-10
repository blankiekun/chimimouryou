<script lang="ts">
  /**
   * The manga reader's (/m) "Search text" sheet: the speech bubbles of this volume's mokuro text
   * that hold the query (searchMangaText), a row each, opening its page. Not part of upstream.
   */
  import { maxMangaSearchResults, searchMangaText, type MokuroPage } from '$lib/data/manga/mokuro';

  interface Props {
    pages: (MokuroPage | undefined)[];
    onjump: (page: number) => void;
  }

  let { pages, onjump }: Props = $props();
  let query = $state('');
  let input: HTMLInputElement | undefined = $state();

  const results = $derived(searchMangaText(pages, query));
  const count = $derived(
    !query.trim()
      ? ''
      : !results.length
        ? 'No matches'
        : `${results.length} matches${results.length === maxMangaSearchResults ? `, first ${maxMangaSearchResults}` : ''}`
  );

  $effect(() => input?.focus());
</script>

<label class="search-field">
  <span class="sr-only">Search this volume's text</span>
  <input
    bind:this={input}
    bind:value={query}
    type="search"
    lang="ja"
    placeholder="Search this volume's text"
    class="min-w-0 flex-1 border-0 bg-transparent p-0 focus:ring-0"
  />
</label>
<p class="search-count" aria-live="polite">{count}</p>
{#if results.length}
  <ul class="search-list">
    {#each results as result, index (index)}
      <li>
        <button type="button" class="search-result" onclick={() => onjump(result.page)}>
          <span class="search-page">p. {result.page + 1}</span>
          <span class="search-text" lang="ja">{result.text}</span>
        </button>
      </li>
    {/each}
  </ul>
{/if}

<style>
  .search-field {
    display: flex;
    min-height: 2.75rem;
    align-items: center;
    padding: 0 0.75rem;
    border: 1px solid var(--reader-panel-fg);
    border-radius: 2px;
  }

  .search-field:focus-within {
    outline: 2px solid var(--app-focus-ring);
    outline-offset: 2px;
  }

  .search-count {
    min-height: 1.5em;
    margin: 0.5rem 0;
    color: color-mix(in srgb, var(--reader-panel-fg) 68%, transparent);
    font-size: var(--type-small);
    font-variant-numeric: tabular-nums;
  }

  .search-list {
    max-height: 50vh;
    margin: 0;
    padding: 0;
    overflow-y: auto;
    border-top: 2px solid var(--reader-panel-fg);
    list-style: none;
  }

  .search-result {
    display: flex;
    width: 100%;
    min-height: 2.75rem;
    align-items: center;
    gap: 0.75rem;
    border-bottom: 1px solid color-mix(in srgb, var(--reader-panel-fg) 16%, transparent);
    text-align: left;
  }

  .search-result:hover {
    background: color-mix(in srgb, var(--reader-panel-fg) 5%, transparent);
  }

  .search-page {
    flex: none;
    color: color-mix(in srgb, var(--reader-panel-fg) 68%, transparent);
    font-size: var(--type-small);
    font-variant-numeric: tabular-nums;
  }

  .search-text {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
