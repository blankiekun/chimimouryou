<script lang="ts">
  import { rankTiers, stepNumeral } from '$lib/data/stats/reading-rank';

  /**
   * A reading rank's name in its own colour (`--rank-N`, the only place it is used besides the
   * rank track): the Japanese name, ruled in a 1px frame. With a step (1-3) the step's numeral
   * follows the name and the rank number goes ("英雄 II"); without one (older apps and hubs,
   * 見習い) the number leads ("5 英雄").
   */
  export let tier: number;
  export let step: number | null | undefined = undefined;
  export let small = false;

  $: rank = rankTiers[Math.min(Math.max(tier, 1), rankTiers.length) - 1];
  $: level = rankTiers.indexOf(rank) + 1;
  $: numeral = level > 1 ? stepNumeral(step) : '';
</script>

<span class="rank-badge" class:rank-badge-small={small} style:--rank="var(--rank-{level})">
  {#if !numeral}<span class="rank-badge-level">{level}</span>{/if}
  <span class="rank-badge-name" lang="ja">{rank.ja}</span>
  {#if numeral}<span class="rank-badge-step">{numeral}</span>{/if}
</span>

<style>
  .rank-badge {
    display: inline-flex;
    align-items: baseline;
    gap: 0.45em;
    padding: 0.2em 0.55em;
    border: 1px solid var(--rank);
    border-radius: 2px;
    color: var(--rank);
    white-space: nowrap;
  }

  .rank-badge-level,
  .rank-badge-step {
    font-size: var(--type-label);
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  .rank-badge-step {
    letter-spacing: 0.04em;
  }

  .rank-badge-name {
    font-size: var(--type-body);
    font-weight: 700;
  }

  .rank-badge-small {
    padding: 0 0.4em;
  }

  .rank-badge-small .rank-badge-name {
    font-size: var(--type-small);
  }
</style>
