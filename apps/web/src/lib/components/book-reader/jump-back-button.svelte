<script lang="ts">
  import { faRotateLeft, faXmark } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { fade } from 'svelte/transition';
  import { t$ } from '$lib/i18n';

  /** Shown after a jump: returns to the place before it. */
  interface Props {
    /** Space the mini player takes at the bottom (px), so the two never overlap. */
    room: number;
    onback: () => void;
    ondismiss: () => void;
  }

  let { room, onback, ondismiss }: Props = $props();
</script>

<div
  class="jump-back writing-horizontal-tb"
  transition:fade|global={{ duration: 150 }}
  style:bottom={room ? `${room + 8}px` : undefined}
>
  <button class="jump-back-go" aria-label={$t$('reader.jumpBackLabel')} onclick={onback}>
    <Fa icon={faRotateLeft} />
    {$t$('reader.jumpBack')}
  </button>
  <button
    class="jump-back-close"
    aria-label={$t$('reader.dismiss')}
    title={$t$('reader.dismiss')}
    onclick={ondismiss}
  >
    <Fa icon={faXmark} />
  </button>
</div>

<style>
  /* Bottom centre, above the footer's progress counter like the mini player. */
  .jump-back {
    position: fixed;
    bottom: calc(1.75rem + env(safe-area-inset-bottom));
    left: 50%;
    z-index: 50;
    display: flex;
    align-items: center;
    padding: 0.25rem;
    border: 1px solid color-mix(in srgb, var(--reader-panel-fg) 16%, transparent);
    border-radius: 2px;
    background:
      linear-gradient(var(--reader-panel-bg), var(--reader-panel-bg)), var(--background-color);
    color: var(--reader-panel-fg);
    font-family: var(--app-font-ui);
    transform: translateX(-50%);
  }
  .jump-back-go,
  .jump-back-close {
    display: inline-flex;
    height: 2.5rem;
    align-items: center;
    justify-content: center;
    border-radius: 2px;
  }
  .jump-back-go {
    gap: 0.5rem;
    padding: 0 0.75rem;
    color: var(--accent-strong-color);
    font-size: var(--type-button);
    font-weight: 700;
  }
  .jump-back-close {
    width: 2.5rem;
    color: color-mix(in srgb, var(--reader-panel-fg) 75%, transparent);
  }
  .jump-back-go:hover,
  .jump-back-close:hover {
    background: color-mix(in srgb, var(--reader-panel-fg) 8%, transparent);
  }
  .jump-back button:focus-visible {
    outline: 2px solid var(--accent-color);
    outline-offset: 2px;
  }
  @media (pointer: coarse) {
    .jump-back-go,
    .jump-back-close {
      min-width: 2.75rem;
      height: 2.75rem;
    }
  }
</style>
