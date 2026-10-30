<script lang="ts">
  import PointBox from '$lib/components/point-box.svelte';
  import ReadingRankRow from '$lib/components/reading-rank/reading-rank-row.svelte';
  import { learningGuideUrl } from '$lib/data/app-update';
  import {
    activityWeeks,
    learnerStats,
    type ActivityDay,
    type LearnerStats
  } from '$lib/data/learner-stats';
  import { placementCutoff$ } from '$lib/data/placement';
  import { pullAccountStatistics } from '$lib/data/statistics-sync';
  import { database, startDayHoursForTracker$, statisticsEnabled$ } from '$lib/data/store';
  import {
    getWordsSummary,
    knownMinCount,
    saveReadProgress,
    type WordsSummary
  } from '$lib/data/words-met';
  import { gainedThisMonth, getKnownHistory } from '$lib/data/words-history';
  import { getDateKey } from '$lib/functions/statistic-util';
  import { t$, uiLanguage$ } from '$lib/i18n';
  import { formatDuration } from '$lib/functions/format-time';
  import { onMount } from 'svelte';

  /**
   * Home tab totals for Japanese learners: today's characters in the Today box with the
   * past week, then time, speed, books and words met and known as a ruled table. Not part
   * of upstream.
   */

  /** The Calibre library's books, for the progress of books read before kanji were recorded */
  export let books: { title: string; progress: number }[] | undefined = undefined;

  let stats: LearnerStats | undefined;
  let week: ActivityDay[] = [];
  let words: WordsSummary | undefined;
  let gained: number | undefined;
  /** Bumped when the server's statistics arrived, so the rank is read again */
  let pulledAt = 0;

  const number = (value: number) => value.toLocaleString('en-US');

  async function loadStats() {
    const statistics = await database
      .getStatisticsForTimeWindow('0000-00-00', '9999-99-99')
      .catch(() => []);

    const today = getDateKey($startDayHoursForTracker$);

    stats = learnerStats(statistics, today);
    week = activityWeeks(statistics, today, 2).flat().slice(-7);

    return { statistics, today };
  }

  function loadWords() {
    return getWordsSummary()
      .then((summary) => (words = summary))
      .catch(() => {});
  }

  $: if (books) {
    saveReadProgress(books).then(
      (changed) => {
        if (changed) loadWords();
      },
      () => {}
    );
  }

  onMount(async () => {
    await loadStats();

    const summary = loadWords();
    // Statistics of books not opened in this browser only exist on the server.
    const pulled = pullAccountStatistics(window)
      .catch(() => {})
      .then(loadStats)
      .then((loaded) => {
        pulledAt = Date.now();
        return loaded;
      });

    // After the summary, which fetches the same word lists.
    Promise.all([pulled, summary])
      .then(async ([{ statistics, today }]) =>
        gainedThisMonth(await getKnownHistory(statistics), today)
      )
      .then((count) => (gained = count))
      .catch(() => {});
  });

  $: weekMax = Math.max(1, ...week.map((day) => day.characters));
  $: weekday = (dateKey: string) =>
    new Date(`${dateKey}T00:00:00Z`).toLocaleDateString($uiLanguage$, {
      weekday: 'narrow',
      timeZone: 'UTC'
    });

  $: rows = stats
    ? [
        {
          label: $t$('dashboard.pastWeek'),
          value: $t$('dashboard.charsValue', { count: number(stats.weekCharacters) })
        },
        { label: $t$('dashboard.time'), value: formatDuration(stats.totalTime, $t$) },
        {
          label: $t$('dashboard.speed'),
          value: stats.speed ? $t$('dashboard.speedValue', { speed: number(stats.speed) }) : '–'
        },
        {
          label: $t$('dashboard.finished'),
          value: number(stats.booksCompleted),
          hint: $t$('dashboard.started', { count: number(stats.booksStarted) })
        },
        {
          label: $t$('dashboard.words'),
          value: words ? number(words.met) : '–',
          hint: $t$('dashboard.wordsHint')
        },
        {
          label: $t$('dashboard.wordsKnown'),
          value: words ? number(words.known) : '–',
          hint:
            $placementCutoff$ > 0
              ? $t$('dashboard.wordsKnownHintPlaced', {
                  count: knownMinCount,
                  cutoff: number($placementCutoff$)
                })
              : $t$('dashboard.wordsKnownHint', { count: knownMinCount }),
          extra: gained ? $t$('dashboard.wordsGained', { count: number(gained) }) : ''
        }
      ]
    : [];
</script>

<section class="dashboard" aria-label={$t$('dashboard.label')}>
  <!-- Nothing read yet: Home's Start reading says what to do instead of a row of zeros -->
  {#if stats?.daysRead}
    <div class="dashboard-today">
      <PointBox
        label={$t$('dashboard.today')}
        figure={stats.todayCharacters}
        unit={$t$('dashboard.unit')}
      >
        <p
          class="dashboard-streak"
          title={$t$('dashboard.streakTitle', {
            longest: stats.longestStreak,
            days: stats.daysRead
          })}
        >
          {#if stats.streak}
            {$t$(stats.streak === 1 ? 'dashboard.streakOne' : 'dashboard.streak', {
              count: stats.streak
            })}
          {:else}
            {$t$('dashboard.noStreak')}
          {/if}
        </p>
        <ol class="dashboard-week" aria-label={$t$('dashboard.week')}>
          {#each week as day, i (day.dateKey)}
            <li
              class:dashboard-week-today={i === week.length - 1}
              title={$t$('dashboard.dayTitle', {
                date: day.dateKey,
                count: number(day.characters)
              })}
            >
              <span class="dashboard-week-bar" aria-hidden="true">
                <span style:height="{(day.characters / weekMax) * 100}%" />
              </span>
              <span class="dashboard-week-day">{weekday(day.dateKey)}</span>
            </li>
          {/each}
        </ol>
      </PointBox>
    </div>

    <dl class="dashboard-table">
      {#each rows as row (row.label)}
        <div title={row.hint || undefined}>
          <dt>{row.label}</dt>
          <dd>
            {#if row.extra}<small title={$t$('dashboard.wordsGainedHint')}>{row.extra}</small>{/if}
            {row.value}
          </dd>
        </div>
      {/each}
    </dl>
    <div class="dashboard-rank"><ReadingRankRow refresh={pulledAt} /></div>
  {:else if stats && !$statisticsEnabled$}
    <p class="dashboard-note">
      {$t$('dashboard.trackerOff')}
    </p>
  {/if}
  <a class="dashboard-guide" href={learningGuideUrl} target="_blank" rel="noreferrer">
    {$t$('dashboard.guide')}
  </a>
</section>

<style>
  .dashboard {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 1.5rem 3rem;
  }

  @media (min-width: 900px) {
    .dashboard {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr);
      align-items: start;
    }

    .dashboard-rank,
    .dashboard-note,
    .dashboard-guide {
      grid-column: 1 / -1;
    }
  }

  .dashboard-today {
    min-width: 0;
  }

  .dashboard-today :global(.point-box) {
    min-height: 100%;
    padding-right: 12rem;
  }

  .dashboard-streak {
    margin-top: 0.5rem;
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }

  .dashboard-week {
    position: absolute;
    right: 1.25rem;
    bottom: 1.25rem;
    display: grid;
    grid-template-columns: repeat(7, 1rem);
    gap: 0.4rem;
  }

  .dashboard-week li {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.35rem;
  }

  .dashboard-week-bar {
    position: relative;
    display: block;
    width: 100%;
    height: 3.5rem;
  }

  .dashboard-week-bar::before {
    content: '';
    position: absolute;
    inset: auto 0 0;
    height: 2px;
    background: var(--border-color);
  }

  .dashboard-week-bar > span {
    position: absolute;
    inset: auto 0 0;
    background: var(--accent-color);
  }

  .dashboard-week-day {
    color: var(--app-muted-fg);
    font-size: var(--type-label);
    line-height: 1;
  }

  .dashboard-week-today .dashboard-week-day {
    color: var(--font-color);
    font-weight: 700;
  }

  @media (max-width: 479px) {
    .dashboard-today :global(.point-box) {
      padding-right: 1.25rem;
    }

    .dashboard-week {
      position: static;
      margin-top: 1rem;
      grid-template-columns: repeat(7, minmax(0, 1fr));
    }

    .dashboard-week-bar {
      width: 1rem;
      height: 2.5rem;
    }
  }

  .dashboard-table {
    border-top: 2px solid var(--font-color);
  }

  .dashboard-table > div {
    display: flex;
    min-height: 2.5rem;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    border-bottom: 1px solid var(--border-color);
  }

  .dashboard-table dt {
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }

  .dashboard-table dd {
    color: var(--font-color);
    font-size: var(--type-body);
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    text-align: right;
  }

  .dashboard-table dd small {
    margin-right: 0.6em;
    color: var(--accent-strong-color);
    font-size: var(--type-label);
    font-weight: 400;
  }

  .dashboard-note,
  .dashboard-guide {
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }

  .dashboard-guide {
    justify-self: start;
    text-decoration: underline;
    text-underline-offset: 0.2em;
  }
</style>
