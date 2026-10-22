<script lang="ts">
  import type { BookCardProps } from '$lib/components/book-card/book-card-props';
  import CoverCard from '$lib/components/book-card/cover-card.svelte';
  import { isReading } from '$lib/components/book-card/library-filters';
  import SectionHead from '$lib/components/section-head.svelte';
  import { t$ } from '$lib/i18n';
  import { createEventDispatcher } from 'svelte';

  /** A numbered shelf of covers: Home's Continue reading and My books, a book page's series. */
  export let books: BookCardProps[];
  export let number: number;
  export let heading: string;
  export let currentBookId: number | undefined;
  export let removeTitle = '';
  /** Set while the library is in select mode: clicks then toggle these */
  export let selectedBookIds: ReadonlySet<number> | undefined = undefined;

  const dispatch = createEventDispatcher<{
    /** Cover click: the book's page, or toggling it in select mode */
    bookClick: { id: number };
    /** The Resume button */
    bookRead: { id: number };
    /** Long press: select the book */
    bookSelect: { id: number };
    remove: BookCardProps;
  }>();

  /** "Vol. 2 · 24%": the volume (or the author outside a series) and the progress */
  function meta(book: BookCardProps, t: typeof $t$) {
    const parts = [
      book.series && book.seriesIndex !== null && book.seriesIndex !== undefined
        ? t('book.vol', { index: book.seriesIndex })
        : book.series || (book.authors !== 'Unknown' ? book.authors : ''),
      isReading(book) ? `${Math.round(book.progress * 100)}%` : ''
    ];

    return parts.filter(Boolean).join(' · ');
  }
</script>

{#if books.length}
  <section class="shelf" aria-label={heading}>
    <SectionHead {number} title={heading} count={books.length} />
    <div class="shelf-row">
      {#each books as book (book.id)}
        <CoverCard
          {book}
          meta={meta(book, $t$)}
          current={book.id === currentBookId}
          selected={selectedBookIds ? selectedBookIds.has(book.id) : undefined}
          {removeTitle}
          on:open={() => dispatch('bookClick', { id: book.id })}
          on:select={() => dispatch('bookSelect', { id: book.id })}
          on:remove={() => dispatch('remove', book)}
        >
          {#if isReading(book)}
            <button
              type="button"
              class="app-button app-button-primary shelf-resume"
              aria-label={$t$('home.resumeBook', { title: book.title })}
              on:click={() => dispatch('bookRead', { id: book.id })}
            >
              {$t$('home.resume')}
            </button>
          {/if}
        </CoverCard>
      {/each}
    </div>
  </section>
{/if}

<style>
  .shelf {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 1.5rem;
  }

  .shelf-row {
    display: grid;
    grid-auto-columns: var(--shelf-cover-width, 8.75rem);
    grid-auto-flow: column;
    gap: 2rem;
    overflow-x: auto;
    /* Room for focus rings */
    padding: 4px 4px 0.5rem;
    margin: -4px;
    scroll-snap-type: x proximity;
  }

  .shelf-row > :global(*) {
    scroll-snap-align: start;
  }

  .shelf-resume {
    width: 100%;
  }

  @media (max-width: 639px) {
    .shelf-row {
      gap: 1.5rem;
    }
  }
</style>
