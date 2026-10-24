<script lang="ts">
  import { rankTiers } from '$lib/data/reading-rank';

  /**
   * A reading rank's name in its own colour (`--rank-N`, the only place it is used besides the
   * rank track): the Japanese name with a small English gloss, ruled in a 1px frame.
   */
  export let tier: number;
  export let small = false;

  $: rank = rankTiers[Math.min(Math.max(tier, 1), rankTiers.length) - 1];
  $: level = rankTiers.indexOf(rank) + 1;
</script>

<span class="rank-badge" class:rank-badge-small={small} style:--rank="var(--rank-{level})">
  <span class="rank-badge-level">{level}</span>
  <span class="rank-badge-name" lang="ja">{rank.ja}</span>
  <span class="rank-badge-gloss">{rank.en}</span>
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

  .rank-badge-level {
    font-size: var(--type-label);
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  .rank-badge-name {
    font-size: var(--type-body);
    font-weight: 700;
  }

  .rank-badge-gloss {
    font-size: var(--type-label);
  }

  .rank-badge-small {
    padding: 0 0.4em;
  }

  .rank-badge-small .rank-badge-name {
    font-size: var(--type-small);
  }
</style>
