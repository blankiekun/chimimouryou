<script lang="ts">
  import { faTrash, faXmark } from '@fortawesome/free-solid-svg-icons';
  import {
    highlightColors,
    type Highlight,
    type HighlightColor
  } from '$lib/data/reader/annotations';
  import { createEventDispatcher, onMount } from 'svelte';
  import { t$ } from '$lib/i18n';
  import Fa from 'svelte-fa';

  export let highlight: Highlight;
  export let focusNote = false;

  const dispatch = createEventDispatcher<{
    close: void;
    change: { note?: string; color?: HighlightColor };
    delete: void;
  }>();

  let note = highlight.note;
  let noteElm: HTMLTextAreaElement;

  onMount(() => {
    if (focusNote) {
      noteElm.focus();
    }
  });

  function close() {
    if (note !== highlight.note) {
      dispatch('change', { note });
    }
    dispatch('close');
  }
</script>

<aside
  class="reader-panel writing-horizontal-tb fixed inset-x-2 bottom-2 z-[70] mx-auto flex max-w-xl flex-col gap-3 rounded-sm p-4 text-sm"
  aria-label={$t$('reader.highlight')}
>
  <div class="flex items-start gap-3">
    <blockquote
      class="reader-panel-quote max-h-28 flex-1 overflow-y-auto border-l-2 pl-3"
      lang="ja"
    >
      {highlight.text}
    </blockquote>
    <button class="p-1" title={$t$('reader.close')} on:click={close}><Fa icon={faXmark} /></button>
  </div>

  <textarea
    class="reader-panel-input min-h-[5rem] w-full resize-y rounded px-3 py-2"
    placeholder={$t$('reader.notePlaceholder')}
    bind:this={noteElm}
    bind:value={note}
    on:keydown={(event) => {
      if (event.key === 'Escape') {
        close();
      }
      event.stopPropagation();
    }}
  />

  <div class="flex items-center gap-2">
    {#each highlightColors as color (color)}
      <button
        type="button"
        class="color-option"
        class:color-option-active={highlight.color === color}
        style:background-color="var(--highlight-{color})"
        title={$t$(`reader.color.${color}`)}
        on:click={() => {
          highlight = { ...highlight, color };
          dispatch('change', { color });
        }}
      />
    {/each}
    <span class="flex-1" />
    <button
      type="button"
      class="reader-panel-chip flex items-center gap-1.5 rounded-sm px-3 py-1.5 text-small"
      on:click={() => dispatch('delete')}
    >
      <Fa icon={faTrash} />
      {$t$('reader.delete')}
    </button>
    <button
      type="button"
      class="reader-panel-chip rounded-sm px-3 py-1.5 text-small font-semibold"
      on:click={close}
    >
      {$t$('reader.done')}
    </button>
  </div>
</aside>

<style>
  .color-option {
    width: 1.6rem;
    height: 1.6rem;
    border: 2px solid color-mix(in srgb, var(--reader-panel-fg) 35%, transparent);
    border-radius: 9999px;
  }

  .color-option-active {
    border-color: var(--reader-panel-fg);
    outline: 2px solid var(--accent-color);
    outline-offset: 2px;
  }
</style>
