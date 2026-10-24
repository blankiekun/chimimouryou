<script lang="ts">
  /**
   * One term in the lookup popup, laid out like Yomitan's (DisplayGenerator.createTermEntry):
   * headwords with furigana, the deinflection chain, tags, frequencies, pronunciations and the
   * glossary per dictionary. The grouping is Yomitan's own (dictionary-data-util.js); glossary
   * items and pitch accents are drawn by its generators (structured-content.ts). Not part of
   * upstream.
   */
  import { faCheck, faCopy, faVolumeHigh } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { createEventDispatcher } from 'svelte';
  import type { DictionarySummary } from '$lib/data/dictionary';
  import { formMarked, wordMarks$ } from '$lib/data/word-marks';
  import { t$ } from '$lib/i18n';
  import {
    getDisambiguations,
    getGroupedPronunciations,
    getTermFrequency,
    groupTermFrequencies,
    groupTermTags
  } from '$lib/vendor/yomitan/dictionary/dictionary-data-util';
  import { distributeFurigana } from '$lib/vendor/yomitan/language/ja/japanese';
  import type { Tag, TermDictionaryEntry } from '$lib/vendor/yomitan/types/dictionary';
  import type { ProfileOptions } from '$lib/vendor/yomitan/types/settings';
  import { glossary, pitchAccent } from './structured-content';

  export let entry: TermDictionaryEntry;
  export let options: ProfileOptions;
  export let summaries: DictionarySummary[];
  export let current = false;
  export let audio = false;

  const dispatch = createEventDispatcher<{
    lookup: string;
    audio: { term: string; reading: string };
    markKnown: string;
    copy: string;
  }>();

  $: general = options.general;
  $: headwords = entry.headwords;
  $: uniqueTerms = new Set(headwords.map(({ term }) => term));
  $: uniqueReadings = new Set(headwords.map(({ reading }) => reading));
  $: termTags = groupTermTags(entry);
  $: frequencies = groupTermFrequencies(entry, summaries).filter(
    ({ dictionary }) => general.averageFrequency || dictionary !== 'Average'
  );
  $: pronunciations = getGroupedPronunciations(entry);
  $: inflections = entry.inflectionRuleChainCandidates.filter(
    ({ inflectionRules }) => inflectionRules.length
  );
  $: frequencyAsTags = general.frequencyDisplayMode.includes('tags');
  $: compact = general.glossaryLayoutMode === 'compact';
  $: collapsible = new Map(
    options.dictionaries.map(({ name, definitionsCollapsible }) => [name, definitionsCollapsible])
  );
  $: first = headwords[0];
  $: known = !!first && formMarked($wordMarks$, first.term);
  // The dictionary tag shows once per run of definitions from one dictionary (createTermEntry).
  $: definitions = entry.definitions.map((definition, index) => ({
    definition,
    redundant: index > 0 && entry.definitions[index - 1].dictionary === definition.dictionary,
    disambiguations: getDisambiguations(
      headwords,
      definition.headwordIndices,
      uniqueTerms,
      uniqueReadings
    )
  }));

  function dictionaryDetails(name: string) {
    const info = summaries.find(({ title }) => title === name);
    if (!info) return name;
    return [
      info.title,
      `rev.${info.revision}`,
      info.author && `Author: ${info.author}`,
      info.attribution && `Attribution: ${info.attribution}`
    ]
      .filter(Boolean)
      .join('\n');
  }

  const tagTitle = (tag: Tag) => tag.content.join('\n') || tag.name;
  const frequencyText = (values: { frequency: number; displayValue: string | null }[]) =>
    values.map(({ frequency, displayValue }) => displayValue ?? `${frequency}`).join(', ');
  const lookup = (query: string) => dispatch('lookup', query);
  $: showReading = (term: string, reading: string) =>
    reading !== term &&
    (general.termDisplayMode === 'ruby-and-reading' ||
      general.termDisplayMode === 'term-and-reading');
  $: furigana =
    general.termDisplayMode === 'ruby' || general.termDisplayMode === 'ruby-and-reading';
</script>

<article class="entry" class:current lang="ja" data-glossary-layout={general.glossaryLayoutMode}>
  <header class="entry-head">
    <div class="headword-list">
      {#each headwords as { term, reading, tags }, index}
        <span class="headword" data-frequency={getTermFrequency(tags)} data-index={index}>
          <span class="headword-term">
            {#if furigana}
              {#each distributeFurigana(term, reading) as segment}
                {#if segment.reading}
                  <ruby>{segment.text}<rt>{segment.reading}</rt></ruby>
                {:else}{segment.text}{/if}
              {/each}
            {:else}{term}{/if}
          </span>
          {#if showReading(term, reading)}
            <span class="headword-reading">{reading}</span>
          {/if}
        </span>
      {/each}
    </div>
    <div class="entry-actions">
      {#if audio}
        <button
          type="button"
          class="entry-action"
          title={$t$('lookup.playAudio')}
          aria-label={$t$('lookup.playAudio')}
          on:click={() => dispatch('audio', { term: first.term, reading: first.reading })}
        >
          <Fa icon={faVolumeHigh} />
        </button>
      {/if}
      <button
        type="button"
        class="entry-action"
        title={$t$('lookup.copy')}
        aria-label={$t$('lookup.copy')}
        on:click={() => dispatch('copy', first.term)}
      >
        <Fa icon={faCopy} />
      </button>
      <button
        type="button"
        class="entry-action entry-known"
        title={$t$('book.markKnown', { word: first.term })}
        aria-label={$t$('book.markKnown', { word: first.term })}
        aria-pressed={known}
        disabled={known}
        on:click={() => dispatch('markKnown', first.term)}
      >
        <Fa icon={faCheck} />
        <span>{$t$(known ? 'reader.wordKnown' : 'reader.markKnown')}</span>
      </button>
    </div>
  </header>

  {#each inflections as { inflectionRules }}
    <p class="inflection-rule-chain">
      {#each inflectionRules as { name, description }}
        <span class="inflection" title={description}>{name}</span>
      {/each}
    </p>
  {/each}

  {#if termTags.length || (frequencyAsTags && frequencies.length)}
    <div class="tag-list">
      {#each termTags as { tag }}
        <span class="tag" data-category={tag.category} title={tagTitle(tag)}>{tag.name}</span>
      {/each}
      {#if frequencyAsTags}
        {#each frequencies as { dictionaryAlias, frequencies: items }}
          {#each items as { term, reading, values }}
            <span class="tag tag-frequency" title={dictionaryAlias}>
              <span class="tag-label">{dictionaryAlias}</span>
              <span class="tag-body">
                {#if uniqueTerms.size > 1 || uniqueReadings.size > 1}
                  <span class="frequency-disambiguation">{reading ?? term}</span>
                {/if}
                {frequencyText(values)}
              </span>
            </span>
          {/each}
        {/each}
      {/if}
    </div>
  {/if}

  {#if !frequencyAsTags && frequencies.length}
    <ul class="frequency-list">
      {#each frequencies as { dictionaryAlias, frequencies: items }}
        {#each items as { term, reading, values }}
          <li>
            <span class="frequency-dictionary">{dictionaryAlias}</span>
            {#if uniqueTerms.size > 1 || uniqueReadings.size > 1}{reading ?? term}:{/if}
            {frequencyText(values)}
          </li>
        {/each}
      {/each}
    </ul>
  {/if}

  {#if pronunciations.length}
    <ul class="pronunciation-group-list">
      {#each pronunciations as { dictionaryAlias, pronunciations: items }}
        <li class="pronunciation-group">
          <span class="tag" data-category="pronunciation-dictionary">{dictionaryAlias}</span>
          <ul class="pronunciation-list">
            {#each items as { pronunciation, reading, exclusiveTerms, exclusiveReadings }}
              <li class="pronunciation">
                {#each pronunciation.tags as tag}
                  <span class="tag" title={tagTitle(tag)}>{tag.name}</span>
                {/each}
                {#if exclusiveTerms.length || exclusiveReadings.length}
                  <span class="pronunciation-disambiguation">
                    {[...exclusiveTerms, ...exclusiveReadings].join('・')}
                  </span>
                {/if}
                {#if pronunciation.type === 'pitch-accent'}
                  {#if general.showPitchAccentDownstepNotation}
                    <span use:pitchAccent={{ pitch: pronunciation, reading, part: 'text' }} />
                  {/if}
                  {#if general.showPitchAccentPositionNotation}
                    <span use:pitchAccent={{ pitch: pronunciation, reading, part: 'position' }} />
                  {/if}
                  {#if general.showPitchAccentGraph}
                    <span use:pitchAccent={{ pitch: pronunciation, reading, part: 'graph' }} />
                  {/if}
                {:else}
                  <span class="pronunciation-ipa">{pronunciation.ipa}</span>
                {/if}
              </li>
            {/each}
          </ul>
        </li>
      {/each}
    </ul>
  {/if}

  <ol class="definition-list" class:single={definitions.length === 1}>
    {#each definitions as { definition, redundant, disambiguations }}
      {@const collapse = collapsible.get(definition.dictionary) ?? 'not-collapsible'}
      <li class="definition-item" data-dictionary={definition.dictionary}>
        <div class="definition-tags">
          {#each definition.tags as tag}
            <span class="tag" data-category={tag.category} title={tagTitle(tag)}>{tag.name}</span>
          {/each}
          {#if !(redundant && general.compactTags)}
            <span
              class="tag"
              data-category="dictionary"
              title={dictionaryDetails(definition.dictionary)}>{definition.dictionaryAlias}</span
            >
          {/if}
          {#each disambiguations as only}
            <span class="definition-only">{only}</span>
          {/each}
        </div>
        {#if collapse === 'not-collapsible'}
          <ul class="gloss-list" class:compact>
            {#each definition.entries as item}
              <li
                class="gloss-item"
                use:glossary={{ entry: item, dictionary: definition.dictionary, onLookup: lookup }}
              />
            {/each}
          </ul>
        {:else}
          <details open={collapse === 'expanded' || collapse === 'force-expanded'}>
            <summary>{$t$('lookup.definitions', { count: definition.entries.length })}</summary>
            <ul class="gloss-list" class:compact>
              {#each definition.entries as item}
                <li
                  class="gloss-item"
                  use:glossary={{
                    entry: item,
                    dictionary: definition.dictionary,
                    onLookup: lookup
                  }}
                />
              {/each}
            </ul>
          </details>
        {/if}
      </li>
    {/each}
  </ol>
</article>
