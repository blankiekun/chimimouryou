<script lang="ts">
  import LibrarySortMenu from '$lib/components/book-card/library-sort-menu.svelte';
  import { t$ } from '$lib/i18n';

  /**
   * The Store's bar over the books (routes/manage): Books | Series, the number of titles shown,
   * Select and the sort menu.
   */

  interface Props {
    activeFilter: string;
    showSeriesGrid: boolean;
    loading: boolean;
    /** Books in the library, before filters */
    bookCount: number;
    /** Books the filters show */
    visibleCount: number;
    onview: (view: 'books' | 'series') => void;
    /** Select mode on */
    onselect: () => void;
  }

  let { activeFilter, showSeriesGrid, loading, bookCount, visibleCount, onview, onselect }: Props =
    $props();
</script>

<div class="store-bar">
  {#if activeFilter !== 'vn'}
    <div class="app-segmented" role="radiogroup" aria-label={$t$('store.view')}>
      <button
        type="button"
        role="radio"
        class="app-segment"
        class:app-segment-selected={!showSeriesGrid}
        aria-checked={!showSeriesGrid}
        onclick={() => onview('books')}
      >
        {$t$('store.books')}
      </button>
      <button
        type="button"
        role="radio"
        class="app-segment"
        class:app-segment-selected={showSeriesGrid}
        aria-checked={showSeriesGrid}
        onclick={() => onview('series')}
      >
        {$t$('store.series')}
      </button>
    </div>
  {/if}
  {#if !loading && bookCount}
    <span class="store-count">
      {$t$(visibleCount === 1 ? 'store.titlesOne' : 'store.titles', {
        count: visibleCount.toLocaleString('en-US')
      })}
    </span>
  {/if}
  {#if !showSeriesGrid}
    <span class="store-sort">
      <button
        type="button"
        class="app-button app-button-quiet"
        disabled={!bookCount}
        onclick={onselect}
      >
        {$t$('library.select')}
      </button>
      <LibrarySortMenu />
    </span>
  {/if}
</div>

<style>
  .store-bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.75rem 1.25rem;
    margin-bottom: 1.5rem;
  }

  .store-sort {
    display: flex;
    gap: 0.5rem;
    margin-left: auto;
  }

  .store-count {
    color: var(--app-muted-fg);
    font-size: var(--type-small);
    font-variant-numeric: tabular-nums;
  }
</style>
