<script lang="ts">
  import { faCheck, faPlus } from '@fortawesome/free-solid-svg-icons';
  import BookCard from '$lib/components/book-card/book-card.svelte';
  import { addToHome, homeBookTitles$, type SeriesGroup } from '$lib/data/library/library-home';
  import { createEventDispatcher } from 'svelte';
  import Fa from 'svelte-fa';

  /** Store → Series: one card per series, shown with its first book's cover. Not part of upstream. */
  export let groups: SeriesGroup[];

  const dispatch = createEventDispatcher<{ showSeries: string }>();
  const step = 120;

  let limit = step;

  $: home = new Set($homeBookTitles$);
  $: (groups, (limit = step));
</script>

{#if !groups.length}
  <p class="series-empty">No series match.</p>
{/if}
<div class="series-grid">
  {#each groups.slice(0, limit) as group (group.series)}
    {@const missing = group.books.filter((book) => !home.has(book.title))}
    <div class="series-card">
      <button
        type="button"
        class="series-open"
        title="Show the books of {group.series}"
        on:click={() => dispatch('showSeries', group.series)}
      >
        <span class="series-cover">
          <BookCard imagePath={group.books[0].imagePath} title={group.books[0].title} />
          <span class="series-count">{group.books.length}</span>
        </span>
        <span class="series-track" aria-hidden="true"
          ><span style:width="{(group.started / group.books.length) * 100}%" /></span
        >
        <span class="series-name" lang="ja">{group.series}</span>
        <span class="series-meta">
          {group.started ? `${group.started} of ${group.books.length} started` : 'Not started'}
        </span>
      </button>
      <button
        type="button"
        class="series-add"
        disabled={!missing.length}
        title={missing.length ? 'Add every book of the series to Home' : 'All on Home'}
        aria-label={missing.length ? `Add ${group.series} to Home` : `${group.series} is on Home`}
        on:click={() => addToHome(missing.map((book) => book.title))}
      >
        <Fa icon={missing.length ? faPlus : faCheck} />
      </button>
    </div>
  {/each}
</div>
{#if groups.length > limit}
  <div class="flex justify-center py-4">
    <button type="button" class="app-button" on:click={() => (limit += step)}>
      Show more ({groups.length - limit} remaining)
    </button>
  </div>
{/if}

<style>
  /* Same columns as book-card-list.svelte */
  .series-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, 8.75rem);
    justify-content: space-between;
    align-items: start;
    gap: 2.5rem 1.5rem;
    padding: 6px 6px 1rem 0;
  }

  @media (max-width: 639px) {
    .series-grid {
      grid-template-columns: repeat(auto-fill, 6.5rem);
      gap: 1.75rem 0.75rem;
    }
  }

  .series-card {
    position: relative;
    min-width: 0;
  }

  .series-open {
    display: flex;
    width: 100%;
    flex-direction: column;
    border-radius: 2px;
    text-align: left;
  }

  .series-open:focus-visible {
    outline: 2px solid var(--app-focus-ring);
    outline-offset: 2px;
  }

  .series-cover {
    position: relative;
    display: block;
    isolation: isolate;
    border: 1px solid var(--border-color);
  }

  /* A second sheet behind the cover, drawn as a rule: it's a series */
  .series-cover::before {
    content: '';
    position: absolute;
    inset: -5px -5px 5px 5px;
    z-index: -1;
    border: 1px solid var(--border-color);
    background: var(--surface-color);
  }

  .series-count {
    position: absolute;
    right: 0;
    bottom: 0;
    padding: 0.1rem 0.45rem;
    background: var(--font-color);
    color: var(--background-color);
    font-size: var(--type-label);
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  .series-track {
    display: block;
    height: 3px;
    margin: 0.4rem 0 0.6rem;
    background: var(--app-progress-track);
  }

  .series-track > span {
    display: block;
    height: 100%;
    background: var(--app-progress-fill);
  }

  .series-name {
    display: -webkit-box;
    overflow: hidden;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    padding-block: 0.05em;
    font-size: var(--type-body);
    font-weight: 700;
    line-height: 1.45;
  }

  .series-meta,
  .series-empty {
    margin-top: 0.2rem;
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }

  .series-empty {
    padding: 2rem 0;
  }

  .series-add {
    position: absolute;
    top: 0.35rem;
    left: 0.35rem;
    display: inline-flex;
    width: 1.75rem;
    height: 1.75rem;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--font-color);
    border-radius: 2px;
    background: var(--background-color);
    color: var(--accent-strong-color);
    font-size: var(--type-label);
  }

  .series-add:disabled {
    border-color: var(--border-color);
    color: var(--app-muted-fg);
  }
</style>
