<script lang="ts">
  import AudiobookPlayer from '$lib/components/book-reader/audiobook-player.svelte';
  import { getAudiobook, type BookAudiobook } from '$lib/data/audiobook';
  import { activePlugins$ } from '$lib/plugins';
  import type { SearchIndex } from '$lib/functions/book-text/book-search';
  import { createEventDispatcher, onMount } from 'svelte';
  import { t$ } from '$lib/i18n';

  export let title: string;
  export let elementHtml: string;
  export let getIndex: () => Promise<SearchIndex>;
  /** Current reading position */
  export let position: number;
  /** Position when the Listen tab opened, where the voice starts */
  export let startCharCount: number;

  const dispatch = createEventDispatcher<{
    reading: { start: number; end: number } | undefined;
    /** Follow the voice (only forwards) */
    position: number;
    /** Go to a line the user picked */
    jump: number;
  }>();

  let loaded = false;
  let audiobook: BookAudiobook | undefined;
  /** 'audiobook' or a plugin's listen mode key */
  let mode = 'audiobook';

  $: pluginModes = $activePlugins$.flatMap((plugin) => plugin.listenModes ?? []);
  $: pluginMode = pluginModes.find((item) => item.key === mode);
  $: modes = [{ key: 'audiobook', title: 'reader.audiobook' as const }, ...pluginModes];

  onMount(async () => {
    try {
      audiobook = await getAudiobook(title);
    } catch (_) {
      // No stored audiobook
    }
    mode = audiobook ? 'audiobook' : (pluginModes[0]?.key ?? 'audiobook');
    loaded = true;
  });

  function setMode(value: string) {
    mode = value;
    dispatch('reading', undefined);
  }
</script>

<!-- The Listen tab of the reader panel; it stays mounted when the panel closes, so playback goes on. -->
<div class="listen" role="region" aria-label={$t$('reader.listen')}>
  {#if pluginModes.length}
    <div class="app-segmented self-start" role="radiogroup" aria-label={$t$('reader.source')}>
      {#each modes as item (item.key)}
        <button
          role="radio"
          aria-checked={mode === item.key}
          class="app-segment"
          class:app-segment-selected={mode === item.key}
          on:click={() => setMode(item.key)}
        >
          {$t$(item.title)}
        </button>
      {/each}
    </div>
  {/if}

  {#if loaded}
    <div class="listen-player">
      {#if pluginMode}
        <svelte:component
          this={pluginMode.component}
          {...pluginMode.props({ title, elementHtml, getIndex, position, startCharCount })}
          on:position
          on:reading
          on:jump
        />
      {:else}
        <AudiobookPlayer
          {title}
          {audiobook}
          {getIndex}
          {position}
          on:reading
          on:jump
          on:changed={({ detail }) => (audiobook = detail)}
        />
      {/if}
    </div>
  {/if}
</div>

<style>
  .listen {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding: 1rem;
    font-size: var(--type-small);
  }

  /* The players were made for a one-line bar: let their controls wrap in the panel's width. */
  .listen-player {
    position: relative;
    display: flex;
    min-height: 3rem;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.25rem;
    padding-top: 0.9rem;
  }

  /* Their seek bar ran along the bar's top edge and their sheets opened above it. */
  .listen-player :global(.player-seek) {
    right: 0;
    left: 0;
  }

  .listen-player :global(.sheet) {
    position: static;
    width: 100%;
    max-height: none;
    margin-top: 0.75rem;
    border-radius: 2px;
    box-shadow: none;
  }

  .listen-player
    :global(:is(.player-icon, .player-play, .player-pill, .player-seek, .voice-icon, .voice-play)) {
    border-radius: 2px;
  }

  .listen-player :global(:is(.player-line, .voice-line, .voice-meta)) {
    white-space: normal;
  }

  @media (min-width: 768px) {
    .listen {
      padding: 1.25rem 1.5rem;
    }
  }
</style>
