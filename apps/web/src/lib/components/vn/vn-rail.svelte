<script lang="ts">
  /**
   * The VN player's (/v) touch rail in landscape: big Menu, Skip and Full screen buttons down
   * the game's left edge; the handle folds it to a strip. Not upstream.
   */
  import Fa from 'svelte-fa';
  import { faExpand } from '@fortawesome/free-solid-svg-icons';
  import { fullscreenManager } from '$lib/data/fullscreen-manager';
  import type { writableSubject } from '$lib/functions/svelte/store';

  interface Props {
    /** Open or folded (`vnRailOpen` in localStorage) */
    railOpen: ReturnType<typeof writableSubject<boolean>>;
    skipping: boolean;
    skipTitle: string;
    onmenu: () => void;
    onskip: () => void;
    onfullscreen: () => void;
  }

  let { railOpen, skipping, skipTitle, onmenu, onskip, onfullscreen }: Props = $props();
</script>

<div class="vn-rail" class:vn-rail-open={$railOpen}>
  <button
    class="vn-rail-handle"
    title={$railOpen ? 'Hide the buttons' : 'Show the buttons'}
    aria-expanded={$railOpen}
    onclick={() => railOpen.next(!$railOpen)}
  >
    <svg viewBox="0 0 12 20" width="12" height="20" aria-hidden="true">
      <path
        d={$railOpen ? 'M8 4 2 10l6 6' : 'M4 4l6 6-6 6'}
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      />
    </svg>
  </button>
  {#if $railOpen}
    <button class="vn-rail-button" title="The game's menu (right-click)" onclick={onmenu}>
      Menu
    </button>
    <button
      class="vn-rail-button"
      class:vn-rail-on={skipping}
      title={skipTitle}
      aria-pressed={skipping}
      onclick={onskip}
    >
      Skip
    </button>
    {#if fullscreenManager.fullscreenEnabled}
      <button class="vn-rail-button" onclick={onfullscreen}>
        <Fa icon={faExpand} />
        <span>Full screen</span>
      </button>
    {/if}
  {/if}
</div>

<style>
  .vn-rail {
    display: none;
  }

  /* The rail: big buttons down the game's left edge, beside the game; the handle folds it to a
     strip. A Steam Deck's primary pointer is fine, so it gets no rail. */
  @media (pointer: coarse) and (orientation: landscape) {
    .vn-rail {
      position: absolute;
      z-index: 1;
      top: 0;
      bottom: 0;
      left: 0;
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      padding: 0.25rem;
      border-right: 1px solid color-mix(in srgb, var(--reader-panel-fg) 16%, transparent);
      background: var(--reader-panel-bg);
    }
  }

  .vn-rail-handle {
    display: flex;
    height: 2.75rem;
    align-items: center;
    justify-content: center;
    border-radius: 2px;
    color: color-mix(in srgb, var(--reader-panel-fg) 68%, transparent);
  }

  .vn-rail-button {
    display: flex;
    width: 4.5rem;
    min-height: 4.5rem;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.35rem;
    border: 1px solid color-mix(in srgb, var(--reader-panel-fg) 24%, transparent);
    border-radius: 2px;
    font-size: var(--type-small);
    font-weight: 700;
    line-height: 1.2;
    text-align: center;
  }

  .vn-rail-button:active {
    background: var(--app-spot-tint);
  }

  .vn-rail-on {
    border-color: var(--accent-color);
    background: var(--app-spot-tint);
    color: var(--accent-strong-color);
  }
</style>
