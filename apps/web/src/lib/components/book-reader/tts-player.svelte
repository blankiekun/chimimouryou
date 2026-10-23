<script lang="ts">
  import {
    faBackwardStep,
    faForwardStep,
    faPause,
    faPlay,
    faSpinner
  } from '@fortawesome/free-solid-svg-icons';
  import {
    defaultElevenLabsModel,
    deviceVoiceName$,
    elevenLabsApiKey$,
    elevenLabsModel$,
    ttsPlaybackRate$,
    ttsVoiceId$
  } from '$lib/data/ai-settings';
  import {
    deviceSpeechAvailable,
    deviceUtterance,
    deviceVoices,
    pickDeviceVoice,
    readingTimeline,
    spokenPhrases,
    synthesizeSpeech,
    ttsBackend,
    timelineEntryAt,
    type TimelineEntry
  } from '$lib/data/tts';
  import { TtsAudioCache } from '$lib/data/tts-audio-cache';
  import {
    buildReadingChunks,
    displayReadingText,
    extractParagraphsFrom,
    speechText,
    type ReadingParagraph
  } from '$lib/functions/tts/extract-reading-text';
  import { createEventDispatcher, onDestroy, onMount } from 'svelte';
  import { pagePath } from '$lib/data/env';
  import { t$, tr } from '$lib/i18n';
  import Fa from 'svelte-fa';

  /** Book HTML (furigana is stripped before synthesis) */
  export let elementHtml: string;
  /** Character position to start reading from */
  export let startCharCount: number;

  const dispatch = createEventDispatcher<{
    position: number;
    /** Character counts of the phrase being said */
    reading: { start: number; end: number } | undefined;
  }>();

  const prefetchCount = 2;

  let chunks: ReadingParagraph[] = [];
  let index = 0;
  let playing = false;
  let loading = false;
  let error = '';
  let audio: HTMLAudioElement;
  let abortController = new AbortController();
  let audioCache = createAudioCache();

  let voices: SpeechSynthesisVoice[] = [];
  /** The device utterance being spoken; events from older ones are ignored. */
  let utterance: SpeechSynthesisUtterance | undefined;

  $: device = ttsBackend($elevenLabsApiKey$) === 'device';
  $: voice = pickDeviceVoice(voices, $deviceVoiceName$);
  $: setup = device
    ? deviceSpeechAvailable()
      ? ''
      : $t$('reader.ttsNoDevice')
    : !$ttsVoiceId$
      ? $t$('reader.ttsNoVoice')
      : '';
  // Switching backends (a key added or removed) stops the other one.
  $: (device, stop());
  $: currentText = displayReadingText(chunks[index]?.text ?? '');

  onMount(() => {
    audio = new Audio();
    audio.addEventListener('ended', () => playChunk(index + 1));
    audio.addEventListener('timeupdate', updateReading);
    deviceVoices().then((list) => (voices = list));
  });

  $: if (audio) {
    audio.defaultPlaybackRate = $ttsPlaybackRate$;
    audio.playbackRate = $ttsPlaybackRate$;
  }

  let timeline: TimelineEntry[] = [];
  let reading: TimelineEntry | undefined;

  /** Highlights the phrase being said, from ElevenLabs' timestamps. */
  function updateReading() {
    const entry = timelineEntryAt(timeline, audio.currentTime);

    if (entry && entry !== reading) {
      reading = entry;
      dispatch('reading', { start: entry.start, end: entry.end });
    }
  }

  onDestroy(stop);

  function createAudioCache() {
    const { signal } = abortController;

    return new TtsAudioCache(
      (chunkIndex) =>
        synthesizeSpeech(speechText(chunks[chunkIndex].text), signal, {
          previousText: chunks[chunkIndex - 1] && speechText(chunks[chunkIndex - 1].text),
          nextText: chunks[chunkIndex + 1] && speechText(chunks[chunkIndex + 1].text)
        }),
      1,
      prefetchCount
    );
  }

  function getAudioUrl(chunkIndex: number) {
    return audioCache.get(chunkIndex);
  }

  /** Reads a chunk with the device's voice; `boundary` events move the highlight. */
  function speakChunk(chunkIndex: number) {
    const chunk = chunks[chunkIndex];
    const phrases = spokenPhrases(chunk);
    const spoken = deviceUtterance(speechText(chunk.text), voice, $ttsPlaybackRate$);
    const show = (entry: TimelineEntry | undefined) => {
      if (utterance === spoken && entry && entry !== reading) {
        reading = entry;
        dispatch('reading', { start: entry.start, end: entry.end });
      }
    };

    speechSynthesis.cancel();
    // A paused synthesizer would hold the new utterance too.
    speechSynthesis.resume();
    utterance = spoken;
    // Some voices (often Japanese ones) send no boundary events: then the whole chunk stays lit.
    spoken.onstart = () => show(readingTimeline(chunk)[0]);
    spoken.onboundary = (event) => show(timelineEntryAt(phrases, event.charIndex));
    spoken.onend = () => {
      if (utterance === spoken) {
        playChunk(chunkIndex + 1);
      }
    };
    spoken.onerror = (event) => {
      if (utterance === spoken && event.error !== 'interrupted' && event.error !== 'canceled') {
        error = tr('reader.ttsDeviceError', { error: event.error });
        playing = false;
      }
    };
    reading = undefined;
    speechSynthesis.speak(spoken);
    playing = true;
    dispatch('position', chunk.startCharCount);
  }

  async function playChunk(chunkIndex: number) {
    if (chunkIndex >= chunks.length) {
      playing = false;
      return;
    }

    if (device) {
      index = chunkIndex;
      error = '';
      speakChunk(chunkIndex);
      return;
    }

    index = chunkIndex;
    loading = true;
    error = '';

    try {
      const { url, alignment } = await getAudioUrl(chunkIndex);

      if (index !== chunkIndex) {
        return;
      }

      audioCache.trim(chunkIndex);

      for (let next = chunkIndex + 1; next <= chunkIndex + prefetchCount; next += 1) {
        if (next < chunks.length) {
          getAudioUrl(next).catch(() => {});
        }
      }

      timeline = readingTimeline(chunks[chunkIndex], alignment);
      reading = undefined;
      audio.src = url;
      await audio.play();
      playing = true;
      dispatch('position', chunks[chunkIndex].startCharCount);
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        error = err.message;
        playing = false;
      }
    } finally {
      if (index === chunkIndex) {
        loading = false;
      }
    }
  }

  function resetAudio() {
    abortController.abort();
    abortController = new AbortController();
    audio?.pause();
    if (utterance) {
      utterance = undefined;
      speechSynthesis.cancel();
    }
    audioCache.clear();
    audioCache = createAudioCache();
    playing = false;
    timeline = [];
    reading = undefined;
    dispatch('reading', undefined);
  }

  function start() {
    resetAudio();
    chunks = buildReadingChunks(extractParagraphsFrom(elementHtml, startCharCount));

    if (!chunks.length) {
      error = tr('reader.ttsNoText');
      return;
    }

    playChunk(0);
  }

  function togglePlay() {
    if (!chunks.length) {
      start();
    } else if (playing) {
      if (device) {
        speechSynthesis.pause();
      } else {
        audio.pause();
      }
      playing = false;
    } else if (device && utterance && !error) {
      speechSynthesis.resume();
      playing = true;
    } else if (!device && audio.src && !error) {
      // Resume. After an error, the else branch retries the failed chunk instead
      // of replaying the previous one.
      audio.play().then(() => (playing = true));
    } else {
      playChunk(index);
    }
  }

  function skip(offset: number) {
    if (!chunks.length) {
      return;
    }

    audio.pause();
    playChunk(Math.min(Math.max(index + offset, 0), chunks.length - 1));
  }

  function stop() {
    resetAudio();
    chunks = [];
  }
</script>

<!-- One row inside the Listen bar (listen-panel.svelte). -->
{#if setup}
  <p class="voice-setup">
    {setup}
    <a class="app-button app-button-quiet" href="{pagePath}/settings?section=ai#ai-guide"
      >{$t$('reader.openAiSettings')}</a
    >
  </p>
{:else}
  <div class="voice">
    <button class="voice-icon" title={$t$('reader.previous')} on:click={() => skip(-1)}>
      <Fa icon={faBackwardStep} />
    </button>
    <button
      class="voice-play"
      title={$t$(playing ? 'reader.pause' : 'reader.readAloudHere')}
      on:click={togglePlay}
    >
      <Fa icon={loading ? faSpinner : playing ? faPause : faPlay} spin={loading} fw />
    </button>
    <button class="voice-icon" title={$t$('reader.next')} on:click={() => skip(1)}>
      <Fa icon={faForwardStep} />
    </button>
    <span class="voice-text">
      {#if error}
        <span class="voice-line voice-error">{error}</span>
      {:else}
        <span class="voice-line" lang="ja">{currentText || $t$('reader.readAloudPosition')}</span>
      {/if}
      <span class="voice-meta"
        >{device
          ? `${$t$('reader.deviceVoice')} · ${voice?.name ?? 'ja-JP'}`
          : `ElevenLabs · ${$elevenLabsModel$ || defaultElevenLabsModel}`}</span
      >
    </span>
  </div>
{/if}

<style>
  .voice {
    display: flex;
    min-width: 0;
    flex: 1;
    align-items: center;
    gap: 0.2rem;
  }

  .voice-icon {
    display: inline-flex;
    width: 2rem;
    height: 2rem;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    border-radius: 2px;
    opacity: 0.75;
  }

  .voice-icon:hover {
    background: color-mix(in srgb, var(--reader-panel-fg) 12%, transparent);
    opacity: 1;
  }

  .voice-play {
    display: inline-flex;
    width: 2.4rem;
    height: 2.4rem;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    border-radius: 2px;
    background: var(--accent-color);
    color: var(--app-accent-fg);
  }

  .voice-play:disabled {
    opacity: 0.5;
  }

  .voice-text {
    display: flex;
    min-width: 0;
    flex: 1;
    flex-direction: column;
    padding: 0 0.4rem;
    line-height: 1.25;
  }

  .voice-line,
  .voice-meta {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .voice-setup {
    color: var(--muted);
    line-height: 1.6;
  }

  .voice-error {
    color: var(--app-danger-color);
    font-size: 0.75rem;
  }

  .voice-meta {
    font-size: 0.7rem;
    opacity: 0.55;
  }
</style>
