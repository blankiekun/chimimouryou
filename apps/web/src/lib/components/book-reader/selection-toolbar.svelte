<script lang="ts">
  import { faCheck, faNoteSticky } from '@fortawesome/free-solid-svg-icons';
  import { highlightColors, type HighlightColor } from '$lib/data/annotations';
  import { formMarked, setWordMarks, wordMarks$ } from '$lib/data/word-marks';
  import { activePlugins$, type SelectionActionContribution } from '$lib/plugins';
  import { createEventDispatcher } from 'svelte';
  import { t$ } from '$lib/i18n';
  import Fa from 'svelte-fa';

  /** The Listen panel is open at the bottom, so show at the top instead */
  export let raised = false;
  /** The word-list form the selection is, conjugated or not (offers "Mark known") */
  export let word = '';

  const dispatch = createEventDispatcher<{
    highlight: HighlightColor;
    note: void;
    action: SelectionActionContribution;
  }>();

  $: marked = !!word && formMarked($wordMarks$, word);
</script>

<div
  class="reader-panel writing-horizontal-tb fixed left-1/2 z-20 flex max-w-[calc(100vw-1rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-1 rounded-sm px-2 py-1.5 text-sm {raised
    ? 'top-12'
    : 'bottom-10'}"
  role="toolbar"
  aria-label={$t$('reader.selectionActions')}
>
  {#each highlightColors as color (color)}
    <button
      type="button"
      class="flex h-8 w-8 items-center justify-center rounded-sm"
      title={$t$('reader.highlightColor', { color: $t$(`reader.color.${color}`) })}
      on:mousedown|preventDefault
      on:click={() => dispatch('highlight', color)}
    >
      <span class="color-dot" style:background-color="var(--highlight-{color})" />
    </button>
  {/each}
  <span class="reader-panel-divider mx-1 h-5 border-l" />
  <button
    type="button"
    class="flex h-8 items-center gap-1.5 rounded-sm px-2.5"
    title={$t$('reader.noteTitle')}
    on:mousedown|preventDefault
    on:click={() => dispatch('note')}
  >
    <Fa icon={faNoteSticky} />
    <span class="hidden sm:inline">{$t$('reader.note')}</span>
  </button>
  {#if word}
    <button
      type="button"
      class="flex h-8 items-center gap-1.5 rounded-sm px-2.5"
      title={$t$('book.markKnown', { word })}
      disabled={marked}
      on:mousedown|preventDefault
      on:click={() => setWordMarks([[word, null]], 'known')}
    >
      <Fa icon={faCheck} />
      <span class="hidden sm:inline">{$t$(marked ? 'reader.wordKnown' : 'reader.markKnown')}</span>
    </button>
  {/if}
  {#each $activePlugins$.flatMap((plugin) => plugin.selectionActions ?? []) as action (action.label)}
    <button
      type="button"
      class="flex h-8 items-center gap-1.5 rounded-sm px-2.5"
      title={$t$(action.title)}
      aria-label={$t$(action.label)}
      on:mousedown|preventDefault
      on:click={() => dispatch('action', action)}
    >
      <Fa icon={action.icon} />
      <span class="hidden sm:inline">{$t$(action.label)}</span>
    </button>
  {/each}
</div>

<style>
  button:hover {
    background: color-mix(in srgb, var(--reader-panel-fg) 12%, transparent);
  }

  .color-dot {
    width: 1.1rem;
    height: 1.1rem;
    border: 2px solid color-mix(in srgb, var(--reader-panel-fg) 50%, transparent);
    border-radius: 9999px;
  }
</style>
