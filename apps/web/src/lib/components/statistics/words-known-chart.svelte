<script lang="ts">
  import type { DayRead, KnownPoint } from '$lib/data/words-history';
  import { getKnownHistory } from '$lib/data/words-history';
  import { knownMinCount } from '$lib/data/words-met';
  import { t$ } from '$lib/i18n';

  /** "Words known" over time (an estimate, see words-history.ts). Not part of upstream. */

  export let statisticsData: DayRead[];
  export let todayKey: string;

  let points: KnownPoint[] = [];
  let hovered: number | undefined;
  let request = 0;

  $: load(statisticsData);

  async function load(days: DayRead[]) {
    const current = (request += 1);
    const history = await getKnownHistory(days).catch(() => []);

    if (current === request) points = history;
  }

  const width = 600;
  const height = 160;
  const time = (dateKey: string) => Date.parse(dateKey);
  const number = (value: number) => value.toLocaleString('en-US');

  // The line runs on to today, flat since the last day read.
  $: shown =
    points.length && points[points.length - 1].dateKey < todayKey
      ? [...points, { dateKey: todayKey, known: points[points.length - 1].known }]
      : points;
  $: start = shown.length ? time(shown[0].dateKey) : 0;
  $: span = shown.length ? Math.max(1, time(shown[shown.length - 1].dateKey) - start) : 1;
  $: max = Math.max(1, ...shown.map((point) => point.known));
  $: coords = shown.map((point) => ({
    ...point,
    x: ((time(point.dateKey) - start) / span) * width,
    y: height - (point.known / max) * height
  }));
  $: line = coords.map(({ x, y }) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  $: last = shown[shown.length - 1];
  $: active = hovered === undefined ? undefined : coords[hovered];

  function onPointerMove(event: PointerEvent) {
    const box = (event.currentTarget as Element).getBoundingClientRect();
    const x = ((event.clientX - box.left) / box.width) * width;
    let nearest = 0;

    coords.forEach((point, index) => {
      if (Math.abs(point.x - x) < Math.abs(coords[nearest].x - x)) nearest = index;
    });
    hovered = nearest;
  }
</script>

{#if points.some((point) => point.known)}
  <figure class="words-chart">
    <figcaption class="words-chart-title">
      <span>
        {$t$('statistics.wordsKnownNow', { count: number(last.known) })}
      </span>
    </figcaption>
    <div class="words-chart-plot">
      <span class="words-chart-muted words-chart-max">{number(max)}</span>
      <div class="words-chart-area">
        <svg
          viewBox="0 0 {width} {height}"
          preserveAspectRatio="none"
          role="img"
          aria-label={$t$('statistics.wordsKnownLabel', {
            from: shown[0].dateKey,
            to: last.dateKey,
            count: number(last.known)
          })}
          on:pointermove={onPointerMove}
          on:pointerleave={() => (hovered = undefined)}
        >
          <line x1="0" y1={height} x2={width} y2={height} class="words-chart-rule" />
          <polyline points={line} class="words-chart-line" />
          {#if active}
            <line x1={active.x} y1="0" x2={active.x} y2={height} class="words-chart-rule" />
          {/if}
        </svg>
        {#if active}
          <span
            class="words-chart-dot"
            style:left="{(active.x / width) * 100}%"
            style:top="{(active.y / height) * 100}%"
          />
        {/if}
      </div>
      {#if active}
        <span
          class="words-chart-tip"
          style:left="{Math.min(80, Math.max(20, (active.x / width) * 100))}%"
        >
          {active.dateKey} · {number(active.known)}
        </span>
      {/if}
    </div>
    <div class="words-chart-muted words-chart-axis">
      <span>{shown[0].dateKey}</span>
      <span>{last.dateKey}</span>
    </div>
    <p class="words-chart-muted words-chart-note">
      {$t$('statistics.wordsKnownNote', { count: knownMinCount })}
    </p>
  </figure>
{:else}
  <p class="words-chart-muted words-chart-note">{$t$('statistics.wordsKnownEmpty')}</p>
{/if}

<style>
  .words-chart {
    min-width: 0;
  }

  .words-chart-title {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 1rem;
    color: var(--app-muted-fg);
    font-size: var(--type-small);
    font-variant-numeric: tabular-nums;
  }

  .words-chart-axis {
    display: flex;
    justify-content: space-between;
    font-size: var(--type-label);
    font-variant-numeric: tabular-nums;
  }

  .words-chart-note {
    margin-top: 0.75rem;
    font-size: var(--type-label);
    line-height: 1.6;
  }

  .words-chart-muted {
    color: var(--app-muted-fg);
  }

  .words-chart-plot {
    position: relative;
    margin: 0.75rem 0 0.25rem;
    padding-top: 1.25rem;
  }

  .words-chart-area {
    position: relative;
  }

  .words-chart-area svg {
    display: block;
    width: 100%;
    height: 10rem;
    overflow: visible;
    touch-action: pan-y;
  }

  .words-chart-max {
    position: absolute;
    top: 0;
    left: 0;
    font-size: var(--type-label);
    font-variant-numeric: tabular-nums;
  }

  .words-chart-rule {
    stroke: var(--border-color);
    stroke-width: 1;
    vector-effect: non-scaling-stroke;
  }

  .words-chart-line {
    fill: none;
    stroke: var(--accent-color);
    stroke-width: 2;
    stroke-linejoin: round;
    vector-effect: non-scaling-stroke;
  }

  .words-chart-dot {
    position: absolute;
    width: 0.6rem;
    height: 0.6rem;
    margin: -0.3rem 0 0 -0.3rem;
    border: 2px solid var(--background-color);
    border-radius: 50%;
    background: var(--accent-color);
    pointer-events: none;
  }

  .words-chart-tip {
    position: absolute;
    top: 0;
    transform: translateX(-50%);
    padding: 0.1rem 0.4rem;
    border: 1px solid var(--border-color);
    border-radius: 2px;
    background: var(--background-color);
    font-size: var(--type-label);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    pointer-events: none;
  }
</style>
