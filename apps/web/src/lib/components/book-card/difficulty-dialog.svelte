<script lang="ts">
  import DialogTemplate from '$lib/components/dialog-template.svelte';
  import DifficultyBadge from '$lib/components/book-card/difficulty-badge.svelte';
  import DifficultyPanel from '$lib/components/book-card/difficulty-panel.svelte';
  import type { BookCardProps } from '$lib/components/book-card/book-card-props';
  import { buttonClasses } from '$lib/css-classes';
  import { account$, hasPermission } from '$lib/data/account';
  import { loadBookKanji } from '$lib/data/calibre';
  import { getKanjiSeen, kanjiCoverage, type KanjiCoverage } from '$lib/data/kanji-seen';
  import { t$ } from '$lib/i18n';
  import { createEventDispatcher, onMount } from 'svelte';

  /** Selected books of the Calibre source */
  export let books: BookCardProps[] = [];

  /** Kanji coverage is fetched per book, so only for the first few. */
  const maxCoverageBooks = 20;
  const dispatch = createEventDispatcher<{ close: void }>();

  let finishedCompute = false;
  let coverage: Record<number, KanjiCoverage | null> = {};

  $: selectedIds = books.map((book) => book.calibreId as number);

  onMount(async () => {
    const seen = await getKanjiSeen().catch(() => []);

    if (!seen.length) {
      return;
    }

    await Promise.all(
      selectedIds.slice(0, maxCoverageBooks).map(async (id) => {
        const counts = await loadBookKanji(id).catch(() => undefined);

        coverage = { ...coverage, [id]: (counts && kanjiCoverage(counts, seen)) || null };
      })
    );
  });
</script>

<DialogTemplate>
  <svelte:fragment slot="header">{$t$('book.difficulty')}</svelte:fragment>
  <div slot="content" class="flex max-w-xl flex-col gap-4 text-sm">
    <ul class="flex flex-col gap-2">
      {#each books.slice(0, maxCoverageBooks) as book (book.id)}
        {@const kanji = coverage[book.calibreId ?? -1]}
        <li class="flex flex-col gap-0.5">
          <span class="flex items-center gap-2">
            <span class="truncate font-semibold" title={book.title}>{book.title}</span>
            {#if book.difficulty !== undefined}
              <DifficultyBadge
                difficulty={book.difficulty}
                low={book.difficultyLow}
                high={book.difficultyHigh}
                words95={book.words95}
              />
            {/if}
          </span>
          {#if book.difficulty === undefined}
            <span class="opacity-70">{$t$('book.noEstimate')}</span>
          {:else}
            {#if book.difficultyLow !== undefined && book.difficultyHigh !== undefined}
              <span class="opacity-70">
                {$t$('library.likelyRange', {
                  low: book.difficultyLow.toFixed(1),
                  high: book.difficultyHigh.toFixed(1)
                })}
              </span>
            {/if}
            {#if book.words95}
              <span class="opacity-70">
                {$t$('difficulty.words95', { count: book.words95.toLocaleString() })}
              </span>
            {/if}
            {#if kanji}
              <span>
                {$t$(kanji.newKanji ? 'book.kanjiMetOnlyNew' : 'book.kanjiMetOnly', {
                  percent: (kanji.coverage * 100).toFixed(1),
                  new: kanji.newKanji.toLocaleString()
                })}
              </span>
            {/if}
          {/if}
        </li>
      {/each}
    </ul>
    {#if Object.values(coverage).some(Boolean)}
      <p class="opacity-70">{$t$('library.kanjiNote')}</p>
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
