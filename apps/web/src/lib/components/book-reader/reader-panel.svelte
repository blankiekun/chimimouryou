<script lang="ts">
  import { faXmark } from '@fortawesome/free-solid-svg-icons';
  import AiLanguageToggle from '$lib/components/ai-language-toggle.svelte';
  import AnnotationsPanel from '$lib/components/book-reader/annotations-panel.svelte';
  import BookSearchPanel from '$lib/components/book-reader/book-search-panel.svelte';
  import ListenPanel from '$lib/components/book-reader/listen-panel.svelte';
  import {
    nextChapter$,
    type SectionWithProgress
  } from '$lib/components/book-reader/book-toc/book-toc';
  import type { Highlight } from '$lib/data/annotations';
  import type { Section } from '$lib/data/database/books-db/versions/v3/books-db-v3';
  import { contentsRows, readerPanelTabs, type PanelTab } from '$lib/data/reader-panel';
  import type { SearchIndex, SearchResult } from '$lib/functions/book-text/book-search';
  import { activePlugins$, type SelectionActionContribution } from '$lib/plugins';
  import type { PassageContext } from '$lib/data/ask-ai';
  import { createEventDispatcher } from 'svelte';
  import { t$ } from '$lib/i18n';
  import Fa from 'svelte-fa';

  /**
   * The reader's one side panel (Study Book): index tabs on its edge for Contents, Search,
   * Highlights, Listen and the plugins' tabs; a bottom sheet with a tab row on phones.
   * Stays mounted while closed, so audio, searches and recaps carry on. Not part of upstream.
   */
  export let open: boolean;
  export let tab: PanelTab;
  export let title: string;
  export let elementHtml: string;
  export let highlights: Highlight[];
  export let syncError: string;
  export let getIndex: () => Promise<SearchIndex>;
  export let sections: Section[];
  export let sectionData: SectionWithProgress[];
  export let position: number;
  export let bookCharacters: number;
  /** A selection action (Ask AI) shown in place of the tabs' content */
  export let selection:
    | { action: SelectionActionContribution; passage: PassageContext }
    | undefined = undefined;

  const dispatch = createEventDispatcher<{
    close: void;
    /** Went to a chapter from Contents */
    navigated: void;
    /** Go to a character count (Highlights, Listen) */
    jump: number;
    searchJump: SearchResult;
    edit: Highlight;
    reading: { start: number; end: number } | undefined;
    position: number;
    closeSelection: void;
  }>();

  let visited = new Set<PanelTab>();
  let listenStart = position;
  let shownTab: PanelTab | undefined;

  $: shown = open ? tab : undefined;
  // A new Set each time: the app compiles with immutable: true, so mutating it wouldn't re-render.
  $: if (shown && !visited.has(shown)) {
    visited = new Set([...visited, shown]);
  }
  // The voice starts where the reader was when Listen was opened.
  $: if (shown !== shownTab) {
    if (shown === 'listen') {
      listenStart = position;
    }
    shownTab = shown;
  }

  $: pluginTabs = $activePlugins$.flatMap((plugin) => plugin.companionTabs ?? []);
  $: tabs = readerPanelTabs(pluginTabs, {
    hasChapters: !!sectionData.length,
    hasText: !!bookCharacters
  });
  $: active = tabs.find((item) => item.key === tab) ?? tabs[0];
  $: rows = tab === 'contents' ? contentsRows(sectionData) : [];

  function select(key: PanelTab) {
    tab = key;
    if (selection) {
      dispatch('closeSelection');
    }
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      dispatch('close');
    }
  }
</script>

<div
  class="scrim md:hidden"
  class:hidden={!open}
  aria-hidden="true"
  on:click={() => dispatch('close')}
/>
<!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
<aside
  class="reader-index writing-horizontal-tb"
  class:hidden={!open}
  aria-label={$t$('reader.panel')}
  on:keydown={onKeydown}
>
  <div class="grabber md:hidden" aria-hidden="true" />
  <div class="tabs" role="tablist" aria-orientation="vertical">
    {#each tabs as item (item.key)}
      <button
        class="tab"
        class:tab-active={!selection && active.key === item.key}
        role="tab"
        aria-selected={!selection && active.key === item.key}
        on:click={() => select(item.key)}
      >
        <span>{$t$(item.label)}</span>
      </button>
    {/each}
  </div>

  <div class="body">
    {#if selection}
      <svelte:component
        this={selection.action.panel}
        passage={selection.passage}
        on:close={() => dispatch('closeSelection')}
      />
    {:else}
      <header class="head">
        <h2>{$t$(active.label)}</h2>
        {#if active.key === 'contents' && bookCharacters}
          <span class="meta"
            >{$t$('reader.chars', { count: bookCharacters.toLocaleString('en-US') })}</span
          >
        {:else if pluginTabs.some((item) => item.key === active.key)}
          <!-- shortcut: assumes every plugin tab is an AI tab; give tabs their own toolbar when another plugin adds one. -->
          <AiLanguageToggle compact />
        {/if}
        <button class="close" title={$t$('reader.close')} on:click={() => dispatch('close')}>
          <Fa icon={faXmark} />
        </button>
      </header>
    {/if}

    <div class="content" class:hidden={!!selection}>
      {#if active.key === 'contents'}
        <ol class="toc">
          {#each rows as row (row.reference)}
            <li>
              <button
                class="contents-row"
                class:contents-current={row.current}
                aria-current={row.current ? 'location' : undefined}
                title={$t$('reader.goTo', { chapter: row.label })}
                on:click={() => {
                  nextChapter$.next(row.reference);
                  dispatch('navigated');
                }}
              >
                <span class="contents-label" lang="ja">{row.label}</span>
                <span class="track" aria-hidden="true">
                  <span style:width="{row.progress}%" />
                </span>
              </button>
            </li>
          {/each}
        </ol>
      {/if}

      <!-- Visited tabs stay mounted (hidden), so a search, the audio or a recap being written survive. -->
      {#if visited.has('search')}
        <div class="tab-panel" class:hidden={active.key !== 'search'}>
          <BookSearchPanel
            {getIndex}
            {sections}
            active={open && active.key === 'search'}
            on:jump={({ detail }) => dispatch('searchJump', detail)}
            on:close={() => dispatch('close')}
          />
        </div>
      {/if}
      {#if visited.has('highlights')}
        <div class="tab-panel" class:hidden={active.key !== 'highlights'}>
          <AnnotationsPanel
            {title}
            {highlights}
            {syncError}
            on:jump={({ detail }) => dispatch('jump', detail.start)}
            on:edit
          />
        </div>
      {/if}
      {#if visited.has('listen')}
        <div class="tab-panel" class:hidden={active.key !== 'listen'}>
          <ListenPanel
            {title}
            {elementHtml}
            {getIndex}
            {position}
            startCharCount={listenStart}
            on:position
            on:reading
            on:jump
          />
        </div>
      {/if}
      {#each pluginTabs as item (item.key)}
        {#if visited.has(item.key)}
          <div class="tab-panel" class:hidden={active.key !== item.key}>
            <svelte:component
              this={item.component}
              {...item.props({
                title,
                getIndex,
                sections,
                position,
                bookCharacters,
                active: open && active.key === item.key
              })}
            />
          </div>
        {/if}
      {/each}
    </div>
  </div>
</aside>

<style>
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 59;
    background: var(--app-overlay-color);
  }

  .reader-index {
    --rule: color-mix(in srgb, var(--reader-panel-fg) 16%, transparent);
    --muted: color-mix(in srgb, var(--reader-panel-fg) 68%, transparent);

    position: fixed;
    right: 0;
    bottom: 0;
    left: 0;
    z-index: 60;
    display: flex;
    height: 72vh;
    flex-direction: column;
    border-top: 1px solid var(--rule);
    /* A flat layer on the opaque page colour: some themes' panel colour is translucent (it was blurred). */
    background:
      linear-gradient(var(--reader-panel-bg), var(--reader-panel-bg)), var(--background-color);
    color: var(--reader-panel-fg);
    font-family: var(--app-font-ui);
    font-size: var(--type-body);
  }

  .hidden {
    display: none !important;
  }

  .grabber {
    width: 2.5rem;
    height: 4px;
    flex: none;
    margin: 0.5rem auto 0.4rem;
    border-radius: 2px;
    background: var(--rule);
  }

  /* Phones: a row of tabs that scrolls sideways */
  .tabs {
    display: flex;
    flex: none;
    gap: 4px;
    overflow-x: auto;
    padding: 0 1rem;
    border-bottom: 1px solid var(--rule);
    scrollbar-width: none;
  }

  .tab {
    min-height: 44px;
    flex: none;
    padding: 0 0.9rem;
    border: 1px solid var(--rule);
    border-bottom: 0;
    border-radius: 2px 2px 0 0;
    background: var(--reader-panel-bg);
    color: var(--reader-panel-fg);
    font-size: var(--type-button);
    white-space: nowrap;
  }

  .tab:hover {
    background: color-mix(in srgb, var(--reader-panel-fg) 5%, var(--reader-panel-bg));
  }

  .tab-active,
  .tab-active:hover {
    border-color: var(--accent-color);
    background: var(--accent-color);
    color: var(--app-accent-fg);
    font-weight: 700;
  }

  .body {
    display: flex;
    min-width: 0;
    min-height: 0;
    flex: 1;
    flex-direction: column;
  }

  .head {
    display: flex;
    flex: none;
    align-items: center;
    gap: 0.75rem;
    margin: 0 1rem;
    padding: 0.9rem 0 0.6rem;
    border-bottom: 2px solid var(--reader-panel-fg);
  }

  .head h2 {
    flex: 1;
    margin: 0;
    font-size: var(--type-h2);
    font-weight: 700;
  }

  .meta {
    color: var(--muted);
    font-size: var(--type-small);
    font-variant-numeric: tabular-nums;
  }

  .close {
    display: inline-flex;
    width: 2.75rem;
    height: 2.75rem;
    margin: -0.6rem -0.75rem -0.6rem 0;
    align-items: center;
    justify-content: center;
    color: var(--muted);
  }

  .close:hover {
    color: var(--reader-panel-fg);
  }

  .content {
    display: flex;
    min-height: 0;
    flex: 1;
    flex-direction: column;
    overflow-y: auto;
  }

  .tab-panel {
    display: flex;
    min-height: 0;
    flex: 1;
    flex-direction: column;
  }

  .toc {
    margin: 0 1rem 1rem;
  }

  .contents-row {
    display: flex;
    width: 100%;
    min-height: 2.75rem;
    align-items: center;
    gap: 1rem;
    padding: 0.5rem 0.5rem;
    border-bottom: 1px solid var(--rule);
    text-align: left;
  }

  .contents-row:hover {
    background: color-mix(in srgb, var(--reader-panel-fg) 5%, transparent);
  }

  .contents-current,
  .contents-current:hover {
    background: color-mix(in srgb, var(--accent-color) 12%, var(--reader-panel-bg));
    color: var(--accent-strong-color);
    font-weight: 700;
  }

  .contents-label {
    min-width: 0;
    flex: 1;
  }

  .track {
    position: relative;
    width: 3.5rem;
    height: 3px;
    flex: none;
    background: var(--rule);
  }

  .track span {
    position: absolute;
    inset: 0 auto 0 0;
    background: var(--accent-color);
  }

  /* The panels inside predate Study Book: square their corners and drop their shadows here. */
  .reader-index :global(:is(.rounded, .rounded-md, .rounded-lg, .rounded-xl, .rounded-full)) {
    border-radius: 2px;
  }

  .reader-index :global(:is(.shadow, .shadow-lg, .shadow-xl, .shadow-2xl)) {
    box-shadow: none;
  }

  /* Larger screens: a column on the right with the index tabs standing out from its edge */
  @media (min-width: 768px) {
    .reader-index {
      top: 0;
      left: auto;
      width: calc(24rem + 2.75rem);
      height: auto;
      flex-direction: row;
      border-top: 0;
      background: transparent;
    }

    .tabs {
      width: 2.75rem;
      flex-direction: column;
      align-items: flex-end;
      gap: 6px;
      overflow: hidden auto;
      padding: 1.25rem 0;
      border-bottom: 0;
      background:
        linear-gradient(
          color-mix(in srgb, var(--reader-panel-fg) 4%, var(--reader-panel-bg)),
          color-mix(in srgb, var(--reader-panel-fg) 4%, var(--reader-panel-bg))
        ),
        var(--background-color);
    }

    .tab {
      width: 2.25rem;
      min-height: 0;
      padding: 0.9rem 0;
      border: 1px solid var(--rule);
      border-right: 0;
      border-radius: 2px 0 0 2px;
      writing-mode: vertical-rl;
    }

    .tab-active {
      width: 2.75rem;
    }

    .body {
      border-left: 1px solid var(--rule);
      /* A flat layer on the opaque page colour: some themes' panel colour is translucent (it was blurred). */
      background:
        linear-gradient(var(--reader-panel-bg), var(--reader-panel-bg)), var(--background-color);
    }

    .head {
      margin: 0 1.5rem;
      padding-top: 1.4rem;
    }

    .toc {
      margin: 0 1.5rem 1.5rem;
    }
  }
</style>
