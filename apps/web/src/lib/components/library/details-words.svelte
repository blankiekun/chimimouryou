<script lang="ts">
  import type { BookCardProps } from '$lib/components/book-card/book-card-props';
  import {
    analysisToolsState$,
    makeReadings,
    redoWordList
  } from '$lib/data/analysis/analysis-tools';
  import type { BookDetails } from '$lib/data/library/book-details';
  import type { MetadataKind } from '$lib/data/library/book-metadata';
  import { standalone } from '$lib/data/env';
  import { bookWordGroups } from '$lib/data/words/known-words';
  import { database, generatedFurigana$ } from '$lib/data/store';
  import { wordMarks$ } from '$lib/data/words/word-marks';
  import { t$ } from '$lib/i18n';

  /**
   * The book page's Words row (new · known · ignored, the link to Book words, standalone's redo
   * with readings) and standalone's Furigana row, in the facts list of book-details.svelte.
   */

  interface Props {
    book: BookCardProps;
    kind: MetadataKind;
    details: BookDetails;
    /** Show the book's word list */
    onwords: () => void;
    /** The readings file was made */
    onreadings: () => void;
    /** The word list was made again: the page loads again */
    onsaved: () => void;
  }

  let { book, kind, details, onwords, onreadings, onsaved }: Props = $props();

  /** Standalone: a readings file being made, and its error; the word list's redo */
  let generating = $state<number>();
  let readingsError = $state('');
  let redoing = $state<number>();

  const { listWords, knownSet, estimate, listWithoutReader, readingsMissing } = $derived(details);

  const number = (value: number) => value.toLocaleString('en-US');

  const furiganaReady = $derived(
    standalone && kind === 'book' && $analysisToolsState$.furigana === 'ready'
  );
  const wordGroups = $derived(
    listWords.length && knownSet
      ? bookWordGroups(listWords, estimate?.words95, knownSet, $wordMarks$)
      : undefined
  );

  /** Standalone: makes the book's readings file now, ahead of the background (analysis-tools.ts). */
  async function generateReadings() {
    const title = book.title;
    const data = await database.getDataByTitle(title).catch(() => undefined);

    readingsError = '';
    if (!data?.elementHtml) {
      readingsError = 'This book has no text stored in this browser.';
      return;
    }
    generating = 0;
    try {
      await makeReadings(title, data.elementHtml, (share) => {
        if (title === book.title) generating = share;
      });
      if (title === book.title) onreadings();
    } catch (error) {
      if (title === book.title) {
        readingsError = `Generating readings failed: ${error instanceof Error ? error.message : String(error)}`;
      }
    } finally {
      if (title === book.title) generating = undefined;
    }
  }

  /** Standalone: makes the word list again with yurigana's readings; the score stays. */
  async function redoList() {
    const title = book.title;
    const data = await database.getDataByTitle(title).catch(() => undefined);

    if (!data?.elementHtml) return;
    redoing = 0;
    try {
      await redoWordList(title, data.elementHtml, (share) => {
        if (title === book.title) redoing = share;
      });
    } catch (error) {
      console.warn(`Word list for “${title}”:`, error);
    } finally {
      if (title === book.title) redoing = undefined;
    }
    if (title === book.title) onsaved();
  }
</script>

{#if wordGroups}
  <div>
    <dt>{$t$('book.words')}</dt>
    <dd>
      {$t$('book.wordsValue', {
        new: number(wordGroups.new.length),
        known: number(wordGroups.known.length),
        ignored: number(wordGroups.ignored.length)
      })}
      <button type="button" class="app-button app-button-quiet" onclick={onwords}>
        {$t$('book.wordList')}
      </button>
      {#if furiganaReady && listWithoutReader}
        {#if redoing === undefined}
          <button
            type="button"
            class="app-button details-row-button"
            title="Reads each word in context; the difficulty stays the same"
            onclick={redoList}
          >
            Redo with readings
          </button>
        {:else}
          <span class="details-note" role="status">
            Redoing the word list… {Math.round(redoing * 100)}%
          </span>
        {/if}
      {/if}
    </dd>
  </div>
{/if}
{#if furiganaReady && $generatedFurigana$ && readingsMissing}
  <div>
    <dt>Furigana</dt>
    <dd>
      {#if generating === undefined}
        No readings yet
        <button type="button" class="app-button details-row-button" onclick={generateReadings}>
          Generate readings
        </button>
        {#if readingsError}
          <span class="details-note" role="alert">{readingsError}</span>
        {/if}
      {:else}
        <span role="status">Generating readings… {Math.round(generating * 100)}%</span>
      {/if}
    </dd>
  </div>
{/if}

<style>
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
