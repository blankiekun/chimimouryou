<script lang="ts">
  import { faXmark } from '@fortawesome/free-solid-svg-icons';
  import { sheetDrag } from '$lib/functions/sheet-drag';
  import { createEventDispatcher } from 'svelte';
  import { t$ } from '$lib/i18n';
  import Fa from 'svelte-fa';

  /**
   * The reader bar's Aa and More menus: a bottom sheet with a scrim on phones, a box under the
   * bar on larger screens. Not part of upstream.
   */
  export let title: string;

  const dispatch = createEventDispatcher<{ close: void }>();
</script>

<svelte:window on:keydown={(event) => event.key === 'Escape' && dispatch('close')} />

<div class="sheet-scrim" aria-hidden="true" on:click={() => dispatch('close')} />
<div
  class="sheet writing-horizontal-tb"
  role="dialog"
  aria-label={title}
  use:sheetDrag={{
    handles: '.sheet-grabber, .sheet-head',
    fullClass: 'sheet-full',
    close: () => dispatch('close')
  }}
>
  <div class="sheet-grabber" aria-hidden="true" />
  <header class="sheet-head">
    <h2>{title}</h2>
    <button class="sheet-close" title={$t$('reader.close')} on:click={() => dispatch('close')}>
      <Fa icon={faXmark} />
    </button>
  </header>
  <slot />
</div>

<style>
  .sheet-scrim {
    position: fixed;
    inset: 0;
    z-index: 61;
    background: var(--app-overlay-color);
  }

  .sheet {
    position: fixed;
    right: 0;
    bottom: 0;
    left: 0;
    z-index: 62;
    max-height: 85vh;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 0 1rem 1.5rem;
    border-top: 1px solid color-mix(in srgb, var(--reader-panel-fg) 16%, transparent);
    /* A flat layer on the opaque page colour: some themes' panel colour is translucent (it was blurred). */
    background:
      linear-gradient(var(--reader-panel-bg), var(--reader-panel-bg)), var(--background-color);
    color: var(--reader-panel-fg);
    font-family: var(--app-font-ui);
    font-size: var(--type-body);
  }

  /* Phones: dragged up (sheet-drag.ts), the sheet may grow to the screen's height. */
  @media (max-width: 767px) {
    .sheet:global(.sheet-full) {
      max-height: calc(100dvh - env(safe-area-inset-top));
    }
  }

  .sheet-grabber {
    width: 2.5rem;
    height: 4px;
    margin: 0 auto;
    padding: 0.5rem 0 0;
    border-radius: 2px;
    background: color-mix(in srgb, var(--reader-panel-fg) 16%, transparent);
    background-clip: content-box;
    touch-action: none;
  }

  .sheet-head {
    touch-action: none;
  }

  .sheet-head {
    display: flex;
    align-items: center;
    padding: 0.75rem 0 0.6rem;
    border-bottom: 2px solid var(--reader-panel-fg);
  }

  .sheet-head h2 {
    flex: 1;
    margin: 0;
    font-size: var(--type-h2);
    font-weight: 700;
  }

  .sheet-close {
    display: inline-flex;
    width: 2.75rem;
    height: 2.75rem;
    margin: -0.6rem -0.75rem -0.6rem 0;
    align-items: center;
    justify-content: center;
    color: color-mix(in srgb, var(--reader-panel-fg) 68%, transparent);
  }

  .sheet-close:hover {
    color: var(--reader-panel-fg);
  }

  /* Larger screens: a box under the bar's right end, no scrim colour */
  @media (min-width: 768px) {
    .sheet-scrim {
      background: transparent;
    }

    .sheet {
      top: 3.75rem;
      right: 1rem;
      bottom: auto;
      left: auto;
      width: 24rem;
      max-height: calc(100vh - 5rem);
      padding: 0 1.25rem 1.25rem;
      border: 1px solid color-mix(in srgb, var(--reader-panel-fg) 16%, transparent);
      border-top: 2px solid var(--reader-panel-fg);
      border-radius: 2px;
    }

    .sheet-grabber {
      display: none;
    }

    .sheet-head {
      padding-top: 1rem;
    }
  }
</style>
