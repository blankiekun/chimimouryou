<script lang="ts">
  import { faCheck, faXmark } from '@fortawesome/free-solid-svg-icons';
  import BookCard from '$lib/components/book-card/book-card.svelte';
  import type { BookCardProps } from '$lib/components/book-card/book-card-props';
  import { isFinished } from '$lib/components/book-card/library-filters';
  import { longPress } from '$lib/functions/use-long-press';
  import { createEventDispatcher } from 'svelte';
  import Fa from 'svelte-fa';

  /**
   * Study Book cover card, the same on every shelf and in the Store: a cover of one fixed size
   * (set by the parent's column), a 3px progress track under it, title and one line of meta.
   * `info` goes under the meta inside the card's button; the default slot after it (buttons).
   */
  export let book: BookCardProps;
  export let meta = '';
  /** Set in select mode: clicks then toggle the book */
  export let selected: boolean | undefined = undefined;
  export let current = false;
  /** Shows a remove button on the cover when not selecting */
  export let removeTitle = '';
  /** Touch screens (no hover) show the remove button too */
  export let removeOnTouch = true;
  /** Cover only, no text */
  export let compact = false;
  /** Phones: cover on the left, text on the right */
  export let rowOnPhone = false;
  /** Earlier class names (Store cards, Home shelves), kept for custom CSS and scripts */
  export let legacy: 'library-card' | 'shelf' = 'shelf';

  $: names =
    legacy === 'shelf'
      ? { root: 'shelf-item', main: 'shelf-book', title: 'shelf-title' }
      : { root: 'library-card', main: 'library-card-main', title: 'library-card-title' };

  const dispatch = createEventDispatcher<{ open: void; select: void; remove: void }>();

  $: percent = Math.round((book.progress || 0) * 100);
</script>

<div
  class="cover-card {names.root}"
  class:cover-card-current={current}
  class:cover-card-selected={selected}
  class:cover-card-placeholder={book.isPlaceholder}
  class:cover-card-row={rowOnPhone}
>
  <button
    type="button"
    class="cover-card-main {names.main}"
    title={book.title}
    aria-pressed={selected}
    on:click={() => dispatch('open')}
    use:longPress={() => dispatch('select')}
  >
    <span class="cover-card-cover">
      <BookCard imagePath={book.imagePath} title={book.title} />
      {#if isFinished(book)}
        <span class="cover-card-finished" title="Finished">読了</span>
      {/if}
    </span>
    <span class="cover-card-track" aria-hidden="true"><span style:width="{percent}%" /></span>
    {#if !compact}
      <span class="cover-card-text">
        <span class="cover-card-title {names.title}" lang="ja"
          >{book.displayTitle || book.title}</span
        >
        {#if meta}<span class="cover-card-meta" lang="ja">{meta}</span>{/if}
        <slot name="info" />
      </span>
    {/if}
  </button>
  <slot />

  {#if selected !== undefined}
    <span class="cover-card-check" class:cover-card-check-on={selected} aria-hidden="true"
      >{#if selected}<Fa icon={faCheck} />{/if}</span
    >
  {/if}
  {#if removeTitle && selected === undefined}
    <button
      type="button"
      class="cover-card-remove"
      class:cover-card-remove-touch={removeOnTouch}
      title={removeTitle}
      aria-label="{removeTitle}: {book.title}"
      on:click={() => dispatch('remove')}
    >
      <Fa icon={faXmark} />
    </button>
  {/if}
</div>

<style>
  .cover-card {
    position: relative;
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 0.75rem;
  }

  .cover-card-placeholder {
    opacity: 0.6;
  }

  .cover-card-main {
    /* No iOS image callout or text selection on a long press (it selects the book). */
    -webkit-touch-callout: none;
    user-select: none;
    display: flex;
    width: 100%;
    min-width: 0;
    flex-direction: column;
    border-radius: 2px;
    text-align: left;
  }

  .cover-card-main:focus-visible {
    outline: 2px solid var(--app-focus-ring);
    outline-offset: 2px;
  }

  .cover-card-cover {
    position: relative;
    display: block;
    overflow: hidden;
    border: 1px solid var(--border-color);
  }

  .cover-card-current .cover-card-cover,
  .cover-card-selected .cover-card-cover {
    outline: 2px solid var(--accent-color);
    outline-offset: 2px;
  }

  .cover-card-finished {
    position: absolute;
    right: 0;
    bottom: 0;
    padding: 0.15rem 0.35rem;
    background: var(--accent-color);
    color: var(--app-accent-fg);
    font-size: var(--type-label);
    font-weight: 700;
    line-height: 1.3;
  }

  .cover-card-track {
    display: block;
    height: 3px;
    margin-top: 0.4rem;
    background: var(--app-progress-track);
  }

  .cover-card-track > span {
    display: block;
    height: 100%;
    background: var(--app-progress-fill);
  }

  .cover-card-text {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 0.2rem;
    margin-top: 0.6rem;
  }

  .cover-card-title {
    display: -webkit-box;
    overflow: hidden;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    /* Room for CJK glyphs so the clamp never cuts them */
    padding-block: 0.05em;
    color: var(--font-color);
    font-size: var(--type-body);
    font-weight: 700;
    line-height: 1.45;
  }

  .cover-card-meta {
    overflow: hidden;
    color: var(--app-muted-fg);
    font-size: var(--type-small);
    font-variant-numeric: tabular-nums;
    line-height: 1.5;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .cover-card-check,
  .cover-card-remove {
    position: absolute;
    top: 0.35rem;
    display: inline-flex;
    width: 1.75rem;
    height: 1.75rem;
    align-items: center;
    justify-content: center;
    border-radius: 2px;
    font-size: var(--type-label);
  }

  .cover-card-check {
    left: 0.35rem;
    width: 1.25rem;
    height: 1.25rem;
    border: 1px solid var(--font-color);
    background: var(--background-color);
    pointer-events: none;
  }

  .cover-card-check-on {
    border-color: var(--accent-color);
    background: var(--accent-color);
    color: var(--app-accent-fg);
  }

  .cover-card-remove {
    right: 0.35rem;
    border: 1px solid var(--font-color);
    background: var(--background-color);
    color: var(--font-color);
    opacity: 0;
    transition: opacity 0.15s ease;
  }

  .cover-card:hover .cover-card-remove,
  .cover-card-remove:focus-visible {
    opacity: 1;
  }

  @media (hover: none) {
    .cover-card-remove {
      display: none;
    }

    .cover-card-remove-touch {
      display: inline-flex;
      opacity: 1;
    }
  }

  @media (max-width: 639px) {
    .cover-card-row .cover-card-main {
      display: grid;
      grid-template-columns: 4.5rem minmax(0, 1fr);
      grid-template-rows: auto 1fr;
      column-gap: 1rem;
    }

    .cover-card-row .cover-card-cover {
      grid-row: 1;
      grid-column: 1;
    }

    .cover-card-row .cover-card-track {
      grid-row: 2;
      grid-column: 1;
      align-self: start;
    }

    .cover-card-row .cover-card-text {
      grid-row: 1 / span 2;
      grid-column: 2;
      margin-top: 0;
    }
  }
</style>
