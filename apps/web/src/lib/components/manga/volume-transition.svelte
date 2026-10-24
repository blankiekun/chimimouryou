<script lang="ts">
  /** Mihon-style card between volumes: the one just finished (or left) and the one to open. */
  import { createEventDispatcher } from 'svelte';
  import { calibreCoverUrl, type CalibreBook } from '$lib/data/calibre';
  import { needsServerImage, serverImage } from '$lib/data/server-connect';

  /** 1: the end of the book, -1: its start. */
  export let direction: number;
  export let title: string;
  /** This volume's catalog entry, for its number */
  export let current: CalibreBook | undefined = undefined;
  export let pageCount: number;
  export let volume: CalibreBook | undefined;
  export let opening = false;
  export let error = '';
  /** Paged modes: the keys that turn forward and back, shown with the hint */
  export let keys: [string, string] | undefined = undefined;

  const dispatch = createEventDispatcher<{ open: CalibreBook; library: void }>();

  const volumeName = (book: CalibreBook | undefined) =>
    book?.seriesIndex != null ? `Vol. ${book.seriesIndex}` : '';

  $: here = volumeName(current) || title;
  $: there = volumeName(volume);
  $: returnPage = direction > 0 ? pageCount : 1;
</script>

<div class="volume-card" lang="ja">
  <div class="volume-head">
    <h2>{direction > 0 ? 'End of' : 'Start of'} {here}</h2>
    <span class="volume-rule" aria-hidden="true" />
    <span class="volume-count">{pageCount} pages</span>
  </div>
  {#if volume}
    <div class="volume-body">
      {#if calibreCoverUrl(volume)}
        <img
          class="volume-cover"
          src={needsServerImage(calibreCoverUrl(volume)) ? undefined : calibreCoverUrl(volume)}
          use:serverImage={calibreCoverUrl(volume)}
          alt=""
        />
      {/if}
      <div class="volume-text">
        <div class="volume-label">{direction > 0 ? 'Next in series' : 'Previous in series'}</div>
        <div class="volume-title">
          {there && volume.series ? `${volume.series}・${there}` : volume.title}
        </div>
        {#if volume.authors}
          <div class="volume-meta">{volume.authors}</div>
        {/if}
        <div class="volume-actions">
          <button
            class="app-button app-button-primary"
            disabled={opening}
            on:click={() => volume && dispatch('open', volume)}
          >
            {opening
              ? 'Opening…'
              : `${direction > 0 ? 'Continue to' : 'Open'} ${there || (direction > 0 ? 'the next volume' : 'the previous volume')}`}
          </button>
          <button class="app-button" on:click={() => dispatch('library')}>Back to library</button>
        </div>
        {#if keys && !opening}
          <p class="volume-hint">
            Turn the page again to open it, or {direction > 0 ? 'back' : 'forward'} to return to page
            {returnPage}.
          </p>
        {/if}
      </div>
    </div>
  {:else}
    <div class="volume-body volume-none">
      <p>No {direction > 0 ? 'next' : 'previous'} volume.</p>
      <button class="app-button" on:click={() => dispatch('library')}>Back to library</button>
    </div>
  {/if}
  {#if error}
    <p class="volume-error">{error}</p>
  {/if}
  {#if keys}
    <div class="volume-keys">
      {#if volume}
        <span><kbd>{keys[0]}</kbd>{direction > 0 ? 'Next volume' : 'Previous volume'}</span>
      {/if}
      <span><kbd>{keys[1]}</kbd>{direction > 0 ? 'Last page' : 'First page'}</span>
      <span><kbd>Esc</kbd>Library</span>
    </div>
  {/if}
</div>

<style>
  .volume-card {
    width: min(45rem, calc(100vw - 2rem));
    padding: 1.75rem 2.5rem 1.5rem;
    border-radius: 2px;
    background: var(--reader-panel-bg);
    color: var(--reader-panel-fg);
    font-family: var(--app-font-ui);
  }

  .volume-head {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .volume-head h2 {
    margin: 0;
    font-size: var(--type-h2);
    font-weight: 400;
    white-space: nowrap;
  }

  .volume-rule {
    flex: 1;
    border-top: 1px solid var(--reader-panel-fg);
  }

  .volume-count,
  .volume-meta,
  .volume-hint {
    color: color-mix(in srgb, var(--reader-panel-fg) 68%, transparent);
    font-size: var(--type-small);
    font-variant-numeric: tabular-nums;
  }

  .volume-body {
    display: flex;
    gap: 1.75rem;
    padding: 1.75rem 0 1.25rem;
  }

  .volume-none {
    align-items: center;
    justify-content: space-between;
  }

  .volume-cover {
    width: 11.25rem;
    flex: none;
    align-self: flex-start;
    border: 1px solid color-mix(in srgb, var(--reader-panel-fg) 16%, transparent);
  }

  .volume-text {
    min-width: 0;
  }

  .volume-label {
    color: var(--accent-strong-color);
    font-size: var(--type-small);
  }

  .volume-title {
    margin: 0.25rem 0;
    font-size: var(--type-h1);
    font-weight: 700;
    line-height: 1.3;
  }

  .volume-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
    margin: 1.5rem 0 0.75rem;
  }

  .volume-error {
    color: var(--app-danger-color);
    font-size: var(--type-small);
  }

  .volume-keys {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem 1.5rem;
    padding-top: 0.75rem;
    border-top: 1px solid color-mix(in srgb, var(--reader-panel-fg) 16%, transparent);
    color: color-mix(in srgb, var(--reader-panel-fg) 68%, transparent);
    font-size: var(--type-small);
  }

  .volume-keys kbd {
    margin-right: 0.4rem;
    padding: 0 0.35rem;
    border: 1px solid var(--reader-panel-fg);
    border-radius: 2px;
    color: var(--reader-panel-fg);
    font-family: inherit;
    font-size: var(--type-label);
  }

  @media (max-width: 600px) {
    .volume-card {
      padding: 1.25rem;
    }

    .volume-cover {
      width: 6rem;
    }

    .volume-body {
      gap: 1rem;
    }

    .volume-title {
      font-size: var(--type-h2);
    }

    .volume-keys {
      display: none;
    }
  }
</style>
