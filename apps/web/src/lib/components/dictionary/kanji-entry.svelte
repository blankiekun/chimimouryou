<script lang="ts">
  /**
   * One kanji in the lookup popup, laid out like Yomitan's (DisplayGenerator.createKanjiEntry):
   * the character, its tags and the dictionary's, frequencies (Yomitan's grouping), then a table
   * of meanings, on'yomi and kun'yomi, statistics, classifications, codepoints and dictionary
   * indices, each left out when empty. Yomitan's class names, so custom popup CSS still applies.
   * Copy and Add to Anki as on term entries (no audio, as in Yomitan). Not part of upstream.
   */
  import { faCopy } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import type { DictionarySummary } from '$lib/data/dictionary/dictionary';
  import type { ScreenshotSource } from '$lib/data/dictionary/anki-dictionary';
  import { t$ } from '$lib/i18n';
  import { groupKanjiFrequencies } from '$lib/vendor/yomitan/dictionary/dictionary-data-util';
  import type { AnkiNoteContext } from '$lib/vendor/yomitan/data/anki-note-builder';
  import type { KanjiDictionaryEntry, KanjiStat, Tag } from '$lib/vendor/yomitan/types/dictionary';
  import type { ProfileOptions } from '$lib/vendor/yomitan/types/settings';
  import AnkiAddButton from './anki-add-button.svelte';

  interface Props {
    entry: KanjiDictionaryEntry;
    options: ProfileOptions;
    summaries: DictionarySummary[];
    current?: boolean;
    /** Where the kanji was looked up, for Add to Anki (none: no button) */
    ankiContext?: AnkiNoteContext;
    screenshot?: ScreenshotSource;
    ankiCommand?: { action: string; argument: string; id: number };
    oncopy?: (text: string) => void;
  }

  let {
    entry,
    options,
    summaries,
    current = false,
    ankiContext,
    screenshot,
    ankiCommand,
    oncopy
  }: Props = $props();

  const frequencies = $derived(groupKanjiFrequencies(entry.frequencies, summaries));
  const frequencyAsTags = $derived(options.general.frequencyDisplayMode.includes('tags'));
  const info = $derived(summaries.find(({ title }) => title === entry.dictionary));
  // createKanjiEntry's dictionary tag: title, author, description, URL and kanji count
  const dictionaryTitle = $derived(
    info
      ? [
          info.title,
          info.author && `Author: ${info.author}`,
          info.description && `Description: ${info.description}`,
          info.url && `URL: ${info.url}`,
          info.counts?.kanji?.total ? `Kanji Count: ${info.counts.kanji.total}` : ''
        ]
          .filter(Boolean)
          .join('\n')
      : entry.dictionary
  );
  const tables = $derived(
    (
      [
        ['statistics', 'lookup.kanjiStatistics', entry.stats.misc],
        ['classifications', 'lookup.kanjiClassifications', entry.stats.class],
        ['codepoints', 'lookup.kanjiCodepoints', entry.stats.code],
        ['dictionary-indices', 'lookup.kanjiIndices', entry.stats.index]
      ] as const
    ).filter(([, , stats]) => stats?.length)
  );

  const tagTitle = (tag: Tag) => tag.content.join('\n') || tag.name;
  const statName = ({ content, name }: KanjiStat) => (content.length > 0 ? content : name);
  const frequencyText = (values: { frequency: number; displayValue: string | null }[]) =>
    values.map(({ frequency, displayValue }) => displayValue ?? `${frequency}`).join(', ');
</script>

<article
  class="entry kanji-entry"
  class:current
  data-type="kanji"
  data-dictionary={entry.dictionary}
  lang="ja"
>
  <header class="entry-head">
    <div class="kanji-glyph-container">
      <span class="kanji-glyph source-text">{entry.character}</span>
    </div>
    <div class="entry-actions">
      <button
        type="button"
        class="entry-action"
        title={$t$('lookup.copyKanji')}
        aria-label={$t$('lookup.copyKanji')}
        onclick={() => oncopy?.(entry.character)}
      >
        <Fa icon={faCopy} />
      </button>
      {#if ankiContext}
        <AnkiAddButton
          {entry}
          {options}
          {summaries}
          context={ankiContext}
          {screenshot}
          command={ankiCommand}
        />
      {/if}
    </div>
  </header>

  <div class="kanji-tag-list tag-list">
    {#each entry.tags as tag}
      <span class="tag" data-category={tag.category} title={tagTitle(tag)}>{tag.name}</span>
    {/each}
    <span class="tag" data-category="dictionary" title={dictionaryTitle}
      >{entry.dictionaryAlias}</span
    >
    {#if frequencyAsTags}
      {#each frequencies as { dictionaryAlias, frequencies: items }}
        {#each items as { values }}
          <span class="tag tag-frequency" title={dictionaryAlias}>
            <span class="tag-label">{dictionaryAlias}</span>
            <span class="tag-body">{frequencyText(values)}</span>
          </span>
        {/each}
      {/each}
    {/if}
  </div>

  {#if !frequencyAsTags && frequencies.length}
    <ul class="frequency-list frequency-group-list">
      {#each frequencies as { dictionaryAlias, frequencies: items }}
        {#each items as { values }}
          <li>
            <span class="frequency-dictionary">{dictionaryAlias}</span>
            {frequencyText(values)}
          </li>
        {/each}
      {/each}
    </ul>
  {/if}

  <table class="kanji-glyph-table">
    <tbody>
      {#if entry.definitions.length}
        <tr>
          <th scope="row" class="kanji-meaning-header">{$t$('lookup.kanjiMeaning')}</th>
          <td class="kanji-gloss-container">
            <ol class="kanji-gloss-list">
              {#each entry.definitions as definition}
                <li class="kanji-gloss-item">
                  <span class="kanji-gloss-content">{definition}</span>
                </li>
              {/each}
            </ol>
          </td>
        </tr>
      {/if}
      {#if entry.onyomi.length || entry.kunyomi.length}
        <tr>
          <th scope="row" class="kanji-readings-header">{$t$('lookup.kanjiReadings')}</th>
          <td class="kanji-readings">
            {#if entry.onyomi.length}
              <dl class="kanji-readings-chinese">
                {#each entry.onyomi as reading}<dd>{reading}</dd>{/each}
              </dl>
            {/if}
            {#if entry.kunyomi.length}
              <dl class="kanji-readings-japanese">
                {#each entry.kunyomi as reading}<dd>{reading}</dd>{/each}
              </dl>
            {/if}
          </td>
        </tr>
      {/if}
      {#each tables as [kind, label, stats]}
        <tr>
          <th scope="row" class="kanji-{kind}-header">{$t$(label)}</th>
          <td class="kanji-{kind}">
            <table class="kanji-info-table">
              <tbody class="kanji-info-table-body">
                {#each stats as stat}
                  <tr class="kanji-info-table-item">
                    <th scope="row" class="kanji-info-table-item-header">{statName(stat)}</th>
                    <td class="kanji-info-table-item-value">{stat.value}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
</article>

<style>
  .kanji-glyph {
    font-size: 3.5em;
    line-height: 1.15;
  }

  .kanji-glyph-table {
    width: 100%;
    margin-top: 0.5rem;
    border-collapse: collapse;
    border-top: 2px solid var(--reader-panel-fg);
    font-size: var(--type-small);
  }

  .kanji-glyph-table > tbody > tr {
    border-bottom: 1px solid color-mix(in srgb, var(--reader-panel-fg) 16%, transparent);
  }

  .kanji-glyph-table > tbody > tr > th {
    width: 6.5rem;
    padding: 0.4rem 0.75rem 0.4rem 0;
    color: var(--app-muted-fg);
    font-size: var(--type-label);
    font-weight: 700;
    text-align: left;
    vertical-align: top;
  }

  .kanji-glyph-table > tbody > tr > td {
    padding: 0.4rem 0;
    vertical-align: top;
  }

  .kanji-gloss-list {
    margin: 0;
    padding-left: 1.25em;
    list-style: decimal;
  }

  .kanji-gloss-content {
    white-space: pre-line;
  }

  .kanji-readings dl {
    display: flex;
    flex-wrap: wrap;
    gap: 0 0.75rem;
    margin: 0;
    font-size: 1.15em;
  }

  .kanji-readings dd {
    margin: 0;
  }

  .kanji-readings-japanese {
    margin-top: 0.25rem;
  }

  .kanji-info-table {
    border-collapse: collapse;
  }

  .kanji-info-table-item-header {
    padding: 0 0.75rem 0.15rem 0;
    font-weight: 400;
    text-align: left;
  }

  .kanji-info-table-item-value {
    font-variant-numeric: tabular-nums;
  }

  @media (max-width: 639px) {
    .kanji-glyph-table > tbody > tr > th {
      width: 5rem;
    }
  }
</style>
