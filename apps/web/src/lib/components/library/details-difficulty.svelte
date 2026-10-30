<script lang="ts">
  import PointBox from '$lib/components/point-box.svelte';
  import type { BookCardProps } from '$lib/components/book-card/book-card-props';
  import DifficultyDialog from '$lib/components/book-card/difficulty-dialog.svelte';
  import { analysisToolsState$, localEstimate } from '$lib/data/analysis-tools';
  import type { BookDetails } from '$lib/data/book-details';
  import type { MetadataKind } from '$lib/data/book-metadata';
  import type { WordCoverage } from '$lib/data/book-words';
  import { bookFacets, bookLevel, forYou, relativeLevel } from '$lib/data/difficulty-core';
  import { dialogManager } from '$lib/data/dialog-manager';
  import { standalone } from '$lib/data/env';
  import { mokuroHtml, type MokuroText as MokuroFile } from '$lib/data/mokuro';
  import { database } from '$lib/data/store';
  import type { CoreNumbers } from '$lib/functions/analysis/core';
  import { t$, uiLanguage$ } from '$lib/i18n';

  /**
   * The book page's difficulty (book-details.svelte): the Difficulty box (`part="box"`) and its
   * row in the facts list (`part="row"`: no level yet, a manga without text, standalone's Estimate).
   */

  interface Props {
    part: 'box' | 'row';
    book: BookCardProps;
    kind: MetadataKind;
    isCalibre: boolean;
    details: BookDetails;
    /** A manga's mokuro text: undefined while loading, null when it has none */
    mokuro: MokuroFile | null | undefined;
    characters: number;
    /** Standalone: the fast core's numbers, shown while the rest of the estimate is made */
    coreFirst?: CoreNumbers;
    /** Standalone: the estimate's progress while it is made */
    estimating?: number;
    /** An estimate was made: the page loads again */
    onsaved?: () => void;
  }

  let {
    part,
    book,
    kind,
    isCalibre,
    details,
    mokuro,
    characters,
    coreFirst = $bindable(),
    estimating = $bindable(),
    onsaved
  }: Props = $props();

  let estimateError = $state('');

  const { estimate, localScored, listWords, knownSet, wordStats } = $derived(details);

  const number = (value: number) => value.toLocaleString('en-US');

  const hasDifficulty = $derived(
    (isCalibre && book.calibreId !== undefined) || !!localScored || !!coreFirst
  );
  /** The objective 1-10 level (fast core), and this reader's numbers from the word list */
  const level = $derived(bookLevel(estimate?.core ?? coreFirst));
  /** Full furigana and sentence length beside the level (core version 2) */
  const facets = $derived(bookFacets(estimate?.core ?? coreFirst));
  const you = $derived(
    listWords.length && knownSet ? forYou(listWords, knownSet.isKnown, estimate) : undefined
  );
  const youLine = $derived(you && forYouLine(you.share, you.learn, you.atLeast));
  const unknownEvery = $derived(
    you?.unknownTokens && characters
      ? $t$('book.unknownEvery', { count: number(Math.round(characters / you.unknownTokens)) })
      : ''
  );
  /** Manga are estimated from their mokuro text, so one without has nothing to estimate yet. */
  const mangaWithoutText = $derived(kind === 'manga' && mokuro === null && !level);
  const canEstimate = $derived(
    standalone &&
      (kind === 'book' || (kind === 'manga' && !!mokuro)) &&
      !localScored &&
      $analysisToolsState$.difficulty === 'ready'
  );
  /** The difficulty note: a few whole sentences, each only when its numbers exist */
  const difficultyNote = $derived(
    !level
      ? ''
      : [
          $t$('book.levelNote', { score: level.score.toFixed(1), tier: level.tier }),
          wordStats ? coverageSentence(wordStats, $t$) : '',
          estimate?.uniqueKanji ? $t$('book.kanji', { count: number(estimate.uniqueKanji) }) : ''
        ]
          .filter(Boolean)
          .join($uiLanguage$ === 'ja' ? '' : ' ')
  );

  const sentLenKeys = {
    short: 'book.sentLenShort',
    average: 'book.sentLenAverage',
    long: 'book.sentLenLong'
  } as const;

  /** One decimal, rounded down: 97.96% is not 98.0% */
  const percent1 = (share: number) => (Math.floor(share * 1000) / 10).toFixed(1);

  function forYouLine(share: number, learn: number, atLeast: boolean) {
    return $t$(
      !learn ? 'book.forYouReached' : atLeast ? 'book.forYouLineMore' : 'book.forYouLine',
      { percent: percent1(share), learn: number(learn) }
    );
  }

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

  /** Standalone: estimates the stored book with the analysis tools (analysis-tools.ts). */
  async function estimateLocally() {
    const title = book.title;
    // By title: cards from other sources carry a dummy id, not the stored record's.
    const html =
      kind === 'manga'
        ? mokuro && mokuroHtml(mokuro)
        : (await database.getDataByTitle(title).catch(() => undefined))?.elementHtml;

    estimateError = '';
    if (!html) {
      estimateError = $t$(kind === 'manga' ? 'book.mangaNoText' : 'book.estimateNoText');
      return;
    }
    estimating = 0;
    try {
      await localEstimate(
        title,
        html,
        (share) => {
          if (title === book.title) estimating = share;
        },
        undefined,
        false,
        (result) => {
          if (title === book.title) coreFirst = result.core;
        }
      );
      if (title === book.title) onsaved?.();
    } catch (error) {
      if (title !== book.title) return;
      estimating = undefined;
      estimateError = $t$('book.estimateFailed', {
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  function showDifficulty() {
    dialogManager.dialogs$.next([{ component: DifficultyDialog, props: { books: [book] } }]);
  }
</script>

{#if part === 'box'}
  {#if hasDifficulty && level}
    <PointBox
      label={$t$('book.difficulty')}
      figure={level.score.toFixed(1)}
      unit={$t$('book.levelOutOf', { tier: level.tier })}
    >
      <div class="details-difficulty" title={difficultyNote}>
        <div class="details-difficulty-score">
          <span class="details-meter details-meter-ten" aria-hidden="true">
            {#each [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as i (i)}
              <span
                ><span style:width="{Math.min(Math.max(level.score - i + 1, 0), 1) * 100}%" /></span
              >
            {/each}
          </span>
        </div>
        <dl class="details-figures">
          {#if wordStats && !you}
            <div>
              <dt>{Math.floor(wordStats.share * 100)}%</dt>
              <dd>{$t$('book.knownFigure')}</dd>
            </div>
          {/if}
          <div>
            <dt>{level.v98 === null ? $t$('book.v98Beyond') : number(level.v98)}</dt>
            <dd>{$t$(level.v98 === null ? 'book.v98BeyondFigure' : 'book.v98Figure')}</dd>
          </div>
          {#if estimate?.uniqueKanji}
            <div>
              <dt>{number(estimate.uniqueKanji)}</dt>
              <dd>{$t$('book.kanjiFigureOnly')}</dd>
            </div>
          {/if}
          {#if facets?.fullFurigana}
            <div>
              <dt>{Math.round(facets.rubyKanji * 100)}%</dt>
              <dd>{$t$('book.fullFuriganaFigure')}</dd>
            </div>
          {/if}
          {#if facets?.withFurigana !== undefined}
            <div>
              <dt>{facets.withFurigana.toFixed(1)}</dt>
              <dd>{$t$('book.withFuriganaFigure')}</dd>
            </div>
          {/if}
          {#if facets}
            <div>
              <dt>{Math.round(facets.sentLen)}</dt>
              <dd>{$t$(sentLenKeys[facets.sentBand])}</dd>
            </div>
          {/if}
        </dl>
      </div>
      {#if you}
        <div class="details-for-you">
          <p class="details-for-you-head">
            <span class="details-for-you-label">{$t$('book.forYou')}</span>
            <span class="details-for-you-level">
              {$t$('book.forYouLevel', { level: relativeLevel(you.share).toFixed(1) })}
            </span>
          </p>
          <p>{youLine}</p>
          {#if unknownEvery}
            <p class="details-small">{unknownEvery}</p>
          {/if}
        </div>
      {/if}
      {#if book.calibreId !== undefined}
        <button type="button" class="app-button app-button-quiet" onclick={showDifficulty}>
          {$t$('book.difficultyDetails')}
        </button>
      {/if}
    </PointBox>
  {/if}
{:else if mangaWithoutText}
  <div>
    <dt>{$t$('book.difficulty')}</dt>
    <dd>{$t$('book.mangaNoText')}</dd>
  </div>
{:else if hasDifficulty && !level}
  <div>
    <dt>{$t$('book.difficulty')}</dt>
    <dd>
      {$t$('book.noEstimate')}
      <button type="button" class="app-button details-row-button" onclick={showDifficulty}>
        {$t$('book.difficultyDetails')}
      </button>
    </dd>
  </div>
{:else if canEstimate}
  <div>
    <dt>{$t$('book.difficulty')}</dt>
    <dd>
      {#if estimating === undefined}
        {$t$('book.noEstimate')}
        <button type="button" class="app-button details-row-button" onclick={estimateLocally}>
          {$t$('book.estimate')}
        </button>
        {#if estimateError}
          <span class="details-note" role="alert">{estimateError}</span>
        {/if}
      {:else}
        <span role="status">
          {$t$('book.estimating', { percent: Math.round(estimating * 100) })}
        </span>
      {/if}
    </dd>
  </div>
{/if}

<style>
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

  .details-meter-ten > span {
    width: 0.875rem;
  }

  .details-for-you {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    margin: 1.25rem 0 0.75rem;
    padding-top: 1rem;
    border-top: 1px solid var(--border-color);
    font-variant-numeric: tabular-nums;
  }

  .details-for-you-head {
    display: flex;
    align-items: baseline;
    gap: 0.75rem;
  }

  .details-for-you-label {
    color: var(--app-muted-fg);
    font-size: var(--type-label);
    font-weight: 700;
  }

  .details-for-you-level {
    font-size: var(--type-number);
    font-weight: 700;
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

  .details-row-button {
    --app-control-height: 2rem;
    padding: 0 0.6rem;
  }

  .details-note {
    display: block;
    width: 100%;
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }
</style>
