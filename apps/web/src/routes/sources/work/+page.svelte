<script lang="ts">
  import { browser } from '$app/env';
  import { goto } from '$app/navigation';
  import AppHeader from '$lib/components/app-header/app-header.svelte';
  import PointBox from '$lib/components/point-box.svelte';
  import SectionHead from '$lib/components/section-head.svelte';
  import { account$, hasPermission } from '$lib/data/account/account';
  import { pagePath, standalone } from '$lib/data/env';
  import { page } from '$lib/data/page-store';
  import { addVolumes, getWork, timeLeft } from '$lib/data/sources/server-sources';
  import type { SourceWork } from '$lib/data/sources/types';

  /**
   * A work from a site (/sources/work?id=N): its details, the volume plan with what is in the
   * library already, and Add for the volumes still missing.
   */

  let work = $state<SourceWork>();
  let loadError = $state('');
  let adding = $state(false);
  let addError = $state('');

  const id = $derived(browser ? Number($page.url.searchParams.get('id')) : 0);
  const allowed = $derived(!standalone && hasPermission($account$, 'import'));
  const missing = $derived(
    work?.volumes.filter((volume) => !volume.inLibrary && !volume.pending) ?? []
  );
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
    if (!id || !allowed) return;
    getWork(id).then(
      (found) => (work = found),
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
        missing.map((volume) => volume.number)
      );
      await goto(`${pagePath}/sources`);
    } catch (error: any) {
      addError = error.message;
    } finally {
      adding = false;
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
    <a class="app-button-quiet work-back" href="{pagePath}/sources">← Sources</a>

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
            <div class="work-cover" aria-hidden="true"><span>{work.title}</span></div>
            <div class="work-heading">
              <h1 class="work-title">{work.title}</h1>
              <p class="work-meta">{work.authors}</p>
              <p class="work-meta">{work.siteName} · {work.status}</p>
              {#if work.updated}<p class="work-meta">Updated {day(work.updated)}</p>{/if}
              <a class="app-button-quiet work-link" href={work.url} target="_blank" rel="noreferrer"
                >Open on {work.domain}</a
              >
            </div>
          </header>
          {#if work.summary}
            <p class="work-summary">{work.summary}</p>
          {/if}
        </div>

        <div class="work-side">
          <PointBox
            label="Volumes"
            figure={work.volumes.length}
            unit="volumes · {work.chapters} chapters"
          >
            <table class="app-table work-volumes">
              <tbody>
                {#each work.volumes as volume (volume.number)}
                  <tr>
                    <th scope="row">Vol. {volume.number}</th>
                    <td class="work-range">ch {volume.first}–{volume.last}</td>
                    <td class="work-state">
                      {#if volume.inLibrary}In library{:else if volume.pending}On its way{/if}
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
            <p class="work-hint">
              {work.volumeSize} chapters each, one book per volume in the series “{work.title}”.
            </p>
          </PointBox>

          {#if addLabel}
            <button
              type="button"
              class="app-button app-button-primary work-add"
              disabled={adding}
              onclick={add}>{adding ? 'Adding…' : addLabel}</button
            >
            <p class="work-hint">
              Into the Calibre library on the server. {timeLeft(
                missingChapters,
                work.interval
              ).replace('about', 'About')}: {work.domain} allows 1 page every {work.interval} s. You
              can close this tab.
            </p>
            {#if addError}<p class="work-error" role="alert">{addError}</p>{/if}
          {:else if work.volumes.length}
            <p class="work-hint work-all">
              {work.volumes.some((volume) => volume.pending)
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

  /* No cover yet: the title set on a paper card, one fixed size like the shelves. */
  .work-cover {
    flex: none;
    width: 5.5rem;
    height: 8rem;
    padding: 0.5rem;
    overflow: hidden;
    border: 1px solid var(--border-color);
    border-radius: 2px;
    background: var(--surface-color);
    color: var(--font-color);
    font-size: var(--type-small);
    line-height: 1.5;
  }

  .work-cover span {
    display: -webkit-box;
    -webkit-line-clamp: 4;
    line-clamp: 4;
    -webkit-box-orient: vertical;
    overflow: hidden;
    padding-bottom: 0.4rem;
    border-bottom: 2px solid var(--font-color);
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

    .work-cover {
      width: 7rem;
      height: 10rem;
    }
  }
</style>
