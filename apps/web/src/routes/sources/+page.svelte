<script lang="ts">
  import { goto } from '$app/navigation';
  import AppHeader from '$lib/components/app-header/app-header.svelte';
  import PointBox from '$lib/components/point-box.svelte';
  import SectionHead from '$lib/components/section-head.svelte';
  import NeedsApp from '$lib/components/sources/needs-app.svelte';
  import SourceCover from '$lib/components/sources/source-cover.svelte';
  import { account$, hasPermission } from '$lib/data/account/account';
  import { pagePath, standalone } from '$lib/data/env';
  import { libraryTab$ } from '$lib/data/library/library-home';
  import {
    cancelJob,
    checkNow,
    followWork,
    getFollowing,
    getQueue,
    lookUpWork,
    removeJob,
    retryJob,
    timeLeft,
    unfollowWork
  } from '$lib/data/sources/server-sources';
  import { sourcesWifiOnly$ } from '$lib/data/sources/sources-settings';
  import { needsAppMessage } from '$lib/data/sources/transport';
  import type { SourceFollow, SourceJob } from '$lib/data/sources/types';
  import { onMount } from 'svelte';

  /**
   * Sources (Import → Sources; server edition: import permission): the works this account
   * follows, the queue of its fetch jobs (both polled every 5 s while the page is open), and
   * paste a link to a work. Standalone: all of it runs on this device (local-sources.ts).
   */

  let jobs = $state<SourceJob[]>();
  let follows = $state<SourceFollow[]>([]);
  let checkHours = $state(6);
  let interval = $state(2);
  let queueError = $state('');
  let tab = $state<'following' | 'queue' | 'add'>();
  let link = $state('');
  let lookupError = $state('');
  let looking = $state(false);
  let showDone = $state(false);
  let busy = $state<string>();

  const allowed = $derived(standalone || hasPermission($account$, 'import'));
  const running = $derived(jobs?.find((job) => job.state === 'fetching'));
  const waiting = $derived(
    jobs?.filter((job) => job.state === 'queued' || job.state === 'adding').reverse() ?? []
  );
  const failed = $derived(
    jobs?.filter((job) => job.state === 'failed' || job.state === 'cancelled') ?? []
  );
  const done = $derived(jobs?.filter((job) => job.state === 'done') ?? []);
  // The switch appears once there is a follow or a queue; until then the page is the Add view.
  const shownTab = $derived(tab ?? (follows.length ? 'following' : jobs?.length ? 'queue' : 'add'));
  const nextCheck = $derived(
    Math.min(
      ...follows
        .filter((follow) => !follow.paused && follow.nextCheck)
        .map((follow) => follow.nextCheck as number)
    )
  );

  async function refresh() {
    try {
      const [queue, following] = await Promise.all([getQueue(), getFollowing()]);
      ({ jobs, interval } = queue);
      ({ follows, checkHours } = following);
      queueError = '';
    } catch (error: any) {
      queueError = error.message;
    }
  }

  onMount(() => {
    $libraryTab$ = 'store';
    if (!allowed) return;
    refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, 5000);
    return () => clearInterval(timer);
  });

  async function lookUp(event: SubmitEvent) {
    event.preventDefault();
    if (!link.trim() || looking) return;
    looking = true;
    lookupError = '';
    try {
      const work = await lookUpWork(link.trim());
      await goto(`${pagePath}/sources/work?id=${work.id}`);
    } catch (error: any) {
      lookupError = error.message;
    } finally {
      looking = false;
    }
  }

  async function act(job: SourceJob, action: (id: string) => Promise<unknown>) {
    busy = job.id;
    try {
      await action(job.id);
      await refresh();
    } catch (error: any) {
      queueError = error.message;
    } finally {
      busy = undefined;
    }
  }

  async function followAction(action: () => Promise<unknown>, id: string) {
    busy = id;
    try {
      await action();
      await refresh();
    } catch (error: any) {
      queueError = error.message;
    } finally {
      busy = undefined;
    }
  }

  function unfollow(follow: SourceFollow) {
    if (!window.confirm('Stop checking for new chapters? Your volumes stay.')) return;
    followAction(() => unfollowWork(follow.workId), `follow-${follow.workId}`);
  }

  /** 18:00 today, else Oct 31 18:00 */
  function clock(ms: number) {
    const date = new Date(ms);
    const time = date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    return date.toDateString() === new Date().toDateString()
      ? time
      : `${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${time}`;
  }

  function ago(ms: number) {
    const minutes = Math.round((Date.now() - ms) / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes} min ago`;
    return minutes < 24 * 60 ? `${Math.round(minutes / 60)} h ago` : `on ${clock(ms)}`;
  }

  function followStatus(follow: SourceFollow) {
    if (follow.paused) return 'Paused';
    if (follow.state === 'checking') return 'Checking now';
    if (follow.state === 'current') return 'Up to date';
    if (follow.state === '') return 'Waiting for the first check';
    if (follow.state === 'wifi') return 'Waiting for Wi-Fi: on mobile data now';
    return follow.detail;
  }

  function followWhen(follow: SourceFollow) {
    if (follow.paused) {
      return `Paused by you on ${new Date(follow.modified).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric'
      })}`;
    }
    if (follow.state === 'removed') {
      return follow.volumes === 1
        ? 'Your volume stays in the library'
        : `Your ${follow.volumes} volumes stay in the library`;
    }
    if (follow.state === 'app') return '';
    if (follow.state === 'failed') {
      return `Retrying every hour${follow.lastCheck ? ` · last ${clock(follow.lastCheck)}` : ''}`;
    }
    return [
      follow.lastCheck && `Checked ${ago(follow.lastCheck)}`,
      follow.state !== 'checking' && follow.nextCheck && `next ${clock(follow.nextCheck)}`
    ]
      .filter(Boolean)
      .join(' · ');
  }

  function volumesText(job: SourceJob) {
    const [first] = job.volumes;
    const last = job.volumes[job.volumes.length - 1];
    if (!job.volumes.length) return '';
    return first === last ? `Vol. ${first}` : `Vol. ${first}–${last}`;
  }

  function meta(job: SourceJob) {
    return [job.siteName, volumesText(job), `${job.total} ${job.unit}`].filter(Boolean).join(' · ');
  }

  function status(job: SourceJob) {
    if (job.state === 'adding') return 'Adding to the Calibre library';
    if (job.error === needsAppMessage) return job.error;
    if (job.state === 'cancelled') return 'Cancelled. Chapters fetched so far are kept.';
    if (job.state === 'failed') {
      return job.failedAt && job.failedAt > 1
        ? `${job.error}. Chapters before it are kept.`
        : job.error;
    }
    return running
      ? `Waiting for the one above, ${timeLeft(running.total - running.done, interval)}`
      : 'Waiting to start';
  }
</script>

<svelte:head>
  <title>Sources</title>
</svelte:head>

<AppHeader active="library" />

<div class="app-page-shell">
  <main class="sources-page">
    <a class="app-button-quiet sources-back" href="{pagePath}/manage">← Store</a>
    <h1 class="sources-title">Sources</h1>
    <p class="sources-lead">
      {standalone
        ? 'On this device. Updates run while the app is open.'
        : 'Fetched on the server into your Calibre library.'}
    </p>

    {#if !allowed}
      <p class="sources-note">
        Adding web novels needs an account with the "Add books" permission. Ask an admin.
      </p>
    {:else}
      {#if jobs?.length || follows.length}
        <div class="sources-bar">
          <div class="app-segmented sources-switch" role="radiogroup" aria-label="Sources view">
            <button
              type="button"
              role="radio"
              class="app-segment"
              class:app-segment-selected={shownTab === 'following'}
              aria-checked={shownTab === 'following'}
              onclick={() => (tab = 'following')}
              >Following{follows.length ? ` ${follows.length}` : ''}</button
            >
            <button
              type="button"
              role="radio"
              class="app-segment"
              class:app-segment-selected={shownTab === 'queue'}
              aria-checked={shownTab === 'queue'}
              onclick={() => (tab = 'queue')}
              >Queue{(jobs?.length ?? 0) > done.length
                ? ` ${(jobs?.length ?? 0) - done.length}`
                : ''}</button
            >
            <button
              type="button"
              role="radio"
              class="app-segment"
              class:app-segment-selected={shownTab === 'add'}
              aria-checked={shownTab === 'add'}
              onclick={() => (tab = 'add')}>Add a work</button
            >
          </div>
          {#if shownTab === 'following'}
            <div class="sources-check">
              <p class="sources-row-meta">
                {#if standalone}
                  Every {checkHours} h while open{$sourcesWifiOnly$ ? ' · Wi-Fi only' : ''}
                {:else}
                  Server checks every {checkHours} h{Number.isFinite(nextCheck)
                    ? ` · next ${clock(nextCheck)}`
                    : ''}
                {/if}
              </p>
              <button
                type="button"
                class="app-button-quiet"
                disabled={busy === 'check' || !follows.some((follow) => !follow.paused)}
                onclick={() => followAction(() => checkNow(), 'check')}>Check now</button
              >
            </div>
          {/if}
        </div>
      {/if}

      {#if queueError}
        <p class="sources-error" role="alert">{queueError}</p>
      {/if}

      {#if shownTab === 'following'}
        {#if follows.length}
          <ul class="sources-rows">
            {#each follows as follow (follow.workId)}
              {@const id = `follow-${follow.workId}`}
              <li class="sources-row sources-follow">
                <SourceCover
                  title={follow.title}
                  workId={follow.cover ? follow.workId : undefined}
                />
                <div class="sources-follow-body">
                  <div class="sources-follow-work">
                    <a
                      class="sources-row-title"
                      lang="ja"
                      href="{pagePath}/sources/work?id={follow.workId}">{follow.title}</a
                    >
                    <p class="sources-row-meta">{follow.siteName}</p>
                  </div>
                  <div class="sources-follow-state">
                    {#if follow.state === 'app' && !follow.paused}
                      <NeedsApp />
                    {:else}
                      <p
                        class="sources-status sources-status-{follow.paused
                          ? 'paused'
                          : follow.state}"
                      >
                        <span class="sources-swatch" aria-hidden="true"></span>{followStatus(
                          follow
                        )}
                      </p>
                      <p class="sources-row-meta">{followWhen(follow)}</p>
                    {/if}
                  </div>
                  <div class="sources-actions">
                    {#if follow.paused}
                      <button
                        type="button"
                        class="app-button-quiet"
                        disabled={busy === id}
                        onclick={() => followAction(() => followWork(follow.workId, false), id)}
                        >Resume</button
                      >
                    {:else if follow.state === 'failed'}
                      <button
                        type="button"
                        class="app-button-quiet"
                        disabled={busy === id}
                        onclick={() => followAction(() => checkNow(follow.workId), id)}
                        >Retry</button
                      >
                    {:else if follow.state !== 'removed'}
                      <button
                        type="button"
                        class="app-button-quiet"
                        disabled={busy === id}
                        onclick={() => followAction(() => followWork(follow.workId, true), id)}
                        >Pause</button
                      >
                    {/if}
                    <button
                      type="button"
                      class="app-button-quiet"
                      disabled={busy === id}
                      onclick={() => unfollow(follow)}>Unfollow</button
                    >
                  </div>
                </div>
              </li>
            {/each}
          </ul>
        {:else}
          <p class="sources-note">
            No followed works yet. Turn on Follow on a work's page to get its new chapters.
          </p>
        {/if}
      {:else if shownTab === 'add'}
        <div class="sources-add">
          <PointBox label="Start here">
            <form class="sources-form" onsubmit={lookUp}>
              <label class="sources-form-label" for="sources-link"
                >Paste a link to a web novel: the work's page or one of its chapters.</label
              >
              <div class="sources-form-row">
                <input
                  id="sources-link"
                  class="app-input"
                  type="url"
                  inputmode="url"
                  autocomplete="off"
                  placeholder="https://kakuyomu.jp/works/…"
                  bind:value={link}
                />
                <button
                  type="submit"
                  class="app-button app-button-primary"
                  disabled={looking || !link.trim()}>{looking ? 'Looking up…' : 'Look up'}</button
                >
              </div>
              {#if lookupError === needsAppMessage}
                <NeedsApp />
              {:else if lookupError}
                <p class="sources-error" role="alert">{lookupError}</p>
              {/if}
            </form>
            <a class="app-button-quiet sources-search-link" href="{pagePath}/sources/search"
              >Search Syosetu and Kakuyomu →</a
            >
            <a class="app-button-quiet sources-search-link" href="{pagePath}/sources/browse"
              >Browse your servers →</a
            >
          </PointBox>

          <section aria-labelledby="sources-sites">
            <SectionHead number={1} title="What you can add" id="sources-sites" />
            <ul class="sources-rows">
              <li class="sources-row">
                <div>
                  <p class="sources-row-title">Syosetu</p>
                  <p class="sources-row-meta">
                    Web novels from Syosetu and its R18 site. Each 50 chapters become one volume in
                    a series named after the work.
                  </p>
                </div>
              </li>
              <li class="sources-row">
                <div>
                  <p class="sources-row-title">Kakuyomu</p>
                  <p class="sources-row-meta">
                    Web novels from Kakuyomu, 50 episodes per volume. Works published as books show
                    their cover.
                  </p>
                </div>
              </li>
              <li class="sources-row">
                <div>
                  <p class="sources-row-title">Your servers</p>
                  <p class="sources-row-meta">
                    A Suwayomi server or an OPDS catalog (Komga, Kavita, Calibre-web): their books
                    come as they are, manga as CBZs per volume or per chapter.
                    <a class="app-button-quiet" href="{pagePath}/sources/add">Add a source</a>
                  </p>
                </div>
              </li>
            </ul>
          </section>
        </div>
      {:else}
        {#if running}
          <PointBox
            label={standalone ? 'Fetching on this device' : 'Fetching on the server'}
            figure={running.done}
            unit="of {running.total} {running.unit}"
          >
            <div
              class="sources-track"
              role="progressbar"
              aria-label="Fetched"
              aria-valuemin={0}
              aria-valuemax={running.total}
              aria-valuenow={running.done}
            >
              <span style:width="{(100 * running.done) / Math.max(1, running.total)}%"></span>
            </div>
            <a class="sources-running-title" href="{pagePath}/sources/work?id={running.workId}"
              >{running.title}</a
            >
            <p class="sources-row-meta">
              {[running.siteName, volumesText(running)].filter(Boolean).join(' · ')} · {timeLeft(
                running.total - running.done,
                interval
              )} left. {running.domain} allows 1 page every {interval} s. {standalone
                ? 'Keep the app open.'
                : 'You can close this tab.'}
            </p>
            <button
              type="button"
              class="app-button-quiet sources-action"
              disabled={busy === running.id}
              onclick={() => act(running, cancelJob)}>Cancel</button
            >
          </PointBox>
        {/if}

        {#each [{ title: 'Waiting', list: waiting }, { title: 'Failed', list: failed }].filter((group) => group.list.length) as group, index (group.title)}
          <section class="sources-section" aria-label={group.title}>
            <SectionHead number={index + 1} title={group.title} count={group.list.length} />
            <ul class="sources-rows">
              {#each group.list as job (job.id)}
                <li class="sources-row">
                  <div class="sources-row-body">
                    <a class="sources-row-title" href="{pagePath}/sources/work?id={job.workId}"
                      >{job.title}</a
                    >
                    <p class="sources-row-meta">{meta(job)}</p>
                    <p class="sources-status" class:sources-status-failed={job.state === 'failed'}>
                      <span class="sources-swatch" aria-hidden="true"></span>{status(job)}
                    </p>
                    <div class="sources-actions">
                      {#if job.state === 'queued'}
                        <button
                          type="button"
                          class="app-button-quiet"
                          disabled={busy === job.id}
                          onclick={() => act(job, cancelJob)}>Cancel</button
                        >
                      {:else if job.state === 'failed' || job.state === 'cancelled'}
                        <button
                          type="button"
                          class="app-button"
                          disabled={busy === job.id}
                          onclick={() => act(job, retryJob)}>Retry</button
                        >
                        <button
                          type="button"
                          class="app-button-quiet"
                          disabled={busy === job.id}
                          onclick={() => act(job, removeJob)}>Remove</button
                        >
                      {/if}
                    </div>
                  </div>
                </li>
              {/each}
            </ul>
          </section>
        {/each}

        {#if done.length}
          <div class="sources-done">
            <span>{done.length} done</span>
            <button type="button" class="app-button-quiet" onclick={() => (showDone = !showDone)}
              >{showDone ? 'Hide' : 'Show'}</button
            >
          </div>
          {#if showDone}
            <ul class="sources-rows">
              {#each done as job (job.id)}
                <li class="sources-row sources-row-inline">
                  <div>
                    <a class="sources-row-title" href="{pagePath}/sources/work?id={job.workId}"
                      >{job.title}</a
                    >
                    <p class="sources-row-meta">
                      {meta(job)} · {standalone ? 'on this device' : 'in the library'}
                    </p>
                  </div>
                  <button
                    type="button"
                    class="app-button-quiet"
                    disabled={busy === job.id}
                    onclick={() => act(job, removeJob)}>Remove</button
                  >
                </li>
              {/each}
            </ul>
          {/if}
        {/if}
      {/if}
    {/if}
  </main>
</div>

<style>
  .sources-page {
    max-width: 75rem;
    margin: 0 auto;
    padding: 5.5rem 1rem calc(5.5rem + env(safe-area-inset-bottom));
  }

  .sources-back {
    display: inline-block;
    margin-bottom: 1rem;
  }

  .sources-title {
    font-size: var(--type-h1);
    line-height: 1.2;
  }

  .sources-lead {
    margin: 0.25rem 0 1.5rem;
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }

  .sources-note {
    color: var(--app-muted-fg);
  }

  .sources-switch {
    display: flex;
    margin-bottom: 1.5rem;
  }

  .sources-switch .app-segment {
    flex: 1;
  }

  .sources-error {
    margin-top: 0.5rem;
    color: var(--app-danger-color);
    font-size: var(--type-small);
  }

  .sources-add {
    display: grid;
    gap: 2rem;
  }

  .sources-form-label {
    display: block;
    margin-bottom: 0.75rem;
  }

  .sources-form-row {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .sources-form-row .app-input {
    flex: 1;
    min-width: 0;
  }

  .sources-rows {
    border-top: 2px solid var(--font-color);
  }

  .sources-row {
    display: flex;
    gap: 1rem;
    padding: 0.9rem 0;
    border-bottom: 1px solid var(--border-color);
  }

  .sources-row-inline {
    align-items: center;
    justify-content: space-between;
  }

  .sources-row-body {
    flex: 1;
    min-width: 0;
  }

  .sources-row-title {
    display: block;
    color: var(--font-color);
    font-weight: 700;
  }

  a.sources-row-title:hover,
  .sources-running-title:hover {
    text-decoration: underline;
  }

  .sources-row-meta {
    margin-top: 0.15rem;
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }

  .sources-status {
    display: flex;
    gap: 0.5rem;
    align-items: baseline;
    margin-top: 0.35rem;
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }

  .sources-swatch {
    flex: none;
    width: 0.5rem;
    height: 0.5rem;
    background: currentColor;
  }

  .sources-status-failed,
  .sources-status-removed {
    color: var(--app-danger-color);
  }

  .sources-status-new {
    color: var(--app-success-color);
  }

  .sources-status-wifi {
    color: var(--app-warning-color);
  }

  .sources-check {
    display: flex;
    gap: 1rem;
    align-items: center;
    justify-content: space-between;
    padding-bottom: 0.75rem;
  }

  .sources-check .app-button-quiet {
    flex: none;
    white-space: nowrap;
  }

  .sources-follow-body {
    display: flex;
    min-width: 0;
    flex: 1;
    flex-direction: column;
  }

  .sources-follow-state .sources-status {
    margin-top: 0.4rem;
  }

  .sources-search-link {
    display: inline-block;
    margin-top: 1rem;
  }

  .sources-actions {
    display: flex;
    gap: 1rem;
    align-items: center;
    margin-top: 0.5rem;
  }

  .sources-actions:empty {
    display: none;
  }

  .sources-section {
    margin-top: 2rem;
  }

  .sources-track {
    height: 3px;
    margin: 0.75rem 0;
    background: var(--app-progress-track);
  }

  .sources-track span {
    display: block;
    height: 100%;
    background: var(--app-progress-fill);
  }

  .sources-running-title {
    display: block;
    color: var(--font-color);
    font-weight: 700;
  }

  .sources-action {
    margin-top: 0.75rem;
  }

  .sources-done {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-top: 2rem;
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }

  @media (min-width: 768px) {
    .sources-page {
      padding: 6rem 2.5rem 4rem;
    }

    .sources-switch {
      display: inline-flex;
      min-width: 24rem;
    }

    .sources-add {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      align-items: start;
      gap: 4rem;
    }

    .sources-form-row {
      flex-direction: row;
    }

    .sources-bar {
      display: flex;
      gap: 2rem;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 1.5rem;
    }

    .sources-bar .sources-switch {
      margin-bottom: 0;
    }

    .sources-check {
      padding-bottom: 0;
    }

    .sources-follow-body {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 12rem;
      gap: 2rem;
      align-items: start;
    }

    .sources-follow-state .sources-status {
      margin-top: 0;
    }

    .sources-follow-body .sources-actions {
      justify-content: flex-end;
      margin-top: 0;
    }
  }
</style>
