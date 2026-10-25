<script lang="ts">
  import { mentionParts } from '$lib/data/community-mentions';
  import { t$ } from '$lib/i18n';
  import { createEventDispatcher } from 'svelte';

  /**
   * A post's text: plain text only (never HTML; the one link is a work mention, `@Title` to its
   * AniList or VNDB page, community-mentions.ts; a quote has none), line breaks kept. A
   * spoiler is blurred (the one blur Study Book allows) until "Show spoiler" (`show` tells the host).
   */
  export let text: string;
  export let blur = false;
  /** The quoted line: set in Japanese, a step larger */
  export let quote = false;
  /** A quote's page around it (splitContext): the line stays bold, the page muted and smaller */
  export let before = '';
  export let after = '';
  /** Off where one Show spoiler serves several texts */
  export let button = true;

  const dispatch = createEventDispatcher<{ show: void }>();

  let shown = false;

  $: hidden = blur && !shown;
</script>

{#if text}
  <p
    class="community-text"
    class:community-text-quote={quote}
    class:community-text-context={quote && !!(before || after)}
    class:community-text-blurred={hidden}
    aria-hidden={hidden || undefined}
    lang={quote ? 'ja' : undefined}
  >
    {#if quote}{before}<strong>{text}</strong
      >{after}{:else}{#each mentionParts(text) as part, index (index)}{#if 'href' in part}<a
            class="community-mention"
            href={part.href}
            target="_blank"
            rel="noopener noreferrer"
            tabindex={hidden ? -1 : undefined}>@{part.title}</a
          >{:else}{part.text}{/if}{/each}{/if}
  </p>
{/if}
{#if hidden && button}
  <p class="community-spoiler">
    <button
      type="button"
      class="app-button"
      on:click={() => {
        shown = true;
        dispatch('show');
      }}>{$t$('community.showSpoiler')}</button
    >
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

  .community-text-context {
    color: var(--c-muted, var(--app-muted-fg));
    font-size: var(--type-small);
    font-weight: 400;
    line-height: 1.7;
  }

  .community-text-context strong {
    color: var(--c-ink, var(--font-color));
    font-size: var(--type-body);
  }

  .community-mention {
    color: var(--accent-strong-color);
    font-weight: 700;
  }

  .community-mention:hover {
    text-decoration: underline;
    text-underline-offset: 0.2em;
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
