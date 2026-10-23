<script lang="ts">
  /**
   * Settings → Analysis tools (standalone): download or remove each feature's tools
   * (lib/data/analysis-tools.ts). Files both features use are downloaded once.
   */
  import { browser } from '$app/environment';
  import SettingsItemGroup from '$lib/components/settings/settings-item-group.svelte';
  import SettingsSection from '$lib/components/settings/settings-section.svelte';
  import {
    analysisFeatures,
    analysisToolsSize,
    analysisToolsState$,
    analysisToolsSupported,
    checkAnalysisTools,
    downloadAnalysisTools,
    removeAnalysisTools,
    type AnalysisFeature
  } from '$lib/data/analysis-tools';
  import { onMount } from 'svelte';

  const supported = browser && analysisToolsSupported();
  const mb = (bytes: number) => Math.round(bytes / 1e6).toLocaleString('en-US');
  const text: Record<AnalysisFeature, { title: string; tooltip: string; ready: string }> = {
    difficulty: {
      title: 'Difficulty estimates',
      tooltip:
        'Difficulty, word lists and word coverage for your books, made in this browser. A book is estimated when you open it, or from its page; a long novel takes about two minutes.',
      ready: 'Downloaded. Open a book, or its page, to estimate it.'
    },
    furigana: {
      title: 'Generated furigana',
      tooltip:
        'Furigana for your books, made in this browser when you open a book with Reader → Generated furigana on; a long novel takes about two minutes.',
      ready: 'Downloaded. Turn on Generated furigana in the reader settings.'
    }
  };

  let size: Partial<Record<AnalysisFeature, number>> = {};
  let done = 0;
  let error: Partial<Record<AnalysisFeature, string>> = {};
  let controller: AbortController | undefined;

  $: downloading = analysisFeatures.some(
    (feature) => $analysisToolsState$[feature] === 'downloading'
  );
  // What is left to fetch changes with what is installed.
  $: if (supported && !downloading) sizes($analysisToolsState$);

  onMount(() => {
    if (supported) checkAnalysisTools();
  });

  async function sizes(_state: unknown) {
    for (const feature of analysisFeatures) {
      size = { ...size, [feature]: await analysisToolsSize(feature).catch(() => undefined) };
    }
  }

  async function download(feature: AnalysisFeature) {
    error = { ...error, [feature]: '' };
    done = 0;
    controller = new AbortController();
    await downloadAnalysisTools(
      feature,
      (bytes, total) => {
        done = bytes;
        size = { ...size, [feature]: total };
      },
      controller.signal
    ).catch((err: Error) => {
      error = {
        ...error,
        [feature]: err.name === 'AbortError' ? '' : `The download failed: ${err.message}`
      };
    });
    controller = undefined;
  }

  function remove(feature: AnalysisFeature) {
    if (confirm(`Remove ${text[feature].title.toLowerCase()}? What they made already stays.`)) {
      removeAnalysisTools(feature);
    }
  }
</script>

<SettingsSection
  id="general-analysis"
  keywords="analysis tools difficulty estimate word list coverage furigana sudachi download"
>
  {#each analysisFeatures as feature (feature)}
    {@const state = $analysisToolsState$[feature]}
    <SettingsItemGroup
      title={text[feature].title}
      tooltip={text[feature].tooltip}
      wide={state === 'downloading'}
    >
      {#if !supported}
        <p class="analysis-note">
          Needs a desktop browser on a computer with 8 GB of memory or more.
        </p>
      {:else if state === 'ready'}
        <button
          type="button"
          class="app-button app-button-danger"
          disabled={downloading}
          on:click={() => remove(feature)}
        >
          Remove
        </button>
      {:else if state === 'downloading'}
        <div class="analysis-progress">
          <div
            class="analysis-track"
            role="progressbar"
            aria-label="Downloading {text[feature].title.toLowerCase()}"
            aria-valuemin={0}
            aria-valuemax={size[feature] ?? 0}
            aria-valuenow={done}
          >
            <div
              class="analysis-fill"
              style:width="{size[feature] ? (done / (size[feature] ?? 1)) * 100 : 0}%"
            />
          </div>
          <span class="analysis-note">
            {mb(done)} of {size[feature] ? mb(size[feature] ?? 0) : '…'} MB
          </span>
          <button type="button" class="app-button" on:click={() => controller?.abort()}>
            Cancel
          </button>
        </div>
      {:else if state === 'absent'}
        <button
          type="button"
          class="app-button app-button-primary"
          disabled={downloading}
          on:click={() => download(feature)}
        >
          Download{size[feature] ? ` (${mb(size[feature] ?? 0)} MB)` : ''}
        </button>
      {/if}
      <svelte:fragment slot="after">
        {#if error[feature]}
          <p class="analysis-note" role="alert">{error[feature]}</p>
        {:else if supported && state === 'ready'}
          <p class="analysis-note">{text[feature].ready}</p>
        {/if}
      </svelte:fragment>
    </SettingsItemGroup>
  {/each}
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
