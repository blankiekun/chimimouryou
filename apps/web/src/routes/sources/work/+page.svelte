<script lang="ts">
  import { browser } from '$app/env';
  import { goto } from '$app/navigation';
  import AppHeader from '$lib/components/app-header/app-header.svelte';
  import PointBox from '$lib/components/point-box.svelte';
  import SectionHead from '$lib/components/section-head.svelte';
  import SourceCover from '$lib/components/sources/source-cover.svelte';
  import Switch from '$lib/components/switch.svelte';
  import { account$, hasPermission } from '$lib/data/account/account';
  import { pagePath, standalone } from '$lib/data/env';
  import { page } from '$lib/data/page-store';
  import {
    addVolumes,
    followWork,
    getWork,
    resolveWork,
    timeLeft,
    unfollowWork
  } from '$lib/data/sources/server-sources';
  import type { SourceWork } from '$lib/data/sources/types';

  /**
   * A work from a site (/sources/work?id=N, or ?site=…&key=… from a search): its details, the volume plan with what is in the
   * library already, and Add for the volumes still missing.
   */

  let work = $state<SourceWork>();
  let loadError = $state('');
  let adding = $state(false);
  let addError = $state('');
  let followBusy = $state(false);
  let followError = $state('');

  const id = $derived(browser ? Number($page.url.searchParams.get('id')) : 0);
  const site = $derived(browser ? $page.url.searchParams.get('site') : null);
  const key = $derived(browser ? $page.url.searchParams.get('key') : null);
  const allowed = $derived(!standalone && hasPermission($account$, 'import'));
  // Manga from a server as pages: one CBZ per volume or per chapter, while nothing of it is added.
  let per = $state<'volume' | 'chapter'>();
  const pages = $derived(!!work?.server && !work.files);
  const volumes = $derived.by(() => {
    if (!work || !work.perChoice || !per || per === work.per) return work?.volumes ?? [];
    const size = per === 'chapter' ? 1 : work.perChoice;
    return Array.from({ length: Math.ceil(work.chapters / size) }, (_, n) => ({
      number: n + 1,
      first: n * size + 1,
      last: Math.min((n + 1) * size, work?.chapters ?? 0),
      inLibrary: false,
      pending: false
    }));
  });
  const volumeSize = $derived(
    per && per !== work?.per ? (per === 'chapter' ? 1 : (work?.perChoice ?? 1)) : work?.volumeSize
  );
  const missing = $derived(volumes.filter((volume) => !volume.inLibrary && !volume.pending));
  // Followed, the last volume takes new chapters until it is full.
  const openVolume = $derived.by(() => {
    const last = volumes[volumes.length - 1];
    return work?.following && last && last.last - last.first + 1 < (volumeSize ?? 0)
      ? last.number
      : undefined;
  });
  const missingChapters = $derived(
    missing.reduce((sum, volume) => sum + volume.last - volume.first + 1, 0)
  );
  const addLabel = $derived.by(() => {
    if (!missing.length) return '';
    const numbers = missing.map((volume) => volume.number);
    const first = numbers[0];
    const last = numbers[numbers.length - 1];
    if (first === last) return `Add Vol. ${first} to library`;
    return last - first + 1 === numbers.length
      ? `Add Vol. ${first}–${last} to library`
      : `Add ${numbers.length} volumes to library`;
  });

  $effect(() => {
    if (!allowed || !(id || (site && key))) return;
    (id ? getWork(id) : resolveWork(site as string, key as string)).then(
      (found) => {
        work = found;
        per = found.per;
      },
      (error) => (loadError = error.message)
    );
  });

  async function add() {
    if (!work || adding) return;
    adding = true;
    addError = '';
    try {
      await addVolumes(
        work.id,
        missing.map((volume) => volume.number),
        pages ? per : undefined
      );
      await goto(`${pagePath}/sources`);
    } catch (error: any) {
      addError = error.message;
    } finally {
      adding = false;
    }
  }

  async function setFollow(next: boolean) {
    if (!work || followBusy) return;
    if (!next && !window.confirm('Stop checking for new chapters? Your volumes stay.')) return;
    followBusy = true;
    followError = '';
    try {
      if (next) await followWork(work.id);
      else await unfollowWork(work.id);
      work = { ...work, following: next, paused: false };
    } catch (error: any) {
      followError = error.message;
    } finally {
      followBusy = false;
    }
  }

  function day(value: number | string) {
    const date = new Date(value);
    const thisYear = date.getFullYear() === new Date().getFullYear();
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      ...(thisYear ? {} : { year: 'numeric' })
    });
  }
</script>

<svelte:head>
  <title>{work?.title ?? 'Sources'}</title>
</svelte:head>

<AppHeader active="library" />

<div class="app-page-shell">
  <main class="work-page">
    {#if site?.startsWith('opds:')}
      <a class="app-button-quiet work-back" href="{pagePath}/sources/browse?server={site.slice(5)}"
        >← Browse</a
      >
    {:else if site}
      <a class="app-button-quiet work-back" href="{pagePath}/sources/search">← Search</a>
    {:else}
      <a class="app-button-quiet work-back" href="{pagePath}/sources">← Sources</a>
    {/if}

    {#if !allowed}
      <p class="work-note">Adding web novels needs an account with the "Add books" permission.</p>
    {:else if loadError}
      <p class="work-error" role="alert">{loadError}</p>
    {:else if !work}
      <p class="work-note" role="status">Loading…</p>
    {:else}
      <div class="work-layout">
        <div>
          <header class="work-header">
            <SourceCover
              title={work.title}
              workId={work.cover ? work.id : undefined}
              size="large"
            />
            <div class="work-heading">
              <h1 class="work-title">{work.title}</h1>
              <p class="work-meta">{work.authors}</p>
              <p class="work-meta">{work.siteName} · {work.status}</p>
              {#if work.updated}<p class="work-meta">Updated {day(work.updated)}</p>{/if}
              {#if !work.server}
                <a
                  class="app-button-quiet work-link"
                  href={work.url}
                  target="_blank"
                  rel="noreferrer">Open on {work.domain}</a
                >
              {/if}
            </div>
          </header>
          {#if work.summary}
            <p class="work-summary">{work.summary}</p>
          {/if}
        </div>

        <div class="work-side">
          <PointBox
            label="Volumes"
            figure={volumes.length}
            unit={work.files ? 'volumes' : `volumes · ${work.chapters} chapters`}
          >
            <table class="app-table work-volumes">
              <tbody>
                {#each volumes as volume (volume.number)}
                  <tr>
                    <th scope="row">{volumeSize === 1 && pages ? 'Ch.' : 'Vol.'} {volume.number}</th
                    >
                    <td class="work-range"
                      >{#if !work.files && volume.last > volume.first}ch {volume.first}–{volume.last}{/if}</td
                    >
                    <td class="work-state" class:work-state-open={volume.number === openVolume}>
                      {#if volume.number === openVolume}Updates in place{:else if volume.inLibrary}In
                        library{:else if volume.pending}On its way{/if}
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
            <p class="work-hint">
              {#if work.files}
                One book per file, as {work.siteName} serves it, in the series “{work.title}”.
              {:else if pages && volumeSize === 1}
                One CBZ per chapter, its number the series index, in the series “{work.title}”.
              {:else if openVolume}
                {volumeSize} chapters each. New chapters go into Vol. {openVolume}, replacing it in
                place, until it is full; then Vol. {openVolume + 1} starts.
              {:else}
                {volumeSize} chapters each, one book per volume in the series “{work.title}”.
              {/if}
            </p>
          </PointBox>

          {#if pages}
            <div class="work-follow">
              <div>
                <p class="work-follow-label" id="work-per-label">One CBZ per</p>
                <p class="work-hint work-follow-hint">
                  {work.perChoice
                    ? 'Chapter keeps each chapter as its own book.'
                    : 'Set when the first volume was added.'}
                </p>
              </div>
              <div class="app-segmented" role="radiogroup" aria-labelledby="work-per-label">
                {#each ['volume', 'chapter'] as const as option (option)}
                  <button
                    type="button"
                    role="radio"
                    class="app-segment"
                    class:app-segment-selected={per === option}
                    aria-checked={per === option}
                    disabled={!work.perChoice}
                    onclick={() => (per = option)}
                    >{option === 'volume' ? 'Volume' : 'Chapter'}</button
                  >
                {/each}
              </div>
            </div>
          {/if}

          <div class="work-follow">
            <div>
              <p class="work-follow-label" id="work-follow-label">Follow</p>
              <p class="work-hint work-follow-hint">
                {work.paused
                  ? 'Paused: change it in Sources → Following.'
                  : `The server checks every ${work.checkHours} h, also when no device is open.`}
              </p>
            </div>
            <Switch
              checked={work.following}
              stateText={false}
              disabled={followBusy}
              aria-labelledby="work-follow-label"
              onchange={setFollow}
            />
          </div>
          {#if followError}<p class="work-error" role="alert">{followError}</p>{/if}

          {#if addLabel}
            <button
              type="button"
              class="app-button app-button-primary work-add"
              disabled={adding}
              onclick={add}>{adding ? 'Adding…' : addLabel}</button
            >
            <p class="work-hint">
              {#if work.server}
                Into the Calibre library on the server, from {work.siteName}. You can close this
                tab.
              {:else}
                Into the Calibre library on the server. {timeLeft(
                  missingChapters,
                  work.interval
                ).replace('about', 'About')}: {work.domain} allows 1 page every {work.interval} s. You
                can close this tab.
              {/if}
            </p>
            {#if addError}<p class="work-error" role="alert">{addError}</p>{/if}
          {:else if volumes.length}
            <p class="work-hint work-all">
              {volumes.some((volume) => volume.pending)
                ? 'The missing volumes are on their way: see the queue in Sources.'
                : 'Every volume is in the library.'}
            </p>
          {/if}
        </div>

        {#if work.latest.length}
          <section class="work-latest" aria-labelledby="work-latest">
            <SectionHead
              number={1}
              title="Latest chapters"
              count={work.chapters}
              id="work-latest"
            />
            <table class="app-table">
              <tbody>
                {#each work.latest as chapter (chapter.n)}
                  <tr>
                    <td class="work-range">{chapter.n}</td>
                    <td lang="ja">{chapter.title}</td>
                    <td class="work-date">{day(chapter.date)}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </section>
        {/if}
      </div>
    {/if}
  </main>
</div>

<style>
  .work-page {
    max-width: 75rem;
    margin: 0 auto;
    padding: 5.5rem 1rem calc(5.5rem + env(safe-area-inset-bottom));
  }

  .work-back {
    display: inline-block;
    margin-bottom: 1.25rem;
  }

  .work-note {
    color: var(--app-muted-fg);
  }

  .work-error {
    margin-top: 0.5rem;
    color: var(--app-danger-color);
    font-size: var(--type-small);
  }

  .work-layout {
    display: grid;
    gap: 2rem;
  }

  .work-header {
    display: flex;
    gap: 1rem;
    align-items: flex-start;
  }

  .work-heading {
    min-width: 0;
  }

  .work-title {
    font-size: var(--type-h2);
    font-weight: 700;
    line-height: 1.4;
    text-wrap: balance;
  }

  .work-meta {
    margin-top: 0.2rem;
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }

  .work-link {
    display: inline-block;
    margin-top: 0.4rem;
    font-size: var(--type-small);
  }

  .work-summary {
    max-width: 40em;
    margin-top: 1.25rem;
    white-space: pre-line;
    line-height: 1.8;
  }

  .work-volumes {
    margin-top: 1rem;
  }

  .work-volumes th {
    color: var(--font-color);
    font-size: var(--type-body);
    font-weight: 700;
    white-space: nowrap;
  }

  .work-range,
  .work-date {
    color: var(--app-muted-fg);
    font-size: var(--type-small);
    white-space: nowrap;
  }

  .work-state {
    color: var(--app-muted-fg);
    font-size: var(--type-small);
    text-align: right;
  }

  .work-date {
    text-align: right;
  }

  .work-state-open {
    color: var(--app-success-color);
    white-space: nowrap;
  }

  .work-follow {
    display: flex;
    gap: 1rem;
    align-items: flex-start;
    justify-content: space-between;
    margin-top: 1.5rem;
  }

  .work-follow-label {
    font-weight: 700;
  }

  .work-follow-hint {
    margin-top: 0.15rem;
  }

  .work-hint {
    margin-top: 0.75rem;
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }

  .work-add {
    width: 100%;
    margin-top: 1.25rem;
  }

  .work-all {
    margin-top: 1.25rem;
  }

  @media (min-width: 768px) {
    .work-page {
      padding: 6rem 2.5rem 4rem;
    }

    .work-layout {
      grid-template-columns: minmax(0, 1fr) minmax(0, 24rem);
      column-gap: 4rem;
      align-items: start;
    }

    .work-side {
      grid-column: 2;
      grid-row: 1 / span 2;
    }

    .work-latest {
      grid-column: 1;
    }
  }
</style>
