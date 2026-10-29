<script lang="ts">
  import { faArrowDownWideShort, faArrowUpShortWide } from '@fortawesome/free-solid-svg-icons';
  import Popover from '$lib/components/popover/popover.svelte';
  import type {
    StatisticsDataSourceChange,
    StatisticsSummaryKey
  } from '$lib/components/statistics/statistics-summary/statistics-summary';
  import type {
    BookStatistic,
    StatisticsDataSource
  } from '$lib/components/statistics/statistics-types';
  import { SortDirection } from '$lib/data/sort-types';
  import {
    lastStatisticsSummarySortDirection$,
    lastStatisticsSummarySortProperty$
  } from '$lib/data/store';
  import { createEventDispatcher } from 'svelte';
  import Fa from 'svelte-fa';

  export let statisticsSummaryKey: StatisticsSummaryKey;
  export let options: StatisticsDataSource[];
  export let selectionKey: keyof BookStatistic;
  export let hasRowInEdit: boolean;
  export let numeric = false;
  export let title = '';

  const dispatch = createEventDispatcher<{
    propertyChange: StatisticsDataSourceChange;
  }>();

  let summaryHeaderPopover: Popover;

  $: optionKeys = new Set<keyof BookStatistic>((options || []).map((option) => option.key));

  $: selectedOption = options.find((option) => option.key === selectionKey)!;
</script>

<th
  class="summary-th"
  class:summary-th-numeric={numeric}
  aria-sort={optionKeys.has($lastStatisticsSummarySortProperty$)
    ? $lastStatisticsSummarySortDirection$ === SortDirection.ASC
      ? 'ascending'
      : 'descending'
    : undefined}
>
  <div class="summary-th-inner">
    {#if options.length > 1 && !hasRowInEdit}
      <Popover
        placement={'bottom-start'}
        fallbackPlacements={['top']}
        panelClasses="app-popover-panel"
        bind:this={summaryHeaderPopover}
      >
        <button type="button" class="summary-th-choice" {title}>{selectedOption.label}</button>
        <div slot="content" class="flex flex-col">
          {#each options as option (option.key)}
            <button
              type="button"
              class="app-popover-item"
              class:app-popover-item-active={option.key === selectedOption.key}
              on:click|stopPropagation={() => {
                selectedOption = option;
                dispatch('propertyChange', { property: option.key, statisticsSummaryKey });
                summaryHeaderPopover.toggleOpen();
              }}
            >
              {option.label}
            </button>
          {/each}
        </div>
      </Popover>
    {:else}
      <button
        type="button"
        class="summary-th-choice"
        disabled={hasRowInEdit}
        {title}
        on:click={() => {
          dispatch('propertyChange', { property: selectedOption.key, statisticsSummaryKey });
        }}
      >
        {selectedOption.label}
      </button>
    {/if}
    <button
      type="button"
      title="Sort by this column"
      aria-label="Sort by {selectedOption.label}"
      class="summary-th-sort"
      class:summary-th-sort-active={optionKeys.has($lastStatisticsSummarySortProperty$)}
      disabled={hasRowInEdit}
      on:click={() =>
        dispatch('propertyChange', { property: selectedOption.key, statisticsSummaryKey })}
    >
      {#if $lastStatisticsSummarySortDirection$ === SortDirection.ASC}
        <Fa icon={faArrowUpShortWide} />
      {:else}
        <Fa icon={faArrowDownWideShort} />
      {/if}
    </button>
  </div>
</th>

<style>
  .summary-th-inner {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }

  .summary-th-numeric .summary-th-inner {
    justify-content: flex-end;
  }

  .summary-th-choice {
    color: inherit;
    text-align: inherit;
  }

  .summary-th-choice:hover:not(:disabled) {
    color: var(--font-color);
  }

  .summary-th-sort {
    font-size: var(--type-label);
    opacity: 0.35;
  }

  .summary-th-sort-active {
    color: var(--font-color);
    opacity: 1;
  }

  button:disabled {
    cursor: not-allowed;
  }
</style>
