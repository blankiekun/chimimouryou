<script lang="ts">
  import { goto } from '$app/navigation';
  import AppHeader from '$lib/components/app-header/app-header.svelte';
  import PointBox from '$lib/components/point-box.svelte';
  import SectionHead from '$lib/components/section-head.svelte';
  import { account$, hasPermission } from '$lib/data/account/account';
  import { pagePath, standalone } from '$lib/data/env';
  import { libraryTab$ } from '$lib/data/library/library-home';
  import {
    cancelJob,
    getQueue,
    lookUpWork,
    removeJob,
    retryJob,
    timeLeft
  } from '$lib/data/sources/server-sources';
  import type { SourceJob } from '$lib/data/sources/types';
  import { onMount } from 'svelte';

  /**
   * Sources (Import → Sources, server edition, import permission): paste a link to a work, and
   * the queue of this account's fetch jobs, polled every 5 s while the page is open.
   */

  let jobs = $state<SourceJob[]>();
  let interval = $state(2);
  let queueError = $state('');
  let tab = $state<'queue' | 'add'>();
  let link = $state('');
  let lookupError = $state('');
  let looking = $state(false);
  let showDone = $state(false);
  let busy = $state<string>();

  const allowed = $derived(!standalone && hasPermission($account$, 'import'));
  const running = $derived(jobs?.find((job) => job.state === 'fetching'));
  const waiting = $derived(
    jobs?.filter((job) => job.state === 'queued' || job.state === 'adding').reverse() ?? []
  );
  const failed = $derived(
    jobs?.filter((job) => job.state === 'failed' || job.state === 'cancelled') ?? []
  );
  const done = $derived(jobs?.filter((job) => job.state === 'done') ?? []);
  // The switch appears once there is a queue; until then the page is the Add view.
  const shownTab = $derived(tab ?? (jobs?.length ? 'queue' : 'add'));

  async function refresh() {
    try {
      ({ jobs, interval } = await getQueue());
      queueError = '';
    } catch (error: any) {
      queueError = error.message;
    }
  }

  onMount(() => {
    $libraryTab$ = 'store';
    if (standalone) return;
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
    <p class="sources-lead">Fetched on the server into your Calibre library.</p>

    {#if !allowed}
      <p class="sources-note">
        {standalone
          ? 'Sources run on a server: the standalone app cannot fetch them yet.'
          : 'Adding web novels needs an account with the "Add books" permission. Ask an admin.'}
      </p>
    {:else}
      {#if jobs?.length}
        <div class="app-segmented sources-switch" role="radiogroup" aria-label="Sources view">
          <button
            type="button"
            role="radio"
            class="app-segment"
            class:app-segment-selected={shownTab === 'queue'}
            aria-checked={shownTab === 'queue'}
            onclick={() => (tab = 'queue')}
            >Queue{jobs.length > done.length ? ` ${jobs.length - done.length}` : ''}</button
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
      {/if}

      {#if queueError}
        <p class="sources-error" role="alert">{queueError}</p>
      {/if}

      {#if shownTab === 'add'}
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
                  placeholder="https://ncode.syosetu.com/…"
                  bind:value={link}
                />
                <button
                  type="submit"
                  class="app-button app-button-primary"
                  disabled={looking || !link.trim()}>{looking ? 'Looking up…' : 'Look up'}</button
                >
              </div>
              {#if lookupError}
                <p class="sources-error" role="alert">{lookupError}</p>
              {/if}
            </form>
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
            </ul>
          </section>
        </div>
      {:else}
        {#if running}
          <PointBox
            label="Fetching on the server"
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
              )} left. {running.domain} allows 1 page every {interval} s. You can close this tab.
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
                    <p class="sources-row-meta">{meta(job)} · in the library</p>
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

  .sources-status-failed {
    color: var(--app-danger-color);
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
  }
</style>
