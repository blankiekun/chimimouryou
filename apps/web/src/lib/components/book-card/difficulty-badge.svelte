<script lang="ts">
  import { levelColor, levelTier } from '$lib/data/difficulty';
  import { t$ } from '$lib/i18n';

  /** The 1-10 level (`levelOf`) */
  export let difficulty: number;
  /** Meter only, without the tier name */
  export let compact = false;

  $: tier = levelTier(difficulty);
  $: summary = $t$('difficulty.summary', { score: difficulty.toFixed(1), tier });
  $: title = `${summary}\n${$t$('difficulty.scaleNote')}`;
  /** How full each of the five segments (two steps each) is, 0-1 */
  $: fills = [0, 1, 2, 3, 4].map((i) => Math.min(Math.max((difficulty - 1) / 2 - i + 0.5, 0), 1));
</script>

<span
  class="difficulty-badge"
  style:--difficulty-color={levelColor(difficulty)}
  role="img"
  aria-label={summary}
  {title}
>
  <span class="difficulty-meter" aria-hidden="true">
    {#each fills as fill, i (i)}
      <span class="difficulty-segment"><span style:width="{fill * 100}%" /></span>
    {/each}
  </span>
  {#if !compact}<span class="difficulty-label">{difficulty.toFixed(1)} {tier}</span>{/if}
</span>

<style>
  .difficulty-badge {
    display: inline-flex;
    flex: 0 0 auto;
    align-items: center;
    gap: 0.4rem;
    color: var(--app-muted-fg);
    font-size: 0.72rem;
    font-weight: 600;
    line-height: 1.4;
    white-space: nowrap;
  }

  .difficulty-meter {
    display: inline-flex;
    gap: 2px;
  }

  .difficulty-segment {
    display: block;
    width: 0.55rem;
    height: 0.3rem;
    overflow: hidden;
    border-radius: 1px;
    background: var(--app-progress-track);
  }

  .difficulty-segment > span {
    display: block;
    height: 100%;
    background: var(--difficulty-color);
  }
</style>
