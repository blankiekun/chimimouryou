<script lang="ts">
  /**
   * The VN player's (/v) bar and, on portrait phones, the chip row under it: one list of
   * toggles drawn in both. Not upstream.
   */
  import Fa from 'svelte-fa';
  import { faEllipsis, faExpand } from '@fortawesome/free-solid-svg-icons';
  import PlayerBar from '$lib/components/audio/player-bar.svelte';
  import { fullscreenManager } from '$lib/data/fullscreen-manager';

  interface Chip {
    label: string;
    title: string;
    on: boolean | undefined;
    click: () => void;
    phone?: boolean;
  }

  interface Props {
    title: string;
    place: string;
    chips: Chip[];
    showText: boolean;
    showMore: boolean;
    onback: () => void;
    ontext: () => void;
    onfullscreen: () => void;
    onmore: () => void;
  }

  let { title, place, chips, showText, showMore, onback, ontext, onfullscreen, onmore }: Props =
    $props();
</script>

<PlayerBar {title} {place} on:back={onback}>
  {#each chips as chip}
    <button
      class="bar-text bar-chip vn-bar-chip"
      class:vn-phone-chip={chip.phone}
      class:bar-icon-active={chip.on}
      title={chip.title}
      aria-pressed={chip.on}
      onclick={chip.click}
    >
      {chip.label}
    </button>
  {/each}
  <span class="bar-divider vn-bar-chip" aria-hidden="true"></span>
  <button
    class="bar-icon"
    class:bar-icon-active={showText}
    title="Show the text beside the game"
    aria-pressed={showText}
    onclick={ontext}
  >
    <!-- A screen with a text panel under it -->
    <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
      <rect
        x="2.75"
        y="3.75"
        width="14.5"
        height="12.5"
        rx="1"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
      />
      <path d="M3 12h14" stroke="currentColor" stroke-width="1.5" />
    </svg>
  </button>
  {#if fullscreenManager.fullscreenEnabled}
    <button class="bar-icon vn-bar-chip" title="Full screen" onclick={onfullscreen}>
      <Fa icon={faExpand} />
    </button>
  {/if}
  <button
    class="bar-icon"
    class:bar-icon-active={showMore}
    title="More"
    aria-expanded={showMore}
    onclick={onmore}
  >
    <Fa icon={faEllipsis} />
  </button>
</PlayerBar>

<div class="vn-chip-row">
  {#each chips as chip}
    <button
      class="vn-chip"
      class:vn-chip-on={chip.on}
      title={chip.title}
      aria-pressed={chip.on}
      onclick={chip.click}
    >
      {chip.label}
    </button>
  {/each}
  {#if fullscreenManager.fullscreenEnabled}
    <button class="vn-chip vn-chip-icon" title="Full screen" onclick={onfullscreen}>
      <Fa icon={faExpand} />
    </button>
  {/if}
</div>

<style>
  /* Menu and Skip are for touch screens, where right-click and the game's own buttons are hard
     to reach: in the bar (portrait tablets), the row (portrait phones) or the rail (landscape). */
  :global(.vn-page) .vn-phone-chip,
  .vn-chip-row {
    display: none;
  }

  @media (pointer: coarse) and (orientation: portrait) {
    :global(.vn-page) .vn-phone-chip {
      display: inline-flex;
    }
  }

  .vn-chip-row {
    gap: 0.25rem;
    overflow-x: auto;
    padding: 0 0.5rem;
    border-bottom: 1px solid color-mix(in srgb, var(--reader-panel-fg) 16%, transparent);
  }

  .vn-chip {
    display: inline-flex;
    height: 2.75rem;
    flex: 1 0 auto;
    align-items: center;
    justify-content: center;
    padding: 0 0.5rem;
    border-radius: 2px;
    color: color-mix(in srgb, var(--reader-panel-fg) 68%, transparent);
    font-size: var(--type-small);
    font-weight: 700;
  }

  .vn-chip-icon {
    width: 2.75rem;
    flex: none;
    padding: 0;
  }

  .vn-chip-on {
    background: var(--app-spot-tint);
    color: var(--accent-strong-color);
  }

  @media (orientation: portrait) and (max-width: 767px) {
    :global(.vn-page) .vn-bar-chip {
      display: none;
    }

    .vn-chip-row {
      display: flex;
    }
  }

  @media (orientation: landscape) and (max-height: 500px) {
    :global(.vn-page) .bar-chip {
      height: 2.75rem;
    }
  }
</style>
