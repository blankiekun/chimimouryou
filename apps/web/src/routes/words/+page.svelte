<script lang="ts">
  import { goto } from '$app/navigation';
  import AppHeader from '$lib/components/app-header/app-header.svelte';
  import ImportMenu from '$lib/components/book-card/import-menu.svelte';
  import PointBox from '$lib/components/point-box.svelte';
  import SectionHead from '$lib/components/section-head.svelte';
  import AnkiKnown from '$lib/components/words/anki-known.svelte';
  import KnownBecause from '$lib/components/words/known-because.svelte';
  import MarkedWords from '$lib/components/words/marked-words.svelte';
  import {
    analysisToolsState$,
    analysisToolsSupported,
    checkAnalysisTools
  } from '$lib/data/analysis-tools';
  import { ankiKnownWords$ } from '$lib/data/anki';
  import { pagePath, selfHostingGuideUrl } from '$lib/data/env';
  import { serverless } from '$lib/data/server';
  import { knownWords$ } from '$lib/data/known-words';
  import { setPendingImport, type PendingImport } from '$lib/data/library-home';
  import { pullAccountStatistics } from '$lib/data/statistics-sync';
  import { database, startDayHoursForTracker$ } from '$lib/data/store';
  import { markedWords, marksSignature, wordMarks$ } from '$lib/data/word-marks';
  import { gainedThisMonth, getKnownHistory } from '$lib/data/words-history';
  import { getWordsSummary, knownMinCount, type WordsSummary } from '$lib/data/words-met';
  import { getDateKey } from '$lib/functions/statistic-util';
  import { t$ } from '$lib/i18n';
  import { map, share } from 'rxjs';
  import { onMount } from 'svelte';

  /**
   * The Words tab: words known and why, the words marked by hand and the Anki deck that
   * counts as known (formerly Settings → Anki → Known Words). Not part of upstream.
   */

  const currentBookId$ = database.lastItem$.pipe(
    map((item) => item?.dataId),
    share()
  );

  let summary: WordsSummary | undefined;
  let gained: number | undefined;

  const number = (value: number) => value.toLocaleString('en-US');

  $: marks = markedWords($wordMarks$);
  // Recount when the marks or Anki's words change (reading them re-emits the stores, so
  // only a changed signature, a string, triggers this).
  $: changes = `${marksSignature($wordMarks$)}|${$knownWords$?.read}|${$ankiKnownWords$}`;
  $: (changes, loadSummary());
  $: because = [
    { label: $t$('words.becauseMet', { count: knownMinCount }), value: summary?.metEnough },
    {
      label: $t$('words.becauseAnki'),
      value: $ankiKnownWords$ ? ($knownWords$?.words.length ?? 0) : 0
    },
    {
      label: $t$('words.becauseMarked'),
      value: marks.filter((word) => word.status === 'known').length
    },
    {
      label: $t$('words.becauseIgnored'),
      value: marks.filter((word) => word.status === 'ignored').length
    }
  ];
  $: note = [
    gained ? $t$('words.gained', { count: number(gained) }) : '',
    summary ? $t$('words.met', { met: number(summary.met) }) : ''
  ]
    .filter(Boolean)
    .join(' · ');

  // The import runs (with its progress and errors) in the library.
  function importOnManage(value: PendingImport) {
    setPendingImport(value);
    goto(`${pagePath}/manage`);
  }

  function loadSummary() {
    getWordsSummary().then(
      (value) => (summary = value),
      () => {}
    );
  }

  onMount(() => {
    if (serverless) checkAnalysisTools();
    // Statistics of books not opened in this browser only exist on the server.
    pullAccountStatistics(window)
      .catch(() => {})
      .then(() => database.getStatisticsForTimeWindow('0000-00-00', '9999-99-99'))
      .then(async (statistics) =>
        gainedThisMonth(await getKnownHistory(statistics), getDateKey($startDayHoursForTracker$))
      )
      .then((count) => (gained = count))
      .catch(() => {});
  });
</script>

<AppHeader active="words" currentBookId={$currentBookId$}>
  <ImportMenu
    on:filesChange={(ev) => importOnManage({ files: Array.from(ev.detail) })}
    on:importBackup={(ev) => importOnManage({ backup: ev.detail })}
  />
</AppHeader>

<div class="app-page-shell">
  <main class="words">
    <header>
      <h1 class="words-title">{$t$('words.title')}</h1>
      <p class="words-subtitle">{$t$('words.subtitle')}</p>
      {#if serverless && $analysisToolsState$.difficulty !== 'ready'}
        <p class="words-tools-note">
          {#if analysisToolsSupported()}
            {$t$('words.needsAnalysisTools')}
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
    </header>

    <div class="words-top">
      <div class="words-point">
        <PointBox label={$t$('words.known')} figure={summary ? summary.known : '–'}>
          <p class="words-point-text">
            {$t$('words.knownUnit')}
            {#if note}<small>{note}</small>{/if}
          </p>
        </PointBox>
      </div>
      <KnownBecause rows={because} />
    </div>

    <div class="words-columns">
      <MarkedWords />
      <div class="words-side">
        <AnkiKnown />
        <section class="words-how" aria-label={$t$('words.how')}>
          <SectionHead number={3} title={$t$('words.how')} />
          <p>{$t$('words.howText', { count: knownMinCount })}</p>
        </section>
      </div>
    </div>
  </main>
</div>

<style>
  .words {
    display: flex;
    max-width: 75rem;
    flex-direction: column;
    gap: 2.5rem;
    margin: 0 auto;
    padding: 6rem 1rem calc(5.5rem + env(safe-area-inset-bottom));
  }

  @media (min-width: 768px) {
    .words {
      padding: 6.5rem 2.5rem 4rem;
    }
  }

  .words-title {
    font-size: var(--type-display);
    font-weight: 400;
    line-height: 1.2;
  }

  .words-subtitle {
    margin-top: 0.25rem;
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }

  .words-tools-note {
    margin-top: 0.75rem;
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }

  .words-tools-note a {
    margin-left: 0.5rem;
    white-space: nowrap;
    color: var(--accent-strong-color);
    font-weight: 700;
  }

  .words-tools-note a:hover {
    text-decoration: underline;
    text-underline-offset: 0.2em;
  }

  .words-top,
  .words-columns {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 2rem 4rem;
    align-items: start;
  }

  @media (min-width: 1024px) {
    .words-top {
      grid-template-columns: minmax(0, 0.9fr) minmax(0, 1fr);
      gap: 2.5rem;
    }

    .words-columns {
      grid-template-columns: minmax(0, 1fr) 22.5rem;
    }
  }

  .words-point :global(.point-box) {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 1.5rem;
  }

  .words-point-text {
    display: flex;
    flex-direction: column;
    color: var(--app-muted-fg);
  }

  .words-point-text small {
    font-size: var(--type-small);
  }

  .words-side {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 3rem;
  }

  .words-how {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .words-how p {
    color: var(--app-muted-fg);
    font-size: var(--type-small);
    line-height: 1.7;
  }
</style>
