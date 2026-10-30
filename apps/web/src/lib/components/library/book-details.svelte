<script lang="ts">
  import BookCard from '$lib/components/book-card/book-card.svelte';
  import BookFriends from '$lib/components/social/book-friends.svelte';
  import SendBook from '$lib/components/social/send-book.svelte';
  import type { BookCardProps } from '$lib/components/book-card/book-card-props';
  import ContinueReadingShelf from '$lib/components/library/continue-reading-shelf.svelte';
  import MokuroText from '$lib/components/manga/mokuro-text.svelte';
  import LocalMokuroText from '$lib/components/manga/local-mokuro-text.svelte';
  import DetailsDifficulty from '$lib/components/library/details-difficulty.svelte';
  import DetailsMetadataSearch from '$lib/components/library/details-metadata-search.svelte';
  import DetailsWords from '$lib/components/library/details-words.svelte';
  import type { MokuroText as MokuroFile } from '$lib/data/manga/mokuro';
  import { isFinished, isReading } from '$lib/data/library/library-filters';
  import { orderSeries } from '$lib/data/library/library-sort';
  import { account$, hasPermission } from '$lib/data/account/account';
  import { pagePath, selfHostingGuideUrl, standalone } from '$lib/data/env';
  import { sourceNames, type MetadataKind } from '$lib/data/library/book-metadata';
  import { loadBookDetails, noBookDetails, type BookDetails } from '$lib/data/library/book-details';
  import { damagedBookText } from '$lib/data/book-content';
  import type { CoreNumbers } from '$lib/functions/analysis/core';
  import {
    analysisToolsState$,
    analysisToolsSupported,
    checkAnalysisTools,
    localEstimateSaved$
  } from '$lib/data/analysis/analysis-tools';
  import { dialogManager } from '$lib/data/dialog-manager';
  import SeriesDialog from '$lib/components/library/series-dialog.svelte';
  import { learnerStats } from '$lib/data/stats/learner-stats';
  import {
    addToHome,
    homeBookTitles$,
    homeRemovedTitles$,
    isContinueReading,
    libraryTab$,
    removeFromHome
  } from '$lib/data/library/library-home';
  import { generatedReadings$ } from '$lib/data/words/generated-furigana';
  import { database, generatedFurigana$, startDayHoursForTracker$ } from '$lib/data/store';
  import { getDateKey } from '$lib/functions/statistic-util';
  import { t$ } from '$lib/i18n';
  import { createEventDispatcher, onMount } from 'svelte';

  /**
   * A book's page in the library (Store clicks, Home covers): length,
   * difficulty, Calibre metadata and details fetched from AniList or VNDB.
   * The data comes from one `loadBookDetails` (book-details.ts); the difficulty, words and
   * Find details parts are `components/library/details-*.svelte`. Not part of upstream.
   */

  export let book: BookCardProps;
  export let bookCards: BookCardProps[];
  /** Calibre source: catalog metadata, difficulty and shared details exist */
  export let isCalibre: boolean;
  /** Browser source: series are made in this browser (series-overrides.ts `browserSeries`) */
  export let localSeries = false;
  /** The book's word list is shown over the page (Escape is its own) */
  export let covered = false;

  const dispatch = createEventDispatcher<{
    close: void;
    read: { id: number };
    showBook: { id: number };
    showSeries: string;
    /** Show the book's word list */
    words: void;
    /** Saved details changed the library (a cover) */
    changed: void;
    /** Delete a book whose stored data is damaged */
    delete: { id: number };
  }>();

  let layer: HTMLDivElement;
  let details: BookDetails = noBookDetails();
  /** Each load starts the parts' own state (search, errors, progress) afresh */
  let loads = 0;
  /** Standalone: the fast core's numbers, shown while the rest of the estimate is made */
  let coreFirst: CoreNumbers | undefined;
  /** Standalone: the estimate's progress while it is made */
  let estimating: number | undefined;
  /** A manga's mokuro text: undefined while loading, null when it has none */
  let mokuro: MokuroFile | null | undefined;
  let speed = 0;
  let searchOpen = false;
  let searchTerm = '';

  const number = (value: number) => value.toLocaleString('en-US');

  $: ({ calibreBook, estimate, metadata, browserKanji, windowsGame, damaged } = details);
  $: kind = (book.vn ? 'vn' : book.manga ? 'manga' : 'book') as MetadataKind;
  $: characters = book.characters || estimate?.characters || 0;
  $: remaining = isReading(book) ? characters * (1 - book.progress) : characters;
  $: canEdit = isCalibre && hasPermission($account$, 'series');
  $: canEditSeries = canEdit || localSeries;
  /** Without `canEdit` (Browser source, standalone) a pick only sets a Windows game's length. */
  $: canFind = canEdit || windowsGame;
  $: onHome = $homeBookTitles$.includes(book.title) || isContinueReading(book, $homeRemovedTitles$);
  $: seriesBooks = book.series
    ? orderSeries(bookCards.filter((card) => card.series === book.series))
    : [];
  $: genres = [...new Set([...(book.tags ?? []), ...(metadata?.genres ?? [])])];
  $: published = calibreBook?.published
    ? new Date(calibreBook.published).getFullYear().toString()
    : metadata?.released.slice(0, 4);
  $: (book.title, load());

  onMount(() => {
    // The layer rather than the back link, whose focus ring would show on every open.
    layer.focus();
    loadSpeed();
    if (standalone) checkAnalysisTools();

    // Ask for the generated furigana now, so they are usually ready when the book opens.
    const readings =
      isCalibre && kind === 'book' && generatedFurigana$.getValue()
        ? generatedReadings$(book.title).subscribe()
        : undefined;

    // Standalone: an estimate made in the background (background-analysis.ts) shows at once.
    const saved = localEstimateSaved$.subscribe((title) => {
      if (title === book.title && estimating === undefined) load();
    });

    return () => {
      readings?.unsubscribe();
      saved.unsubscribe();
    };
  });

  function hours(count: number) {
    const value = count / speed;

    return value < 1
      ? $t$('book.minutes', { minutes: Math.max(1, Math.round(value * 60)) })
      : $t$('book.hours', { hours: value.toFixed(1) });
  }

  async function loadSpeed() {
    const statistics = await database
      .getStatisticsForTimeWindow('0000-00-00', '9999-99-99')
      .catch(() => []);

    speed = learnerStats(statistics, getDateKey($startDayHoursForTracker$)).speed;
  }

  async function load() {
    const title = book.title;

    details = noBookDetails();
    loads += 1;
    searchOpen = false;
    coreFirst = estimating = undefined;
    if (standalone && kind === 'manga') mokuro = undefined;

    const loaded = await loadBookDetails(book, kind, isCalibre);

    if (title !== book.title) {
      return;
    }

    details = loaded;
    if (standalone && kind === 'manga') mokuro = loaded.mokuro;
  }

  /** The library's Make series dialog for this book; Browser books save in this browser. */
  async function editSeries() {
    const saved = await new Promise<boolean>((resolver) => {
      dialogManager.dialogs$.next([
        {
          component: SeriesDialog,
          props: { book, books: bookCards, resolver, local: localSeries }
        }
      ]);
    });

    if (saved) dispatch('changed');
  }

  function toggleHome() {
    if (onHome) {
      removeFromHome(book.title);
    } else {
      addToHome([book.title]);
    }
  }
</script>

<svelte:window
  on:keydown={(ev) => ev.key === 'Escape' && !searchOpen && !covered && dispatch('close')}
/>

<div
  class="details"
  role="dialog"
  aria-modal="true"
  aria-labelledby="book-details-title"
  tabindex="-1"
  bind:this={layer}
>
  <nav class="details-bar" aria-label={$t$('nav.back')}>
    <button type="button" class="app-button app-button-quiet" on:click={() => dispatch('close')}>
      ← {$t$($libraryTab$ === 'home' ? 'nav.home' : standalone ? 'nav.library' : 'nav.store')}
    </button>
    <span class="details-crumb" lang="ja">/ {book.displayTitle || book.title}</span>
  </nav>

  <div class="details-body">
    <div class="details-aside">
      <div class="details-cover">
        <span class="details-cover-image"
          ><BookCard imagePath={book.imagePath} title={book.title} full /></span
        >
        <span class="details-track" aria-hidden="true"
          ><span style:width="{Math.round((book.progress || 0) * 100)}%" /></span
        >
        {#if isReading(book)}
          <span class="details-percent">{Math.round(book.progress * 100)}%</span>
        {/if}
      </div>
      <BookFriends title={book.title} part="friends" />

      <div class="details-actions">
        {#if damaged}
          <p role="alert">{damagedBookText}</p>
          <button
            type="button"
            class="app-button app-button-danger"
            on:click={() => dispatch('delete', { id: book.id })}
          >
            Delete
          </button>
        {:else}
          <button
            type="button"
            class="app-button app-button-primary"
            on:click={() => dispatch('read', { id: book.id })}
          >
            {#if isReading(book)}{$t$('book.resumeAt', {
                percent: Math.round(book.progress * 100)
              })}{:else if isFinished(book)}{$t$('book.readAgain')}{:else}{$t$('book.read')}{/if}
          </button>
        {/if}
        <button type="button" class="app-button" aria-pressed={onHome} on:click={toggleHome}>
          {onHome ? $t$('home.remove') : $t$('home.add')}
        </button>
      </div>
      <BookFriends title={book.title} part="hide" />
      <SendBook title={book.title} vn={!!book.vn} />
    </div>

    <div class="details-main">
      <div class="details-head">
        <h1 id="book-details-title" class="details-title" lang="ja">
          {(metadata?.source === 'vndb' && metadata.title) || book.title}
        </h1>
        {#if book.authors && book.authors !== 'Unknown'}
          <p class="details-author" lang="ja">{book.authors}</p>
        {/if}
        {#if book.series || canEditSeries}
          <p class="details-series">
            {#if book.seriesIndex !== null && book.seriesIndex !== undefined}
              <span class="details-vol">{$t$('book.vol', { index: book.seriesIndex })}</span>
            {/if}
            {#if book.series}
              <button
                type="button"
                class="app-button app-button-quiet"
                lang="ja"
                on:click={() => dispatch('showSeries', book.series ?? '')}
              >
                {book.series}{#if seriesBooks.length > 1}&nbsp;·
                  {$t$('book.volumes', { count: seriesBooks.length })}{/if}
              </button>
            {/if}
            {#if canEditSeries}
              <button type="button" class="app-button app-button-quiet" on:click={editSeries}>
                {$t$('library.makeSeries')}
              </button>
            {/if}
          </p>
        {/if}
      </div>

      <div class="details-rest">
        {#if metadata?.description}
          <div class="details-description">
            <p lang="ja">{metadata.description}</p>
            <a href={metadata.url} target="_blank" rel="noreferrer">
              {$t$('book.from', { source: sourceNames[metadata.source] })}
            </a>
          </div>
        {/if}

        <DetailsDifficulty
          part="box"
          {book}
          {kind}
          {isCalibre}
          {details}
          {mokuro}
          {characters}
          {coreFirst}
        />

        <dl class="details-facts">
          {#key loads}
            <DetailsDifficulty
              part="row"
              {book}
              {kind}
              {isCalibre}
              {details}
              {mokuro}
              {characters}
              bind:coreFirst
              bind:estimating
              onsaved={load}
            />
          {/key}
          <div>
            <dt>{$t$('book.length')}</dt>
            <dd>
              {#if !characters}
                {$t$('book.lengthUnknown')}
              {:else if kind === 'manga'}
                {$t$('book.pages', { count: number(characters) })}
              {:else}
                {$t$('book.characters', { count: number(characters) })}
                {#if speed}
                  <span class="details-note">
                    {$t$(isReading(book) ? 'book.timeLeftAtSpeed' : 'book.timeAtSpeed', {
                      time: hours(remaining),
                      speed: number(speed)
                    })}
                  </span>
                {/if}
              {/if}
            </dd>
          </div>
          {#if browserKanji}
            <div>
              <dt>{$t$('book.kanjiRow')}</dt>
              <dd>{$t$('book.kanjiCount', { count: number(browserKanji) })}</dd>
            </div>
          {/if}
          {#key loads}
            <DetailsWords
              {book}
              {kind}
              {details}
              onwords={() => dispatch('words')}
              onreadings={() => (details = { ...details, readingsMissing: false })}
              onsaved={load}
            />
          {/key}
          <div>
            <dt>{$t$('book.progress')}</dt>
            <dd>
              {#if isFinished(book)}{$t$('book.finished')}{:else if isReading(book)}{Math.round(
                  book.progress * 100
                )}%{:else}{$t$('book.notStarted')}{/if}
            </dd>
          </div>
          {#if isCalibre && kind === 'manga' && book.calibreId !== undefined}
            <div>
              <dt>{$t$('book.text')}</dt>
              <dd><MokuroText calibreId={book.calibreId} bind:text={mokuro} /></dd>
            </div>
          {:else if !isCalibre && kind === 'manga'}
            <div>
              <dt>{$t$('book.text')}</dt>
              <dd><LocalMokuroText title={book.title} /></dd>
            </div>
          {/if}
          {#if calibreBook?.publisher}
            <div>
              <dt>{$t$('book.publisher')}</dt>
              <dd lang="ja">{calibreBook.publisher}</dd>
            </div>
          {/if}
          {#if published}
            <div>
              <dt>{$t$('book.published')}</dt>
              <dd>{published}</dd>
            </div>
          {/if}
          {#if genres.length}
            <div>
              <dt>{$t$('book.tags')}</dt>
              <dd lang="ja">{genres.join('・')}</dd>
            </div>
          {/if}
          {#if book.rating}
            <div>
              <dt>{$t$('book.rating')}</dt>
              <dd aria-label={$t$('book.ratingLabel', { rating: book.rating })}>
                {'★'.repeat(Math.round(book.rating))}{'☆'.repeat(5 - Math.round(book.rating))}
              </dd>
            </div>
          {/if}
          {#if metadata?.score}
            <div>
              <dt>{$t$('book.sourceScore', { source: sourceNames[metadata.source] })}</dt>
              <dd>{metadata.score} / 100</dd>
            </div>
          {/if}
          {#if calibreBook}
            <div>
              <dt>{$t$('book.file')}</dt>
              <dd>
                {$t$(calibreBook.size ? 'book.fileSizeAdded' : 'book.fileAdded', {
                  format: calibreBook.format === 'VN' ? $t$('book.gameFolder') : calibreBook.format,
                  size: (calibreBook.size / 1e6).toFixed(1),
                  date: new Date(calibreBook.added).toLocaleDateString()
                })}
              </dd>
            </div>
          {/if}
        </dl>
        {#if standalone && kind === 'book' && $analysisToolsState$.difficulty !== 'ready'}
          <p class="details-server-note">
            {#if analysisToolsSupported()}
              {$t$('book.needsAnalysisTools')}
              <a href="{pagePath}/settings?section=general#general-analysis"
                >{$t$('book.downloadAnalysisTools')}</a
              >
            {:else}
              {$t$('book.needsDesktopOrServer')}
              <a href={selfHostingGuideUrl} target="_blank" rel="noreferrer"
                >{$t$('book.selfHosting')}</a
              >
            {/if}
          </p>
        {/if}

        {#if seriesBooks.length > 1}
          <ContinueReadingShelf
            books={seriesBooks}
            number={1}
            heading={book.series ?? ''}
            currentBookId={book.id}
            on:bookClick={(ev) => dispatch('showBook', ev.detail)}
            on:bookRead={(ev) => dispatch('read', ev.detail)}
          />
        {/if}

        {#if canFind}
          {#key loads}
            <DetailsMetadataSearch
              {book}
              {kind}
              {canEdit}
              {windowsGame}
              {metadata}
              bind:searchOpen
              bind:searchTerm
              onmetadata={(saved) => (details = { ...details, metadata: saved })}
              onchanged={() => dispatch('changed')}
            />
          {/key}
        {/if}
      </div>
    </div>
  </div>
</div>

<style>
  .details {
    position: fixed;
    /* Under the app header (4rem, 3.25rem from xl) and the phones' bottom tab bar */
    inset: 4rem 0 0;
    z-index: 39;
    outline: none;
    overflow-y: auto;
    overscroll-behavior: contain;
    background: var(--background-color);
    color: var(--font-color);
  }

  @media (min-width: 1280px) {
    .details {
      top: 3.25rem;
    }
  }

  @media (max-width: 639px) {
    .details {
      bottom: calc(3.5rem + env(safe-area-inset-bottom));
    }
  }

  .details-bar {
    display: flex;
    min-width: 0;
    max-width: 75rem;
    align-items: baseline;
    gap: 0.5rem;
    margin: 0 auto;
    padding: 1.25rem 1rem 0;
  }

  .details-crumb {
    overflow: hidden;
    color: var(--app-muted-fg);
    font-size: var(--type-small);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .details-body {
    display: grid;
    grid-template-columns: 7.5rem minmax(0, 1fr);
    gap: 1.5rem 1rem;
    max-width: 75rem;
    margin: 0 auto;
    padding: 1.5rem 1rem calc(3rem + env(safe-area-inset-bottom));
  }

  /* Phones: cover beside the title, then everything full width */
  .details-aside,
  .details-main {
    display: contents;
  }

  .details-cover {
    grid-column: 1;
    grid-row: 1;
  }

  .details-head {
    grid-column: 2;
    grid-row: 1;
  }

  .details-actions,
  .details-rest {
    grid-column: 1 / -1;
  }

  @media (min-width: 768px) {
    .details-body {
      grid-template-columns: 16.5rem minmax(0, 1fr);
      gap: 0 4rem;
      padding: 2rem 2.5rem 4rem;
    }

    .details-bar {
      padding: 2rem 2.5rem 0;
    }

    .details-aside,
    .details-main {
      display: flex;
      min-width: 0;
      flex-direction: column;
    }

    .details-aside {
      position: sticky;
      top: 2rem;
      align-self: start;
      gap: 1.25rem;
    }

    .details-main {
      gap: 2rem;
    }
  }

  .details-cover-image {
    display: block;
    border: 1px solid var(--border-color);
  }

  .details-track {
    display: block;
    height: 3px;
    margin-top: 0.5rem;
    background: var(--app-progress-track);
  }

  .details-track > span {
    display: block;
    height: 100%;
    background: var(--app-progress-fill);
  }

  .details-percent {
    display: block;
    margin-top: 0.4rem;
    color: var(--app-muted-fg);
    font-size: var(--type-small);
    font-variant-numeric: tabular-nums;
  }

  .details-actions {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .details-actions .app-button {
    width: 100%;
  }

  .details-title {
    font-size: var(--type-h1);
    font-weight: 700;
    line-height: 1.3;
    overflow-wrap: anywhere;
  }

  @media (max-width: 767px) {
    .details-title {
      font-size: var(--type-h2);
    }
  }

  .details-author {
    margin-top: 0.4rem;
    color: var(--app-muted-fg);
    font-size: var(--type-body);
  }

  .details-series {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.25rem 0.6rem;
    margin-top: 0.6rem;
  }

  .details-vol {
    padding: 0.1rem 0.4rem;
    border-radius: 2px;
    background: var(--accent-color);
    color: var(--app-accent-fg);
    font-size: var(--type-label);
    font-weight: 700;
  }

  .details-rest {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 2rem;
  }

  .details-description {
    max-width: 40em;
    line-height: 1.8;
    white-space: pre-line;
  }

  .details-description a {
    display: inline-block;
    margin-top: 0.35rem;
    color: var(--app-muted-fg);
    font-size: var(--type-small);
    text-decoration: underline;
    text-underline-offset: 0.2em;
  }

  .details-facts {
    border-top: 2px solid var(--font-color);
  }

  .details-facts > :global(div) {
    display: grid;
    grid-template-columns: 8.5rem minmax(0, 1fr);
    gap: 1rem;
    padding: 0.7rem 0;
    border-bottom: 1px solid var(--border-color);
  }

  @media (max-width: 639px) {
    .details-facts > :global(div) {
      grid-template-columns: 6rem minmax(0, 1fr);
    }
  }

  .details-facts :global(dt) {
    padding-top: 0.1rem;
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }

  .details-facts :global(dd) {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.25rem 0.75rem;
    font-variant-numeric: tabular-nums;
  }

  .details-server-note {
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }

  .details-server-note a {
    margin-left: 0.5rem;
    white-space: nowrap;
    color: var(--accent-strong-color);
    font-weight: 700;
  }

  .details-server-note a:hover {
    text-decoration: underline;
    text-underline-offset: 0.2em;
  }

  .details-note {
    display: block;
    width: 100%;
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }
</style>
