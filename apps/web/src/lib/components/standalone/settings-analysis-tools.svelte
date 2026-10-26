<script lang="ts">
  /**
   * Settings → Analysis tools (standalone): download or remove each feature's tools
   * (lib/data/analysis-tools.ts). Files both features use are downloaded once.
   */
  import { browser } from '$app/env';
  import SettingsItemGroup from '$lib/components/settings/settings-item-group.svelte';
  import SettingsSection from '$lib/components/settings/settings-section.svelte';
  import {
    analysisDownload$,
    analysisFeatures,
    analysisToolsSize,
    analysisToolsState$,
    analysisToolsSupported,
    cancelAnalysisDownload,
    checkAnalysisTools,
    downloadAnalysisTools,
    removeAnalysisTools,
    type AnalysisFeature
  } from '$lib/data/analysis-tools';
  import {
    cancelMangaTextDownload,
    checkMangaText,
    downloadMangaText,
    mangaTextBytes,
    mangaTextDownload$,
    mangaTextState$,
    removeMangaText
  } from '$lib/data/manga-ocr';
  import {
    cancelWhisperDownload,
    checkWhisper,
    downloadWhisper,
    removeWhisper,
    whisperDownload$,
    whisperModel$,
    whisperModels,
    whisperState$
  } from '$lib/data/whisper';
  import { onMount } from 'svelte';

  const supported = browser && analysisToolsSupported();
  const mb = (bytes: number) => Math.round(bytes / 1e6).toLocaleString('en-US');
  const text: Record<AnalysisFeature, { title: string; tooltip: string; ready: string }> = {
    difficulty: {
      title: 'Difficulty estimates',
      tooltip:
        'Difficulty, word lists and word coverage for your books, made in this browser in the background when a book is added; a long novel takes about two minutes.',
      ready: 'Downloaded. Books are estimated in the background when you add them.'
    },
    furigana: {
      title: 'Generated furigana',
      tooltip:
        'Furigana for your books, made in this browser in the background while Reader → Generated furigana is on; a long novel takes about two minutes.',
      ready: 'Downloaded. Used while Generated furigana is on in the reader settings.'
    }
  };

  let size: Partial<Record<AnalysisFeature, number>> = {};

  $: downloading = analysisFeatures.some(
    (feature) => $analysisToolsState$[feature] === 'downloading'
  );
  // What is left to fetch changes with what is installed.
  $: if (supported && !downloading) sizes($analysisToolsState$);

  // Whisper runs wherever the browser has WebGPU or wasm, phones included (it did before it was a tool).
  $: if (browser) checkWhisper($whisperModel$);

  onMount(() => {
    if (supported) {
      checkAnalysisTools();
      checkMangaText();
    }
  });

  async function sizes(_state: unknown) {
    for (const feature of analysisFeatures) {
      size = { ...size, [feature]: await analysisToolsSize([feature]).catch(() => undefined) };
    }
  }

  function remove(feature: AnalysisFeature) {
    if (confirm(`Remove ${text[feature].title.toLowerCase()}? What they made already stays.`)) {
      removeAnalysisTools(feature);
    }
  }
</script>

<SettingsSection
  id="general-analysis"
  keywords="analysis tools difficulty estimate word list coverage furigana sudachi download manga text ocr mokuro audiobook subtitles whisper"
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
        {@const total = $analysisDownload$?.total ?? 0}
        {@const done = $analysisDownload$?.done ?? 0}
        <div class="analysis-progress">
          <div
            class="analysis-track"
            role="progressbar"
            aria-label="Downloading {text[feature].title.toLowerCase()}"
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={done}
          >
            <div class="analysis-fill" style:width="{total ? (done / total) * 100 : 0}%" />
          </div>
          <span class="analysis-note">
            {mb(done)} of {total ? mb(total) : '…'} MB
          </span>
          <button type="button" class="app-button" on:click={cancelAnalysisDownload}>
            Cancel
          </button>
        </div>
      {:else if state === 'absent'}
        <button
          type="button"
          class="app-button app-button-primary"
          disabled={downloading}
          on:click={() => downloadAnalysisTools([feature])}
        >
          Download{size[feature] ? ` (${mb(size[feature] ?? 0)} MB)` : ''}
        </button>
      {/if}
      <svelte:fragment slot="after">
        {#if $analysisDownload$?.error && $analysisDownload$.features.includes(feature)}
          <p class="analysis-note" role="alert">
            The download failed: {$analysisDownload$.error}
          </p>
        {:else if supported && state === 'ready'}
          <p class="analysis-note">{text[feature].ready}</p>
        {/if}
      </svelte:fragment>
    </SettingsItemGroup>
  {/each}
  <SettingsItemGroup
    title="Manga text"
    tooltip="Text over the pages of your manga for lookups, made in this browser from a volume's book page (about 10 seconds a page). Models from Hugging Face: a text detector by ogkalu and manga-ocr by kha-white, Apache-2.0."
    wide={$mangaTextState$ === 'downloading'}
  >
    {#if !supported}
      <p class="analysis-note">
        Needs a desktop browser on a computer with 8 GB of memory or more.
      </p>
    {:else if $mangaTextState$ === 'ready'}
      <button
        type="button"
        class="app-button app-button-danger"
        on:click={() => {
          if (confirm('Remove manga text? The text made already stays.')) removeMangaText();
        }}
      >
        Remove
      </button>
    {:else if $mangaTextState$ === 'downloading'}
      {@const total = $mangaTextDownload$?.total ?? 0}
      {@const done = $mangaTextDownload$?.done ?? 0}
      <div class="analysis-progress">
        <div
          class="analysis-track"
          role="progressbar"
          aria-label="Downloading manga text"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={done}
        >
          <div class="analysis-fill" style:width="{total ? (done / total) * 100 : 0}%"></div>
        </div>
        <span class="analysis-note">{mb(done)} of {mb(total)} MB</span>
        <button type="button" class="app-button" on:click={cancelMangaTextDownload}>Cancel</button>
      </div>
    {:else if $mangaTextState$ === 'absent'}
      <button type="button" class="app-button app-button-primary" on:click={downloadMangaText}>
        Download ({mb(mangaTextBytes)} MB)
      </button>
    {/if}
    <svelte:fragment slot="after">
      {#if $mangaTextDownload$?.error}
        <p class="analysis-note" role="alert">The download failed: {$mangaTextDownload$.error}</p>
      {:else if supported && $mangaTextState$ === 'ready'}
        <p class="analysis-note">
          Downloaded. Make a volume's text from its book page; it stays in this browser.
        </p>
      {/if}
    </svelte:fragment>
  </SettingsItemGroup>
  <SettingsItemGroup
    title="Audiobook subtitles"
    tooltip="Subtitles for an audiobook made with Whisper in this browser, from the audiobook setup or the Audiobookshelf bar; a GPU with WebGPU makes it much faster. Models from Hugging Face (OpenAI's Whisper, MIT). The subtitles made stay in this browser."
    wide={$whisperState$ === 'downloading'}
  >
    {#if $whisperState$ === 'downloading'}
      {@const progress = $whisperDownload$?.progress ?? 0}
      <div class="analysis-progress">
        <div
          class="analysis-track"
          role="progressbar"
          aria-label="Downloading audiobook subtitles"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
        >
          <div class="analysis-fill" style:width="{progress * 100}%"></div>
        </div>
        <span class="analysis-note">{Math.round(progress * 100)}%</span>
        <button type="button" class="app-button" on:click={cancelWhisperDownload}>Cancel</button>
      </div>
    {:else}
      <span class="analysis-progress">
        <select class="app-input" aria-label="Whisper model" bind:value={$whisperModel$}>
          {#each whisperModels as model (model.id)}
            <option value={model.id}>{model.name}</option>
          {/each}
        </select>
        {#if $whisperState$ === 'ready'}
          <button
            type="button"
            class="app-button app-button-danger"
            on:click={() => {
              if (confirm('Remove the Whisper models? Subtitles made already stay.'))
                removeWhisper();
            }}
          >
            Remove
          </button>
        {:else if $whisperState$ === 'absent'}
          <button type="button" class="app-button app-button-primary" on:click={downloadWhisper}>
            Download
          </button>
        {/if}
      </span>
    {/if}
    <svelte:fragment slot="after">
      {#if $whisperDownload$?.error}
        <p class="analysis-note" role="alert">The download failed: {$whisperDownload$.error}</p>
      {:else if $whisperState$ === 'ready'}
        <p class="analysis-note">Downloaded. The audiobook players offer Make subtitles.</p>
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
