<script lang="ts">
  /**
   * Home, once there are books (standalone, where the analysis tools run): a ruled note offering
   * the analysis tools still missing, until "Not now". Settings → Analysis tools keeps the full
   * controls; a download started here carries on there.
   */
  import { onMount } from 'svelte';
  import {
    analysisDownload$,
    analysisFeatures,
    analysisToolsSize,
    analysisToolsState$,
    analysisToolsSupported,
    checkAnalysisTools,
    downloadAnalysisTools
  } from '$lib/data/analysis/analysis-tools';
  import { pagePath } from '$lib/data/env';
  import { writableBooleanLocalStorageSubject } from '$lib/data/internal/writable-boolean-local-storage-subject';
  import { t$ } from '$lib/i18n';

  const dismissed$ = writableBooleanLocalStorageSubject()('analysisOfferDismissed', false);
  const supported = typeof window !== 'undefined' && analysisToolsSupported();

  let size = $state<number | undefined>();
  let started = $state(false);

  const missing = $derived(
    analysisFeatures.filter((feature) => $analysisToolsState$[feature] === 'absent')
  );

  onMount(() => {
    if (supported && !dismissed$.getValue()) checkAnalysisTools();
  });

  $effect(() => {
    if (missing.length) {
      analysisToolsSize(missing)
        .then((bytes) => (size = bytes))
        .catch(() => undefined);
    }
  });

  const ready = $derived(
    analysisFeatures.every((feature) => $analysisToolsState$[feature] === 'ready')
  );

  function download() {
    started = true;
    downloadAnalysisTools(missing);
  }
</script>

{#if supported && !$dismissed$ && (missing.length || started)}
  <aside class="offer" aria-label={$t$('analysisOffer.title')}>
    <div class="offer-text">
      <h2>{$t$('analysisOffer.title')}</h2>
      <p>{$t$('analysisOffer.text')}</p>
      {#if $analysisDownload$?.error}
        <p class="offer-error" role="alert">
          {$t$('analysisOffer.failed', { error: $analysisDownload$.error })}
        </p>
      {:else if started && ready}
        <p role="status">{$t$('analysisOffer.ready')}</p>
      {:else if started}
        <p role="status">
          {$t$('analysisOffer.downloading')}
          <a class="offer-link" href="{pagePath}/settings?section=general#general-analysis"
            >{$t$('analysisOffer.settings')}</a
          >
        </p>
      {/if}
    </div>
    <div class="offer-actions">
      {#if !started || $analysisDownload$?.error}
        <button type="button" class="app-button app-button-primary" onclick={download}>
          {size
            ? $t$('analysisOffer.download', { size: Math.max(1, Math.round(size / 1e6)) })
            : $t$('analysisOffer.downloadNoSize')}
        </button>
      {/if}
      <button
        type="button"
        class="app-button app-button-quiet"
        onclick={() => dismissed$.next(true)}
      >
        {$t$(started ? 'analysisOffer.hide' : 'analysisOffer.notNow')}
      </button>
    </div>
  </aside>
{/if}

<style>
  .offer {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 1rem 2rem;
    padding: 1.25rem 0;
    border-block: 1px solid var(--border-color);
  }

  .offer-text {
    flex: 1 1 18rem;
    min-width: 0;
  }

  .offer h2 {
    color: var(--font-color);
    font-size: var(--type-body);
    font-weight: 700;
  }

  .offer p {
    max-width: 40rem;
    margin-top: 0.25rem;
    color: var(--app-muted-fg);
    font-size: var(--type-small);
    line-height: 1.55;
  }

  .offer .offer-error {
    color: var(--app-danger-color);
  }

  .offer-link {
    color: var(--accent-strong-color);
    font-weight: 700;
  }

  .offer-link:hover {
    text-decoration: underline;
    text-underline-offset: 0.2em;
  }

  .offer-actions {
    display: flex;
    align-items: center;
    gap: 1.5rem;
  }
</style>
