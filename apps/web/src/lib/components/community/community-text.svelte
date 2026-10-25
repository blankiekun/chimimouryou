<script lang="ts">
  import { t$ } from '$lib/i18n';

  /**
   * A post's text: plain text only (never HTML, no links made from it), line breaks kept. A
   * spoiler is blurred (the one blur Study Book allows) until "Show spoiler".
   */
  export let text: string;
  export let blur = false;
  /** Set by the host when the reader has the book but hasn't reached the line */
  export let notReached = true;
  /** The quoted line: set in Japanese, a step larger */
  export let quote = false;
  /** Off where one Show spoiler serves several texts */
  export let button = true;

  let shown = false;

  $: hidden = blur && !shown;
</script>

{#if text}
  <p
    class="community-text"
    class:community-text-quote={quote}
    class:community-text-blurred={hidden}
    aria-hidden={hidden || undefined}
    lang={quote ? 'ja' : undefined}
  >
    {text}
  </p>
{/if}
{#if hidden && button}
  <p class="community-spoiler">
    <button type="button" class="app-button" on:click={() => (shown = true)}
      >{$t$('community.showSpoiler')}</button
    >
    {#if notReached}<span>{$t$('community.notReached')}</span>{/if}
  </p>
{/if}

<style>
  .community-text {
    margin-top: 0.4rem;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  }

  .community-text-quote {
    margin-top: 0;
    font-weight: 700;
  }

  /* Study Book's one blur: a spoiler's text (DESIGN.md) */
  .community-text-blurred {
    filter: blur(6px);
    user-select: none;
    pointer-events: none;
  }

  .community-spoiler {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 1rem;
    margin-top: 0.75rem;
    color: var(--c-muted, var(--app-muted-fg));
    font-size: var(--type-small);
  }
</style>
