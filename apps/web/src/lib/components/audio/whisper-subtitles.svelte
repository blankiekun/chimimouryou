<script lang="ts">
  import { faDownload, faSpinner, faStop, faTrash } from '@fortawesome/free-solid-svg-icons';
  import { pagePath } from '$lib/data/env';
  import {
    checkWhisper,
    keptWhisperSubtitles,
    removeWhisperSubtitles,
    saveWhisperSubtitles,
    transcribeAudio,
    whisperModel$,
    whisperModels,
    whisperNeedsDownload,
    whisperState$,
    type WhisperSource,
    type WhisperSubtitles
  } from '$lib/data/audio/whisper';
  import { createEventDispatcher, onDestroy } from 'svelte';
  import { t$, tr } from '$lib/i18n';
  import Fa from 'svelte-fa';

  /** The audio to transcribe, asked for when the button is pressed. */
  export let sources: () => WhisperSource[];
  /** File name of the SRT download, without extension. */
  export let name: string;
  /** The book's title and its audio's identity: the SRT made is kept for them (whisper.ts). */
  export let title: string;
  export let audio: string;

  const dispatch = createEventDispatcher<{ srt: string }>();

  let controller: AbortController | undefined;
  let progress = '';
  let error = '';
  let kept: WhisperSubtitles | undefined;

  $: srtUrl = kept
    ? URL.createObjectURL(new Blob([kept.srt], { type: 'application/x-subrip' }))
    : '';
  $: revokeLater(srtUrl);
  $: loadKept(title, audio);
  $: if (whisperNeedsDownload) checkWhisper($whisperModel$);
  $: offered = !whisperNeedsDownload || $whisperState$ === 'ready';

  let lastUrl = '';

  function revokeLater(url: string) {
    URL.revokeObjectURL(lastUrl);
    lastUrl = url;
  }

  async function loadKept(forTitle: string, forAudio: string) {
    const found = await keptWhisperSubtitles(forTitle, forAudio).catch(() => undefined);

    if (forTitle === title && forAudio === audio) kept = found;
  }

  onDestroy(() => {
    controller?.abort();
    URL.revokeObjectURL(lastUrl);
  });

  async function start() {
    controller = new AbortController();
    error = '';
    progress = tr('reader.whisperStarting');

    try {
      const srt = await transcribeAudio(sources(), (text) => (progress = text), controller.signal);
      const subtitles = { title, audio, model: $whisperModel$, srt };

      kept = { ...subtitles, created: Date.now() };
      await saveWhisperSubtitles(subtitles).catch(() => undefined);
      dispatch('srt', srt);
    } catch (e: any) {
      error = e.name === 'AbortError' ? '' : e.message;
    } finally {
      controller = undefined;
    }
  }

  async function remove() {
    await removeWhisperSubtitles(title).catch(() => undefined);
    kept = undefined;
  }
</script>

<span class="flex min-w-0 flex-wrap items-center gap-2 text-small">
  {#if controller}
    <Fa icon={faSpinner} spin />
    <span class="truncate" role="status">{progress}</span>
    <button
      class="whisper-pill"
      title={$t$('reader.whisperStop')}
      on:click={() => controller?.abort()}
    >
      <Fa icon={faStop} />
    </button>
  {:else}
    {#if kept}
      <button class="whisper-pill" on:click={() => kept && dispatch('srt', kept.srt)}>
        {$t$('reader.whisperUseKept', { date: new Date(kept.created).toLocaleDateString() })}
      </button>
    {/if}
    {#if offered}
      <select
        class="whisper-select"
        aria-label={$t$('reader.whisperModel')}
        bind:value={$whisperModel$}
      >
        {#each whisperModels as model (model.id)}
          <option value={model.id}>{model.name}</option>
        {/each}
      </select>
      <button class="whisper-pill" title={$t$('reader.whisperHint')} on:click={start}>
        {kept ? $t$('reader.whisperRegenerate') : $t$('reader.whisperMake')}
      </button>
    {:else if $whisperState$ !== 'unknown'}
      <a class="underline" href="{pagePath}/settings?section=general#general-analysis">
        {$t$('reader.whisperGetTools')}
      </a>
    {/if}
    {#if kept}
      <a
        class="whisper-pill"
        href={srtUrl}
        download="{name}.srt"
        title={$t$('reader.whisperDownload')}
      >
        <Fa icon={faDownload} /> SRT
      </a>
      <button class="whisper-pill" title={$t$('reader.whisperDelete')} on:click={remove}>
        <Fa icon={faTrash} />
      </button>
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
