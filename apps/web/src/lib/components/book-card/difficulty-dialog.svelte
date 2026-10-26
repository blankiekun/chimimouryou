<script lang="ts">
  import DialogTemplate from '$lib/components/dialog-template.svelte';
  import DifficultyBadge from '$lib/components/book-card/difficulty-badge.svelte';
  import DifficultyPanel from '$lib/components/book-card/difficulty-panel.svelte';
  import type { BookCardProps } from '$lib/components/book-card/book-card-props';
  import { buttonClasses } from '$lib/css-classes';
  import { account$, hasPermission } from '$lib/data/account';
  import type { WordCoverage } from '$lib/data/book-words';
  import { loadCalibreDifficulty, type CalibreDifficulty } from '$lib/data/calibre';
  import { bookFacets, bookLevel, relativeLevel } from '$lib/data/difficulty-core';
  import { bookCoverage, getKnownSet } from '$lib/data/known-words';
  import { knownMinCount, wordList } from '$lib/data/words-met';
  import { t$ } from '$lib/i18n';
  import { createEventDispatcher, onMount } from 'svelte';

  /** Selected books of the Calibre source */
  export let books: BookCardProps[] = [];

  /** Word coverage needs each book's word list, so only for the first few. */
  const maxCoverageBooks = 20;
  const sentenceKeys = {
    short: 'difficulty.sentShort',
    average: 'difficulty.sentAverage',
    long: 'difficulty.sentLong'
  } as const;
  const dispatch = createEventDispatcher<{ close: void }>();

  let finishedCompute = false;
  let coverage: Record<number, WordCoverage | null> = {};
  let estimates: Record<number, CalibreDifficulty> = {};

  $: selectedIds = books.map((book) => book.calibreId as number);

  onMount(async () => {
    const [known, difficulty] = await Promise.all([
      getKnownSet().catch(() => undefined),
      loadCalibreDifficulty().catch(() => undefined)
    ]);

    if (difficulty) estimates = difficulty;
    if (!known || !difficulty) {
      return;
    }

    // One at a time: each book's share is also cached for the Known words sort.
    for (const id of selectedIds.slice(0, maxCoverageBooks)) {
      const estimate = difficulty[id];
      const words = estimate ? await wordList(id, estimate.computedAt).catch(() => null) : null;

      coverage = {
        ...coverage,
        [id]: (estimate && words && (await bookCoverage(id, words, estimate, known))) || null
      };
    }
  });
</script>

<DialogTemplate>
  <svelte:fragment slot="header">{$t$('book.difficulty')}</svelte:fragment>
  <div slot="content" class="flex max-w-xl flex-col gap-4 text-sm">
    <ul class="flex flex-col gap-2">
      {#each books.slice(0, maxCoverageBooks) as book (book.id)}
        {@const words = coverage[book.calibreId ?? -1]}
        {@const level = bookLevel(estimates[book.calibreId ?? -1]?.core)}
        {@const facets = bookFacets(estimates[book.calibreId ?? -1]?.core)}
        <li class="flex flex-col gap-0.5">
          <span class="flex items-center gap-2">
            <span class="truncate font-semibold" title={book.title}>{book.title}</span>
            {#if level}
              <DifficultyBadge difficulty={level.score} />
            {/if}
          </span>
          {#if !level}
            <span class="opacity-70">{$t$('book.noEstimate')}</span>
          {:else}
            <span>
              {$t$(level.v98 === null ? 'difficulty.levelBeyond' : 'difficulty.level', {
                words: level.v98?.toLocaleString('en-US') ?? ''
              })}
            </span>
            {#if facets}
              <span>
                {[
                  facets.fullFurigana ? $t$('difficulty.fullFurigana') : '',
                  $t$(sentenceKeys[facets.sentBand])
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            {/if}
            {#if words}
              <span>
                {$t$('difficulty.forYou', {
                  level: relativeLevel(words.share).toFixed(1),
                  percent: (Math.floor(words.share * 1000) / 10).toFixed(1)
                })}
              </span>
              <span class="opacity-70">
                {$t$(
                  words.unlisted
                    ? 'book.wordCoverageTail'
                    : words.complete
                      ? 'book.wordCoverage'
                      : 'book.wordCoverageTop',
                  {
                    count: words.words.toLocaleString(),
                    percent: Math.floor(words.share * 100),
                    new: words.newWords.toLocaleString(),
                    rare: words.unlisted.toLocaleString()
                  }
                )}
              </span>
            {/if}
          {/if}
        </li>
      {/each}
    </ul>
    <p class="opacity-70">{$t$('difficulty.scaleNote')}</p>
    {#if Object.values(coverage).some(Boolean)}
      <p class="opacity-70">{$t$('library.wordsNote', { count: knownMinCount })}</p>
    {/if}

    {#if hasPermission($account$, 'difficulty')}
      <DifficultyPanel {selectedIds} bind:finishedCompute />
    {/if}
  </div>
  <div slot="footer" class="flex gap-2">
    {#if finishedCompute}
      <button class={buttonClasses} on:click={() => window.location.reload()}>
        {$t$('library.reload')}
      </button>
    {/if}
    <button class={buttonClasses} on:click={() => dispatch('close')}>{$t$('library.close')}</button>
  </div>
</DialogTemplate>
