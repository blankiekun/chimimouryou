<script lang="ts">
  import {
    faBackwardStep,
    faCrosshairs,
    faFileAudio,
    faForwardStep,
    faList,
    faPause,
    faPlay,
    faRotateLeft,
    faRotateRight,
    faSpinner,
    faTrash,
    faXmark
  } from '@fortawesome/free-solid-svg-icons';
  import {
    deleteAudiobook,
    getAudiobookPosition,
    putAudiobook,
    saveAudiobookPosition,
    type BookAudiobook
  } from '$lib/data/audiobook';
  import type { SearchIndex } from '$lib/functions/book-text/book-search';
  import {
    cueAt,
    matchableText,
    matchCues,
    parseSubtitles,
    type MatchedCue
  } from '$lib/functions/audiobook/subtitles';
  import { toTimeString } from '$lib/functions/statistic-util';
  import WhisperSubtitles from '$lib/components/book-reader/whisper-subtitles.svelte';
  import { createEventDispatcher, onDestroy, tick } from 'svelte';
  import { t$, tr } from '$lib/i18n';
  import Fa from 'svelte-fa';

  export let title: string;
  /** Stored audiobook, or undefined to set one up */
  export let audiobook: BookAudiobook | undefined;
  export let getIndex: () => Promise<SearchIndex>;
  /** Current reading position */
  export let position: number;

  const dispatch = createEventDispatcher<{
    reading: { start: number; end: number } | undefined;
    jump: number;
    changed: BookAudiobook | undefined;
  }>();

  const rates = [0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];

  let audio: HTMLAudioElement | undefined;
  let audioUrl = '';
  let playing = false;
  let currentTime = 0;
  let duration = 0;
  let rate = 1;
  let activeIndex = -1;
  /** Sheet open above the bar */
  let sheet: '' | 'lines' | 'setup' = '';
  let linesElm: HTMLElement | undefined;
  let error = '';

  // Setup
  let audioFile: File | undefined;
  let subtitleFile: File | undefined;
  let fromCurrentPosition = false;
  let matching = false;

  $: cues = audiobook?.cues ?? [];
  $: foundCount = cues.filter((cue) => cue.start !== undefined).length;
  $: activeCue = cues[activeIndex] as MatchedCue | undefined;
  $: if (audiobook) {
    loadAudio(audiobook);
  }

  function loadAudio(book: BookAudiobook) {
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
    }
    audioUrl = URL.createObjectURL(book.audio);
    ({ position: currentTime, rate } = getAudiobookPosition(title));
    activeIndex = cueAt(book.cues, currentTime);
  }

  onDestroy(() => {
    savePosition();
    audio?.pause();
    dispatch('reading', undefined);
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
    }
    if ('mediaSession' in navigator) {
      ['play', 'pause', 'previoustrack', 'nexttrack'].forEach((action) =>
        navigator.mediaSession.setActionHandler(action as MediaSessionAction, null)
      );
    }
  });

  function savePosition() {
    if (audiobook && audio) {
      saveAudiobookPosition(title, audio.currentTime, rate);
    }
  }

  let lastSaved = 0;

  function onTimeUpdate() {
    if (!audio) {
      return;
    }

    currentTime = audio.currentTime;

    const index = cueAt(cues, currentTime);

    if (index !== activeIndex) {
      activeIndex = index;

      const cue = cues[index];

      dispatch(
        'reading',
        cue?.start !== undefined ? { start: cue.start, end: cue.end! } : undefined
      );

      if (sheet === 'lines') {
        tick().then(() =>
          linesElm?.querySelector('[data-active]')?.scrollIntoView({ block: 'nearest' })
        );
      }
    }

    if (Date.now() - lastSaved > 5000) {
      lastSaved = Date.now();
      savePosition();
    }
  }

  function onLoaded() {
    if (!audio) {
      return;
    }

    duration = audio.duration;
    audio.currentTime = currentTime;
    audio.playbackRate = rate;

    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({ title });
      navigator.mediaSession.setActionHandler('play', () => audio?.play());
      navigator.mediaSession.setActionHandler('pause', () => audio?.pause());
      navigator.mediaSession.setActionHandler('previoustrack', () => skipLine(-1));
      navigator.mediaSession.setActionHandler('nexttrack', () => skipLine(1));
    }
  }

  function togglePlay() {
    if (!audio) {
      return;
    }
    if (audio.paused) {
      audio.play().catch((e) => (error = e.message));
    } else {
      audio.pause();
    }
  }

  function seek(seconds: number) {
    if (audio) {
      audio.currentTime = Math.min(Math.max(seconds, 0), duration || seconds);
      onTimeUpdate();
    }
  }

  function playCue(index: number) {
    const cue = cues[index];

    if (!cue) {
      return;
    }

    seek(cue.startSeconds);
    if (cue.start !== undefined) {
      dispatch('jump', cue.start);
    }
  }

  function skipLine(offset: number) {
    playCue(Math.min(Math.max(activeIndex + offset, 0), cues.length - 1));
  }

  /** Continues the audio from the reading position. */
  function playFromHere() {
    const index = cues.findIndex((cue) => cue.end !== undefined && cue.end > position);

    if (index < 0) {
      error = tr('reader.abNoMatch');
      return;
    }

    seek(cues[index].startSeconds);
    audio?.play();
  }

  function cycleRate() {
    setRate(rates[(rates.indexOf(rate) + 1) % rates.length] ?? 1);
  }

  function setRate(value: number) {
    rate = value;
    if (audio) {
      audio.playbackRate = value;
    }
    savePosition();
  }

  async function match() {
    if (!audioFile || !subtitleFile) {
      return;
    }

    matching = true;
    error = '';

    try {
      const parsed = parseSubtitles(await subtitleFile.text());

      if (!parsed.length) {
        throw new Error(tr('reader.abNoCues'));
      }

      const index = await getIndex();
      const bookText = index.paragraphs.map((p) => matchableText(p.text)).join('');

      // Let the spinner render before the (synchronous) matching.
      await new Promise((resolve) => setTimeout(resolve, 50));

      const matched = matchCues(parsed, bookText, fromCurrentPosition ? position : 0);
      const stored: BookAudiobook = {
        title,
        audio: audioFile,
        audioName: audioFile.name,
        subtitleName: subtitleFile.name,
        cues: matched
      };

      if (!matched.some((cue) => cue.start !== undefined)) {
        throw new Error(tr('reader.abNotFound'));
      }

      try {
        await putAudiobook(stored);
      } catch (_) {
        error = tr('reader.abNoStorage');
      }

      saveAudiobookPosition(title, 0, rate);
      sheet = '';
      dispatch('changed', stored);
    } catch (e: any) {
      error = e.message;
    } finally {
      matching = false;
    }
  }

  async function remove() {
    if (!confirm(tr('reader.abRemoveConfirm'))) {
      return;
    }

    sheet = '';
    audio?.pause();
    await deleteAudiobook(title);
    dispatch('reading', undefined);
    dispatch('changed', undefined);
  }
</script>

<div class="player">
  {#if !audiobook}
    <span class="player-icon"><Fa icon={faFileAudio} /></span>
    <span class="player-text">
      <span class="player-line">{$t$('reader.abNone')}</span>
      <span class="player-meta">{$t$('reader.abNoneHint')}</span>
    </span>
    <button
      class="player-pill"
      class:player-pill-active={sheet === 'setup'}
      on:click={() => (sheet = sheet === 'setup' ? '' : 'setup')}
    >
      {$t$('reader.abSetUp')}
    </button>
  {:else}
    <audio
      bind:this={audio}
      src={audioUrl}
      preload="metadata"
      on:loadedmetadata={onLoaded}
      on:timeupdate={onTimeUpdate}
      on:play={() => (playing = true)}
      on:pause={() => {
        playing = false;
        savePosition();
      }}
    />
    <input
      type="range"
      class="player-seek"
      style:--progress="{duration ? (currentTime / duration) * 100 : 0}%"
      min="0"
      max={duration || 0}
      step="1"
      value={currentTime}
      aria-label={$t$('reader.abPosition')}
      on:change={(e) => seek(Number(e.currentTarget.value))}
    />
    <button class="player-icon" title={$t$('reader.prevLine')} on:click={() => skipLine(-1)}>
      <Fa icon={faBackwardStep} />
    </button>
    <button class="player-play" title={$t$(playing ? 'reader.pause' : 'reader.play')} on:click={togglePlay}>
      <Fa icon={playing ? faPause : faPlay} fw />
    </button>
    <button class="player-icon" title={$t$('reader.nextLine')} on:click={() => skipLine(1)}>
      <Fa icon={faForwardStep} />
    </button>
    <span class="player-text">
      {#if error}
        <span class="player-line player-error">{error}</span>
      {:else}
        <span class="player-line" lang="ja">{activeCue?.text ?? audiobook.audioName}</span>
      {/if}
      <span class="player-meta">{toTimeString(currentTime)} / {toTimeString(duration)}</span>
    </span>
    <button class="player-pill" title={$t$('reader.speed')} on:click={cycleRate}>{rate}×</button>
    <button
      class="player-icon hidden sm:inline-flex"
      title={$t$('reader.playFromPosition')}
      on:click={playFromHere}
    >
      <Fa icon={faCrosshairs} />
    </button>
    <button
      class="player-icon"
      class:player-icon-active={sheet === 'lines'}
      title={$t$('reader.lines')}
      on:click={() => (sheet = sheet === 'lines' ? '' : 'lines')}
    >
      <Fa icon={faList} />
    </button>
  {/if}
</div>

{#if sheet === 'setup' && !audiobook}
  <div class="sheet reader-panel" role="dialog" aria-label={$t$('reader.abSetupTitle')}>
    <div class="sheet-header">
      <span class="flex-1 font-semibold">{$t$('reader.abSetupTitle')}</span>
      <button class="player-icon" title={$t$('reader.close')} on:click={() => (sheet = '')}
        ><Fa icon={faXmark} /></button
      >
    </div>
    <p class="mb-3 text-xs opacity-75">
      {$t$('reader.abSetupHint')}
    </p>
    <label class="sheet-field">
      <span>{$t$('reader.abAudio')}</span>
      <input
        type="file"
        accept="audio/*,.m4b"
        on:change={(e) => (audioFile = e.currentTarget.files?.[0])}
      />
    </label>
    <label class="sheet-field">
      <span>{$t$('reader.abSubtitles')}</span>
      <input
        type="file"
        accept=".srt,.vtt,text/vtt"
        on:change={(e) => (subtitleFile = e.currentTarget.files?.[0])}
      />
    </label>
    {#if audioFile}
      <div class="mb-3">
        <WhisperSubtitles
          name={audioFile.name.replace(/\.[^.]+$/, '')}
          sources={() => (audioFile ? [{ blob: audioFile, offset: 0 }] : [])}
          on:srt={({ detail }) => {
            subtitleFile = new File([detail], 'Whisper.srt');
            match();
          }}
        />
      </div>
    {/if}
    <label class="mb-3 flex items-center gap-2 text-xs">
      <input type="checkbox" bind:checked={fromCurrentPosition} />
      {$t$('reader.abFromPosition')}
    </label>
    <button class="player-pill" disabled={!audioFile || !subtitleFile || matching} on:click={match}>
      {#if matching}<Fa icon={faSpinner} spin /> {$t$('reader.abMatching')}{:else}{$t$(
        'reader.abMatch'
      )}{/if}
    </button>
    {#if error}<p class="pt-2 text-xs text-panel-danger">{error}</p>{/if}
  </div>
{/if}

{#if sheet === 'lines' && audiobook}
  <div class="sheet reader-panel" role="dialog" aria-label={$t$('reader.lines')}>
    <div class="sheet-header">
      <span class="flex-1 text-xs opacity-70">{$t$('reader.abLinesFound', { found: foundCount, total: cues.length })}</span>
      <button class="player-icon" title={$t$('reader.back10')} on:click={() => seek(currentTime - 10)}>
        <Fa icon={faRotateLeft} />
      </button>
      <button
        class="player-icon"
        title={$t$('reader.forward10')}
        on:click={() => seek(currentTime + 10)}
      >
        <Fa icon={faRotateRight} />
      </button>
      <button
        class="player-icon sm:hidden"
        title={$t$('reader.playFromPosition')}
        on:click={playFromHere}
      >
        <Fa icon={faCrosshairs} />
      </button>
      <button class="player-icon" title={$t$('reader.abRemove')} on:click={remove}
        ><Fa icon={faTrash} /></button
      >
      <button class="player-icon" title={$t$('reader.close')} on:click={() => (sheet = '')}
        ><Fa icon={faXmark} /></button
      >
    </div>
    <div class="sheet-lines" bind:this={linesElm}>
      {#each cues as cue, index (index)}
        <button
          class="line"
          class:line-active={index === activeIndex}
          class:opacity-50={cue.start === undefined}
          data-active={index === activeIndex ? '' : undefined}
          title={$t$(cue.start === undefined ? 'reader.abLineMissing' : 'reader.abPlayLine')}
          on:click={() => playCue(index)}
        >
          <span class="line-time">{toTimeString(cue.startSeconds)}</span>
          <span lang="ja">{cue.text}</span>
        </button>
      {/each}
    </div>
  </div>
{/if}

<style>
  .player {
    display: flex;
    min-width: 0;
    flex: 1;
    align-items: center;
    gap: 0.2rem;
  }

  .player-seek {
    position: absolute;
    top: -1px;
    right: 1rem;
    left: 1rem;
    height: 3px;
    appearance: none;
    border-radius: 999px;
    background: linear-gradient(
      to right,
      var(--accent-color) var(--progress),
      color-mix(in srgb, var(--reader-panel-fg) 15%, transparent) var(--progress)
    );
    cursor: pointer;
  }

  .player-seek::-webkit-slider-thumb {
    width: 0.7rem;
    height: 0.7rem;
    appearance: none;
    border-radius: 999px;
    background: var(--accent-color);
    opacity: 0;
    transition: opacity 0.15s ease;
  }

  .player-seek::-moz-range-thumb {
    width: 0.7rem;
    height: 0.7rem;
    border: 0;
    border-radius: 999px;
    background: var(--accent-color);
    opacity: 0;
  }

  .player-seek:hover::-webkit-slider-thumb,
  .player-seek:focus-visible::-webkit-slider-thumb {
    opacity: 1;
  }

  .player-seek:hover::-moz-range-thumb,
  .player-seek:focus-visible::-moz-range-thumb {
    opacity: 1;
  }

  .player-icon {
    display: inline-flex;
    width: 2rem;
    height: 2rem;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    border-radius: 999px;
    opacity: 0.75;
  }

  .player-icon:hover,
  .player-icon-active {
    background: color-mix(in srgb, var(--reader-panel-fg) 12%, transparent);
    opacity: 1;
  }

  .player-play {
    display: inline-flex;
    width: 2.4rem;
    height: 2.4rem;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    border-radius: 999px;
    background: var(--accent-color);
    color: var(--app-accent-fg);
  }

  .player-text {
    display: flex;
    min-width: 0;
    flex: 1;
    flex-direction: column;
    padding: 0 0.4rem;
    line-height: 1.25;
  }

  .player-line {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .player-error {
    color: var(--app-danger-color);
    font-size: 0.75rem;
  }

  .player-meta {
    overflow: hidden;
    font-size: 0.7rem;
    font-variant-numeric: tabular-nums;
    opacity: 0.55;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .player-pill {
    display: inline-flex;
    flex-shrink: 0;
    align-items: center;
    gap: 0.35rem;
    padding: 0.3rem 0.65rem;
    border-radius: 999px;
    background: color-mix(in srgb, var(--reader-panel-fg) 10%, transparent);
    font-size: 0.75rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  .player-pill:hover:not(:disabled),
  .player-pill-active {
    background: color-mix(in srgb, var(--reader-panel-fg) 20%, transparent);
  }

  .player-pill:disabled {
    opacity: 0.5;
  }

  .sheet {
    position: absolute;
    right: 0;
    bottom: calc(100% + 0.5rem);
    left: 0;
    display: flex;
    max-height: 45vh;
    flex-direction: column;
    padding: 0.6rem 0.75rem 0.75rem;
    border: 1px solid color-mix(in srgb, var(--reader-panel-fg) 10%, transparent);
    border-radius: 1.1rem;
    box-shadow: 0 10px 30px -12px var(--shadow-color);
  }

  .sheet-header {
    display: flex;
    align-items: center;
    gap: 0.15rem;
    margin-bottom: 0.4rem;
  }

  .sheet-field {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    margin-bottom: 0.6rem;
    font-size: 0.75rem;
  }

  .sheet-field > span {
    font-weight: 600;
    opacity: 0.7;
  }

  .sheet-lines {
    min-height: 0;
    overflow-y: auto;
  }

  .line {
    display: flex;
    width: 100%;
    gap: 0.6rem;
    padding: 0.3rem 0.5rem;
    border-radius: 0.5rem;
    text-align: left;
  }

  .line:hover {
    background: color-mix(in srgb, var(--reader-panel-fg) 7%, transparent);
  }

  .line-active {
    background: var(--reading-line-color);
  }

  .line-time {
    flex-shrink: 0;
    padding-top: 0.1rem;
    font-size: 0.7rem;
    font-variant-numeric: tabular-nums;
    opacity: 0.55;
  }
</style>
