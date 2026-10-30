<script lang="ts">
  import { aiLanguage$ } from '$lib/data/ai/ai-settings';

  /** One-click switch of the AI prompt and answer language. Not part of upstream. */

  /** Shorter segments for the reader panels' header rows */
  export let compact = false;

  const options = [
    { value: 'en', label: 'EN', title: 'AI answers in English' },
    { value: 'ja', label: '日本語', title: 'AIは日本語で答えます' }
  ];
</script>

<!-- .app-segmented and .app-segment are in app.scss. -->
<div class="app-segmented toggle" class:compact role="radiogroup" aria-label="AI language">
  {#each options as option (option.value)}
    <button
      type="button"
      role="radio"
      aria-checked={$aiLanguage$ === option.value}
      class="app-segment"
      class:app-segment-selected={$aiLanguage$ === option.value}
      title={option.title}
      on:click={() => ($aiLanguage$ = option.value)}
    >
      {option.label}
    </button>
  {/each}
</div>

<style>
  .toggle {
    flex: none;
    flex-wrap: nowrap;
  }

  .compact .app-segment {
    min-height: 1.75rem;
    padding: 0.1rem 0.6rem;
    font-size: var(--type-small);
  }
</style>
