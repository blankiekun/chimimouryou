<script lang="ts">
  /**
   * A page's mokuro text over its image: one box per speech bubble, invisible until hovered
   * (or always shown), so Yomitan can look the words up. Placed in percent of the page and
   * sized from its rendered height, so it follows zoom and resizing.
   */
  import { blockStyle, type MangaText, type MokuroPage } from '$lib/data/mokuro';

  export let page: MokuroPage;
  export let mode: MangaText;

  let height = 0;

  $: scale = height / page.height;
</script>

<div class="mokuro-page" class:always={mode === 'always'} lang="ja" bind:clientHeight={height}>
  {#each page.blocks as block}
    <div
      class="mokuro-block"
      class:vertical={block.vertical}
      style={blockStyle(block, page, scale)}
    >
      {#each block.lines as line}
        <p>{line}</p>
      {/each}
    </div>
  {/each}
</div>

<style>
  .mokuro-page {
    position: absolute;
    inset: 0;
  }

  .mokuro-block {
    position: absolute;
    display: flex;
    flex-direction: column;
    line-height: 1.15;
    white-space: nowrap;
    color: transparent;
    user-select: text;
  }

  .mokuro-block.vertical {
    writing-mode: vertical-rl;
  }

  .mokuro-block p {
    margin: 0;
  }

  /* Covers the bubble like paper, whatever the theme: part of the page, as the backdrop is. */
  .mokuro-block:hover,
  .always .mokuro-block {
    z-index: 1;
    background: #fff;
    color: #000;
  }

  /* The bubble under the pointer: framed and tagged in the spot colour */
  .mokuro-block:hover {
    outline: 2px solid var(--accent-color);
  }

  .mokuro-block:hover::before {
    content: 'Text';
    position: absolute;
    right: -2px;
    bottom: calc(100% + 2px);
    padding: 0 0.4rem;
    border-radius: 2px 2px 0 0;
    background: var(--accent-color);
    color: var(--app-accent-fg);
    font-family: var(--app-font-ui);
    font-size: 0.75rem;
    line-height: 1.5;
    writing-mode: horizontal-tb;
    user-select: none;
  }
</style>
