<script lang="ts">
  import AiLanguageToggle from '$lib/components/ai-language-toggle.svelte';
  import LorebookPanel from '$lib/components/book-reader/lorebook-panel.svelte';
  import RecapPanel from '$lib/components/book-reader/recap-panel.svelte';
  import { modelShortName } from '$lib/data/ai-settings';
  import type { Section } from '$lib/data/database/books-db/versions/v3/books-db-v3';
  import { recapModel } from '$lib/data/recap';
  import type { SearchIndex } from '$lib/functions/book-text/book-search';

  /**
   * The reader panel's Story tab: Story so far, then the lore (characters, places and terms),
   * scrolling as one view. Not part of upstream.
   */
  export let title: string;
  export let getIndex: () => Promise<SearchIndex>;
  export let sections: Section[];
  export let position: number;
  export let bookCharacters: number;
  /** The tab is showing (it stays mounted while hidden) */
  export let active = true;

  // Read when the tab opens; changing the model in Settings means leaving the reader.
  const model = recapModel();
</script>

<div class="panel-meta">
  <span class="panel-meta-text" title={model}>{modelShortName(model)}</span>
  <AiLanguageToggle compact />
</div>
<div class="story">
  <RecapPanel {title} {getIndex} {sections} {position} {bookCharacters} {active} />
  <LorebookPanel {title} {getIndex} {position} />
</div>

<style>
  .story {
    min-height: 0;
    flex: 1;
    overflow-y: auto;
  }
</style>
