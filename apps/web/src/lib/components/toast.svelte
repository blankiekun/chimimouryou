<script lang="ts">
  import { faXmark } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import type { Snippet } from 'svelte';
  import { t$ } from '$lib/i18n';

  /**
   * A flat note at the bottom right (full width minus gutters on phones) that stays until it is
   * answered or closed: a labelled status region with a close button, its content in `children`.
   */
  interface Props {
    label: string;
    onclose: () => void;
    children: Snippet;
  }

  let { label, onclose, children }: Props = $props();
</script>

<section class="toast writing-horizontal-tb" role="status" aria-label={label}>
  <button type="button" class="toast-close" title={$t$('reader.dismiss')} onclick={onclose}>
    <Fa icon={faXmark} />
  </button>
  {@render children()}
</section>

<style>
  .toast {
    position: fixed;
    right: 1rem;
    bottom: 2.5rem;
    left: 1rem;
    z-index: 30;
    padding: 0.75rem 2.75rem 0.875rem 1rem;
    border: 1px solid color-mix(in srgb, var(--reader-panel-fg) 16%, transparent);
    border-top: 2px solid var(--accent-color);
    border-radius: 2px;
    /* Opaque like the panel: some themes' panel colour is translucent. */
    background:
      linear-gradient(var(--reader-panel-bg), var(--reader-panel-bg)), var(--background-color);
    color: var(--reader-panel-fg);
    font-family: var(--app-font-ui);
    font-size: var(--type-body);
  }

  @media (min-width: 640px) {
    .toast {
      left: auto;
      width: 22rem;
    }
  }

  .toast-close {
    position: absolute;
    top: 0.25rem;
    right: 0.25rem;
    display: inline-flex;
    width: 2.25rem;
    height: 2.25rem;
    align-items: center;
    justify-content: center;
    color: color-mix(in srgb, var(--reader-panel-fg) 68%, transparent);
  }

  .toast-close:hover {
    color: var(--reader-panel-fg);
  }

  .toast-close:focus-visible {
    outline: 2px solid var(--accent-color);
    outline-offset: -2px;
  }
</style>
