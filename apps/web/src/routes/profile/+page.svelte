<script lang="ts">
  import { goto } from '$app/navigation';
  import AppHeader from '$lib/components/app-header/app-header.svelte';
  import ImportMenu from '$lib/components/library/import-menu.svelte';
  import PointBox from '$lib/components/point-box.svelte';
  import ReadingRankRow from '$lib/components/reading-rank/reading-rank-row.svelte';
  import SectionHead from '$lib/components/section-head.svelte';
  import StatisticsHeatmap from '$lib/components/statistics/statistics-heatmap/statistics-heatmap.svelte';
  import RoleBadge from '$lib/components/social/role-badge.svelte';
  import SocialAvatar from '$lib/components/social/social-avatar.svelte';
  import { account$ } from '$lib/data/account/account';
  import { pagePath, standalone } from '$lib/data/env';
  import { learnerStats, type LearnerStats } from '$lib/data/stats/learner-stats';
  import { setPendingImport, type PendingImport } from '$lib/data/library/library-home';
  import { socialSession$ } from '$lib/data/social/social-account';
  import { pullAccountStatistics } from '$lib/data/stats/statistics-sync';
  import type { BooksDbStatistic } from '$lib/data/database/books-db/versions/books-db';
  import {
    database,
    lastReadingDataHeatmapAggregationMode$,
    startDayHoursForTracker$,
    statisticsEnabled$
  } from '$lib/data/store';
  import { getWordsSummary, type WordsSummary } from '$lib/data/words/words-met';
  import { getDateString, getStartHoursDate } from '$lib/functions/statistic-util';
  import { t$ } from '$lib/i18n';
  import { formatDuration } from '$lib/functions/format-time';
  import { activePlugins$ } from '$lib/plugins';
  import { onMount } from 'svelte';

  /**
   * Profile (boards 11, 12, D11), opened from the avatar at the header's end: the reader's own
   * statistics, which need no account, and Edit statistics for the full Statistics tools (period,
   * goals, data). Signed in to the hub it also shows the public profile's parts. Not part of upstream.
   */

  let stats: LearnerStats | undefined;
  let statistics: BooksDbStatistic[] = [];
  let today = new Date();
  let todayKey = '';
  /** Every title shown: the heatmap counts only titles set true here */
  let titles = new Map<string, boolean>();
  let words: WordsSummary | undefined;
  let note = '';
  let pulledAt = 0;

  $: socialOn = $activePlugins$.some((plugin) => plugin.id === 'social');
  $: me = socialOn ? $socialSession$?.me : undefined;
  $: link = me ? `${location.origin}${pagePath}/u?name=${encodeURIComponent(me.username)}` : '';

  const number = (value: number) => value.toLocaleString('en-US');

  async function load() {
    statistics = await database
      .getStatisticsForTimeWindow('0000-00-00', '9999-99-99')
      .catch(() => []);
    titles = new Map(statistics.map((statistic) => [statistic.title, true]));
    today = getStartHoursDate($startDayHoursForTracker$);
    todayKey = getDateString(today);
    stats = learnerStats(statistics, todayKey);
  }

  onMount(async () => {
    await load();
    getWordsSummary().then(
      (summary) => (words = summary),
      () => {}
    );
    // Statistics of books not opened in this browser only exist on the server.
    pullAccountStatistics(window)
      .then(load)
      .then(() => (pulledAt = Date.now()))
      .catch(() => {});
  });

  function copyLink() {
    navigator.clipboard
      ?.writeText(link)
      .then(() => (note = $t$('social.linkCopied')))
      .catch(() => {});
  }

  function importOnManage(value: PendingImport) {
    setPendingImport(value);
    goto(`${pagePath}/manage`);
  }

  $: rows = stats
    ? [
        [$t$('profile.charactersRead'), number(stats.totalCharacters)],
        [$t$('dashboard.time'), formatDuration(stats.totalTime, $t$, 'short')],
        [$t$('dashboard.finished'), number(stats.booksCompleted)],
        [$t$('profile.readingDays'), number(stats.daysRead)],
        [$t$('dashboard.wordsKnown'), words ? number(words.known) : '–']
      ]
    : [];
</script>

<svelte:head><title>{$t$('nav.profile')}</title></svelte:head>

<AppHeader active="profile">
  <ImportMenu
    on:filesChange={(ev) => importOnManage({ files: Array.from(ev.detail) })}
    on:importBackup={(ev) => importOnManage({ backup: ev.detail })}
  />
</AppHeader>

<div class="app-page-shell">
  <main class="profile">
    {#if me}
      <header class="profile-who">
        <SocialAvatar avatar={me.avatar} person={me} size={4} />
        <div>
          <h1 class="profile-name">{me.name}<RoleBadge role={me.role} /></h1>
          <p class="profile-meta">
            @{me.username}{#if me.share.public !== false}
              · {$t$('social.publicProfile').toLowerCase()}{/if}
          </p>
          {#if words}
            <p class="profile-meta">
              {$t$('community.wordsKnown', { count: number(words.known) })}
            </p>
          {/if}
        </div>
      </header>
      <div class="profile-actions">
        <a class="app-button" href="{pagePath}/settings?section=social#social-profile"
          >{$t$('social.editProfile')}</a
        >
        <button type="button" class="app-button-quiet" on:click={copyLink}
          >{$t$('social.copyLink')}</button
        >
        <a class="app-button-quiet" href={link}>{$t$('social.viewProfile')}</a>
        {#if note}<span class="profile-meta" role="status">{note}</span>{/if}
      </div>
    {:else}
      <header>
        <h1 class="profile-title">{$t$('nav.profile')}</h1>
        <p class="profile-meta">
          {#if socialOn}
            <a class="app-button-quiet" href="{pagePath}/friends">{$t$('profile.signUp')}</a>
          {:else if !standalone && !$account$}
            <a class="app-button-quiet" href="{pagePath}/settings?section=general#general-account"
              >{$t$('nav.signIn')}</a
            >
          {/if}
        </p>
      </header>
    {/if}

    <section class="profile-stats" aria-labelledby="profile-statistics">
      <SectionHead id="profile-statistics" number={1} title={$t$('nav.statistics')} />
      {#if stats?.daysRead}
        <PointBox
          label={$t$('dashboard.pastWeek')}
          figure={stats.weekCharacters}
          unit={$t$('profile.chars')}
        >
          <p class="profile-meta profile-week">
            {$t$(stats.streak === 1 ? 'dashboard.streakOne' : 'dashboard.streak', {
              count: stats.streak
            })}{stats.speed
              ? ` · ${$t$('dashboard.speedValue', { speed: number(stats.speed) })}`
              : ''}
          </p>
        </PointBox>
        <dl class="profile-table">
          {#each rows as [label, value] (label)}
            <div>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          {/each}
        </dl>
        <ReadingRankRow refresh={pulledAt} />
        <!-- The Statistics page's calendar (no reading goals here) -->
        <StatisticsHeatmap
          statisticsData={statistics}
          readingGoals={[]}
          statisticsTitleFilters={titles}
          {today}
          {todayKey}
          bind:heatmapAggregration={$lastReadingDataHeatmapAggregationMode$}
        />
      {:else if stats}
        <p class="profile-meta">
          {$t$($statisticsEnabled$ ? 'profile.empty' : 'dashboard.trackerOff')}
        </p>
      {/if}
      <p class="profile-edit">
        <a class="app-button" href="{pagePath}/statistics">{$t$('profile.editStatistics')}</a>
      </p>
    </section>
  </main>
</div>

<style>
  .profile {
    display: flex;
    max-width: 47.5rem;
    flex-direction: column;
    gap: 1.5rem;
    margin: 0 auto;
    padding: 6rem 1rem calc(5.5rem + env(safe-area-inset-bottom));
  }

  @media (min-width: 768px) {
    .profile {
      padding: 6.5rem 2.5rem 4rem;
    }
  }

  .profile-who {
    display: flex;
    align-items: center;
    gap: 1.25rem;
  }

  .profile-name {
    font-size: var(--type-h1);
    font-weight: 400;
  }

  .profile-title {
    font-size: var(--type-display);
    font-weight: 400;
    line-height: 1.2;
  }

  .profile-title + .profile-meta,
  .profile-name + .profile-meta {
    margin-top: 0.4rem;
  }

  .profile-meta {
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }

  .profile-actions,
  .profile-edit {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.75rem 1rem;
  }

  .profile-stats {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
    margin-top: 1rem;
  }

  .profile-week {
    margin-top: 0.5rem;
  }

  .profile-table {
    border-top: 2px solid var(--font-color);
  }

  .profile-table > div {
    display: flex;
    min-height: 2.75rem;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    border-bottom: 1px solid var(--border-color);
  }

  .profile-table dd {
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
</style>
