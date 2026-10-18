<script lang="ts">
  import { faDownload, faSpinner, faStop } from '@fortawesome/free-solid-svg-icons';
  import {
    transcribeAudio,
    whisperModel$,
    whisperModels,
    type WhisperSource
  } from '$lib/data/whisper';
  import { createEventDispatcher, onDestroy } from 'svelte';
  import { t$, tr } from '$lib/i18n';
  import Fa from 'svelte-fa';

  /** The audio to transcribe, asked for when the button is pressed. */
  export let sources: () => WhisperSource[];
  /** File name of the SRT download, without extension. */
  export let name: string;

  const dispatch = createEventDispatcher<{ srt: string }>();

  let controller: AbortController | undefined;
  let progress = '';
  let error = '';
  let srtUrl = '';

  onDestroy(() => {
    controller?.abort();
    URL.revokeObjectURL(srtUrl);
  });

  async function start() {
    controller = new AbortController();
    error = '';
    progress = tr('reader.whisperStarting');

    try {
      const srt = await transcribeAudio(sources(), (text) => (progress = text), controller.signal);

      URL.revokeObjectURL(srtUrl);
      srtUrl = URL.createObjectURL(new Blob([srt], { type: 'application/x-subrip' }));
      dispatch('srt', srt);
    } catch (e: any) {
      error = e.name === 'AbortError' ? '' : e.message;
    } finally {
      controller = undefined;
    }
  }
</script>

<span class="flex min-w-0 flex-wrap items-center gap-2 text-xs">
  {#if controller}
    <Fa icon={faSpinner} spin />
    <span class="truncate" role="status">{progress}</span>
    <button class="whisper-pill" title={$t$('reader.whisperStop')} on:click={() => controller?.abort()}>
      <Fa icon={faStop} />
    </button>
  {:else}
    <select class="whisper-select" aria-label={$t$('reader.whisperModel')} bind:value={$whisperModel$}>
      {#each whisperModels as model (model.id)}
        <option value={model.id}>{model.name}</option>
      {/each}
    </select>
    <button
      class="whisper-pill"
      title={$t$('reader.whisperHint')}
      on:click={start}
    >
      {$t$('reader.whisperMake')}
    </button>
    {#if srtUrl}
      <a class="whisper-pill" href={srtUrl} download="{name}.srt" title={$t$('reader.whisperDownload')}>
        <Fa icon={faDownload} /> SRT
      </a>
    {/if}
  {/if}
  {#if error}<span class="text-panel-danger">{error}</span>{/if}
</span>

<style>
  .whisper-select {
    max-width: 10rem;
    border-radius: 0.5rem;
    background: transparent;
  }

  .whisper-pill {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    border: 1px solid color-mix(in srgb, var(--reader-panel-fg) 25%, transparent);
    border-radius: 999px;
    padding: 0.2rem 0.6rem;
  }
</style>
