<script lang="ts">
  import type { BookCardProps } from '$lib/components/book-card/book-card-props';
  import CoverCard from '$lib/components/library/cover-card.svelte';
  import { levelTier } from '$lib/data/difficulty/difficulty';
  import { t$ } from '$lib/i18n';
  import { createEventDispatcher } from 'svelte';

  export let bookCards: BookCardProps[] = [];
  export let currentBookId: number | undefined;
  export let selectedBookIds: ReadonlySet<number>;
  export let selectMode = false;
  export let compact = false;

  const dispatch = createEventDispatcher<{
    bookClick: {
      id: number;
    };
    /** Long press: select the book */
    bookSelect: { id: number };
    removeBookClick: {
      id: number;
    };
  }>();

  /** Author (Calibre's placeholder author is noise) and the 1-10 level or kind */
  function meta(book: BookCardProps, t: typeof $t$) {
    return [
      book.authors !== 'Unknown' ? book.authors : '',
      book.difficulty !== undefined
        ? `${book.difficulty.toFixed(1)} ${levelTier(book.difficulty)}`
        : book.manga
          ? t('library.manga')
          : book.vn
            ? 'VN'
            : ''
    ]
      .filter(Boolean)
      .join(' · ');
  }
</script>

<div class="library-grid" class:library-grid-compact={compact}>
  {#each bookCards as bookCard (bookCard.id)}
    <CoverCard
      book={bookCard}
      legacy="library-card"
      meta={meta(bookCard, $t$)}
      {compact}
      current={bookCard.id === currentBookId}
      selected={selectMode ? selectedBookIds.has(bookCard.id) : undefined}
      removeTitle="Delete book"
      on:open={() => dispatch('bookClick', { id: bookCard.id })}
      on:select={() => dispatch('bookSelect', { id: bookCard.id })}
      on:remove={() => dispatch('removeBookClick', { id: bookCard.id })}
    />
  {/each}
</div>

<style>
  /* One cover size on every row: fixed columns, the gaps take the rest */
  .library-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, 8.75rem);
    justify-content: space-between;
    align-items: start;
    gap: 2.5rem 1.5rem;
    padding-bottom: 1rem;
  }

  .library-grid-compact {
    grid-template-columns: repeat(auto-fill, 6.25rem);
    gap: 1.5rem 1rem;
  }

  @media (max-width: 639px) {
    .library-grid {
      grid-template-columns: repeat(auto-fill, 6.5rem);
      gap: 1.75rem 0.75rem;
    }

    .library-grid-compact {
      grid-template-columns: repeat(auto-fill, 4.75rem);
    }
  }
</style>
