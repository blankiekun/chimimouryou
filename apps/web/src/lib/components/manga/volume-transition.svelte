<script lang="ts">
  /** Mihon-style card between volumes: the one just finished (or left) and the one to open. */
  import { createEventDispatcher } from 'svelte';
  import type { CalibreBook } from '$lib/data/calibre';
  import { primaryButtonClasses } from '$lib/css-classes';

  /** 1: the end of the book, -1: its start. */
  export let direction: number;
  export let title: string;
  export let volume: CalibreBook | undefined;
  export let opening = false;
  export let error = '';
  export let hint = '';

  const dispatch = createEventDispatcher<{ open: CalibreBook }>();
</script>

<div class="reader-panel flex max-w-sm flex-col gap-3 rounded-lg p-5 text-center">
  <div>
    <div class="text-xs opacity-70">{direction > 0 ? 'Finished' : 'Current'}</div>
    <div class="font-bold">{title}</div>
  </div>
  {#if volume}
    <div>
      <div class="text-xs opacity-70">{direction > 0 ? 'Next' : 'Previous'}</div>
      <div class="font-bold">{volume.title}</div>
    </div>
    <button
      class={primaryButtonClasses}
      disabled={opening}
      on:click={() => volume && dispatch('open', volume)}
    >
      {opening ? 'Opening…' : direction > 0 ? 'Read the next volume' : 'Read the previous volume'}
    </button>
    {#if hint && !opening}
      <div class="text-xs opacity-70">{hint}</div>
    {/if}
  {:else}
    <div class="text-sm opacity-70">No {direction > 0 ? 'next' : 'previous'} volume</div>
  {/if}
  {#if error}
    <div class="text-sm text-danger">{error}</div>
  {/if}
</div>
