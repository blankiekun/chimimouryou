<script lang="ts">
  import Popover from '$lib/components/popover/popover.svelte';
  import {
    StatisticsSummaryKey,
    type StatisticsDataSourceChange,
    type StatisticsDeleteRequest,
    type StatisticsEditRequest
  } from '$lib/components/statistics/statistics-summary/statistics-summary';
  import StatisticsSummaryHeader from '$lib/components/statistics/statistics-summary/statistics-summary-header.svelte';
  import {
    type BookStatistic,
    StatisticsReadingDataAggregationMode,
    readingTimeDataSources,
    charactersDataSources,
    readingSpeedDataSources,
    dateDataSources,
    titleDataSources
  } from '$lib/components/statistics/statistics-types';
  import { CLOSE_POPOVER } from '$lib/data/events';
  import { SortDirection } from '$lib/data/sort-types';
  import {
    lastBlurredTrackerItems$,
    lastCharactersDataSource$,
    lastPrimaryReadingDataAggregationMode$,
    lastReadingSpeedDataSource$,
    lastReadingTimeDataSource$,
    lastStatisticsEndDate$,
    lastStatisticsStartDate$,
    lastStatisticsSummarySortDirection$,
    lastStatisticsSummarySortProperty$
  } from '$lib/data/store';
  import { getNumberFromObject, secondsToMinutes } from '$lib/functions/statistic-util';
  import { limitToRange } from '$lib/functions/utils';
  import { t$ } from '$lib/i18n';
  import { createEventDispatcher, tick } from 'svelte';

  export let aggregratedStatistics: BookStatistic[];
  export let statisticsDateRangeLabel: string;

  const dispatch = createEventDispatcher<{
    delete: StatisticsDeleteRequest;
    edit: StatisticsEditRequest;
  }>();

  const rowsPerStatisticsSummaryPage = 20;
  const number = (value: number) => value.toLocaleString('en-US');

  let statisticsSummaryPopover: Popover;
  let statisticsData: BookStatistic[] = [];
  let currentStatisticsSummaryRows: BookStatistic[] = [];
  let statisticsSummaryMaxPages = 0;
  let currentStatisticsSummaryPage = 1;
  const statisticsSummaryPageRefs: HTMLButtonElement[] = [];
  let statisticsSummaryPagesContainer: HTMLElement;
  let statisticsSummaryPopoverDetails: string[] = [];
  let rowInEdit: BookStatistic | undefined;
  let rowInEditTime = 0;
  let rowInEditCharacters = 0;
  let rowInEditResetMinMaxValues = false;

  $: statisticsSummaryPageLabel = $t$('statistics.page', {
    page: currentStatisticsSummaryPage,
    pages: statisticsSummaryMaxPages
  });

  // eslint-disable-next-line prefer-spread
  $: statisticsSummaryPages = Array.apply(null, Array(statisticsSummaryMaxPages)).map(
    (_, index) => index + 1
  );

  $: updateTableData(false, currentStatisticsSummaryPage);

  $: updateFilterAndSort($lastPrimaryReadingDataAggregationMode$);

  $: if (aggregratedStatistics) {
    setRowInEditMode();
    statisticsData = [...aggregratedStatistics];
    updatePageData(true);
  }

  $: if (
    $lastReadingTimeDataSource$ ||
    $lastCharactersDataSource$ ||
    $lastReadingSpeedDataSource$ ||
    $lastStatisticsSummarySortProperty$
  ) {
    let valueToSet: keyof BookStatistic | undefined;

    switch ($lastStatisticsSummarySortProperty$) {
      case 'readingTime':
      case 'averageReadingTime':
      case 'averageWeightedReadingTime':
        if ($lastStatisticsSummarySortProperty$ !== $lastReadingTimeDataSource$) {
          valueToSet = $lastReadingTimeDataSource$;
        }
        break;
      case 'charactersRead':
      case 'averageCharactersRead':
      case 'averageWeightedCharactersRead':
        if ($lastStatisticsSummarySortProperty$ !== $lastCharactersDataSource$) {
          valueToSet = $lastCharactersDataSource$;
        }
        break;
      case 'lastReadingSpeed':
      case 'minReadingSpeed':
      case 'altMinReadingSpeed':
      case 'maxReadingSpeed':
        if ($lastStatisticsSummarySortProperty$ !== $lastReadingSpeedDataSource$) {
          valueToSet = $lastReadingSpeedDataSource$;
        }
        break;

      default:
        break;
    }

    if (valueToSet) {
      $lastStatisticsSummarySortProperty$ = valueToSet;
    }

    updateTableData();
  }

  function dispatchDeleteRequest(row: BookStatistic) {
    const request: StatisticsDeleteRequest = {
      startDate: '',
      endDate: '',
      titlesToCheck: new Set<string>()
    };

    if ($lastPrimaryReadingDataAggregationMode$ === StatisticsReadingDataAggregationMode.NONE) {
      request.startDate = row.dateKey;
      request.endDate = row.dateKey;
      request.titlesToCheck.add(row.title);
    } else if (
      $lastPrimaryReadingDataAggregationMode$ === StatisticsReadingDataAggregationMode.DATE
    ) {
      request.startDate = row.dateKey;
      request.endDate = row.dateKey;
    } else {
      request.startDate = $lastStatisticsStartDate$;
      request.endDate = $lastStatisticsEndDate$;
      request.titlesToCheck.add(row.title);
    }

    dispatch('delete', request);
  }

  function handlePropertyChange({
    detail: { property, statisticsSummaryKey }
  }: CustomEvent<StatisticsDataSourceChange>) {
    switch (statisticsSummaryKey) {
      case StatisticsSummaryKey.READING_TIME:
        $lastReadingTimeDataSource$ = property;
        break;
      case StatisticsSummaryKey.CHARACTERS:
        $lastCharactersDataSource$ = property;
        break;
      case StatisticsSummaryKey.READING_SPEED:
        $lastReadingSpeedDataSource$ = property;
        break;

      default:
        break;
    }

    const wasSameProperty = property === $lastStatisticsSummarySortProperty$;

    if (wasSameProperty) {
      $lastStatisticsSummarySortDirection$ =
        $lastStatisticsSummarySortDirection$ === SortDirection.ASC
          ? SortDirection.DESC
          : SortDirection.ASC;
    }

    $lastStatisticsSummarySortProperty$ = property;

    if (wasSameProperty) {
      updateTableData();
    }
  }

  function updatePageData(executeSort: boolean, newPage?: number) {
    statisticsSummaryMaxPages = Math.ceil(statisticsData.length / rowsPerStatisticsSummaryPage);
    currentStatisticsSummaryPage = newPage
      ? limitToRange(1, statisticsSummaryMaxPages, newPage)
      : limitToRange(1, statisticsSummaryMaxPages, currentStatisticsSummaryPage);

    updateTableData(executeSort);
  }

  function updateTableData(executeSort = true, pageNumber = currentStatisticsSummaryPage) {
    if (!pageNumber) {
      return;
    }

    if (executeSort) {
      applyTableSort();
    }

    const currenPageStart = (pageNumber - 1) * rowsPerStatisticsSummaryPage;

    currentStatisticsSummaryRows = statisticsData.slice(
      currenPageStart,
      currenPageStart + rowsPerStatisticsSummaryPage
    );
  }

  function applyTableSort() {
    statisticsData.sort(sortTable);
    statisticsData = [...statisticsData];
  }

  function sortTable(row1: BookStatistic, row2: BookStatistic) {
    const isTitleSort = $lastStatisticsSummarySortProperty$ === 'title';
    const isDateKeySort = $lastStatisticsSummarySortProperty$ === 'dateKey';
    const row1Prop = row1[$lastStatisticsSummarySortProperty$] || (isTitleSort ? '' : 0);
    const row2Prop = row2[$lastStatisticsSummarySortProperty$] || (isTitleSort ? '' : 0);

    let sortDiff = 0;

    if ($lastStatisticsSummarySortDirection$ === SortDirection.ASC) {
      if (isTitleSort) {
        sortDiff = row1.title.localeCompare(row2.title, 'ja-JP', { numeric: true });
      } else if (isDateKeySort) {
        if (row1Prop === row2Prop) {
          sortDiff = 0;
        } else {
          sortDiff = row1Prop > row2Prop ? 1 : -1;
        }
      } else {
        sortDiff = +row1Prop - +row2Prop;
      }
    } else if (isTitleSort) {
      sortDiff = row2.title.localeCompare(row1.title, 'ja-JP', { numeric: true });
    } else if (isDateKeySort) {
      if (row1Prop === row2Prop) {
        sortDiff = 0;
      } else {
        sortDiff = row2Prop > row1Prop ? 1 : -1;
      }
    } else {
      sortDiff = +row2Prop - +row1Prop;
    }

    if (!sortDiff) {
      sortDiff = row1.title.localeCompare(row2.title, 'ja-JP', { numeric: true });
    }

    return sortDiff;
  }

  function updateFilterAndSort(aggregrationMode: StatisticsReadingDataAggregationMode) {
    setRowInEditMode();

    switch (aggregrationMode) {
      case StatisticsReadingDataAggregationMode.DATE:
        if ($lastStatisticsSummarySortProperty$ === 'title') {
          $lastStatisticsSummarySortProperty$ = 'readingTime';
        }
        break;

      case StatisticsReadingDataAggregationMode.TITLE:
        if ($lastStatisticsSummarySortProperty$ === 'dateKey') {
          $lastStatisticsSummarySortProperty$ = 'readingTime';
        }
        break;

      default:
        $lastReadingTimeDataSource$ = 'readingTime';
        break;
    }
  }

  function setRowInEditMode(row?: BookStatistic) {
    if (row) {
      rowInEditTime = row.readingTime;
      rowInEditCharacters = row.charactersRead;
      rowInEditResetMinMaxValues = false;
      rowInEdit = row;
    } else {
      rowInEdit = undefined;
      rowInEditTime = 0;
      rowInEditCharacters = 0;
      rowInEditResetMinMaxValues = false;
    }
  }
</script>

{#if statisticsData.length}
  {@const isNoneAggregation =
    $lastPrimaryReadingDataAggregationMode$ === StatisticsReadingDataAggregationMode.NONE}
  {@const isDateAggregation =
    $lastPrimaryReadingDataAggregationMode$ === StatisticsReadingDataAggregationMode.DATE}
  {@const isTitleAggregation =
    $lastPrimaryReadingDataAggregationMode$ === StatisticsReadingDataAggregationMode.TITLE}
  <div class="summary-scroll">
    <table class="app-table summary-table">
      <thead>
        <tr>
          {#if !isTitleAggregation}
            <StatisticsSummaryHeader
              statisticsSummaryKey={StatisticsSummaryKey.DATE}
              options={dateDataSources}
              selectionKey={StatisticsSummaryKey.DATE}
              hasRowInEdit={rowInEdit !== undefined}
              title="Sort by date"
              on:propertyChange={(detail) => handlePropertyChange(detail)}
            />
          {/if}
          {#if !isDateAggregation}
            <StatisticsSummaryHeader
              statisticsSummaryKey={StatisticsSummaryKey.TITLE}
              options={titleDataSources}
              selectionKey={StatisticsSummaryKey.TITLE}
              hasRowInEdit={rowInEdit !== undefined}
              title="Sort by title"
              on:propertyChange={(detail) => handlePropertyChange(detail)}
            />
          {/if}
          <StatisticsSummaryHeader
            statisticsSummaryKey={StatisticsSummaryKey.CHARACTERS}
            options={charactersDataSources}
            selectionKey={$lastCharactersDataSource$}
            hasRowInEdit={rowInEdit !== undefined}
            numeric
            title="Choose which characters figure to show"
            on:propertyChange={(detail) => handlePropertyChange(detail)}
          />
          <StatisticsSummaryHeader
            statisticsSummaryKey={StatisticsSummaryKey.READING_TIME}
            options={readingTimeDataSources}
            selectionKey={$lastReadingTimeDataSource$}
            hasRowInEdit={rowInEdit !== undefined}
            numeric
            title="Choose which time figure to show"
            on:propertyChange={(detail) => handlePropertyChange(detail)}
          />
          <StatisticsSummaryHeader
            statisticsSummaryKey={StatisticsSummaryKey.READING_SPEED}
            options={readingSpeedDataSources}
            selectionKey={$lastReadingSpeedDataSource$}
            hasRowInEdit={rowInEdit !== undefined}
            numeric
            title="Choose which speed figure to show"
            on:propertyChange={(detail) => handlePropertyChange(detail)}
          />
          <th class="summary-actions-head"><span class="sr-only">Actions</span></th>
        </tr>
      </thead>
      <tbody>
        {#each currentStatisticsSummaryRows as currentStatisticsSummaryRow (currentStatisticsSummaryRow.id)}
          {@const currentRowInEdit = rowInEdit && rowInEdit.id === currentStatisticsSummaryRow.id}
          {@const otherRowInEdit = rowInEdit && !currentRowInEdit}
          <tr class:summary-row-edit={currentRowInEdit}>
            {#if !isTitleAggregation}
              <td class="summary-date">{currentStatisticsSummaryRow.dateKey}</td>
            {/if}
            {#if !isDateAggregation}
              <td class="summary-title">
                <button
                  type="button"
                  title={currentStatisticsSummaryRow.title}
                  on:click={(event) => {
                    statisticsSummaryPopoverDetails = [currentStatisticsSummaryRow.title];

                    tick().then(() => {
                      if (event.target instanceof HTMLElement) {
                        statisticsSummaryPopover.toggleOpen(event.target);
                      }
                    });
                  }}
                >
                  {currentStatisticsSummaryRow.title}
                </button>
              </td>
            {/if}
            <td class="summary-number" data-label="Characters">
              {#if currentRowInEdit}
                <input
                  class="app-input summary-input"
                  type="number"
                  aria-label="Characters"
                  bind:value={rowInEditCharacters}
                  on:change={() => {
                    if (
                      rowInEdit &&
                      (!Number.isFinite(rowInEditCharacters) || rowInEditCharacters < 0)
                    ) {
                      rowInEditCharacters = rowInEdit.charactersRead;
                    }
                  }}
                />
              {:else}
                <button
                  type="button"
                  class:blur={$lastBlurredTrackerItems$.has('charactersRead')}
                  on:click={(event) => {
                    statisticsSummaryPopoverDetails = [
                      `Characters: ${number(currentStatisticsSummaryRow.charactersRead)}`,
                      `Average: ${number(currentStatisticsSummaryRow.averageCharactersRead)}`,
                      `Weighted: ${number(
                        currentStatisticsSummaryRow.averageWeightedCharactersRead
                      )}`
                    ];

                    tick().then(() => {
                      if (event.target instanceof HTMLElement) {
                        statisticsSummaryPopover.toggleOpen(event.target);
                      }
                    });
                  }}
                >
                  {number(
                    getNumberFromObject(currentStatisticsSummaryRow, $lastCharactersDataSource$)
                  )}
                </button>
              {/if}
            </td>
            <td class="summary-number" data-label="Time">
              {#if currentRowInEdit}
                <input
                  class="app-input summary-input"
                  type="number"
                  aria-label="Time in seconds"
                  title="Seconds"
                  bind:value={rowInEditTime}
                  on:change={() => {
                    if (rowInEdit && (!Number.isFinite(rowInEditTime) || rowInEditTime < 0)) {
                      rowInEditTime = rowInEdit.readingTime;
                    }
                  }}
                />
              {:else}
                <button
                  type="button"
                  class:blur={$lastBlurredTrackerItems$.has('readingTime')}
                  on:click={(event) => {
                    statisticsSummaryPopoverDetails = [
                      `Time: ${secondsToMinutes(currentStatisticsSummaryRow.readingTime)} min`,
                      `Average: ${secondsToMinutes(
                        currentStatisticsSummaryRow.averageReadingTime
                      )} min`,
                      `Weighted: ${secondsToMinutes(
                        currentStatisticsSummaryRow.averageWeightedReadingTime
                      )} min`
                    ];

                    tick().then(() => {
                      if (event.target instanceof HTMLElement) {
                        statisticsSummaryPopover.toggleOpen(event.target);
                      }
                    });
                  }}
                >
                  {secondsToMinutes(
                    getNumberFromObject(currentStatisticsSummaryRow, $lastReadingTimeDataSource$)
                  )} min
                </button>
              {/if}
            </td>
            <td class="summary-number" data-label="Speed">
              {#if currentRowInEdit}
                <label class="summary-reset">
                  <input type="checkbox" bind:checked={rowInEditResetMinMaxValues} />
                  Reset min/max
                </label>
              {:else}
                <button
                  type="button"
                  class:blur={$lastBlurredTrackerItems$.has('lastReadingSpeed')}
                  on:click={(event) => {
                    statisticsSummaryPopoverDetails = [
                      `Speed: ${number(currentStatisticsSummaryRow.lastReadingSpeed)}/h`,
                      `Min: ${number(currentStatisticsSummaryRow.minReadingSpeed)}/h`,
                      `Alt min: ${number(currentStatisticsSummaryRow.altMinReadingSpeed)}/h`,
                      `Max: ${number(currentStatisticsSummaryRow.maxReadingSpeed)}/h`
                    ];

                    tick().then(() => {
                      if (event.target instanceof HTMLElement) {
                        statisticsSummaryPopover.toggleOpen(event.target);
                      }
                    });
                  }}
                >
                  {number(
                    getNumberFromObject(currentStatisticsSummaryRow, $lastReadingSpeedDataSource$)
                  )}/h
                </button>
              {/if}
            </td>
            <td class="summary-actions">
              {#if currentRowInEdit && rowInEdit}
                <button
                  type="button"
                  class="app-button app-button-quiet"
                  on:click={() => {
                    if (!rowInEdit) return;
                    dispatch('edit', {
                      dateKey: rowInEdit.dateKey,
                      title: rowInEdit.title,
                      newReadingTime: rowInEditTime,
                      newCharactersRead: rowInEditCharacters,
                      resetMinMaxValues: rowInEditResetMinMaxValues
                    });
                    setRowInEditMode();
                  }}
                >
                  {$t$('statistics.save')}
                </button>
                <button
                  type="button"
                  class="app-button app-button-quiet"
                  on:click={() => setRowInEditMode()}
                >
                  {$t$('statistics.cancel')}
                </button>
              {:else}
                {#if isNoneAggregation}
                  <button
                    type="button"
                    class="app-button app-button-quiet"
                    disabled={otherRowInEdit}
                    on:click={() => setRowInEditMode(currentStatisticsSummaryRow)}
                  >
                    {$t$('statistics.edit')}
                  </button>
                {/if}
                <button
                  type="button"
                  class="app-button app-button-quiet"
                  disabled={otherRowInEdit}
                  on:click={() => dispatchDeleteRequest(currentStatisticsSummaryRow)}
                >
                  {$t$('statistics.delete')}
                </button>
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
  {#if statisticsSummaryPopoverDetails.length}
    <Popover
      placement="top-start"
      yOffset={5}
      containerStyles={`align-self:flex-start;display:${isDateAggregation ? 'none' : 'flex'}`}
      bind:this={statisticsSummaryPopover}
    >
      <div slot="content" class="summary-popover">
        {#each statisticsSummaryPopoverDetails as popoverDetail (popoverDetail)}
          <div>{popoverDetail}</div>
        {/each}
        <button
          type="button"
          class="app-button app-button-quiet"
          on:click={() => (statisticsSummaryPopoverDetails = [])}
        >
          {$t$('statistics.close')}
        </button>
      </div>
    </Popover>
  {/if}
  {#if statisticsSummaryMaxPages > 1}
    <div class="summary-pages">
      <button
        type="button"
        class="app-button app-button-quiet"
        disabled={currentStatisticsSummaryPage === 1}
        on:click={() => {
          setRowInEditMode();
          currentStatisticsSummaryPage -= 1;
        }}
      >
        {$t$('statistics.previous')}
      </button>
      <Popover
        yOffset={5}
        on:open={() => {
          const currentPageElement = statisticsSummaryPageRefs[currentStatisticsSummaryPage];

          if (!currentPageElement || !statisticsSummaryPagesContainer) {
            return;
          }

          const absoluteElementTop =
            currentPageElement.offsetTop + currentPageElement.clientHeight / 2;
          const middle = absoluteElementTop - statisticsSummaryPagesContainer.clientHeight / 2;

          statisticsSummaryPagesContainer.scrollTo(0, middle);
        }}
      >
        <button type="button" class="summary-page-label">{statisticsSummaryPageLabel}</button>
        <div
          slot="content"
          class="flex max-h-48 w-32 flex-col overflow-auto"
          bind:this={statisticsSummaryPagesContainer}
        >
          {#each statisticsSummaryPages as statisticsSummaryPage, pageIndex (statisticsSummaryPage)}
            <button
              type="button"
              class="app-popover-item"
              class:app-popover-item-active={statisticsSummaryPage === currentStatisticsSummaryPage}
              bind:this={statisticsSummaryPageRefs[pageIndex + 1]}
              on:click={({ target }) => {
                setRowInEditMode();

                currentStatisticsSummaryPage = statisticsSummaryPage;
                target?.dispatchEvent(new CustomEvent(CLOSE_POPOVER, { bubbles: true }));
              }}
            >
              {statisticsSummaryPage}
            </button>
          {/each}
        </div>
      </Popover>
      <button
        type="button"
        class="app-button app-button-quiet"
        disabled={currentStatisticsSummaryPage === statisticsSummaryMaxPages}
        on:click={() => {
          setRowInEditMode();
          currentStatisticsSummaryPage += 1;
        }}
      >
        {$t$('statistics.next')}
      </button>
    </div>
  {/if}
{:else}
  <p class="summary-empty">{$t$('statistics.noData', { range: statisticsDateRangeLabel })}</p>
{/if}

<style>
  .summary-scroll {
    min-width: 0;
  }

  .summary-table :global(th) {
    white-space: nowrap;
  }

  .summary-table td {
    font-size: var(--type-body);
  }

  .summary-table :global(.summary-th-numeric),
  .summary-number {
    text-align: right;
  }

  .summary-date {
    color: var(--app-muted-fg);
    white-space: nowrap;
  }

  .summary-title {
    width: 100%;
  }

  .summary-title button {
    display: -webkit-box;
    overflow: hidden;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    text-align: left;
  }

  .summary-number {
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .summary-number button:hover,
  .summary-title button:hover {
    text-decoration: underline;
    text-underline-offset: 0.2em;
  }

  .summary-input {
    width: 7rem;
    text-align: right;
  }

  .summary-reset {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    font-size: var(--type-small);
  }

  .summary-actions {
    padding-right: 0 !important;
    text-align: right;
    white-space: nowrap;
  }

  .summary-actions button + button {
    margin-left: 1rem;
  }

  .summary-actions-head {
    padding-right: 0 !important;
  }

  .summary-row-edit {
    background: var(--app-control-bg);
  }

  .summary-popover {
    display: flex;
    min-width: 10rem;
    max-width: 20rem;
    flex-direction: column;
    gap: 0.35rem;
    padding: 0.75rem;
    font-size: var(--type-small);
    font-variant-numeric: tabular-nums;
  }

  .summary-popover button {
    align-self: flex-start;
    margin-top: 0.25rem;
  }

  .summary-pages {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 1rem;
  }

  .summary-page-label {
    color: var(--app-muted-fg);
    font-size: var(--type-small);
    font-variant-numeric: tabular-nums;
  }

  .summary-empty {
    padding: 1.5rem 0;
    border-top: 2px solid var(--font-color);
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }

  /* Phones: each row is a block, title on top and the figures below it. */
  @media (max-width: 767px) {
    .summary-table thead tr {
      display: flex;
      flex-wrap: wrap;
      gap: 0 1rem;
    }

    .summary-table thead :global(th) {
      padding-right: 0;
    }

    .summary-actions-head {
      display: none;
    }

    .summary-table tbody tr {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 0.25rem 0.75rem;
      padding: 0.6rem 0;
    }

    .summary-table td {
      padding: 0 !important;
    }

    .summary-date,
    .summary-title,
    .summary-actions {
      grid-column: 1 / -1;
    }

    .summary-actions {
      text-align: left;
    }

    .summary-number {
      text-align: left;
      font-size: var(--type-small) !important;
    }

    .summary-number::before {
      content: attr(data-label);
      display: block;
      color: var(--app-muted-fg);
      font-size: var(--type-label);
    }
  }
</style>
