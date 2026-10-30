<script lang="ts">
  import { faChevronDown, faXmark } from '@fortawesome/free-solid-svg-icons';
  import type { BookCardProps } from '$lib/components/book-card/book-card-props';
  import {
    allBooksFilter,
    countBookCards,
    libraryFilterLabel,
    libraryFilterSections
  } from '$lib/data/library/library-filters';
  import { libraryCollapsedFilterSections$ } from '$lib/data/store';
  import { t$ } from '$lib/i18n';
  import Fa from 'svelte-fa';

  export let bookCards: BookCardProps[] = [];
  export let loading = false;
  export let activeFilter = allBooksFilter.key;
  export let searchTerm = '';

  let mobileOpen = false;

  $: counts = countBookCards(bookCards);
  $: activeFilterLabel = libraryFilterLabel(activeFilter, $t$);

  function toggleSection(sectionKey: string) {
    const collapsed = new Set($libraryCollapsedFilterSections$);

    if (collapsed.has(sectionKey)) {
      collapsed.delete(sectionKey);
    } else {
      collapsed.add(sectionKey);
    }

    $libraryCollapsedFilterSections$ = [...collapsed];
  }

  function selectFilter(filterKey: string) {
    activeFilter = filterKey;
    mobileOpen = false;
  }
</script>

<aside class="library-sidebar" aria-label={$t$('library.filters')}>
  {#if !loading}
    <div class="library-sidebar-search">
      <label class="library-filter-search">
        <input
          type="search"
          class="library-filter-search-input"
          placeholder={$t$('library.searchPlaceholder')}
          autocomplete="off"
          bind:value={searchTerm}
        />
        {#if searchTerm}
          <button
            type="button"
            class="library-filter-search-clear"
            title={$t$('library.clearSearch')}
            on:click={() => (searchTerm = '')}
          >
            <Fa icon={faXmark} />
          </button>
        {/if}
      </label>
    </div>
  {:else}
    <div class="library-sidebar-search">
      <div class="library-filter-search"><span class="app-skeleton h-3 w-2/3" /></div>
    </div>
  {/if}
  <button
    type="button"
    class="library-sidebar-toggle"
    title={activeFilterLabel}
    aria-expanded={mobileOpen}
    on:click={() => (mobileOpen = !mobileOpen)}
  >
    {$t$('library.filtersButton')}
    {#if activeFilter !== allBooksFilter.key}<span class="library-sidebar-toggle-count">1</span
      >{/if}
  </button>
  {#if mobileOpen}
    <button
      type="button"
      class="library-sheet-scrim"
      aria-label={$t$('library.close')}
      on:click={() => (mobileOpen = false)}
    />
  {/if}

  <div class="library-sidebar-content" class:library-sidebar-content-open={mobileOpen}>
    <div class="library-sheet-head">
      <h2>{$t$('library.filtersButton')}</h2>
      <button
        type="button"
        class="library-filter-search-clear"
        aria-label={$t$('library.close')}
        on:click={() => (mobileOpen = false)}
      >
        <Fa icon={faXmark} />
      </button>
    </div>
    {#if loading}
      {#each [3, 4, 3] as rows}
        <div class="mt-4 flex flex-col gap-3 px-3">
          <div class="flex items-center justify-between">
            <span class="app-skeleton h-3 w-1/3" />
            <span class="app-skeleton h-5 w-5" />
          </div>
          {#each { length: rows } as _}
            <span class="app-skeleton ml-5 h-3 w-1/2" />
          {/each}
        </div>
      {/each}
    {:else}
      <button
        type="button"
        class="library-filter-row library-filter-all"
        class:library-filter-row-active={activeFilter === allBooksFilter.key}
        aria-pressed={activeFilter === allBooksFilter.key}
        on:click={() => selectFilter(allBooksFilter.key)}
      >
        <span
          ><span class="library-filter-mark" aria-hidden="true" />{$t$(allBooksFilter.label)}</span
        >
        <span class="library-filter-count">{counts.get(allBooksFilter.key) ?? 0}</span>
      </button>

      {#each libraryFilterSections as section (section.key)}
        {@const expanded = !$libraryCollapsedFilterSections$.includes(section.key)}
        <section
          class="library-filter-section"
          class:library-filter-section-active={section.filters.some(
            (filter) => filter.key === activeFilter
          )}
        >
          <button
            type="button"
            class="library-filter-section-toggle"
            aria-expanded={expanded}
            on:click={() => toggleSection(section.key)}
          >
            <span>{$t$(section.label)}</span>
            <!-- No group count: Last read's buckets overlap, so a sum would mislead -->
            <span class="library-filter-chevron" class:library-filter-chevron-expanded={expanded}>
              <Fa icon={faChevronDown} />
            </span>
          </button>
          {#if expanded}
            <div class="library-filter-list">
              {#each section.filters as filter (filter.key)}
                <button
                  type="button"
                  class="library-filter-row"
                  class:library-filter-row-active={activeFilter === filter.key}
                  aria-pressed={activeFilter === filter.key}
                  on:click={() => selectFilter(filter.key)}
                >
                  <span
                    ><span class="library-filter-mark" aria-hidden="true" />{$t$(
                      filter.label
                    )}</span
                  >
                  <span class="library-filter-count">{counts.get(filter.key) ?? 0}</span>
                </button>
              {/each}
            </div>
          {/if}
        </section>
      {/each}
    {/if}
  </div>
</aside>

<style>
  /* Study Book filters: ruled groups (2px ink rule, 1px rows), a square mark on the chosen one */
  .library-sidebar {
    position: fixed;
    top: calc(var(--library-header-height) - 1px);
    left: 0;
    z-index: 11;
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    width: var(--library-sidebar-width);
    height: calc(100dvh - var(--library-header-height) + 1px);
    background: var(--background-color);
    color: var(--font-color);
  }

  .library-sidebar-toggle,
  .library-sheet-head,
  .library-sheet-scrim {
    display: none;
  }

  .library-sidebar-search {
    padding: 1.75rem 1.25rem 0 2.5rem;
  }

  .library-sidebar-content {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    min-height: 0;
    padding: 0 1.25rem 2rem 2.5rem;
    overflow-y: auto;
  }

  .library-filter-search {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.5rem;
    min-height: var(--app-control-height);
    padding: 0 0.4rem 0 0.75rem;
    border: 1px solid var(--app-control-border);
    border-radius: 2px;
    background: var(--app-control-bg);
    color: var(--app-muted-fg);
  }

  .library-filter-search:focus-within {
    border-color: var(--app-focus-ring);
    outline: 2px solid var(--app-focus-ring);
    outline-offset: 2px;
    color: var(--font-color);
  }

  .library-filter-search-input {
    width: 100%;
    min-width: 0;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--font-color);
    font-size: var(--type-body);
    outline: none;
    appearance: none;
  }

  .library-filter-search-input:focus {
    box-shadow: none;
  }

  .library-filter-search-input::placeholder {
    color: var(--app-text-subtle);
    opacity: 1;
  }

  .library-filter-search-input::-webkit-search-cancel-button {
    appearance: none;
  }

  .library-filter-search-clear {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.75rem;
    height: 1.75rem;
    border-radius: 2px;
  }

  .library-filter-search-clear:hover {
    background: var(--surface-color);
  }

  .library-filter-all {
    margin-top: 1.25rem;
    border-top: 2px solid var(--font-color);
  }

  .library-filter-section {
    display: flex;
    flex-direction: column;
    margin-top: 1.5rem;
    border-top: 2px solid var(--font-color);
  }

  .library-filter-section-toggle,
  .library-filter-row {
    display: flex;
    width: 100%;
    min-width: 0;
    align-items: center;
    justify-content: space-between;
    gap: 0.55rem;
    text-align: left;
  }

  .library-filter-section-toggle > span:first-child,
  .library-filter-row > span:first-child {
    display: flex;
    min-width: 0;
    align-items: center;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .library-filter-section-toggle {
    min-height: 2.25rem;
    color: var(--font-color);
    font-size: var(--type-small);
    font-weight: 700;
  }

  .library-filter-row {
    min-height: 2.25rem;
    border-bottom: 1px solid var(--border-color);
    color: var(--font-color);
    font-size: var(--type-body);
  }

  .library-filter-mark {
    flex: none;
    width: 0.875rem;
    height: 0.875rem;
    margin-right: 0.65rem;
    border: 1px solid var(--app-control-border);
    border-radius: 2px;
  }

  .library-filter-row:hover .library-filter-mark {
    border-color: var(--font-color);
  }

  .library-filter-row-active {
    font-weight: 700;
  }

  .library-filter-row-active .library-filter-mark,
  .library-filter-row-active:hover .library-filter-mark {
    border-color: var(--accent-color);
    padding: 2px;
    background: var(--accent-color) content-box;
  }

  .library-filter-section-toggle:focus-visible,
  .library-filter-row:focus-visible {
    outline: 2px solid var(--app-focus-ring);
    outline-offset: 2px;
  }

  .library-filter-list {
    display: flex;
    flex-direction: column;
  }

  .library-filter-list .library-filter-row:first-child {
    border-top: 1px solid var(--border-color);
  }

  .library-filter-count {
    display: inline-flex;
    flex: 0 0 auto;
    align-items: center;
    justify-content: center;
    color: var(--app-muted-fg);
    font-size: var(--type-small);
    font-variant-numeric: tabular-nums;
    font-weight: 400;
  }

  .library-filter-chevron {
    display: inline-flex;
    font-size: 0.7rem;
    transition: transform 0.18s ease;
  }

  .library-filter-chevron-expanded {
    transform: rotate(180deg);
  }

  @media (max-width: 900px) {
    .library-sidebar {
      position: relative;
      top: auto;
      /* No stacking context: the filter sheet goes above the tab bar */
      z-index: auto;
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 0.75rem;
      width: auto;
      height: auto;
      background: transparent;
    }

    .library-sidebar-search {
      padding: 0;
    }

    .library-sidebar-toggle {
      display: inline-flex;
      min-height: 2.75rem;
      align-items: center;
      gap: 0.6rem;
      padding: 0 1rem;
      border: 1px solid var(--font-color);
      border-radius: 2px;
      background: transparent;
      font-size: var(--type-button);
      font-weight: 700;
    }

    .library-sidebar-toggle-count {
      padding: 0 0.4rem;
      border-radius: 2px;
      background: var(--accent-color);
      color: var(--app-accent-fg);
      font-size: var(--type-label);
      font-variant-numeric: tabular-nums;
    }

    .library-filter-search {
      min-height: 2.75rem;
    }

    .library-sidebar-content {
      display: none;
    }

    /* Filters as a bottom sheet over a scrim */
    .library-sheet-scrim {
      position: fixed;
      inset: 0;
      z-index: 48;
      display: block;
      background: var(--app-overlay-color);
    }

    .library-sidebar-content-open {
      position: fixed;
      inset: auto 0 0;
      z-index: 49;
      display: flex;
      max-height: 85dvh;
      padding: 0.5rem 1rem calc(1.5rem + env(safe-area-inset-bottom));
      border-top: 2px solid var(--font-color);
      background: var(--background-color);
    }

    .library-sheet-head {
      display: flex;
      min-height: 3rem;
      align-items: center;
      justify-content: space-between;
    }

    .library-sheet-head h2 {
      font-size: var(--type-h2);
      font-weight: 700;
    }

    .library-sheet-head .library-filter-search-clear {
      width: 2.75rem;
      height: 2.75rem;
    }

    .library-filter-row,
    .library-filter-section-toggle {
      min-height: 2.75rem;
    }
  }
</style>
