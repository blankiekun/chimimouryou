<script lang="ts">
  import type { CharactersBar } from '$lib/components/statistics/characters-per-day';
  import { t$ } from '$lib/i18n';

  /** Characters read per day (per month for long periods), today's bar in the spot colour. Not part of upstream. */

  export let bars: CharactersBar[];
  export let todayKey: string;

  const number = (value: number) => value.toLocaleString('en-US');
  const label = (bar: CharactersBar) => (bar.key === bar.end ? bar.key : bar.key.slice(0, 7));

  let hovered: number | undefined;

  $: max = Math.max(1, ...bars.map((bar) => bar.characters));
  $: active = hovered === undefined ? undefined : bars[hovered];
</script>

<figure class="chars-chart">
  <figcaption class="chars-chart-title">
    <h3>{$t$('statistics.charactersPerDay')}</h3>
    <span>{$t$('statistics.max', { count: number(max) })}</span>
  </figcaption>
  <!-- Touch fires pointerleave as the finger lifts: keep the tapped bar's tip until the next tap. -->
  <div
    class="chars-chart-plot"
    on:pointerleave={(event) => event.pointerType !== 'touch' && (hovered = undefined)}
  >
    {#each bars as bar, index (bar.key)}
      {@const today = todayKey >= bar.key && todayKey <= bar.end}
      <button
        type="button"
        class="chars-chart-slot"
        aria-label="{label(bar)}: {$t$('dashboard.charsValue', { count: number(bar.characters) })}"
        on:pointerenter={() => (hovered = index)}
        on:click={() => (hovered = index)}
        on:focus={() => (hovered = index)}
        on:blur={() => (hovered = undefined)}
      >
        <span
          class="chars-chart-bar"
          class:chars-chart-bar-today={today}
          style:height="{(bar.characters / max) * 100}%"
        />
      </button>
    {/each}
    {#if active && hovered !== undefined}
      <span
        class="chars-chart-tip"
        style:left="{Math.min(85, Math.max(15, ((hovered + 0.5) / bars.length) * 100))}%"
      >
        {label(active)} · {$t$('dashboard.charsValue', { count: number(active.characters) })}
      </span>
    {/if}
  </div>
  {#if bars.length}
    <div class="chars-chart-axis">
      <span>{label(bars[0])}</span>
      {#if bars.length > 1}<span>{label(bars[bars.length - 1])}</span>{/if}
    </div>
  {/if}
</figure>

<style>
  .chars-chart {
    min-width: 0;
  }

  .chars-chart-title {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 1rem;
    color: var(--app-muted-fg);
    font-size: var(--type-small);
    font-variant-numeric: tabular-nums;
  }

  .chars-chart-title h3 {
    color: var(--font-color);
    font-size: var(--type-body);
    font-weight: 700;
  }

  .chars-chart-plot {
    position: relative;
    display: flex;
    height: 10rem;
    align-items: stretch;
    gap: 2px;
    margin: 1.75rem 0 0.4rem;
    border-bottom: 1px solid var(--border-color);
  }

  .chars-chart-slot {
    position: relative;
    display: flex;
    min-width: 0;
    flex: 1 1 0;
    align-items: flex-end;
    cursor: default;
  }

  .chars-chart-slot:hover .chars-chart-bar,
  .chars-chart-slot:focus-visible .chars-chart-bar {
    background: var(--font-color);
  }

  .chars-chart-bar {
    display: block;
    width: 100%;
    max-width: 1.5rem;
    margin: 0 auto;
    border-radius: 2px 2px 0 0;
    background: var(--app-muted-fg);
  }

  .chars-chart-bar-today {
    background: var(--accent-color);
  }

  .chars-chart-tip {
    position: absolute;
    top: -1.6rem;
    transform: translateX(-50%);
    padding: 0.1rem 0.4rem;
    border: 1px solid var(--border-color);
    border-radius: 2px;
    background: var(--background-color);
    color: var(--font-color);
    font-size: var(--type-label);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    pointer-events: none;
  }

  .chars-chart-axis {
    display: flex;
    justify-content: space-between;
    color: var(--app-muted-fg);
    font-size: var(--type-label);
    font-variant-numeric: tabular-nums;
  }
</style>
