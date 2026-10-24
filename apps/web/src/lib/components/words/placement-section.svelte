<script lang="ts">
  import SectionHead from '$lib/components/section-head.svelte';
  import { pagePath } from '$lib/data/env';
  import { placementCutoff$ } from '$lib/data/placement';
  import { t$ } from '$lib/i18n';

  /** The Words page's placement check: the current result and a link to (re)take it. */
  export let number: number;

  $: cutoff = $placementCutoff$ > 0 ? $placementCutoff$ : 0;
</script>

<section class="placement-section" aria-label={$t$('words.placement')}>
  <SectionHead {number} title={$t$('words.placement')} />
  <p>
    {cutoff
      ? $t$('words.placementResult', { count: cutoff.toLocaleString('en-US') })
      : $t$('words.placementNone')}
  </p>
  <a class="app-button" href="{pagePath}/placement"
    >{$t$(cutoff ? 'words.placementRetake' : 'words.placementTake')}</a
  >
</section>

<style>
  .placement-section {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 1rem;
  }

  .placement-section p {
    color: var(--app-muted-fg);
    font-size: var(--type-small);
    line-height: 1.7;
  }
</style>
