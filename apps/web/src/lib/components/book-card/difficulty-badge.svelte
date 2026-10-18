<script lang="ts">
  import {
    difficultyColor,
    difficultyDescriptionKey,
    difficultyNameKey
  } from '$lib/data/difficulty';
  import { t$ } from '$lib/i18n';

  export let difficulty: number;
  export let low: number | undefined = undefined;
  export let high: number | undefined = undefined;
  export let words95: number | undefined = undefined;
  /** Meter only, without the band name */
  export let compact = false;

  $: hasRange = low !== undefined && high !== undefined;
  $: band = $t$(difficultyNameKey(difficulty));
  $: summary = $t$(hasRange ? 'difficulty.summaryRange' : 'difficulty.summary', {
    score: difficulty.toFixed(2),
    band,
    low: low?.toFixed(1) ?? '',
    high: high?.toFixed(1) ?? ''
  });
  $: title = [
    $t$('difficulty.estimated', { summary }),
    $t$('difficulty.meaning', { band, meaning: $t$(difficultyDescriptionKey(difficulty)) }),
    ...(hasRange ? [$t$('difficulty.rangeNote')] : []),
    ...(words95 ? [$t$('difficulty.words95', { count: words95.toLocaleString() })] : [])
  ].join('\n');
  /** How full each of the five segments is, 0-1 */
  $: fills = [0, 1, 2, 3, 4].map((i) => Math.min(Math.max(difficulty - i, 0), 1));
</script>

<span
  class="difficulty-badge"
  style:--difficulty-color={difficultyColor(difficulty)}
  role="img"
  aria-label={summary}
  {title}
>
  <span class="difficulty-meter" aria-hidden="true">
    {#each fills as fill, i (i)}
      <span class="difficulty-segment"><span style:width="{fill * 100}%" /></span>
    {/each}
  </span>
  {#if !compact}<span class="difficulty-label">{band}</span>{/if}
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
