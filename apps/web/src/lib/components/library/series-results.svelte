<script lang="ts">
  import { faCheck, faPlus } from '@fortawesome/free-solid-svg-icons';
  import BookCard from '$lib/components/book-card/book-card.svelte';
  import { addToHome, homeBookTitles$, type SeriesMatch } from '$lib/data/library/library-home';
  import { createEventDispatcher } from 'svelte';
  import Fa from 'svelte-fa';

  /** Store search: whole series matching the search, each addable to Home at once. Not part of upstream. */
  export let matches: SeriesMatch[];

  const dispatch = createEventDispatcher<{ showSeries: string }>();

  $: home = new Set($homeBookTitles$);
</script>

{#if matches.length}
  <section class="series" aria-label="Matching series">
    <h2 class="series-heading">Series</h2>
    {#each matches as match (match.series)}
      {@const missing = match.books.filter((book) => !home.has(book.title))}
      <div class="series-row">
        <span class="series-covers">
          {#each match.books.slice(0, 3) as book (book.id)}
            <span class="series-cover"
              ><BookCard imagePath={book.imagePath} title={book.title} /></span
            >
          {/each}
        </span>
        <button
          class="series-name"
          title="Show this series"
          on:click={() => dispatch('showSeries', match.series)}
        >
          <span class="block truncate font-bold">{match.series}</span>
          <span class="series-meta">
            {match.books.length} books{#if match.books[0].authors}&nbsp;· {match.books[0]
                .authors}{/if}
          </span>
        </button>
        <button
          class="app-button series-add"
          disabled={!missing.length}
          title={missing.length ? 'Add every book of the series to Home' : 'All on Home'}
          on:click={() => addToHome(missing.map((book) => book.title))}
        >
          <Fa icon={missing.length ? faPlus : faCheck} />
          <span class="hidden sm:inline"
            >{missing.length ? `Add all ${missing.length}` : 'On Home'}</span
          >
        </button>
      </div>
    {/each}
  </section>
{/if}

<style>
  .series {
    margin-bottom: 1.5rem;
    border-top: 2px solid var(--font-color);
  }

  .series-heading {
    padding: 0.6rem 0 0.3rem;
    color: var(--app-muted-fg);
    font-size: var(--type-label);
    font-weight: 700;
  }

  .series-row {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    padding: 0.5rem 0;
    border-bottom: 1px solid var(--border-color);
  }

  .series-covers {
    display: flex;
    flex-shrink: 0;
  }

  .series-cover {
    width: 2.2rem;
    overflow: hidden;
    border: 1px solid var(--border-color);
  }

  .series-cover + .series-cover {
    margin-left: -1rem;
  }

  .series-name {
    min-width: 0;
    flex: 1;
    text-align: left;
  }

  .series-meta {
    display: block;
    overflow: hidden;
    color: var(--app-muted-fg);
    font-size: var(--type-small);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .series-add {
    flex-shrink: 0;
  }
</style>
