<script lang="ts">
  import { goto } from '$app/navigation';
  import AppHeader from '$lib/components/app-header/app-header.svelte';
  import { accountReady, currentAccount } from '$lib/data/account/account';
  import { pagePath } from '$lib/data/env';
  import {
    allHighlights,
    allHighlightsMarkdown,
    type BookHighlights
  } from '$lib/data/reader/all-highlights';
  import type { Highlight } from '$lib/data/reader/annotations';
  import { database } from '$lib/data/store';
  import { downloadBlob } from '$lib/functions/file-dom/download-blob';
  import { t$ } from '$lib/i18n';
  import { map, share } from 'rxjs';
  import { onMount } from 'svelte';

  /**
   * Every book's highlights and notes kept in this browser, with a filter, an export and a
   * jump into the book (handed to the reader as sessionStorage 'ttu-jump'). Not part of upstream.
   */

  const pageSize = 300;

  const currentBookId$ = database.lastItem$.pipe(
    map((item) => item?.dataId),
    share()
  );

  let books = $state<BookHighlights[]>();
  let query = $state('');
  let notesOnly = $state(false);
  let limit = $state(pageSize);
  let copied = $state(false);
  let notHere = $state<string>();

  const shown = $derived.by(() => {
    const needle = query.trim().toLowerCase();

    return (books ?? [])
      .map((book) => ({
        title: book.title,
        highlights: book.highlights.filter(
          (h) =>
            (!notesOnly || h.note) &&
            (!needle ||
              [h.text, h.note, book.title].some((text) => text.toLowerCase().includes(needle)))
        )
      }))
      .filter((book) => book.highlights.length);
  });

  // Cut at `limit` highlights in all, so a long list renders in steps.
  const visible = $derived.by(() => {
    let left = limit;

    return shown
      .map((book) => {
        const highlights = book.highlights.slice(0, Math.max(left, 0));

        left -= book.highlights.length;

        return { title: book.title, count: book.highlights.length, highlights };
      })
      .filter((book) => book.highlights.length);
  });
  const total = $derived(shown.reduce((sum, book) => sum + book.highlights.length, 0));

  onMount(async () => {
    await accountReady();
    books = await allHighlights(currentAccount()?.id ?? '');
  });

  function download() {
    downloadBlob(
      new Blob([allHighlightsMarkdown(shown)], { type: 'text/markdown' }),
      'highlights.md'
    );
  }

  async function copy() {
    await navigator.clipboard.writeText(allHighlightsMarkdown(shown));
    copied = true;
    setTimeout(() => (copied = false), 1500);
  }

  async function open(title: string, highlight: Highlight) {
    const book = await database.getDataByTitle(title);

    if (!book) {
      notHere = highlight.id;
      return;
    }

    try {
      sessionStorage.setItem('ttu-jump', JSON.stringify({ id: book.id, count: highlight.start }));
    } catch {
      // The book still opens, at its saved place.
    }
    goto(`${pagePath}/b?id=${book.id}`);
  }
</script>

<AppHeader active={undefined} currentBookId={$currentBookId$} />

<div class="app-page-shell">
  <main class="highlights">
    <header>
      <h1 class="highlights-title">{$t$('highlights.title')}</h1>
      <p class="highlights-note">{$t$('highlights.thisBrowser')}</p>
    </header>

    <div class="highlights-tools">
      <input
        class="app-input"
        type="search"
        bind:value={query}
        placeholder={$t$('highlights.filter')}
        aria-label={$t$('highlights.filter')}
      />
      <label class="flex items-center gap-1.5 whitespace-nowrap">
        <input type="checkbox" bind:checked={notesOnly} />
        {$t$('highlights.onlyNotes')}
      </label>
      <span class="highlights-actions">
        <span class="highlights-count">
          {copied
            ? $t$('reader.copied')
            : $t$(total === 1 ? 'reader.highlightCountOne' : 'reader.highlightCount', {
                count: total
              })}
        </span>
        <button class="app-button-quiet" disabled={!total} onclick={copy}>
          {$t$('highlights.copyAll')}
        </button>
        <button class="app-button-quiet" disabled={!total} onclick={download}>
          {$t$('highlights.downloadAll')}
        </button>
      </span>
    </div>

    {#if books && !books.length}
      <p class="highlights-note">{$t$('highlights.empty')}</p>
    {/if}

    {#each visible as book (book.title)}
      <section class="highlights-book">
        <h2 class="highlights-book-title" lang="ja">{book.title}</h2>
        <p class="highlights-note">
          {$t$(book.count === 1 ? 'reader.highlightCountOne' : 'reader.highlightCount', {
            count: book.count
          })}
        </p>
        {#each book.highlights as highlight (highlight.id)}
          <div class="highlight" style:border-left-color="var(--highlight-{highlight.color})">
            {#if highlight.chapter}
              <p class="highlights-note" lang="ja">{highlight.chapter}</p>
            {/if}
            <p class="highlight-text" lang="ja">{highlight.text}</p>
            {#if highlight.note}
              <p class="highlight-note">{highlight.note}</p>
            {/if}
            <p class="highlight-open">
              <button class="app-button-quiet" onclick={() => open(book.title, highlight)}>
                {$t$('highlights.open')}
              </button>
              {#if notHere === highlight.id}
                <span class="highlights-note">{$t$('highlights.notHere')}</span>
              {/if}
            </p>
          </div>
        {/each}
      </section>
    {/each}

    {#if total > limit}
      <button class="app-button self-start" onclick={() => (limit += pageSize)}>
        {$t$('words.showMore')}
      </button>
    {/if}
  </main>
</div>

<style>
  .highlights {
    display: flex;
    max-width: 50rem;
    flex-direction: column;
    gap: 1.5rem;
    margin: 0 auto;
    padding: 6rem 1rem calc(5.5rem + env(safe-area-inset-bottom));
  }

  @media (min-width: 768px) {
    .highlights {
      padding: 6.5rem 2.5rem 4rem;
    }
  }

  .highlights-title {
    font-size: var(--type-display);
    font-weight: 400;
    line-height: 1.2;
  }

  .highlights-note {
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }

  .highlights-tools {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 0.75rem;
    font-size: var(--type-small);
  }

  .highlights-tools input[type='search'] {
    min-width: 12rem;
    flex: 1;
  }

  .highlights-actions {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    margin-left: auto;
    white-space: nowrap;
  }

  .highlights-count {
    color: var(--app-muted-fg);
    font-variant-numeric: tabular-nums;
  }

  .highlights-book {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .highlights-book-title {
    font-size: var(--type-number);
    font-weight: 700;
  }

  .highlight {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    padding: 0.25rem 0 0.25rem 0.75rem;
    border-left: 3px solid;
  }

  .highlight-note {
    color: var(--accent-strong-color);
    font-size: var(--type-small);
    white-space: pre-wrap;
  }

  .highlight-open {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
  }
</style>
