<script lang="ts">
  import PointBox from '$lib/components/point-box.svelte';
  import SectionHead from '$lib/components/section-head.svelte';
  import KnownBecause from '$lib/components/words/known-because.svelte';
  import type { BookCardProps } from '$lib/components/book-card/book-card-props';
  import { localWordList } from '$lib/data/analysis-tools';
  import {
    downloadWordsCsv,
    wordCoverage,
    type BookWord,
    type WordTotals
  } from '$lib/data/book-words';
  import { loadCalibreDifficulty, type CalibreDifficulty } from '$lib/data/calibre';
  import {
    bookWordGroups,
    getKnownSet,
    refreshKnownWordsIfStale,
    type KnownSet
  } from '$lib/data/known-words';
  import { markEntry, marksOf, setWordMarks, wordMark, wordMarks$ } from '$lib/data/word-marks';
  import { knownMinCount, wordList } from '$lib/data/words-met';
  import { placementCutoff$ } from '$lib/data/placement';
  import { t$, tr } from '$lib/i18n';
  import { createEventDispatcher, onMount } from 'svelte';

  /**
   * A book's word list (Book words, over its book page): coverage, why words are known, and
   * every listed word by group with ✓/✕ marks, Copy and CSV. Not part of upstream.
   */

  export let book: BookCardProps;

  const dispatch = createEventDispatcher<{ close: void }>();
  const pageSize = 50;

  type View = 'new' | 'known' | 'ignored' | 'all';

  let layer: HTMLDivElement;
  let estimate: CalibreDifficulty | undefined;
  /** A local book's totals (analysis tools) */
  let totals: WordTotals | undefined;
  let list: BookWord[] | null | undefined;
  let known: KnownSet | undefined;
  let view: View = 'new';
  let search = '';
  let limit = pageSize;
  let copied = false;

  const number = (value: number) => value.toLocaleString('en-US');

  $: groups =
    list && known ? bookWordGroups(list, estimate?.words95, known, $wordMarks$) : undefined;
  $: coverage =
    list && known
      ? wordCoverage(
          list,
          (word) => known!.met(word) || known!.anki(word) || !!wordMark($wordMarks$, word),
          estimate ?? totals
        )
      : undefined;
  $: shown = (groups?.[view] ?? []).filter(
    ([form, reading]) => !search.trim() || `${form} ${reading ?? ''}`.includes(search.trim())
  );
  $: (view, search, (limit = pageSize), (copied = false));
  $: views = groups
    ? ([
        ['new', $t$('words.newCount', { count: number(groups.new.length) })],
        ['known', $t$('words.knownCount', { count: number(groups.known.length) })],
        ['ignored', $t$('words.ignoredCount', { count: number(groups.ignored.length) })],
        ['all', $t$('words.all', { count: number(groups.all.length) })]
      ] as [View, string][])
    : [];

  onMount(async () => {
    layer.focus();
    if (book.calibreId === undefined) {
      const local = await localWordList(book.title).catch(() => undefined);

      totals = local?.totals;
      [list, known] = [
        local?.words ?? null,
        local &&
          (await refreshKnownWordsIfStale()
            .then(getKnownSet)
            .catch(() => undefined))
      ];
      return;
    }

    const id = book.calibreId;
    const difficulty = await loadCalibreDifficulty().catch(() => undefined);

    estimate = difficulty?.[id];
    [list, known] = await Promise.all([
      estimate ? wordList(id, estimate.computedAt).catch(() => null) : null,
      refreshKnownWordsIfStale()
        .then(getKnownSet)
        .catch(() => undefined)
    ]);
  });

  function markAllShown() {
    const words = shown.slice(0, limit).filter((word) => !wordMark($wordMarks$, word));

    if (words.length && confirm(tr('book.markAllKnownConfirm', { count: words.length }))) {
      setWordMarks(
        words.map((word) => markEntry(list ?? [], word)),
        'known'
      );
    }
  }

  async function copy() {
    await navigator.clipboard.writeText(shown.map(([form]) => form).join('\n'));
    copied = true;
  }
</script>

<svelte:window on:keydown={(ev) => ev.key === 'Escape' && dispatch('close')} />

<div
  class="words-layer"
  role="dialog"
  aria-modal="true"
  aria-labelledby="book-words-title"
  tabindex="-1"
  bind:this={layer}
>
  <div class="words-page">
    <nav class="words-bar" aria-label={$t$('nav.back')}>
      <button
        type="button"
        class="app-button app-button-quiet words-back"
        lang="ja"
        on:click={() => dispatch('close')}
      >
        ← {book.displayTitle || book.title}
      </button>
      <span class="words-crumb">/ {$t$('bookWords.crumb')}</span>
    </nav>

    <header>
      <h1 id="book-words-title" class="words-title">
        {$t$('bookWords.title', { title: book.displayTitle || book.title })}
      </h1>
      {#if list}
        <p class="words-subtitle">{$t$('bookWords.subtitle', { count: number(list.length) })}</p>
      {/if}
    </header>

    {#if list === null}
      <p class="words-subtitle">{$t$('bookWords.noList')}</p>
    {:else if groups}
      <div class="words-top">
        <div class="words-point">
          <PointBox
            label={$t$('bookWords.coverage')}
            figure={coverage ? `${Math.floor(coverage.share * 100)}%` : '–'}
          >
            <p class="words-point-text">
              {$t$('bookWords.coverageText')}
              <small>
                {$t$('bookWords.counts', {
                  known: number(groups.known.length),
                  new: number(groups.new.length),
                  ignored: number(groups.ignored.length)
                })}
              </small>
            </p>
          </PointBox>
        </div>
        <KnownBecause
          rows={[
            {
              label: $t$('words.becauseMet', { count: knownMinCount }),
              value: groups.reasons.met
            },
            { label: $t$('words.becauseAnki'), value: groups.reasons.anki },
            ...($placementCutoff$ > 0
              ? [
                  {
                    label: $t$('bookWords.becausePlaced', {
                      count: $placementCutoff$.toLocaleString('en-US')
                    }),
                    value: groups.reasons.placed
                  }
                ]
              : []),
            { label: $t$('words.becauseMarked'), value: groups.reasons.marked },
            { label: $t$('words.becauseIgnored'), value: groups.reasons.ignored }
          ]}
        />
      </div>

      <section class="words-list" aria-label={$t$('bookWords.list')}>
        <SectionHead number={1} title={$t$('bookWords.list')} count={number(groups.all.length)} />

        <div class="words-tools">
          <div class="app-segmented" role="group" aria-label={$t$('words.filter')}>
            {#each views as [id, label] (id)}
              <button
                type="button"
                class="app-segment"
                class:app-segment-selected={view === id}
                aria-pressed={view === id}
                on:click={() => (view = id)}
              >
                {label}
              </button>
            {/each}
          </div>
          <input
            type="search"
            lang="ja"
            class="app-input words-search"
            aria-label={$t$('bookWords.search')}
            placeholder={$t$('bookWords.search')}
            bind:value={search}
          />
          <span class="words-actions">
            <button
              type="button"
              class="app-button app-button-quiet"
              disabled={!shown.length}
              on:click={copy}
            >
              {copied ? $t$('book.copied') : $t$('book.copy')}
            </button>
            <button
              type="button"
              class="app-button app-button-quiet"
              disabled={!shown.length}
              on:click={() => downloadWordsCsv(book.title, shown)}
            >
              {$t$('bookWords.csv')}
            </button>
            {#if view !== 'known' && view !== 'ignored'}
              <button
                type="button"
                class="app-button words-mark-all"
                disabled={!shown.length}
                on:click={markAllShown}
              >
                {$t$('book.markAllKnown')}
              </button>
            {/if}
          </span>
        </div>

        <table class="app-table words-table">
          <thead>
            <tr>
              <th class="words-wide">#</th>
              <th>{$t$('words.word')}</th>
              <th class="words-wide">{$t$('words.reading')}</th>
              <th>
                <span class="words-wide">{$t$('bookWords.inBook')}</span>
                <span class="words-narrow">{$t$('bookWords.inBookShort')}</span>
              </th>
              <th class="words-wide">{$t$('bookWords.rank')}</th>
              <th><span class="sr-only">{$t$('words.status')}</span></th>
            </tr>
          </thead>
          <tbody>
            {#each shown.slice(0, limit) as word, i (`${word[0]}\t${word[1]}`)}
              {@const [form, reading, count, rank] = word}
              {@const mark = wordMark($wordMarks$, word)}
              <tr>
                <td class="words-wide words-muted">{i + 1}</td>
                <td class="words-word" lang="ja">
                  {form}
                  <span class="words-narrow words-sub">{reading ?? '—'}</span>
                </td>
                <td class="words-wide words-muted" lang="ja">{reading ?? '—'}</td>
                <td>
                  ×{number(count)}
                  <span class="words-narrow words-sub">{rank ? `#${number(rank)}` : '—'}</span>
                </td>
                <td class="words-wide words-muted">{rank ? `#${number(rank)}` : '—'}</td>
                <td>
                  <div class="words-marks">
                    {#if mark}
                      <span class="app-tag" class:app-tag-muted={mark === 'ignored'}>
                        {$t$(mark === 'known' ? 'anki.markedKnown' : 'anki.markedIgnored')}
                      </span>
                      <button
                        type="button"
                        class="app-button app-button-quiet"
                        title={$t$('book.unmarkWord', { word: form })}
                        on:click={() => setWordMarks(marksOf($wordMarks$, word), null)}
                      >
                        {$t$('anki.unmark')}
                      </button>
                    {:else if view !== 'new' && known?.isKnown(word)}
                      <span class="app-tag">{$t$('anki.markedKnown')}</span>
                    {:else}
                      <button
                        type="button"
                        class="app-button words-mark"
                        title={$t$('book.markKnown', { word: form })}
                        aria-label={$t$('book.markKnown', { word: form })}
                        on:click={() => setWordMarks([markEntry(list ?? [], word)], 'known')}
                      >
                        ✓<span class="words-wide">{$t$('bookWords.known')}</span>
                      </button>
                      <button
                        type="button"
                        class="app-button words-mark"
                        title={$t$('book.markIgnored', { word: form })}
                        aria-label={$t$('book.markIgnored', { word: form })}
                        on:click={() => setWordMarks([markEntry(list ?? [], word)], 'ignored')}
                      >
                        ✕<span class="words-wide">{$t$('bookWords.ignore')}</span>
                      </button>
                    {/if}
                  </div>
                </td>
              </tr>
            {:else}
              <tr><td colspan="6" class="words-muted">{$t$('bookWords.none')}</td></tr>
            {/each}
          </tbody>
        </table>

        {#if shown.length}
          <p class="words-footer">
            {$t$('words.showing', {
              shown: number(Math.min(limit, shown.length)),
              total: number(shown.length)
            })}
            {#if shown.length > limit}
              ·
              <button
                type="button"
                class="app-button app-button-quiet words-more"
                on:click={() => (limit += pageSize)}
              >
                {$t$('words.showMore')}
              </button>
            {/if}
          </p>
        {/if}
      </section>
    {/if}
  </div>
</div>

<style>
  .words-layer {
    position: fixed;
    /* Over the book page: under the app header (4rem, 3.25rem from xl) and the phones' tab bar */
    inset: 4rem 0 0;
    z-index: 39;
    outline: none;
    overflow-y: auto;
    overscroll-behavior: contain;
    background: var(--background-color);
    color: var(--font-color);
  }

  @media (min-width: 1280px) {
    .words-layer {
      top: 3.25rem;
    }
  }

  @media (max-width: 639px) {
    .words-layer {
      bottom: calc(3.5rem + env(safe-area-inset-bottom));
    }
  }

  .words-page {
    display: flex;
    max-width: 75rem;
    flex-direction: column;
    gap: 2.5rem;
    margin: 0 auto;
    padding: 1.25rem 1rem calc(3rem + env(safe-area-inset-bottom));
  }

  @media (min-width: 768px) {
    .words-page {
      padding: 2rem 2.5rem 4rem;
    }
  }

  .words-bar {
    display: flex;
    min-width: 0;
    align-items: baseline;
    gap: 0.5rem;
    margin-bottom: -1rem;
  }

  .words-back {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .words-crumb {
    flex: none;
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }

  .words-title {
    font-size: var(--type-h1);
    font-weight: 400;
    line-height: 1.3;
    overflow-wrap: anywhere;
  }

  .words-subtitle {
    margin-top: 0.25rem;
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }

  .words-top {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    align-items: start;
    gap: 2rem;
  }

  @media (min-width: 1024px) {
    .words-top {
      grid-template-columns: minmax(0, 0.9fr) minmax(0, 1fr);
      gap: 2.5rem;
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

  .words-list {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }

  .words-tools {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.75rem;
  }

  .words-search {
    min-width: 0;
    flex: 0 1 15rem;
  }

  .words-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 1.25rem;
    margin-left: auto;
  }

  .words-word {
    font-size: 1.05rem;
    font-weight: 700;
  }

  .words-muted,
  .words-sub {
    color: var(--app-muted-fg);
  }

  .words-sub {
    display: block;
    font-size: var(--type-label);
    font-weight: 400;
  }

  .words-marks {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: 0.5rem;
  }

  .words-mark {
    --app-control-height: 1.75rem;
    gap: 0.3rem;
    padding: 0 0.5rem;
    font-weight: 400;
  }

  .words-footer {
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }

  .words-more {
    color: inherit;
    font-weight: 400;
  }

  .words-narrow {
    display: none;
  }

  @media (max-width: 639px) {
    .words-search {
      flex-basis: 100%;
    }

    .words-actions {
      margin-left: 0;
    }

    .words-mark-all {
      order: -1;
    }

    .words-wide {
      display: none;
    }

    .words-narrow {
      display: block;
    }
  }
</style>
