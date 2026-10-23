<script lang="ts">
  import { faChevronLeft } from '@fortawesome/free-solid-svg-icons';
  import { createEventDispatcher } from 'svelte';
  import Fa from 'svelte-fa';

  /**
   * The manga reader's and VN player's slim bar, like the book reader's (book-reader-header):
   * back, title with the place under it, then the slot's controls (.bar-icon, .bar-text).
   */
  export let title: string;
  export let place: string;

  const dispatch = createEventDispatcher<{ back: void }>();
</script>

<header class="player-bar">
  <button class="bar-icon" title="Back to the library" on:click={() => dispatch('back')}>
    <Fa icon={faChevronLeft} />
  </button>
  <div class="bar-title">
    <span class="bar-book" lang="ja">{title}</span>
    <span class="bar-place" lang="ja">{place}</span>
  </div>
  <slot />
</header>

<style>
  .player-bar {
    display: flex;
    height: 3.5rem;
    align-items: center;
    gap: 0.25rem;
    padding: 0 0.5rem;
    border-bottom: 1px solid color-mix(in srgb, var(--reader-panel-fg) 16%, transparent);
    /* A flat layer on the opaque page colour: some themes' panel colour is translucent. */
    background:
      linear-gradient(var(--reader-panel-bg), var(--reader-panel-bg)), var(--background-color);
    color: var(--reader-panel-fg);
    font-family: var(--app-font-ui);
  }

  .player-bar :global(.bar-icon),
  .player-bar :global(.bar-text) {
    display: inline-flex;
    height: 2.75rem;
    flex: none;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    border-radius: 2px;
  }

  .player-bar :global(.bar-icon) {
    width: 2.75rem;
    font-size: 1.05rem;
  }

  .player-bar :global(.bar-text) {
    padding: 0 0.75rem;
    color: color-mix(in srgb, var(--reader-panel-fg) 68%, transparent);
    font-size: var(--type-body);
    white-space: nowrap;
  }

  .player-bar :global(:is(.bar-icon, .bar-text):hover) {
    background: color-mix(in srgb, var(--reader-panel-fg) 6%, transparent);
    color: var(--reader-panel-fg);
  }

  /* Small toggles ("Furigana"): a tinted chip when on */
  .player-bar :global(.bar-chip) {
    height: 1.9rem;
    padding: 0 0.6rem;
    font-size: var(--type-small);
    font-weight: 700;
  }

  .player-bar :global(.bar-icon-active),
  .player-bar :global(.bar-icon-active:hover) {
    background: color-mix(in srgb, var(--accent-color) 12%, var(--reader-panel-bg));
    color: var(--accent-strong-color);
  }

  .player-bar :global(.bar-divider) {
    width: 1px;
    height: 1.5rem;
    margin: 0 0.5rem;
    background: color-mix(in srgb, var(--reader-panel-fg) 16%, transparent);
  }

  /* Controls shown only on larger screens, or only on phones */
  .player-bar :global(.bar-wide) {
    display: none;
  }

  @media (min-width: 768px) {
    .player-bar :global(.bar-wide) {
      display: inline-flex;
    }

    .player-bar :global(.bar-narrow) {
      display: none;
    }
  }

  .bar-title {
    display: flex;
    min-width: 0;
    flex: 1;
    flex-direction: column;
    padding: 0 0.25rem;
    line-height: 1.3;
  }

  .bar-book {
    overflow: hidden;
    font-size: var(--type-body);
    font-weight: 700;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .bar-place {
    overflow: hidden;
    color: color-mix(in srgb, var(--reader-panel-fg) 68%, transparent);
    font-size: var(--type-label);
    font-variant-numeric: tabular-nums;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
