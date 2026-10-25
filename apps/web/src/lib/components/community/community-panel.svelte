<script lang="ts">
  import { browser } from '$app/env';
  import CommunityMatch from '$lib/components/community/community-match.svelte';
  import CommunitySignup from '$lib/components/community/community-signup.svelte';
  import CommunityThread from '$lib/components/community/community-thread.svelte';
  import { listThreads, visibleThreads, type ThreadSummary } from '$lib/data/community';
  import {
    bookMarks,
    communityErrorKey,
    communityMarks$,
    communityMarkTap$,
    forgetBookCommunity,
    loadBookCommunity,
    type BookCommunity,
    type BookLine
  } from '$lib/data/community-book';
  import type { Section } from '$lib/data/database/books-db/versions/v3/books-db-v3';
  import { page } from '$lib/data/page-store';
  import { socialSession$ } from '$lib/data/social-account';
  import { chapterLabelAt, type SearchIndex } from '$lib/functions/book-text/book-search';
  import { t$ } from '$lib/i18n';
  import { createEventDispatcher, onDestroy, onMount } from 'svelte';

  /**
   * The reader panel's Community tab (board 3): threads on every line of this book wherever the
   * reader is (a spoiler thread's line blurred, its posts behind Show spoiler), in book order or by
   * posts, and a line's thread. The first visit matches the book to its work (board 6). Its threads also mark
   * the lines in the text (community-markers.svelte); a marker or a `/b?line=` link opens one.
   * Hub requests start only here, when the tab is first opened.
   */
  export let title: string;
  export let getIndex: () => Promise<SearchIndex>;
  export let sections: Section[];
  export let bookCharacters: number;
  export let active: boolean;

  const dispatch = createEventDispatcher<{
    jump: number;
    /** A link's line: the book goes there and the panel stays open */
    reveal: number;
  }>();

  let state: 'loading' | 'match' | 'ready' | 'error' = 'loading';
  let suggestion: string | null = null;
  let work = '';
  let lines: BookLine[] = [];
  let index: BookCommunity['index'] | undefined;
  let threads: ThreadSummary[] = [];
  let error = '';
  let order: 'book' | 'posts' = 'book';
  /** The thread shown: a line's hash */
  let open = '';
  let started = false;
  let linkedDone = false;

  $: visible = index ? visibleThreads(threads, index) : [];
  $: rows = order === 'book' ? visible : [...visible].sort((a, b) => b.posts - a.posts);
  $: total = visible.reduce((sum, thread) => sum + thread.posts, 0);
  // Markers: every thread of the book; only lines on screen are drawn. Not before the tab has
  // loaded, so the markers the book open set stay meanwhile.
  $: if (index) communityMarks$.next({ title, marks: bookMarks({ lines, index, threads }) });
  $: openLine = open
    ? lines[visible.find((thread) => thread.hash === open)?.index ?? -1]
    : undefined;
  $: if (active && !started) start();

  async function start() {
    started = true;
    state = 'loading';
    error = '';
    try {
      // The book open may have loaded it already (markBookOnOpen).
      const found = await loadBookCommunity(title, getIndex);

      lines = found.lines;
      index = found.index;
      if (found.work) {
        work = found.work;
        threads = found.threads;
        state = 'ready';
        openLinked();
      } else {
        suggestion = found.suggestion;
        state = 'match';
      }
    } catch (e) {
      error = $t$(communityErrorKey(e));
      state = 'error';
    }
  }

  async function load() {
    state = 'loading';
    try {
      threads = await listThreads(work);
      state = 'ready';
      openLinked();
    } catch (e) {
      error = $t$(communityErrorKey(e));
      state = 'error';
    }
  }

  /** A `/b?line=` link: its thread, and the book at its line */
  function openLinked() {
    const linked = browser && !linkedDone ? $page.url.searchParams.get('line') : null;

    if (!linked || !index) return;
    linkedDone = true;

    const line = index.get(linked.slice(0, 8))?.find((item) => item.hash === linked);

    if (line) {
      communityMarkTap$.next(linked);
      dispatch('reveal', lines[line.index].start);
    }
  }

  // A marker's tap or a new post: its thread (and the list again when it is a new line).
  const tapped = communityMarkTap$.subscribe((hash) => {
    open = hash;
    if (hash && state === 'ready' && !visible.some((thread) => thread.hash === hash)) load();
  });

  // The markers stay: the panel unmounts when it closes or a selection action (the composer)
  // takes its place, and the book is still open.
  onMount(() => () => {
    forgetBookCommunity();
    communityMarkTap$.next('');
  });
  onDestroy(() => tapped.unsubscribe());

  const where = (line: BookLine) =>
    [
      chapterLabelAt(sections, line.start),
      `${Math.floor((line.start / Math.max(1, bookCharacters)) * 100)}%`
    ]
      .filter(Boolean)
      .join(' · ');
</script>

<div class="community-tab">
  {#if !$socialSession$ && state !== 'match'}<CommunitySignup />{/if}

  {#if state === 'loading'}
    <p class="tab-quiet">{$t$('community.loading')}</p>
  {:else if state === 'error'}
    <p class="tab-text" role="alert">{error}</p>
    <p class="tab-quiet">{$t$('community.downNote')}</p>
    <button type="button" class="app-button tab-retry" on:click={start}
      >{$t$('community.tryAgain')}</button
    >
  {:else if state === 'match'}
    <CommunityMatch
      {title}
      {suggestion}
      on:done={({ detail }) => {
        work = detail;
        load();
      }}
    />
  {:else if open}
    <!-- Keyed: the thread loads on mount, so another bubble's tap needs a fresh one -->
    {#key open}<CommunityThread
        {work}
        line={open}
        bookTitle={title}
        {getIndex}
        backLabel={$t$('nav.community')}
        goToLine={openLine ? () => openLine && dispatch('jump', openLine.start) : undefined}
        on:back={() => communityMarkTap$.next('')}
      />{/key}
  {:else if !rows.length}
    <p class="tab-text">{$t$('community.empty')}</p>
    <p class="tab-quiet">{$t$('community.emptyHint')}</p>
  {:else}
    <div class="tab-bar">
      <div class="app-segmented" role="radiogroup" aria-label={$t$('community.order')}>
        {#each [['book', 'community.inOrder'], ['posts', 'community.mostPosts']] as const as [key, label] (key)}
          <button
            type="button"
            role="radio"
            aria-checked={order === key}
            class="app-segment"
            class:app-segment-selected={order === key}
            on:click={() => (order = key)}>{$t$(label)}</button
          >
        {/each}
      </div>
      <span class="tab-quiet"
        >{$t$(total === 1 ? 'community.postsOne' : 'community.posts', { count: total })}</span
      >
    </div>
    <ul class="threads">
      {#each rows as thread (thread.hash)}
        {@const line = lines[thread.index]}
        <li>
          <button
            type="button"
            class="thread-row"
            on:click={() => communityMarkTap$.next(thread.hash)}
          >
            <span class="thread-where" lang="ja">{where(line)}</span>
            {#if thread.spoiler}<span class="thread-spoiler">{$t$('community.spoiler')}</span>{/if}
            <span
              class="thread-line"
              class:thread-line-blurred={thread.spoiler}
              aria-hidden={thread.spoiler || undefined}
              lang="ja">{line.text}</span
            >
            <span class="tab-quiet"
              >{$t$(thread.posts === 1 ? 'community.postsOne' : 'community.posts', {
                count: thread.posts
              })}</span
            >
          </button>
        </li>
      {/each}
    </ul>
    <p class="tab-quiet">{$t$('community.guardNote')}</p>
  {/if}
</div>

<style>
  .community-tab {
    --c-ink: var(--reader-panel-fg);
    --c-muted: var(--muted);
    --c-rule: var(--rule);
    --c-field: color-mix(in srgb, var(--reader-panel-fg) 6%, transparent);

    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding: 1rem;
  }

  .tab-quiet {
    color: var(--muted);
    font-size: var(--type-small);
  }

  .tab-retry {
    align-self: flex-start;
  }

  .tab-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }

  .threads {
    border-top: 1px solid var(--rule);
  }

  .thread-row {
    display: grid;
    width: 100%;
    grid-template-columns: auto 1fr;
    gap: 0.35rem 0.6rem;
    padding: 0.75rem 0;
    border-bottom: 1px solid var(--rule);
    text-align: left;
  }

  .thread-row:hover .thread-line {
    text-decoration: underline;
    text-underline-offset: 0.2em;
  }

  .thread-where {
    color: var(--muted);
    font-size: var(--type-small);
  }

  .thread-spoiler {
    justify-self: start;
    padding: 0 0.35em;
    border: 1px solid var(--reader-panel-fg);
    border-radius: 2px;
    font-size: var(--type-label);
    line-height: 1.4;
  }

  .thread-line,
  .thread-row > .tab-quiet {
    grid-column: 1 / -1;
  }

  .thread-line {
    overflow-wrap: anywhere;
  }

  /* Study Book's one blur: a spoiler thread's line (DESIGN.md) */
  .thread-line-blurred {
    filter: blur(6px);
    user-select: none;
  }
</style>
