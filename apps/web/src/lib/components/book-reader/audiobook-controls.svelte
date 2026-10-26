<script lang="ts">
  import {
    faCirclePause,
    faMoon,
    faRepeat,
    faRotateLeft,
    faSliders
  } from '@fortawesome/free-solid-svg-icons';
  import { audiobookControls$ } from '$lib/data/audiobook-controls';
  import type { PlaybackController } from '$lib/functions/audiobook/playback-controller';
  import { t$ } from '$lib/i18n';
  import Fa from 'svelte-fa';

  /**
   * The listening buttons both audiobook players show: speed, replay the line, repeat lines,
   * pause after each line, options. Their panels are `audiobook-controls-panel.svelte`.
   */
  interface Props {
    controller: PlaybackController;
    /** The audiobook has subtitle lines */
    hasLines: boolean;
  }

  let { controller, hasLines }: Props = $props();
  // The controller's state, as a store
  let playback = $derived(controller.state$);
</script>

<button
  class="abc-pill"
  class:abc-active={$playback.panel === 'speed'}
  title={$t$('reader.speed')}
  aria-expanded={$playback.panel === 'speed'}
  onclick={() => controller.togglePanel('speed')}>{$playback.rate}×</button
>
{#if hasLines}
  <button
    class="abc-icon"
    title="{$t$('reader.abReplayLine')} (H)"
    onclick={() => controller.line(0)}
  >
    <Fa icon={faRotateLeft} />
  </button>
  <button
    class="abc-icon"
    class:abc-on={$playback.loop}
    title="{$t$('reader.abLoop')} (O)"
    aria-pressed={$playback.loop}
    onclick={() => controller.toggleLoop()}
  >
    <Fa icon={faRepeat} />
  </button>
  <button
    class="abc-icon"
    class:abc-on={$audiobookControls$.autoPause}
    title="{$t$('reader.abAutoPause')} (I)"
    aria-pressed={!!$audiobookControls$.autoPause}
    onclick={() => controller.run('autoPause')}
  >
    <Fa icon={faCirclePause} />
  </button>
{/if}
<button
  class="abc-icon"
  class:abc-active={$playback.panel === 'options'}
  class:abc-on={!!$playback.sleepAt}
  title={$t$('reader.abOptions')}
  aria-expanded={$playback.panel === 'options'}
  onclick={() => controller.togglePanel('options')}
>
  <Fa icon={$playback.sleepAt ? faMoon : faSliders} />
</button>

<style>
  .abc-icon {
    display: inline-flex;
    width: 2rem;
    height: 2rem;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    border-radius: 2px;
    opacity: 0.75;
  }

  .abc-icon:hover,
  .abc-active {
    background: color-mix(in srgb, var(--reader-panel-fg) 12%, transparent);
    opacity: 1;
  }

  /* A mode that is switched on */
  .abc-on {
    background: var(--accent-color);
    color: var(--app-accent-fg);
    opacity: 1;
  }

  .abc-icon.abc-on:hover {
    background: var(--accent-color);
  }

  .abc-pill {
    display: inline-flex;
    flex-shrink: 0;
    align-items: center;
    padding: 0.3rem 0.65rem;
    border-radius: 2px;
    background: color-mix(in srgb, var(--reader-panel-fg) 10%, transparent);
    font-size: 0.75rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  .abc-pill:hover,
  .abc-pill.abc-active {
    background: color-mix(in srgb, var(--reader-panel-fg) 20%, transparent);
  }
</style>
