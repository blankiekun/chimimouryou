<script lang="ts">
  import SectionHead from '$lib/components/section-head.svelte';
  import { pagePath } from '$lib/data/env';
  import { latestPlacement, placementResults$, placementWords } from '$lib/data/placement';
  import { t$ } from '$lib/i18n';

  /** The Words page's placement check: the current results and links to (re)take them. */
  export let number: number;

  $: yesno = latestPlacement($placementResults$, 'yesno');
  $: cutoff = yesno?.cutoff ?? 0;
  $: hard = placementWords(latestPlacement($placementResults$, 'typed'));
</script>

<section class="placement-section" aria-label={$t$('words.placement')}>
  <SectionHead {number} title={$t$('words.placement')} />
  <p>
    {cutoff
      ? $t$('words.placementResult', {
          count: placementWords(yesno).toLocaleString('en-US'),
          cutoff: cutoff.toLocaleString('en-US')
        })
      : $t$('words.placementNone')}
  </p>
  <p>
    {hard
      ? $t$('words.placementHard', { count: hard.toLocaleString('en-US') })
      : $t$('words.placementHardNone')}
    {#if hard && cutoff}{$t$('hardTest.both')}{/if}
  </p>
  <span class="placement-section-actions">
    <a class="app-button" href="{pagePath}/placement"
      >{$t$(cutoff ? 'words.placementRetake' : 'words.placementTake')}</a
    >
    <a class="app-button" href="{pagePath}/placement?mode=hard"
      >{$t$(hard ? 'words.placementHardRetake' : 'words.placementHardTake')}</a
    >
  </span>
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

  .placement-section-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
  }
</style>
