<script lang="ts">
  import type { BookCardProps } from '$lib/components/book-card/book-card-props';
  import CoverCard from '$lib/components/library/cover-card.svelte';
  import SectionHead from '$lib/components/section-head.svelte';
  import { levelTier } from '$lib/data/difficulty/difficulty';
  import { relativeLevel } from '$lib/data/difficulty/difficulty-core';
  import { standalone } from '$lib/data/env';
  import { t$ } from '$lib/i18n';
  import { createEventDispatcher } from 'svelte';

  /** Home → Read next: a few books at the reader's level, with why and a Read button. */
  export let books: BookCardProps[];
  export let number: number;
  /** Calibre id → share of the book's words known (known-words.ts) */
  export let coverage: Record<number, number>;
  export let reason: string;
  export let currentBookId: number | undefined;
  export let selectedBookIds: ReadonlySet<number> | undefined = undefined;

  const dispatch = createEventDispatcher<{
    bookClick: { id: number };
    bookRead: { id: number };
    bookSelect: { id: number };
  }>();

  const share = (book: BookCardProps) =>
    book.calibreId === undefined ? undefined : coverage[book.calibreId];
</script>

{#if books.length}
  <section class="read-next" aria-label={$t$('home.readNext')}>
    <SectionHead
      {number}
      title={$t$('home.readNext')}
      count={$t$(standalone ? 'home.nextInSeries' : 'home.atYourLevel')}
    />
    <div class="read-next-body">
      <div class="read-next-books">
        {#each books as book (book.id)}
          {@const known = share(book)}
          <CoverCard
            {book}
            rowOnPhone
            meta={book.difficulty === undefined
              ? ''
              : $t$('home.difficultyScore', {
                  tier: levelTier(book.difficulty),
                  score: book.difficulty.toFixed(1)
                })}
            current={book.id === currentBookId}
            selected={selectedBookIds ? selectedBookIds.has(book.id) : undefined}
            on:open={() => dispatch('bookClick', { id: book.id })}
            on:select={() => dispatch('bookSelect', { id: book.id })}
          >
            <span slot="info" class="read-next-known">
              {#if known !== undefined}
                <span class="read-next-meter" aria-hidden="true"
                  ><span style:width="{Math.floor(known * 100)}%" /></span
                >
                {$t$('home.wordsKnownForYou', {
                  percent: (Math.floor(known * 1000) / 10).toFixed(1),
                  level: relativeLevel(known).toFixed(1)
                })}
              {/if}
            </span>
          </CoverCard>
        {/each}
      </div>
      <div class="read-next-reason">
        <p>{reason}</p>
        <button
          type="button"
          class="app-button app-button-primary"
          on:click={() => dispatch('bookRead', { id: books[0].id })}
        >
          <span class="read-next-button-label" lang="ja"
            >{$t$('home.readBook', { title: books[0].displayTitle || books[0].title })}</span
          >
        </button>
      </div>
    </div>
  </section>
{/if}

<style>
  .read-next {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 1.5rem;
  }

  .read-next-body {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: 2rem;
  }

  .read-next-books {
    display: grid;
    grid-auto-columns: 8.75rem;
    grid-auto-flow: column;
    gap: 2rem;
  }

  .read-next-known {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    /* At the bottom, so the bars line up when a title wraps */
    margin-top: auto;
    padding-top: 0.4rem;
    color: var(--app-muted-fg);
    font-size: var(--type-label);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .read-next-meter {
    display: block;
    height: 3px;
    background: var(--app-progress-track);
  }

  .read-next-meter > span {
    display: block;
    height: 100%;
    background: var(--font-color);
  }

  .read-next-reason {
    display: flex;
    max-width: 13rem;
    flex-direction: column;
    align-items: flex-start;
    gap: 1rem;
    color: var(--app-muted-fg);
    font-size: var(--type-body);
    line-height: 1.6;
  }

  .read-next-button-label {
    overflow: hidden;
    max-width: 11rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  @media (max-width: 639px) {
    .read-next-books {
      width: 100%;
      grid-auto-columns: auto;
      grid-auto-flow: row;
      gap: 1.25rem;
    }

    .read-next-reason {
      max-width: none;
    }
  }
</style>
