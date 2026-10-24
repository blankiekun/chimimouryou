<script lang="ts">
  import LorebookPanel from '$lib/components/book-reader/lorebook-panel.svelte';
  import RecapPanel from '$lib/components/book-reader/recap-panel.svelte';
  import type { Section } from '$lib/data/database/books-db/versions/v3/books-db-v3';
  import { storySection$, type StorySection } from '$lib/data/reader-panel';
  import type { SearchIndex } from '$lib/functions/book-text/book-search';
  import { t$, type MessageKey } from '$lib/i18n';

  /**
   * The reader panel's Story tab: Story so far and the lorebook, one at a time under a segmented
   * control; each stays mounted once shown, so a recap being written survives. Not part of upstream.
   */
  export let title: string;
  export let getIndex: () => Promise<SearchIndex>;
  export let sections: Section[];
  export let position: number;
  export let bookCharacters: number;
  /** The tab is showing (it stays mounted while hidden) */
  export let active = true;

  const choices: [StorySection, MessageKey][] = [
    ['recap', 'reader.recap'],
    ['lorebook', 'reader.lorebook']
  ];

  let visited = new Set<StorySection>();

  $: section = $storySection$;
  // A new Set each time: the app compiles with immutable: true.
  $: if (!visited.has(section)) {
    visited = new Set([...visited, section]);
  }
</script>

<div class="story-switch">
  <div class="app-segmented" role="radiogroup" aria-label={$t$('reader.story')}>
    {#each choices as [key, label] (key)}
      <button
        type="button"
        role="radio"
        aria-checked={section === key}
        class="app-segment"
        class:app-segment-selected={section === key}
        on:click={() => storySection$.next(key)}
      >
        {$t$(label)}
      </button>
    {/each}
  </div>
</div>
{#if visited.has('recap')}
  <div class="story-section" class:story-hidden={section !== 'recap'}>
    <RecapPanel
      {title}
      {getIndex}
      {sections}
      {position}
      {bookCharacters}
      active={active && section === 'recap'}
    />
  </div>
{/if}
{#if visited.has('lorebook')}
  <div class="story-section" class:story-hidden={section !== 'lorebook'}>
    <LorebookPanel {title} {getIndex} {position} />
  </div>
{/if}

<style>
  .story-switch {
    flex: none;
    margin: 0 1rem;
    padding-top: 0.75rem;
  }

  .story-section {
    display: flex;
    min-height: 0;
    flex: 1;
    flex-direction: column;
  }

  .story-hidden {
    display: none;
  }

  @media (min-width: 768px) {
    .story-switch {
      margin: 0 1.5rem;
    }
  }
</style>
