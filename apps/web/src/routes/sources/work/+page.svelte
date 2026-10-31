<script lang="ts">
  import { browser } from '$app/env';
  import { goto } from '$app/navigation';
  import AppHeader from '$lib/components/app-header/app-header.svelte';
  import PointBox from '$lib/components/point-box.svelte';
  import SectionHead from '$lib/components/section-head.svelte';
  import NeedsApp from '$lib/components/sources/needs-app.svelte';
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
  import { sourcesWifiOnly$ } from '$lib/data/sources/sources-settings';
  import { needsAppMessage, notInstalledMessage } from '$lib/data/sources/transport';
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
  // "From Vol. N": the first volume to add; the missing volumes from it on are added.
  let from = $state(1);

  const id = $derived(browser ? Number($page.url.searchParams.get('id')) : 0);
  const site = $derived(browser ? $page.url.searchParams.get('site') : null);
  const key = $derived(browser ? $page.url.searchParams.get('key') : null);
  const allowed = $derived(standalone || hasPermission($account$, 'import'));
  // Standalone: what the picked volumes take and the free space (navigator.storage.estimate()).
  let space = $state<{ bytes: number; free: number | null; fits: boolean }>();
  const here = standalone ? 'On this device' : 'In library';
  // Manga from a server as pages: one CBZ per volume or per chapter, while nothing of it is added.
  let per = $state<'volume' | 'chapter'>();
  // An extension's work (ext:<repo key>:<source>): fetched and followed on this device only.
  const ext = $derived(!!work?.site.startsWith('ext:'));
  const pages = $derived((!!work?.server && !work.files) || (ext && work?.kind === 'manga'));
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
  // The picked volume once it is in the library or on its way: the first one still missing.
  const start = $derived(
    missing.some((volume) => volume.number === from) ? from : (missing[0]?.number ?? 1)
  );
  const picked = $derived(missing.filter((volume) => volume.number >= start));
  const pickedChapters = $derived(
    picked.reduce((sum, volume) => sum + volume.last - volume.first + 1, 0)
  );
  // One CBZ per chapter counts chapters, not volumes.
  const unit = $derived(pages && volumeSize === 1 ? 'Ch.' : 'Vol.');
  const pickedText = $derived.by(() => {
    if (!picked.length) return '';
    const first = picked[0].number;
    const last = picked[picked.length - 1].number;
    if (first === last) return `${unit} ${first}`;
    return last - first + 1 === picked.length
      ? `${unit} ${first}–${last}`
      : `${picked.length} volumes`;
  });
  $effect(() => {
    if (!standalone || !work) return;
    const numbers = picked.map((volume) => volume.number);
    import('$lib/data/sources/local-sources').then(async ({ spaceFor }) => {
      if (work) space = await spaceFor(work, numbers);
    });
  });

  const gb = (bytes: number) =>
    bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`;

  // Following a work with nothing in the library adds the picked volumes first, so its checks start there.
  const empty = $derived(!work?.volumes.some((volume) => volume.inLibrary || volume.pending));

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
        picked.map((volume) => volume.number),
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
      if (next && empty && picked.length) {
        await addVolumes(
          work.id,
          picked.map((volume) => volume.number),
          pages ? per : undefined
        );
        await followWork(work.id);
        work = await getWork(work.id);
      } else {
        if (next) await followWork(work.id);
        else await unfollowWork(work.id);
        work = { ...work, following: next, paused: false };
      }
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
    {:else if (site ?? work?.site)?.startsWith('ext:')}
      <a
        class="app-button-quiet work-back"
        href="{pagePath}/sources/browse?ext={encodeURIComponent(site ?? work?.site ?? '')}"
        >← Browse</a
      >
    {:else if site}
      <a class="app-button-quiet work-back" href="{pagePath}/sources/search">← Search</a>
    {:else}
      <a class="app-button-quiet work-back" href="{pagePath}/sources">← Sources</a>
    {/if}

    {#if !allowed}
      <p class="work-note">Adding web novels needs an account with the "Add books" permission.</p>
    {:else if loadError === needsAppMessage}
      <NeedsApp />
    {:else if loadError === notInstalledMessage}
      <p class="work-note">{notInstalledMessage}.</p>
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
              <p class="work-meta">
                {work.siteName}{ext ? ' · extension' : ''} · {work.status}{#if ext}<span
                    class="work-tag">This device</span
                  >{/if}
              </p>
              {#if work.updated}<p class="work-meta">Updated {day(work.updated)}</p>{/if}
              {#if !work.server && !ext}
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
                    <th scope="row">{unit} {volume.number}</th>
                    <td class="work-range"
                      >{#if !work.files && volume.last > volume.first}Ch. {volume.first}–{volume.last}{/if}</td
                    >
                    <td class="work-state" class:work-state-open={volume.number === openVolume}>
                      {#if volume.number === openVolume}Updates in place{:else if volume.inLibrary}{here}{:else if volume.pending}On
                        its way{/if}
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

          {#if missing.length > 1}
            <label class="work-from">
              <span class="work-follow-label">From</span>
              <select class="app-input" bind:value={from}>
                {#each missing as volume (volume.number)}
                  <option value={volume.number}>{unit} {volume.number}</option>
                {/each}
              </select>
            </label>
          {/if}
          <div class="work-follow">
            <div>
              <p class="work-follow-label" id="work-follow-label">Follow</p>
              <p class="work-hint work-follow-hint">
                {work.paused
                  ? 'Paused: change it in Sources → Following.'
                  : work.elsewhere
                    ? `Followed in ${work.elsewhere}; updates there.`
                    : ext && !standalone
                      ? 'Checks while the app is open on this device.'
                      : standalone
                        ? `Checks while the app is open${$sourcesWifiOnly$ ? ', on Wi-Fi only' : ''} (Settings → Sources).`
                        : `The server checks every ${work.checkHours} h, also when no device is open.`}
                {#if !work.following && empty && pickedText}Turning it on adds {pickedText} first.{/if}
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

          {#if pickedText}
            <button
              type="button"
              class="app-button app-button-primary work-add"
              disabled={adding || (space && !space.fits)}
              onclick={add}
              >{adding
                ? 'Adding…'
                : `Add ${pickedText} to ${standalone ? 'this device' : 'library'}`}</button
            >
            <p class="work-hint">
              {#if standalone}
                {#if space && !space.fits && space.free !== null}
                  Not enough space: free up {gb(space.bytes - space.free)}.
                {:else}
                  Saved in this browser's library, not on a server{space?.free
                    ? `: about ${gb(space.bytes)} of the ${gb(space.free)} free`
                    : ''}. Keep the app open while it fetches.
                {/if}
              {:else if ext}
                This browser fetches through the server’s relay, then the files go into Calibre. {timeLeft(
                  pickedChapters,
                  work.interval
                ).replace('about', 'About')}; keep this tab open. “In library” counts what this
                device sent, and a volume isn’t refreshed in Calibre when new chapters come.
              {:else if work.server}
                Into the Calibre library on the server, from {work.siteName}. You can close this
                tab.
              {:else}
                Into the Calibre library on the server. {timeLeft(
                  pickedChapters,
                  work.interval
                ).replace('about', 'About')}: {work.domain} allows 1 page every {work.interval} s. You
                can close this tab.
              {/if}
            </p>
            {#if addError === needsAppMessage}<NeedsApp />{:else if addError}<p
                class="work-error"
                role="alert"
              >
                {addError}
              </p>{/if}
          {:else if volumes.length}
            <p class="work-hint work-all">
              {volumes.some((volume) => volume.pending)
                ? 'The missing volumes are on their way: see the queue in Sources.'
                : standalone
                  ? 'Every volume is on this device.'
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

  .work-tag {
    display: inline-block;
    margin-left: 0.5rem;
    padding: 0.05rem 0.35rem;
    line-height: 1.3;
    border: 1px solid var(--font-color);
    border-radius: 2px;
    color: var(--font-color);
    font-size: var(--type-label);
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

  .work-from {
    display: flex;
    gap: 1rem;
    align-items: center;
    justify-content: space-between;
    margin-top: 1.5rem;
  }

  .work-from select {
    width: auto;
    padding-right: 2.5rem; /* room for the chevron .app-input's padding would cover */
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
