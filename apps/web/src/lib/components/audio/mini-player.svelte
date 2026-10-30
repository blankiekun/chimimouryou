<script lang="ts">
  import {
    faBackwardStep,
    faForwardStep,
    faPause,
    faPlay
  } from '@fortawesome/free-solid-svg-icons';
  import { nextRate, nowPlaying$ } from '$lib/data/now-playing';
  import { t$ } from '$lib/i18n';
  import Fa from 'svelte-fa';

  /**
   * The Listen player docked at the bottom of the reader while Listen isn't shown: it drives the
   * player in the panel (`now-playing.ts`), so pausing doesn't need the panel. Not part of upstream.
   */
  interface Props {
    /** The panel is open (on another tab): on phones the sheet covers this, so it hides */
    panelOpen: boolean;
    onopen: () => void;
    /** Out: how far up from the bottom of the window it reaches (px), 0 when not shown */
    room?: number;
  }

  let { panelOpen, onopen, room = $bindable(0) }: Props = $props();
  let box = $state<HTMLElement>();

  $effect(() => {
    if (!box) return;
    const el = box;
    const measure = () => {
      // Hidden under the phone sheet: keep the room, so the book doesn't reflow behind the sheet.
      if (el.offsetHeight) room = el.offsetHeight + parseFloat(getComputedStyle(el).bottom);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => {
      observer.disconnect();
      room = 0;
    };
  });
</script>

{#if $nowPlaying$}
  {@const now = $nowPlaying$}
  <div
    bind:this={box}
    class="mini writing-horizontal-tb"
    class:mini-panel-open={panelOpen}
    role="region"
    aria-label={$t$('reader.listen')}
  >
    <button class="mini-icon" title={$t$('reader.prevLine')} onclick={() => now.step(-1)}>
      <Fa icon={faBackwardStep} />
    </button>
    <button
      class="mini-play"
      title={$t$(now.playing ? 'reader.pause' : 'reader.play')}
      aria-label={$t$(now.playing ? 'reader.pause' : 'reader.play')}
      onclick={() => now.toggle()}
    >
      <Fa icon={now.playing ? faPause : faPlay} fw />
    </button>
    <button class="mini-icon" title={$t$('reader.nextLine')} onclick={() => now.step(1)}>
      <Fa icon={faForwardStep} />
    </button>
    <span class="mini-text">
      <span class="mini-line" lang="ja">{now.text}</span>
      {#if now.time}<span class="mini-time">{now.time}</span>{/if}
    </span>
    <button
      class="mini-rate"
      title={$t$('reader.speed')}
      onclick={() => now.setRate(nextRate(now.rates, now.rate))}>{now.rate}×</button
    >
    <button class="mini-open" onclick={onopen}>{$t$('reader.listen')}</button>
  </div>
{/if}

<style>
  /* Above the footer's progress counter (bottom-right), so it never covers it. */
  .mini {
    position: fixed;
    right: 0.5rem;
    bottom: calc(1.75rem + env(safe-area-inset-bottom));
    left: 0.5rem;
    z-index: 50;
    display: flex;
    align-items: center;
    gap: 0.125rem;
    padding: 0.25rem;
    border: 1px solid color-mix(in srgb, var(--reader-panel-fg) 16%, transparent);
    border-radius: 2px;
    /* A flat layer on the opaque page colour, as the panel does. */
    background:
      linear-gradient(var(--reader-panel-bg), var(--reader-panel-bg)), var(--background-color);
    color: var(--reader-panel-fg);
    font-family: var(--app-font-ui);
    font-size: var(--type-small);
  }

  .mini-icon,
  .mini-play {
    display: inline-flex;
    width: 2.5rem;
    height: 2.5rem;
    flex: none;
    align-items: center;
    justify-content: center;
    border-radius: 2px;
  }

  .mini-icon {
    color: color-mix(in srgb, var(--reader-panel-fg) 75%, transparent);
  }

  .mini-icon:hover {
    background: color-mix(in srgb, var(--reader-panel-fg) 8%, transparent);
    color: var(--reader-panel-fg);
  }

  .mini-play {
    background: var(--accent-color);
    color: var(--app-accent-fg);
  }

  .mini-text {
    display: flex;
    min-width: 0;
    flex: 1;
    flex-direction: column;
    padding: 0 0.5rem;
    line-height: 1.3;
  }

  .mini-line,
  .mini-time {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .mini-time {
    color: color-mix(in srgb, var(--reader-panel-fg) 68%, transparent);
    font-size: var(--type-label);
    font-variant-numeric: tabular-nums;
  }

  .mini-rate,
  .mini-open {
    height: 2.5rem;
    flex: none;
    padding: 0 0.6rem;
    border-radius: 2px;
    font-size: var(--type-button);
    font-weight: 700;
  }

  .mini-rate {
    font-variant-numeric: tabular-nums;
  }

  .mini-rate:hover {
    background: color-mix(in srgb, var(--reader-panel-fg) 8%, transparent);
  }

  .mini-open {
    color: var(--accent-strong-color);
  }

  .mini-open:hover {
    text-decoration: underline;
    text-underline-offset: 3px;
  }

  .mini button:focus-visible {
    outline: 2px solid var(--accent-color);
    outline-offset: 2px;
  }

  @media (pointer: coarse) {
    .mini-icon,
    .mini-play,
    .mini-rate,
    .mini-open {
      min-width: 2.75rem;
      height: 2.75rem;
    }
  }

  /* Phones: the open sheet covers the bottom of the screen. */
  @media (max-width: 767px) {
    .mini-panel-open {
      display: none;
    }
  }

  /* Larger screens: a compact box at the bottom left, clear of the panel on the right. */
  @media (min-width: 768px) {
    .mini {
      right: auto;
      width: min(26rem, calc(100vw - 28.5rem));
      min-width: 20rem;
    }
  }
</style>
