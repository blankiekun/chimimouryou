<script lang="ts">
  /** Settings → Analysis tools (standalone): download or remove them (lib/data/analysis-tools.ts). */
  import { browser } from '$app/environment';
  import SettingsItemGroup from '$lib/components/settings/settings-item-group.svelte';
  import SettingsSection from '$lib/components/settings/settings-section.svelte';
  import {
    analysisToolsSize,
    analysisToolsState$,
    analysisToolsSupported,
    checkAnalysisTools,
    downloadAnalysisTools,
    removeAnalysisTools
  } from '$lib/data/analysis-tools';
  import { onMount } from 'svelte';

  const supported = browser && analysisToolsSupported();
  const mb = (bytes: number) => Math.round(bytes / 1e6).toLocaleString('en-US');

  let size: number | undefined;
  let done = 0;
  let error = '';
  let controller: AbortController | undefined;

  onMount(() => {
    if (!supported) return;
    checkAnalysisTools();
    analysisToolsSize()
      .then((bytes) => (size = bytes))
      .catch(() => {});
  });

  async function download() {
    error = '';
    done = 0;
    controller = new AbortController();
    await downloadAnalysisTools((bytes, total) => {
      done = bytes;
      size = total;
    }, controller.signal).catch((err: Error) => {
      error = err.name === 'AbortError' ? '' : `The download failed: ${err.message}`;
    });
    controller = undefined;
  }

  function remove() {
    if (confirm('Remove the analysis tools? Word lists already made stay.')) removeAnalysisTools();
  }
</script>

<SettingsSection
  id="general-analysis"
  keywords="analysis tools word list furigana sudachi download"
>
  <SettingsItemGroup
    title="Analysis tools"
    tooltip="Make word lists, word coverage and generated furigana for your books in this browser. Books are analysed when you open them, one at a time; a long novel takes about three minutes and 300 MB of memory. Unpacked, the tools take about 330 MB of storage."
    wide={$analysisToolsState$ === 'downloading'}
  >
    {#if !supported}
      <p class="analysis-note">
        Needs a desktop browser on a computer with 8 GB of memory or more.
      </p>
    {:else if $analysisToolsState$ === 'ready'}
      <button type="button" class="app-button app-button-danger" on:click={remove}> Remove </button>
    {:else if $analysisToolsState$ === 'downloading'}
      <div class="analysis-progress">
        <div
          class="analysis-track"
          role="progressbar"
          aria-label="Downloading the analysis tools"
          aria-valuemin={0}
          aria-valuemax={size ?? 0}
          aria-valuenow={done}
        >
          <div class="analysis-fill" style:width="{size ? (done / size) * 100 : 0}%" />
        </div>
        <span class="analysis-note">{mb(done)} of {size ? mb(size) : '…'} MB</span>
        <button type="button" class="app-button" on:click={() => controller?.abort()}>
          Cancel
        </button>
      </div>
    {:else if $analysisToolsState$ === 'absent'}
      <button type="button" class="app-button app-button-primary" on:click={download}>
        Download{size ? ` (${mb(size)} MB)` : ''}
      </button>
    {/if}
    <svelte:fragment slot="after">
      {#if error}
        <p class="analysis-note" role="alert">{error}</p>
      {:else if supported && $analysisToolsState$ === 'ready'}
        <p class="analysis-note">Downloaded. Open a book to analyse it.</p>
      {/if}
    </svelte:fragment>
  </SettingsItemGroup>
</SettingsSection>

<style>
  .analysis-progress {
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .analysis-track {
    flex: 1;
    height: 3px;
    background: var(--app-progress-track);
  }

  .analysis-fill {
    height: 100%;
    background: var(--app-progress-fill);
  }

  .analysis-note {
    font-size: var(--type-small);
    font-variant-numeric: tabular-nums;
    color: var(--app-muted-fg);
  }
</style>
