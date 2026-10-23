<script lang="ts">
  import { faMagnifyingGlass, faSpinner } from '@fortawesome/free-solid-svg-icons';
  import PointBox from '$lib/components/point-box.svelte';
  import SectionHead from '$lib/components/section-head.svelte';
  import BookCard from '$lib/components/book-card/book-card.svelte';
  import type { BookCardProps } from '$lib/components/book-card/book-card-props';
  import ContinueReadingShelf from '$lib/components/book-card/continue-reading-shelf.svelte';
  import DifficultyDialog from '$lib/components/book-card/difficulty-dialog.svelte';
  import MokuroText from '$lib/components/book-card/mokuro-text.svelte';
  import { isFinished, isReading } from '$lib/components/book-card/library-filters';
  import { orderSeries } from '$lib/components/book-card/library-sort';
  import { account$, hasPermission } from '$lib/data/account';
  import { selfHostingGuideUrl, standalone } from '$lib/data/env';
  import {
    loadBookMetadata,
    defaultSource,
    saveBookMetadata,
    searchMetadata,
    sourceNames,
    type BookMetadata,
    type MetadataCandidate,
    type MetadataKind,
    type MetadataSource
  } from '$lib/data/book-metadata';
  import {
    loadCalibreCatalog,
    loadCalibreDifficulty,
    type CalibreBook,
    type CalibreDifficulty
  } from '$lib/data/calibre';
  import { difficultyNameKey } from '$lib/data/difficulty';
  import { bookKanjiCount } from '$lib/data/book-kanji';
  import type { BookWord, WordCoverage } from '$lib/data/book-words';
  import { dialogManager } from '$lib/data/dialog-manager';
  import {
    bookCoverage,
    bookWordGroups,
    getKnownSet,
    refreshKnownWordsIfStale,
    type KnownSet
  } from '$lib/data/known-words';
  import { learnerStats } from '$lib/data/learner-stats';
  import {
    addToHome,
    homeBookTitles$,
    homeRemovedTitles$,
    isContinueReading,
    libraryTab$,
    removeFromHome
  } from '$lib/data/library-home';
  import { guessSeriesName } from '$lib/data/series-overrides';
  import { generatedReadings$ } from '$lib/data/generated-furigana';
  import { database, generatedFurigana$, startDayHoursForTracker$ } from '$lib/data/store';
  import { wordMarks$ } from '$lib/data/word-marks';
  import { wordList } from '$lib/data/words-met';
  import { getDateKey } from '$lib/functions/statistic-util';
  import { t$, tr, uiLanguage$ } from '$lib/i18n';
  import { createEventDispatcher, onMount } from 'svelte';
  import Fa from 'svelte-fa';

  /**
   * A book's page in the library (Store clicks, Home covers): length,
   * difficulty, Calibre metadata and details fetched from AniList or VNDB.
   * Not part of upstream.
   */

  export let book: BookCardProps;
  export let bookCards: BookCardProps[];
  /** Calibre source: catalog metadata, difficulty and shared details exist */
  export let isCalibre: boolean;
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
  }>();

  let layer: HTMLDivElement;
  let calibreBook: CalibreBook | undefined;
  let estimate: CalibreDifficulty | undefined;
  /** The book's word list and the words known, for the Words row */
  let listWords: BookWord[] = [];
  let knownSet: KnownSet | undefined;
  let wordStats: WordCoverage | undefined;
  /** Standalone: different kanji counted from the stored book */
  let browserKanji: number | undefined;
  let speed = 0;
  let metadata: BookMetadata | undefined;
  let searching = false;
  let searchOpen = false;
  let searchTerm = '';
  let searchRequest = 0;
  let searchError = '';
  let saving = false;
  let candidates: MetadataCandidate[] | undefined;
  let source: MetadataSource | undefined;

  const number = (value: number) => value.toLocaleString('en-US');

  $: kind = (book.vn ? 'vn' : book.manga ? 'manga' : 'book') as MetadataKind;
  $: source ??= defaultSource(kind);
  $: characters = book.characters || estimate?.characters || 0;
  $: remaining = isReading(book) ? characters * (1 - book.progress) : characters;
  $: hasDifficulty = isCalibre && kind !== 'manga' && book.calibreId !== undefined;
  $: canEdit = isCalibre && hasPermission($account$, 'series');
  $: onHome = $homeBookTitles$.includes(book.title) || isContinueReading(book, $homeRemovedTitles$);
  $: seriesBooks = book.series
    ? orderSeries(bookCards.filter((card) => card.series === book.series))
    : [];
  $: genres = [...new Set([...(book.tags ?? []), ...(metadata?.genres ?? [])])];
  $: published = calibreBook?.published
    ? new Date(calibreBook.published).getFullYear().toString()
    : metadata?.released.slice(0, 4);
  $: (book.title, load());
  $: wordGroups =
    listWords.length && knownSet
      ? bookWordGroups(listWords, estimate?.words95, knownSet, $wordMarks$)
      : undefined;
  /** The difficulty note: a few whole sentences, each only when its numbers exist */
  $: difficultyNote =
    book.difficulty === undefined
      ? ''
      : [
          book.difficultyLow !== undefined && book.difficultyHigh !== undefined
            ? $t$('book.scoreRange', {
                score: book.difficulty.toFixed(1),
                low: book.difficultyLow.toFixed(1),
                high: book.difficultyHigh.toFixed(1)
              })
            : $t$('book.score', { score: book.difficulty.toFixed(1) }),
          book.words95 ? $t$('book.words95', { count: number(book.words95) }) : '',
          wordStats ? coverageSentence(wordStats, $t$) : '',
          estimate?.uniqueKanji ? $t$('book.kanji', { count: number(estimate.uniqueKanji) }) : ''
        ]
          .filter(Boolean)
          .join($uiLanguage$ === 'ja' ? '' : ' ');

  function coverageSentence(stats: WordCoverage, t: typeof $t$) {
    return t(
      stats.unlisted
        ? 'book.wordCoverageTail'
        : stats.complete
          ? 'book.wordCoverage'
          : 'book.wordCoverageTop',
      {
        count: number(stats.words),
        percent: Math.floor(stats.share * 100),
        new: number(stats.newWords),
        rare: number(stats.unlisted)
      }
    );
  }

  onMount(() => {
    // The layer rather than the back link, whose focus ring would show on every open.
    layer.focus();
    loadSpeed();

    // Ask for the generated furigana now, so they are usually ready when the book opens.
    const readings =
      isCalibre && kind === 'book' && generatedFurigana$.getValue()
        ? generatedReadings$(book.title).subscribe()
        : undefined;

    return () => readings?.unsubscribe();
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

    calibreBook = undefined;
    estimate = undefined;
    listWords = [];
    knownSet = undefined;
    wordStats = undefined;
    metadata = undefined;
    candidates = undefined;
    source = undefined;
    searchOpen = false;
    searchError = '';
    browserKanji = undefined;

    if (standalone && kind === 'book') {
      bookKanjiCount(book.id, title, book.characters)
        .then((count) => {
          if (title === book.title) browserKanji = count;
        })
        .catch(() => {});
    }

    if (!isCalibre) {
      return;
    }

    const [catalog, difficulty, details] = await Promise.all([
      loadCalibreCatalog().catch(() => []),
      book.calibreId === undefined ? undefined : loadCalibreDifficulty().catch(() => undefined),
      loadBookMetadata().catch(() => ({}) as Record<string, BookMetadata>)
    ]);

    if (title !== book.title) {
      return;
    }

    calibreBook = catalog.find((entry) => entry.title === title);
    estimate = book.calibreId === undefined ? undefined : difficulty?.[book.calibreId];
    metadata = details[title];

    if (estimate && book.calibreId !== undefined) {
      const id = book.calibreId;
      const bookEstimate = estimate;
      const [list, known] = await Promise.all([
        kind === 'manga' ? null : wordList(id, bookEstimate.computedAt).catch(() => null),
        refreshKnownWordsIfStale()
          .then(getKnownSet)
          .catch(() => undefined)
      ]);
      const coverage =
        list && known
          ? await bookCoverage(id, list, bookEstimate, known).catch(() => undefined)
          : undefined;

      if (title !== book.title) {
        return;
      }

      wordStats = coverage;
      listWords = list ?? [];
      knownSet = known;
    }
  }

  function openSearch() {
    searchOpen = true;
    searchTerm ||= guessSeriesName(book.title);
    search();
  }

  async function search() {
    if (!searchTerm.trim()) {
      return;
    }

    const request = (searchRequest += 1);

    searching = true;
    searchError = '';
    try {
      const results = await searchMetadata(kind, searchTerm.trim(), source);

      // An older search answering late must not replace a newer one's results.
      if (request === searchRequest) {
        candidates = results;
      }
    } catch (error: any) {
      if (request === searchRequest) {
        searchError = tr('book.searchFailed', {
          source: sourceNames[source ?? defaultSource(kind)],
          error: error.message
        });
      }
    } finally {
      if (request === searchRequest) {
        searching = false;
      }
    }
  }

  async function save(entry: MetadataCandidate | undefined) {
    saving = true;
    searchError = '';
    try {
      metadata = (await saveBookMetadata(book.title, entry))[book.title];
      searchOpen = false;
      dispatch('changed');
    } catch (error: any) {
      searchError = error.message;
    } finally {
      saving = false;
    }
  }

  function showDifficulty() {
    dialogManager.dialogs$.next([{ component: DifficultyDialog, props: { books: [book] } }]);
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

      <div class="details-actions">
        <button
          type="button"
          class="app-button app-button-primary"
          on:click={() => dispatch('read', { id: book.id })}
        >
          {#if isReading(book)}{$t$('book.resumeAt', {
              percent: Math.round(book.progress * 100)
            })}{:else if isFinished(book)}{$t$('book.readAgain')}{:else}{$t$('book.read')}{/if}
        </button>
        <button type="button" class="app-button" aria-pressed={onHome} on:click={toggleHome}>
          {onHome ? $t$('home.remove') : $t$('home.add')}
        </button>
      </div>
    </div>

    <div class="details-main">
      <div class="details-head">
        <h1 id="book-details-title" class="details-title" lang="ja">
          {(metadata?.source === 'vndb' && metadata.title) || book.title}
        </h1>
        {#if book.authors && book.authors !== 'Unknown'}
          <p class="details-author" lang="ja">{book.authors}</p>
        {/if}
        {#if book.series}
          <p class="details-series">
            {#if book.seriesIndex !== null && book.seriesIndex !== undefined}
              <span class="details-vol">{$t$('book.vol', { index: book.seriesIndex })}</span>
            {/if}
            <button
              type="button"
              class="app-button app-button-quiet"
              lang="ja"
              on:click={() => dispatch('showSeries', book.series ?? '')}
            >
              {book.series}{#if seriesBooks.length > 1}&nbsp;·
                {$t$('book.volumes', { count: seriesBooks.length })}{/if}
            </button>
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

        {#if hasDifficulty && book.difficulty !== undefined}
          <PointBox
            label={$t$('book.difficulty')}
            figure={book.difficulty.toFixed(1)}
            unit={$t$('book.outOf', { band: $t$(difficultyNameKey(book.difficulty)) })}
          >
            <div class="details-difficulty" title={difficultyNote}>
              <div class="details-difficulty-score">
                <span class="details-meter" aria-hidden="true">
                  {#each [0, 1, 2, 3, 4] as i (i)}
                    <span
                      ><span
                        style:width="{Math.min(Math.max(book.difficulty - i, 0), 1) * 100}%"
                      /></span
                    >
                  {/each}
                </span>
                {#if book.difficultyLow !== undefined && book.difficultyHigh !== undefined}
                  <span class="details-small">
                    {$t$('book.likely', {
                      low: book.difficultyLow.toFixed(1),
                      high: book.difficultyHigh.toFixed(1)
                    })}
                  </span>
                {/if}
              </div>
              <dl class="details-figures">
                {#if wordStats}
                  <div>
                    <dt>{Math.floor(wordStats.share * 100)}%</dt>
                    <dd>{$t$('book.knownFigure')}</dd>
                  </div>
                {/if}
                {#if estimate?.uniqueKanji}
                  <div>
                    <dt>{number(estimate.uniqueKanji)}</dt>
                    <dd>{$t$('book.kanjiFigureOnly')}</dd>
                  </div>
                {/if}
                {#if book.words95}
                  <div>
                    <dt>{number(book.words95)}</dt>
                    <dd>{$t$('book.words95Figure')}</dd>
                  </div>
                {/if}
              </dl>
            </div>
            <button type="button" class="app-button app-button-quiet" on:click={showDifficulty}>
              {$t$('book.difficultyDetails')}
            </button>
          </PointBox>
        {/if}

        <dl class="details-facts">
          {#if hasDifficulty && book.difficulty === undefined}
            <div>
              <dt>{$t$('book.difficulty')}</dt>
              <dd>
                {$t$('book.noEstimate')}
                <button
                  type="button"
                  class="app-button details-row-button"
                  on:click={showDifficulty}
                >
                  {$t$('book.difficultyDetails')}
                </button>
              </dd>
            </div>
          {/if}
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
          {#if wordGroups}
            <div>
              <dt>{$t$('book.words')}</dt>
              <dd>
                {$t$('book.wordsValue', {
                  new: number(wordGroups.new.length),
                  known: number(wordGroups.known.length),
                  ignored: number(wordGroups.ignored.length)
                })}
                <button
                  type="button"
                  class="app-button app-button-quiet"
                  on:click={() => dispatch('words')}
                >
                  {$t$('book.wordList')}
                </button>
              </dd>
            </div>
          {/if}
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
              <dd><MokuroText calibreId={book.calibreId} /></dd>
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
        {#if standalone}
          <p class="details-server-note">
            Difficulty and word lists need a server.
            <a href={selfHostingGuideUrl} target="_blank" rel="noreferrer">Self-hosting →</a>
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

        {#if canEdit}
          <section class="details-fetch" aria-labelledby="book-details-fetch">
            {#if !searchOpen}
              <button type="button" class="app-button" on:click={openSearch}>
                <Fa icon={faMagnifyingGlass} />
                {metadata
                  ? $t$('book.changeDetails')
                  : $t$('book.findDetailsOn', { source: sourceNames[defaultSource(kind)] })}
              </button>
              {#if metadata}
                <button
                  type="button"
                  class="app-button app-button-quiet"
                  disabled={saving}
                  on:click={() => save(undefined)}
                >
                  {metadata.cover ? $t$('book.removeDetailsCover') : $t$('book.removeDetails')}
                </button>
              {/if}
            {:else}
              <h2 id="book-details-fetch" class="details-fetch-heading">
                {$t$('book.findDetails')}
              </h2>
              <form class="details-search" on:submit|preventDefault={search}>
                <select
                  class="app-input"
                  aria-label={$t$('book.source')}
                  bind:value={source}
                  on:change={() => ((candidates = undefined), search())}
                >
                  <option value={defaultSource(kind)}>{sourceNames[defaultSource(kind)]}</option>
                  <option value="jiten">Jiten</option>
                </select>
                <input
                  class="app-input"
                  type="search"
                  lang="ja"
                  aria-label={$t$('book.searchSource', {
                    source: sourceNames[source ?? defaultSource(kind)]
                  })}
                  bind:value={searchTerm}
                  on:keydown={(ev) => ev.key === 'Escape' && (searchOpen = false)}
                />
                <button type="submit" class="app-button">
                  <Fa icon={searching ? faSpinner : faMagnifyingGlass} spin={searching} />
                  {$t$('book.search')}
                </button>
                <button
                  type="button"
                  class="app-button app-button-quiet"
                  on:click={() => (searchOpen = false)}
                >
                  {$t$('book.cancel')}
                </button>
              </form>
              {#if candidates && !candidates.length && !searching}
                <p class="details-note">{$t$('book.nothingFound')}</p>
              {/if}
              {#if candidates?.length}
                <ul class="details-candidates">
                  {#each candidates as candidate (candidate.url)}
                    <li>
                      {#if candidate.cover}
                        <img
                          src={candidate.cover}
                          alt=""
                          loading="lazy"
                          referrerpolicy="no-referrer"
                        />
                      {:else}
                        <span class="details-candidate-blank" />
                      {/if}
                      <span class="details-candidate-text">
                        <a href={candidate.url} target="_blank" rel="noreferrer" lang="ja">
                          {candidate.title}
                        </a>
                        <span class="details-note">
                          {candidate.released.slice(0, 4) ||
                            $t$('book.undated')}{#if candidate.genres.length},
                            {candidate.genres.slice(0, 3).join(', ')}{/if}
                        </span>
                        <span class="details-candidate-buttons">
                          <button
                            type="button"
                            class="app-button"
                            disabled={saving}
                            on:click={() => save({ ...candidate, cover: '' })}
                          >
                            {$t$('book.useDetails')}
                          </button>
                          {#if candidate.cover}
                            <button
                              type="button"
                              class="app-button"
                              disabled={saving}
                              on:click={() => save(candidate)}
                            >
                              {$t$('book.useDetailsCover')}
                            </button>
                          {/if}
                        </span>
                      </span>
                    </li>
                  {/each}
                </ul>
              {/if}
            {/if}
            {#if searchError}
              <p class="text-danger" role="alert">{searchError}</p>
            {/if}
          </section>
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

  .details-difficulty {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem 3rem;
    margin-top: 0.5rem;
  }

  .details-difficulty-score {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .details-meter {
    display: flex;
    gap: 3px;
  }

  .details-meter > span {
    display: block;
    width: 1.75rem;
    height: 4px;
    background: var(--app-progress-track);
  }

  .details-meter > span > span {
    display: block;
    height: 100%;
    background: var(--accent-color);
  }

  .details-figures {
    display: grid;
    grid-template-columns: auto 1fr;
    align-items: baseline;
    gap: 0.3rem 0.6rem;
  }

  .details-figures > div {
    display: contents;
  }

  .details-figures dt {
    font-size: var(--type-number);
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    text-align: right;
  }

  .details-figures dd,
  .details-small {
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }

  .details-facts {
    border-top: 2px solid var(--font-color);
  }

  .details-facts > div {
    display: grid;
    grid-template-columns: 8.5rem minmax(0, 1fr);
    gap: 1rem;
    padding: 0.7rem 0;
    border-bottom: 1px solid var(--border-color);
  }

  @media (max-width: 639px) {
    .details-facts > div {
      grid-template-columns: 6rem minmax(0, 1fr);
    }
  }

  .details-facts dt {
    padding-top: 0.1rem;
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }

  .details-facts dd {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.25rem 0.75rem;
    font-variant-numeric: tabular-nums;
  }

  .details-row-button {
    --app-control-height: 2rem;
    padding: 0 0.6rem;
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

  .details-fetch {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .details-fetch-heading {
    width: 100%;
    font-size: var(--type-h2);
    font-weight: 700;
  }

  .details-search {
    display: flex;
    width: 100%;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .details-search input {
    min-width: 12rem;
    flex: 1;
  }

  .details-candidates {
    display: flex;
    width: 100%;
    flex-direction: column;
    border-top: 2px solid var(--font-color);
  }

  .details-candidates li {
    display: flex;
    gap: 0.9rem;
    padding: 0.8rem 0;
    border-bottom: 1px solid var(--border-color);
  }

  .details-candidates img,
  .details-candidate-blank {
    width: 4rem;
    flex: 0 0 auto;
    aspect-ratio: 375 / 529;
    object-fit: cover;
    background: var(--surface-color);
  }

  .details-candidate-text {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 0.2rem;
  }

  .details-candidate-text a {
    font-weight: 700;
    text-decoration: underline;
    text-underline-offset: 0.2em;
  }

  .details-candidate-buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    margin-top: 0.3rem;
  }
</style>
