<script lang="ts">
  import { learningGuideUrl } from '$lib/data/app-update';
  import {
    activityWeeks,
    learnerStats,
    type ActivityDay,
    type LearnerStats
  } from '$lib/data/learner-stats';
  import { pullAccountStatistics } from '$lib/data/statistics-sync';
  import { database, startDayHoursForTracker$, statisticsEnabled$ } from '$lib/data/store';
  import { getWordsSummary, knownMinCount, type WordsSummary } from '$lib/data/words-met';
  import { getDateKey } from '$lib/functions/statistic-util';
  import { t$, type MessageKey, type MessageParams } from '$lib/i18n';
  import { onMount } from 'svelte';

  /**
   * Home tab totals for Japanese learners: characters, time, speed, streaks
   * and how many different words were met and known. Not part of upstream.
   */

  let stats: LearnerStats | undefined;
  let weeks: ActivityDay[][] = [];
  let words: WordsSummary | undefined;

  const number = (value: number) => value.toLocaleString('en-US');

  function hours(seconds: number, t: (key: MessageKey, params?: MessageParams) => string) {
    const h = Math.floor(seconds / 3600);
    const m = Math.round((seconds % 3600) / 60);

    return h
      ? t('dashboard.hours', { hours: h, minutes: m })
      : t('dashboard.minutes', { minutes: m });
  }

  async function loadStats() {
    const statistics = await database
      .getStatisticsForTimeWindow('0000-00-00', '9999-99-99')
      .catch(() => []);

    const today = getDateKey($startDayHoursForTracker$);

    stats = learnerStats(statistics, today);
    weeks = activityWeeks(statistics, today);
  }

  onMount(async () => {
    getWordsSummary()
      .then((summary) => (words = summary))
      .catch(() => {});
    await loadStats();
    // Statistics of books not opened in this browser only exist on the server.
    pullAccountStatistics(window)
      .then(loadStats)
      .catch(() => {});
  });

  $: secondary = stats
    ? [
        { label: $t$('dashboard.pastWeek'), value: number(stats.weekCharacters) },
        { label: $t$('dashboard.characters'), value: number(stats.totalCharacters) },
        { label: $t$('dashboard.time'), value: hours(stats.totalTime, $t$) },
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
          hint: $t$('dashboard.wordsKnownHint', { count: knownMinCount })
        }
      ]
    : [];
</script>

<section class="dashboard" aria-label={$t$('dashboard.label')}>
  {#if stats}
    <div class="dashboard-main">
      <div class="dashboard-feature">
        <span class="dashboard-feature-label">{$t$('dashboard.today')}</span>
        <span class="dashboard-feature-value">{number(stats.todayCharacters)}<small>字</small></span>
        <span
          class="dashboard-streak"
          title={$t$('dashboard.streakTitle', {
            longest: stats.longestStreak,
            days: stats.daysRead
          })}
        >
          {#if stats.streak}
            <span class="dashboard-seal" aria-hidden="true">連</span>
            {$t$(stats.streak === 1 ? 'dashboard.streakOne' : 'dashboard.streak', {
              count: stats.streak
            })}
          {:else}
            {$t$('dashboard.noStreak')}
          {/if}
        </span>
      </div>

      {#if stats.daysRead}
        <div class="dashboard-heatmap" role="img" aria-label={$t$('dashboard.heatmap')}>
          {#each weeks as week, w (w)}
            <span class="dashboard-week">
              {#each week as day (day.dateKey)}
                <span
                  class="dashboard-day"
                  data-level={day.level}
                  title={$t$('dashboard.dayTitle', {
                    date: day.dateKey,
                    count: number(day.characters)
                  })}
                />
              {/each}
            </span>
          {/each}
        </div>
      {/if}
    </div>

    <dl class="dashboard-stats">
      {#each secondary as item (item.label)}
        <div title={item.hint || undefined}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      {/each}
    </dl>

    {#if !$statisticsEnabled$ && !stats.daysRead}
      <p class="dashboard-note">
        {$t$('dashboard.trackerOff')}
      </p>
    {/if}
  {/if}
  <a class="dashboard-guide" href={learningGuideUrl} target="_blank" rel="noreferrer">
    {$t$('dashboard.guide')}
  </a>
</section>

<style>
  .dashboard {
    margin-bottom: 2.5rem;
    padding-bottom: 1.75rem;
    border-bottom: 1px solid var(--border-color);
  }

  .dashboard-main {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    justify-content: space-between;
    gap: 1.5rem 2.5rem;
  }

  .dashboard-feature {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }

  .dashboard-feature-label,
  .dashboard-note,
  .dashboard-stats dt {
    color: var(--app-muted-fg);
    font-size: 0.78rem;
  }

  .dashboard-feature-value {
    font-family: var(--app-font-display);
    font-size: clamp(2.5rem, 7vw, 3.5rem);
    font-variant-numeric: tabular-nums;
    line-height: 1.1;
  }

  .dashboard-feature-value small {
    margin-left: 0.2em;
    color: var(--app-muted-fg);
    font-size: 0.4em;
  }

  .dashboard-streak {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    margin-top: 0.35rem;
    color: var(--app-muted-fg);
    font-size: 0.82rem;
  }

  .dashboard-seal {
    display: inline-flex;
    width: 1.3rem;
    height: 1.3rem;
    align-items: center;
    justify-content: center;
    border-radius: 2px;
    background: var(--accent-color);
    color: var(--app-accent-fg);
    font-family: var(--app-font-display);
    font-size: 0.75rem;
  }

  .dashboard-heatmap {
    display: flex;
    gap: 3px;
    max-width: 100%;
    overflow-x: auto;
  }

  .dashboard-week {
    display: grid;
    grid-template-rows: repeat(7, 0.7rem);
    gap: 3px;
  }

  .dashboard-day {
    width: 0.7rem;
    border-radius: 2px;
    background: var(--heatmap-empty);
  }

  .dashboard-day[data-level='1'] {
    background: var(--heatmap-low);
  }

  .dashboard-day[data-level='2'] {
    background: color-mix(in srgb, var(--heatmap-high) 40%, var(--heatmap-low));
  }

  .dashboard-day[data-level='3'] {
    background: color-mix(in srgb, var(--heatmap-high) 70%, var(--heatmap-low));
  }

  .dashboard-day[data-level='4'] {
    background: var(--heatmap-high);
  }

  .dashboard-stats {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem 2rem;
    margin-top: 1.5rem;
  }

  .dashboard-stats dd {
    font-size: 1rem;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  .dashboard-note {
    margin-top: 1rem;
  }

  .dashboard-guide {
    display: inline-block;
    margin-top: 1rem;
    color: var(--app-muted-fg);
    font-size: 0.78rem;
    text-decoration: underline;
  }
</style>
