<script lang="ts">
  import type { BookCardProps } from '$lib/components/book-card/book-card-props';
  import ContinueReadingShelf from '$lib/components/library/continue-reading-shelf.svelte';
  import LearnerDashboard from '$lib/components/words/learner-dashboard.svelte';
  import { isReading } from '$lib/data/library/library-filters';
  import PlacementOffer from '$lib/components/placement/placement-offer.svelte';
  import SectionHead from '$lib/components/section-head.svelte';
  import AnalysisToolsOffer from '$lib/components/analysis/analysis-tools-offer.svelte';
  import InstallHint from '$lib/components/standalone/install-hint.svelte';
  import { standalone } from '$lib/data/env';
  import {
    continueReading,
    homeBookTitles$,
    homeRemovedTitles$,
    libraryTab$,
    removeFromHome
  } from '$lib/data/library/library-home';
  import { StorageKey } from '$lib/data/storage/storage-types';
  import { storageSource$ } from '$lib/data/storage/storage-view';
  import { inputFile } from '$lib/functions/file-dom/input-file';
  import { t$ } from '$lib/i18n';

  /**
   * The library's Home tab (routes/manage): the learner dashboard (not on phones: Profile has it),
   * the first-run start, Continue reading and My books, numbered in order. Friends live in
   * Community (home-social.svelte).
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

  const continueCards = $derived(continueReading(bookCards, $homeRemovedTitles$));
  const homeCards = $derived.by(() => {
    const byTitle = new Map(bookCards.map((card) => [card.title, card]));

    return $homeBookTitles$
      .map((title) => byTitle.get(title))
      .filter((card): card is BookCardProps => !!card && !isReading(card));
  });
  const firstRun = $derived(!continueCards.length && !homeCards.length);
  const myBooksNumber = $derived(1 + Number(firstRun) + Number(!!continueCards.length));
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

  @media (max-width: 639px) {
    .home {
      gap: 2.5rem;
      padding-top: 0.5rem;
    }

    /* Phones see the dashboard on Profile; still mounted, it keeps saving read progress */
    .home > :global(.dashboard) {
      display: none;
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
