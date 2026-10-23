<script lang="ts">
  import Popover from '$lib/components/popover/popover.svelte';
  import {
    StatisticsRangeTemplate,
    copyStatisticsData$,
    statisticsTitleFilterEnabled$,
    statisticsTitleFilterIsOpen$,
    type StatisticsDataSource
  } from '$lib/components/statistics/statistics-types';
  import { getDateRangeLabel } from '$lib/data/reading-goal';
  import {
    lastStatisticsEndDate$,
    lastStatisticsRangeTemplate$,
    lastStatisticsStartDate$
  } from '$lib/data/store';
  import { t$ } from '$lib/i18n';

  /** The Statistics page's title, period control and tools (formerly glyph buttons in the app header). */

  export let showStatisticsSettings: boolean;

  const copyStatisticsDataItems: StatisticsDataSource[] = [
    { key: 'readingTime', label: 'Reading time' },
    { key: 'charactersRead', label: 'Characters read' }
  ];

  const periods = [
    [StatisticsRangeTemplate.TODAY, 'statistics.today'],
    [StatisticsRangeTemplate.WEEK, 'statistics.week'],
    [StatisticsRangeTemplate.MONTH, 'statistics.month'],
    [StatisticsRangeTemplate.YEAR, 'statistics.year'],
    [StatisticsRangeTemplate.CUSTOM, 'statistics.custom']
  ] as const;

  let copyStatisticsDataPopover: Popover;

  function choosePeriod(period: StatisticsRangeTemplate) {
    // Custom dates are set in the settings panel.
    if (period === StatisticsRangeTemplate.CUSTOM) {
      showStatisticsSettings = true;
    } else {
      $lastStatisticsRangeTemplate$ = period;
    }
  }
</script>

<header class="stats-header">
  <div class="stats-header-title">
    <h1>{$t$('statistics.title')}</h1>
    <p>{getDateRangeLabel($lastStatisticsStartDate$, $lastStatisticsEndDate$)}</p>
  </div>
  <div class="app-segmented" role="radiogroup" aria-label={$t$('statistics.period')}>
    {#each periods as [period, label] (period)}
      <button
        type="button"
        role="radio"
        aria-checked={$lastStatisticsRangeTemplate$ === period}
        class="app-segment"
        class:app-segment-selected={$lastStatisticsRangeTemplate$ === period}
        on:click={() => choosePeriod(period)}
      >
        {$t$(label)}
      </button>
    {/each}
  </div>
</header>
<div class="stats-toolbar">
  <button
    type="button"
    class="app-button app-button-quiet"
    disabled={!$statisticsTitleFilterEnabled$}
    on:click={() => ($statisticsTitleFilterIsOpen$ = true)}
  >
    {$t$('statistics.filterTitles')}
  </button>
  <Popover
    placement="bottom-start"
    fallbackPlacements={['bottom', 'bottom-end']}
    yOffset={6}
    panelClasses="app-popover-panel"
    bind:this={copyStatisticsDataPopover}
  >
    <button type="button" class="app-button app-button-quiet" slot="icon">
      {$t$('statistics.copyLog')}
    </button>
    <div class="flex flex-col" slot="content">
      <div class="app-popover-heading">{$t$('statistics.copyLogHeading')}</div>
      {#each copyStatisticsDataItems as copyStatisticsDataItem (copyStatisticsDataItem.key)}
        <button
          type="button"
          class="app-popover-item"
          on:click={() => {
            copyStatisticsData$.next(copyStatisticsDataItem.key);
            copyStatisticsDataPopover.toggleOpen();
          }}
        >
          {copyStatisticsDataItem.label}
        </button>
      {/each}
    </div>
  </Popover>
  <button
    type="button"
    class="app-button app-button-quiet"
    on:click={() => (showStatisticsSettings = true)}
  >
    {$t$('statistics.settings')}
  </button>
</div>

<style>
  .stats-header {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    justify-content: space-between;
    gap: 1rem 2rem;
  }

  .stats-header-title h1 {
    font-size: var(--type-display);
    font-weight: 400;
    line-height: 1.2;
  }

  .stats-header-title p {
    margin-top: 0.25rem;
    color: var(--app-muted-fg);
    font-size: var(--type-small);
    font-variant-numeric: tabular-nums;
  }

  /* Phones: the five periods share one row */
  @media (max-width: 479px) {
    .stats-header .app-segmented {
      display: flex;
      width: 100%;
      flex-wrap: nowrap;
    }

    .stats-header .app-segment {
      flex: 1 1 auto;
      padding-inline: 0.4rem;
    }
  }

  .stats-toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.25rem 1.5rem;
    margin-top: 1.25rem;
    padding: 0.5rem 0;
    border-top: 1px solid var(--border-color);
    border-bottom: 1px solid var(--border-color);
  }
</style>
