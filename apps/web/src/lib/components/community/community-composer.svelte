<script lang="ts">
  import CommunityMentions from '$lib/components/community/community-mentions.svelte';
  import CommunityMatch from '$lib/components/community/community-match.svelte';
  import CommunitySignup from '$lib/components/community/community-signup.svelte';
  import CommunityWork from '$lib/components/community/community-work.svelte';
  import type { PassageContext } from '$lib/data/ask-ai';
  import { absBaseTitle } from '$lib/data/audiobookshelf';
  import {
    bodyLength,
    clipContext,
    contextLength,
    lineHash,
    occurrenceFor,
    occurrenceOf,
    postOnLine,
    quoteLength,
    uploadWorkCover,
    volumeOf,
    type CommunityThread
  } from '$lib/data/community';
  import {
    bookLines,
    bookWork,
    communityErrorKey,
    communityMarkTap$,
    lineAt,
    refreshBookMarks,
    splitContext,
    workTitles
  } from '$lib/data/community-book';
  import { socialSession$ } from '$lib/data/social-account';
  import type { SearchIndex } from '$lib/functions/book-text/book-search';
  import { t$ } from '$lib/i18n';
  import { createEventDispatcher, onMount } from 'svelte';

  /**
   * Post to community (board 5), the selection's action: the post's text (a question, a comment
   * or nothing but the line), a Spoiler mark, and what goes with it: the selected sentence, its
   * page (<= 600 characters) and the work. Signed out it asks to sign up; the first post on a
   * book matches it to its work (board 6). Plain text, 1,000 characters and 20 lines at most.
   * Given a `thread`, it posts on that line instead (its quote and context, its work).
   */
  export let passage: PassageContext | undefined = undefined;
  export let getIndex: (() => Promise<SearchIndex>) | undefined = undefined;
  export let thread: CommunityThread | undefined = undefined;
  /** With a thread: the open book, for its cover and markers (none on /community) */
  export let bookTitle = '';

  const bodyLines = 20;
  /** close: the reader panel's tab to show next (the new thread's, after a post from a selection) */
  const dispatch = createEventDispatcher<{ close: string | void; posted: void }>();

  let state: 'loading' | 'match' | 'ready' | 'error' = 'loading';
  let suggestion: string | null = null;
  let work = '';
  let line = '';
  /** Which copy of the line: a line the book repeats has a thread per copy */
  let occurrence = 1;
  let context = '';
  let body = '';
  let spoiler = false;
  /** Where the post goes: the Community feed and the line's thread, or the thread only */
  let feed = true;
  let sending = false;
  let error = '';
  let box: HTMLTextAreaElement | undefined;

  $: title = passage?.bookTitle ?? bookTitle;
  $: workTitle = thread?.title || workTitles.get(work) || absBaseTitle(title) || title;
  $: vol = thread ? thread.vol : volumeOf(title);
  $: shown = splitContext(context, line);
  $: count = [...body].length;
  $: tooLong = body.split('\n').length > bodyLines;

  onMount(async () => {
    if (!$socialSession$) return;
    if (thread) {
      const found = await occurrenceFor(thread.quote, thread.line).catch(() => null);

      work = thread.work;
      line = thread.quote;
      // The hub keeps only the line's first quote and context, so the line alone will do here.
      context = thread.context || thread.quote;
      occurrence = found ?? 1;
      error = $t$('community.lineShort');
      state = found ? 'ready' : 'error';
      return;
    }
    if (!passage || !getIndex) return;
    try {
      const [resolved, index] = await Promise.all([bookWork(title), getIndex()]);
      const lines = bookLines(index.paragraphs);
      const at = lineAt(lines, passage.start ?? -1);

      line = at >= 0 ? lines[at].text : passage.selection.trim();
      occurrence =
        at >= 0
          ? occurrenceOf(
              lines.map((item) => item.text),
              at
            )
          : 1;
      context = clipContext(
        lines
          .slice(Math.max(0, at - 6), at + 7)
          .map((item) => item.text)
          .join(''),
        line
      );
      if (!(await lineHash(line))) {
        error = $t$('community.lineShort');
        state = 'error';
      } else if ([...line].length > quoteLength) {
        error = $t$('community.lineLong');
        state = 'error';
      } else if (resolved.work) {
        work = resolved.work;
        state = 'ready';
      } else {
        suggestion = resolved.suggestion;
        state = 'match';
      }
    } catch (e) {
      error = $t$(communityErrorKey(e));
      state = 'error';
    }
  });

  /** The work's first cover on the hub: this reader's copy, as a thumbnail */
  async function sendCover() {
    const { database } = await import('$lib/data/store');
    const cover = (await database.getDataByTitle(title))?.coverImage;
    const blob =
      typeof cover === 'string' && cover ? await (await fetch(cover)).blob() : cover || undefined;

    if (blob instanceof Blob) await uploadWorkCover(work, blob);
  }

  async function post() {
    sending = true;
    error = '';
    try {
      const posted = await postOnLine(work, {
        title: workTitle,
        vol,
        quote: line,
        context,
        body: body.trim(),
        spoiler,
        feed,
        occurrence
      });

      if (!posted.cover && title) sendCover().catch(() => {});
      if (title && getIndex) refreshBookMarks(title, getIndex).catch(() => {});
      if (thread) {
        dispatch('posted');
        dispatch('close');
      } else {
        communityMarkTap$.next(posted.line);
        dispatch('close', 'community');
      }
    } catch (e) {
      error = $t$(communityErrorKey(e));
    } finally {
      sending = false;
    }
  }
</script>

<div class="composer" class:composer-inline={thread}>
  <header class="composer-head">
    <h2>{$t$('community.postTitle')}</h2>
  </header>

  {#if !$socialSession$}
    <CommunitySignup box on:close={() => dispatch('close')} />
  {:else if state === 'loading'}
    <p class="composer-quiet">{$t$('community.loading')}</p>
  {:else if state === 'error'}
    <p role="alert">{error}</p>
    <button type="button" class="app-button composer-start" on:click={() => dispatch('close')}
      >{$t$('social.cancel')}</button
    >
  {:else if state === 'match'}
    <CommunityMatch
      {title}
      {suggestion}
      on:done={({ detail }) => {
        work = detail;
        state = 'ready';
      }}
    />
  {:else}
    <form class="composer-form" on:submit|preventDefault={post}>
      <p class="composer-quiet">{$t$('community.postLead')}</p>
      <textarea
        class="app-input"
        rows="4"
        maxlength={bodyLength}
        aria-label={$t$('community.postTitle')}
        placeholder={$t$('community.postPlaceholder')}
        bind:this={box}
        bind:value={body}
      />
      <CommunityMentions textarea={box} />
      <p class="composer-row composer-quiet">
        <span>{$t$('community.plainText')}</span>
        <span class="composer-count" class:composer-over={tooLong}
          >{count.toLocaleString('en-US')} / {bodyLength.toLocaleString('en-US')}</span
        >
      </p>
      {#if tooLong}<p class="composer-error">{$t$('community.tooManyLines')}</p>{/if}
      <label class="composer-spoiler">
        <input type="checkbox" bind:checked={spoiler} />
        <span>
          <strong>{$t$('community.spoiler')}</strong>
          <small>{$t$('community.spoilerHint')}</small>
        </span>
      </label>

      <fieldset class="composer-where">
        <legend>{$t$('community.where')}</legend>
        <div class="app-segmented" role="radiogroup" aria-label={$t$('community.where')}>
          {#each [[true, 'community.whereFeed'], [false, 'community.whereLine']] as const as [key, label] (key)}
            <button
              type="button"
              role="radio"
              aria-checked={feed === key}
              class="app-segment"
              class:app-segment-selected={feed === key}
              on:click={() => (feed = key)}>{$t$(label)}</button
            >
          {/each}
        </div>
        <small>{$t$(feed ? 'community.whereFeedHint' : 'community.whereLineHint')}</small>
      </fieldset>

      <h3>{$t$('community.shared')}</h3>
      <figure class="composer-context">
        <blockquote lang="ja">{shown.before}<strong>{shown.line}</strong>{shown.after}</blockquote>
        <figcaption>
          {$t$('community.contextCount', {
            count: [...context].length,
            max: contextLength
          })}
        </figcaption>
      </figure>
      <CommunityWork title={workTitle} {vol} cover={thread?.cover ?? null}>
        {#if !thread}<button
            type="button"
            class="app-button-quiet composer-change"
            on:click={() => (state = 'match')}>{$t$('community.change')}</button
          >{/if}
      </CommunityWork>
      <p class="composer-quiet">{$t$('community.alsoShown')}</p>

      {#if error}<p class="composer-error" role="alert">{error}</p>{/if}
      <div class="composer-actions">
        <button type="submit" class="app-button app-button-primary" disabled={sending || tooLong}
          >{$t$('community.post')}</button
        >
        <button type="button" class="app-button" on:click={() => dispatch('close')}
          >{$t$('social.cancel')}</button
        >
      </div>
    </form>
  {/if}
</div>

<style>
  /* In the reader panel; inside a thread (the panel or /community) it takes the thread's colours */
  .composer:not(.composer-inline) {
    --c-ink: var(--reader-panel-fg);
    --c-muted: var(--muted);
    --c-rule: var(--rule);
    --c-field: color-mix(in srgb, var(--reader-panel-fg) 6%, transparent);
  }

  .composer {
    display: flex;
    min-height: 0;
    flex-direction: column;
    gap: 1rem;
    overflow-y: auto;
    padding: 0 1rem 1rem;
  }

  .composer-inline {
    overflow-y: visible;
    padding: 0;
  }

  .composer-head {
    padding: 0.9rem 0 0.6rem;
    border-bottom: 2px solid var(--c-ink, var(--font-color));
  }

  .composer-head h2 {
    font-size: var(--type-h2);
    font-weight: 700;
  }

  .composer-form {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .composer-form textarea {
    width: 100%;
    resize: vertical;
  }

  .composer-form h3 {
    margin-top: 0.5rem;
    font-weight: 700;
  }

  .composer-quiet {
    color: var(--c-muted, var(--app-muted-fg));
    font-size: var(--type-small);
  }

  .composer-row {
    display: flex;
    justify-content: space-between;
    margin-top: -0.4rem;
  }

  .composer-count {
    font-variant-numeric: tabular-nums;
  }

  .composer-over,
  .composer-error {
    color: var(--app-danger-color);
  }

  .composer-error {
    font-size: var(--type-small);
  }

  .composer-spoiler {
    display: flex;
    align-items: flex-start;
    gap: 0.6rem;
  }

  .composer-spoiler input {
    margin-top: 0.2rem;
  }

  .composer-spoiler small {
    display: block;
    color: var(--c-muted, var(--app-muted-fg));
    font-size: var(--type-small);
  }

  .composer-where {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.4rem;
  }

  .composer-where legend {
    margin-bottom: 0.4rem;
    font-weight: 700;
  }

  /* Two long labels in the panel: one row of equal halves, each label free to wrap. */
  .composer-where .app-segmented {
    display: flex;
    flex-wrap: nowrap;
  }

  .composer-where .app-segment {
    flex: 1 1 0;
    white-space: normal;
  }

  .composer-where small {
    color: var(--c-muted, var(--app-muted-fg));
    font-size: var(--type-small);
  }

  .composer-context {
    padding: 0.75rem;
    background: var(--c-field, var(--surface-color));
  }

  .composer-context blockquote {
    color: var(--c-muted, var(--app-muted-fg));
    font-size: var(--type-small);
    line-height: 1.7;
    overflow-wrap: anywhere;
  }

  .composer-context strong {
    color: var(--c-ink, var(--font-color));
    font-size: var(--type-body);
  }

  .composer-context figcaption {
    margin-top: 0.5rem;
    color: var(--c-muted, var(--app-muted-fg));
    font-size: var(--type-small);
    font-variant-numeric: tabular-nums;
  }

  .composer-change {
    margin-left: auto;
    font-weight: 700;
  }

  .composer-actions,
  .composer-start {
    display: flex;
    gap: 0.75rem;
    align-self: flex-start;
  }
</style>
