<script lang="ts">
  import { goto } from '$app/navigation';
  import AppHeader from '$lib/components/app-header/app-header.svelte';
  import ImportMenu from '$lib/components/book-card/import-menu.svelte';
  import StatisticsContent from '$lib/components/statistics/statistics-content.svelte';
  import StatisticsHeader from '$lib/components/statistics/statistics-header.svelte';
  import StatisticsSettings from '$lib/components/statistics/statistics-settings.svelte';
  import {
    StatisticsRangeTemplate,
    type StatisticsDateChange,
    preFilteredTitlesForStatistics$,
    statisticsActionInProgress$
  } from '$lib/components/statistics/statistics-types';
  import { pagePath } from '$lib/data/env';
  import { t$ } from '$lib/i18n';
  import { setPendingImport, type PendingImport } from '$lib/data/library-home';
  import {
    database,
    lastStartDayOfWeek$,
    lastStatisticsEndDate$,
    lastStatisticsRangeTemplate$,
    lastStatisticsStartDate$,
    startDayHoursForTracker$
  } from '$lib/data/store';
  import {
    advanceDateDays,
    getDateKey,
    getDateString,
    getStartHoursDate
  } from '$lib/functions/statistic-util';
  import { clickOutside } from '$lib/functions/use-click-outside';
  import { map, share } from 'rxjs';
  import { onDestroy, tick } from 'svelte';
  import { quintInOut } from 'svelte/easing';
  import { fly } from 'svelte/transition';

  const currentBookId$ = database.lastItem$.pipe(
    map((item) => item?.dataId),
    share()
  );

  let showStatisticsSettings = false;

  $: if ($lastStatisticsRangeTemplate$ || $lastStartDayOfWeek$ > -1) {
    tick().then(() => setSelectedStatisticsDays());
  }

  onDestroy(() => ($preFilteredTitlesForStatistics$ = new Set()));

  // The import runs (with its progress and errors) in the library.
  function importOnManage(value: PendingImport) {
    setPendingImport(value);
    goto(`${pagePath}/manage`);
  }

  function handleSelectedStatisticsDateChange({
    detail: { dateString, isStartDate }
  }: CustomEvent<StatisticsDateChange>) {
    const referenceDate = getStartHoursDate($startDayHoursForTracker$);
    const todayKey = getDateKey($startDayHoursForTracker$, referenceDate);

    $lastStatisticsRangeTemplate$ = StatisticsRangeTemplate.CUSTOM;

    if (isStartDate) {
      $lastStatisticsStartDate$ = dateString || todayKey;
    } else {
      $lastStatisticsEndDate$ = dateString || todayKey;
    }

    if ($lastStatisticsStartDate$ > $lastStatisticsEndDate$) {
      const originalStartDate = $lastStatisticsStartDate$;
      const originalEndDate = $lastStatisticsEndDate$;

      $lastStatisticsStartDate$ = originalEndDate;
      $lastStatisticsEndDate$ = originalStartDate;
    }

    setSelectedStatisticsDays(referenceDate);
  }

  function setSelectedStatisticsDays(referenceDate = getStartHoursDate($startDayHoursForTracker$)) {
    switch ($lastStatisticsRangeTemplate$) {
      case StatisticsRangeTemplate.TODAY: {
        const dateKey = getDateString(referenceDate);

        $lastStatisticsStartDate$ = dateKey;
        $lastStatisticsEndDate$ = dateKey;
        break;
      }
      case StatisticsRangeTemplate.WEEK: {
        const dayIndex = referenceDate.getDay();

        let dayDiff = 0;

        if ($lastStartDayOfWeek$ !== dayIndex) {
          if (!$lastStartDayOfWeek$) {
            dayDiff = -dayIndex;
          } else if (!dayIndex) {
            dayDiff = $lastStartDayOfWeek$ - 7;
          } else {
            dayDiff =
              $lastStartDayOfWeek$ > dayIndex
                ? $lastStartDayOfWeek$ - dayIndex - 7
                : $lastStartDayOfWeek$ - dayIndex;
          }
        }

        ({ dateString: $lastStatisticsStartDate$ } = advanceDateDays(referenceDate, dayDiff));
        ({ dateString: $lastStatisticsEndDate$ } = advanceDateDays(referenceDate, 6));
        break;
      }
      case StatisticsRangeTemplate.MONTH: {
        referenceDate.setDate(1);

        $lastStatisticsStartDate$ = getDateString(referenceDate);

        referenceDate.setMonth(referenceDate.getMonth() + 1);

        ({ dateString: $lastStatisticsEndDate$ } = advanceDateDays(referenceDate, -1));
        break;
      }
      case StatisticsRangeTemplate.YEAR: {
        referenceDate.setMonth(0);
        referenceDate.setDate(1);

        $lastStatisticsStartDate$ = getDateString(referenceDate);

        referenceDate.setFullYear(referenceDate.getFullYear() + 1);

        ({ dateString: $lastStatisticsEndDate$ } = advanceDateDays(referenceDate, -1));
        break;
      }
      default:
        break;
    }
  }
</script>

<AppHeader active="profile" currentBookId={$currentBookId$}>
  <ImportMenu
    on:filesChange={(ev) => importOnManage({ files: Array.from(ev.detail) })}
    on:importBackup={(ev) => importOnManage({ backup: ev.detail })}
  />
</AppHeader>

<div class="app-page-shell">
  <main class="statistics" aria-label="Statistics">
    <div>
      <!-- Edit statistics on Profile opens these tools (the header's avatar stays lit) -->
      <a class="app-button-quiet statistics-back" href="{pagePath}/profile"
        >← {$t$('nav.profile')}</a
      >
      <StatisticsHeader bind:showStatisticsSettings />
    </div>
    <StatisticsContent />
  </main>
</div>

{#if showStatisticsSettings}
  <div
    class="writing-horizontal-tb fixed top-0 right-0 z-[60] flex h-full w-full max-w-xl flex-col justify-between bg-[color:var(--surface-strong-color)] text-[color:var(--font-color)]"
    in:fly|local={{ x: 100, duration: 100, easing: quintInOut }}
    use:clickOutside={() => {
      if (!$statisticsActionInProgress$) {
        showStatisticsSettings = false;
      }
    }}
  >
    <StatisticsSettings
      on:statisticsDateChange={handleSelectedStatisticsDateChange}
      on:close={() => (showStatisticsSettings = false)}
    />
  </div>
{/if}

<style>
  .statistics {
    display: flex;
    max-width: 75rem;
    flex-direction: column;
    gap: 3rem;
    margin: 0 auto;
    padding: 6rem 1rem calc(5.5rem + env(safe-area-inset-bottom));
  }

  .statistics-back {
    margin-bottom: 1rem;
  }

  @media (min-width: 768px) {
    .statistics {
      padding: 6.5rem 2.5rem 4rem;
    }
  }
</style>
