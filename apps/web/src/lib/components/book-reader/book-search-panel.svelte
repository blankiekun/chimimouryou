<script lang="ts">
  import { faMagnifyingGlass, faSpinner } from '@fortawesome/free-solid-svg-icons';
  import type { Section } from '$lib/data/database/books-db/versions/v3/books-db-v3';
  import {
    maxSearchResults,
    searchBook,
    type SearchIndex,
    type SearchResult
  } from '$lib/functions/book-text/book-search';
  import { createEventDispatcher, onMount, tick } from 'svelte';
  import { t$, tr } from '$lib/i18n';
  import Fa from 'svelte-fa';

  export let getIndex: () => Promise<SearchIndex>;
  export let sections: Section[];
  export let query = '';
  export let ignoreKana = true;
  export let regex = false;
  export let activeIndex = -1;
  export let results: SearchResult[] = [];

  const dispatch = createEventDispatcher<{ close: void; jump: SearchResult }>();
  const renderStep = 100;

  let index: SearchIndex | undefined;
  let error = '';
  let inputElm: HTMLInputElement;
  let listElm: HTMLElement;
  let renderLimit = renderStep;
  let debounce: ReturnType<typeof setTimeout>;

  /** The panel's Search tab is the one shown */
  export let active = true;

  $: if (active && inputElm) {
    inputElm.focus();
    inputElm.select();
  }

  onMount(async () => {
    index = await getIndex();
    if (query && !results.length) {
      run();
    }
  });

  $: (query, ignoreKana, regex, schedule());

  function schedule() {
    clearTimeout(debounce);
    debounce = setTimeout(run, 250);
  }

  function run() {
    if (!index) {
      return;
    }

    try {
      results = searchBook(index, query, { ignoreKana, regex }, sections);
      error = '';
    } catch (e: any) {
      results = [];
      error =
        e instanceof SyntaxError ? tr('reader.invalidRegex', { error: e.message }) : e.message;
    }

    activeIndex = -1;
    renderLimit = renderStep;
  }

  async function go(offset: number) {
    if (!results.length) {
      return;
    }

    activeIndex = (activeIndex + offset + results.length) % results.length;
    renderLimit = Math.max(renderLimit, activeIndex + 1);
    dispatch('jump', results[activeIndex]);

    await tick();
    listElm?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      event.preventDefault();
      go(event.shiftKey ? -1 : 1);
    } else if (event.key === 'Escape') {
      dispatch('close');
    }
  }
</script>

<section class="flex min-h-0 flex-1 flex-col" aria-label={$t$('reader.search')}>
  <div class="px-4 pt-4 md:px-6">
    <label class="search-field">
      <Fa icon={faMagnifyingGlass} class="search-icon" />
      <input
        class="min-w-0 flex-1 border-0 bg-transparent p-0 focus:ring-0"
        type="search"
        placeholder={$t$('reader.searchPlaceholder')}
        lang="ja"
        bind:this={inputElm}
        bind:value={query}
        on:keydown={onKeydown}
      />
    </label>
  </div>

  <div class="search-options flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 md:px-6">
    <label class="flex items-center gap-1.5">
      <input type="checkbox" bind:checked={ignoreKana} />
      {$t$('reader.matchKana')}
    </label>
    <label class="flex items-center gap-1.5">
      <input type="checkbox" bind:checked={regex} />
      {$t$('reader.regex')}
    </label>
    <span class="search-count ml-auto flex items-center gap-1">
      {#if !index}
        <Fa icon={faSpinner} spin /> {$t$('reader.indexing')}
      {:else if query.trim() && !error}
        {$t$(activeIndex >= 0 ? 'reader.resultsAt' : 'reader.results', {
          index: activeIndex + 1,
          count: `${results.length}${results.length >= maxSearchResults ? '+' : ''}`
        })}
      {/if}
    </span>
  </div>

  {#if error}
    <p class="px-4 pb-2 text-xs text-panel-danger md:px-6">{error}</p>
  {/if}

  <ol class="search-list mx-4 flex-1 overflow-y-auto pb-3 md:mx-6" bind:this={listElm}>
    {#each results.slice(0, renderLimit) as result, i (i)}
      <li>
        <button
          type="button"
          class="search-result w-full px-2 py-2.5 text-left"
          class:search-result-active={i === activeIndex}
          data-active={i === activeIndex}
          on:click={() => {
            activeIndex = i;
            dispatch('jump', result);
          }}
        >
          {#if result.chapter}
            <span class="search-chapter block truncate">{result.chapter}</span>
          {/if}
          <span class="block" lang="ja"
            >{result.before}<mark class="search-mark">{result.match}</mark>{result.after}</span
          >
        </button>
      </li>
    {/each}
    {#if results.length > renderLimit}
      <li class="pt-2">
        <button class="app-button-quiet text-sm" on:click={() => (renderLimit += renderStep)}>
          {$t$('reader.showMore', { count: results.length - renderLimit })}
        </button>
      </li>
    {/if}
  </ol>

  {#if results.length}
    <footer class="search-footer flex justify-end gap-2 px-4 py-2 md:px-6">
      <button class="app-button" on:click={() => go(-1)}>
        {$t$('reader.previous')}
      </button>
      <button class="app-button" on:click={() => go(1)}>
        {$t$('reader.next')}
      </button>
    </footer>
  {/if}
</section>

<style>
  .search-field {
    display: flex;
    min-height: 2.75rem;
    align-items: center;
    gap: 0.6rem;
    padding: 0 0.75rem;
    border: 1px solid var(--reader-panel-fg);
    border-radius: 2px;
  }

  .search-field:focus-within {
    outline: 2px solid var(--app-focus-ring);
    outline-offset: 2px;
  }

  .search-field :global(.search-icon) {
    opacity: 0.6;
  }

  .search-options,
  .search-chapter {
    color: color-mix(in srgb, var(--reader-panel-fg) 68%, transparent);
    font-size: var(--type-small);
  }

  .search-count {
    font-variant-numeric: tabular-nums;
  }

  .search-list {
    border-top: 2px solid var(--reader-panel-fg);
  }

  .search-result {
    border-bottom: 1px solid color-mix(in srgb, var(--reader-panel-fg) 16%, transparent);
  }

  .search-result:hover {
    background: color-mix(in srgb, var(--reader-panel-fg) 5%, transparent);
  }

  .search-result-active,
  .search-result-active:hover {
    background: var(--app-spot-tint);
  }

  .search-result-active .search-chapter {
    color: var(--accent-strong-color);
    font-weight: 700;
  }

  .search-mark {
    background: transparent;
    color: var(--accent-strong-color);
    font-weight: 700;
  }

  .search-footer {
    border-top: 1px solid color-mix(in srgb, var(--reader-panel-fg) 16%, transparent);
  }
</style>
