<script lang="ts">
  import type { BookCardProps } from '$lib/components/book-card/book-card-props';
  import ContinueReadingShelf from '$lib/components/book-card/continue-reading-shelf.svelte';
  import LearnerDashboard from '$lib/components/book-card/learner-dashboard.svelte';
  import { isReading } from '$lib/components/book-card/library-filters';
  import PlacementOffer from '$lib/components/book-card/placement-offer.svelte';
  import ReadNextShelf from '$lib/components/book-card/read-next-shelf.svelte';
  import SectionHead from '$lib/components/section-head.svelte';
  import HomeSocial from '$lib/components/social/home-social.svelte';
  import AnalysisToolsOffer from '$lib/components/standalone/analysis-tools-offer.svelte';
  import InstallHint from '$lib/components/standalone/install-hint.svelte';
  import { standalone } from '$lib/data/env';
  import { knownCoverage$ } from '$lib/data/known-words';
  import {
    continueReading,
    homeBookTitles$,
    homeRemovedTitles$,
    libraryTab$,
    readNext,
    readNextPool,
    recentLevels,
    removeFromHome
  } from '$lib/data/library-home';
  import { StorageKey } from '$lib/data/storage/storage-types';
  import { storageSource$ } from '$lib/data/storage/storage-view';
  import { inputFile } from '$lib/functions/file-dom/input-file';
  import { activePlugins$ } from '$lib/plugins';
  import { t$ } from '$lib/i18n';

  /**
   * The library's Home tab (routes/manage): the learner dashboard, the first-run start, Continue
   * reading and Read next with its reason, the social shelves and My books, numbered in order.
   */

  interface Props {
    bookCards: BookCardProps[];
    currentBookId: number | undefined;
    /** The selection while select mode is on */
    selectedBookIds: ReadonlySet<number> | undefined;
    /** A cover was clicked: the book's page, or in select mode a toggle */
    oncoverclick: (id: number) => void;
    /** A Resume button: open the book */
    onbookread: (id: number) => void;
    /** A long press: select the book */
    onbookselect: (id: number) => void;
    /** Files picked in the first-run start */
    onfiles: (files: FileList | File[]) => void;
  }

  let {
    bookCards,
    currentBookId,
    selectedBookIds,
    oncoverclick,
    onbookread,
    onbookselect,
    onfiles
  }: Props = $props();

  const readNextCards = $derived(readNext(bookCards, $knownCoverage$, 3));
  const readNextReason = $derived.by(() => {
    if (!readNextCards.length) return '';
    if (standalone) return $t$('home.readNextReasonNext');
    const levels = recentLevels(bookCards);
    const low = levels[0].toFixed(1);
    const high = levels[levels.length - 1].toFixed(1);
    const next = new Set(readNextPool(bookCards).next.map((card) => card.id));

    return $t$(
      readNextCards.some((card) => next.has(card.id))
        ? 'home.readNextReasonSeries'
        : 'home.readNextReason',
      { range: low === high ? low : `${low}–${high}` }
    );
  });
  const continueCards = $derived(continueReading(bookCards, $homeRemovedTitles$));
  const homeCards = $derived.by(() => {
    const byTitle = new Map(bookCards.map((card) => [card.title, card]));

    return $homeBookTitles$
      .map((title) => byTitle.get(title))
      .filter((card): card is BookCardProps => !!card && !isReading(card));
  });
  const firstRun = $derived(!continueCards.length && !readNextCards.length && !homeCards.length);
  const socialNumber = $derived(
    1 + Number(firstRun) + Number(!!continueCards.length) + Number(!!readNextCards.length)
  );
  const socialOn = $derived($activePlugins$.some((plugin) => plugin.id === 'social'));
  let socialSections = $state(0);
  const myBooksNumber = $derived(socialNumber + (socialOn ? socialSections : 0));
</script>

<div class="home">
  <LearnerDashboard
    books={standalone || $storageSource$ === StorageKey.CALIBRE ? bookCards : undefined}
  />
  <PlacementOffer />
  {#if firstRun}
    <section class="home-start" aria-label={$t$('home.startReading')}>
      <SectionHead number={1} title={$t$('home.startReading')} />
      <span class="home-start-actions">
        <button
          type="button"
          class="app-button app-button-primary"
          onclick={() => ($libraryTab$ = 'store')}
        >
          {$t$(standalone ? 'home.openLibrary' : 'home.openStore')}
        </button>
        <label class="app-button">
          <input
            type="file"
            accept="application/epub+zip,.epub,.htmlz,plain/text,.txt,.cbz,.zip,.mokuro"
            multiple
            hidden
            use:inputFile={onfiles}
          />
          {$t$('home.importBook')}
        </label>
      </span>
    </section>
  {/if}
  <div class="home-pair">
    <ContinueReadingShelf
      books={continueCards}
      number={1}
      heading={$t$('home.continueReading')}
      {currentBookId}
      {selectedBookIds}
      on:bookClick={(ev) => oncoverclick(ev.detail.id)}
      on:bookRead={(ev) => onbookread(ev.detail.id)}
      on:bookSelect={(ev) => onbookselect(ev.detail.id)}
      removeTitle={$t$('home.remove')}
      on:remove={(ev) => removeFromHome(ev.detail.title)}
    />
    <ReadNextShelf
      books={readNextCards}
      number={continueCards.length ? 2 : 1}
      coverage={$knownCoverage$}
      reason={readNextReason}
      {currentBookId}
      {selectedBookIds}
      on:bookClick={(ev) => oncoverclick(ev.detail.id)}
      on:bookRead={(ev) => onbookread(ev.detail.id)}
      on:bookSelect={(ev) => onbookselect(ev.detail.id)}
    />
  </div>
  {#if socialOn}
    <HomeSocial
      books={bookCards}
      number={socialNumber}
      bind:sections={socialSections}
      on:bookClick={(ev) => oncoverclick(ev.detail.id)}
    />
  {/if}
  {#if homeCards.length}
    <ContinueReadingShelf
      books={homeCards}
      number={myBooksNumber}
      heading={$t$('home.myBooks')}
      removeTitle={$t$('home.remove')}
      {currentBookId}
      {selectedBookIds}
      on:bookClick={(ev) => oncoverclick(ev.detail.id)}
      on:bookSelect={(ev) => onbookselect(ev.detail.id)}
      on:remove={(ev) => removeFromHome(ev.detail.title)}
    />
  {:else}
    <section class="home-start" aria-label={$t$('home.myBooks')}>
      <SectionHead number={myBooksNumber} title={$t$('home.myBooks')} count={0} />
      <p class="library-empty-text">
        {$t$(standalone ? 'home.myBooksEmptyLibrary' : 'home.myBooksEmpty')}
      </p>
    </section>
  {/if}
  {#if standalone}
    <AnalysisToolsOffer />
    <InstallHint />
  {/if}
</div>

<style>
  .home {
    display: flex;
    max-width: 75rem;
    flex-direction: column;
    gap: 3.5rem;
    margin: 0 auto;
    padding-top: 1.25rem;
  }

  /* Continue reading and Read next side by side while both fit */
  .home-pair {
    display: flex;
    flex-wrap: wrap;
    gap: 3.5rem 4rem;
  }

  /* Grown, so every section head's rule runs to the column's right edge */
  .home-pair > :global(*) {
    flex: 1 1 auto;
    max-width: 100%;
  }

  .home-pair:not(:has(> *)) {
    display: none;
  }

  @media (max-width: 639px) {
    .home {
      gap: 2.5rem;
      padding-top: 0.5rem;
    }

    .home-pair {
      gap: 2.5rem;
    }

    .home-pair > :global(*) {
      flex-basis: 100%;
    }
  }

  .home-start {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 1rem;
  }

  .home-start :global(.section-head) {
    align-self: stretch;
  }

  .home-start > p {
    max-width: 40rem;
  }

  .home-start-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
  }
</style>
