<script lang="ts">
  import CommunityPost from '$lib/components/community/community-post.svelte';
  import CommunitySignup from '$lib/components/community/community-signup.svelte';
  import CommunityWork from '$lib/components/community/community-work.svelte';
  import {
    bodyLength,
    loadThread,
    replyTo,
    type CommunityPost as Post,
    type CommunityThread
  } from '$lib/data/community';
  import {
    communityErrorKey,
    lineLink,
    markNotesSeen,
    splitContext
  } from '$lib/data/community-book';
  import { socialSession$ } from '$lib/data/social-account';
  import { t$ } from '$lib/i18n';
  import { createEventDispatcher, onMount } from 'svelte';

  /**
   * One line's thread (board 4): the work, the line in its page with Go to line and Copy link, the
   * posts oldest first, and a reply box (with its own Spoiler mark) at the end. Outside the book,
   * spoiler-marked posts stay blurred until the reader passed the line or taps Show spoiler.
   */
  export let work: string;
  export let line: string;
  /** Outside the book: blur spoilers unless `passed` */
  export let outside = false;
  export let passed = false;
  /** Go to line: the host opens the book there (a link otherwise) */
  export let goToLine: (() => void) | undefined = undefined;
  export let backLabel: string;

  const dispatch = createEventDispatcher<{ back: void }>();

  let thread: CommunityThread | undefined;
  let error = '';
  let loading = true;
  let replyingTo: Post | undefined;
  let draft = '';
  let spoiler = false;
  let sending = false;
  let sendError = '';
  let signUp = false;
  let copied = false;
  let replyBox: HTMLTextAreaElement;

  $: root = thread?.posts.find((post) => !post.parent);
  $: replies = thread ? thread.posts.length - (root ? 1 : 0) : 0;
  $: context = thread ? splitContext(thread.context, thread.quote) : undefined;
  let revealed = false;

  $: hide = outside && !passed && !revealed;

  async function load() {
    error = '';
    try {
      thread = await loadThread(work, line);
      if (root?.mine) markNotesSeen(root.id);
    } catch (e) {
      error = $t$(communityErrorKey(e));
    } finally {
      loading = false;
    }
  }

  onMount(load);

  function reply(post: Post) {
    replyingTo = post;
    replyBox?.focus();
  }

  async function send() {
    const parent = root?.id;

    if (!parent || !draft.trim()) return;
    sending = true;
    sendError = '';
    try {
      await replyTo(parent, draft.trim(), spoiler);
      draft = '';
      spoiler = false;
      replyingTo = undefined;
      await load();
    } catch (e) {
      sendError = $t$(communityErrorKey(e));
    } finally {
      sending = false;
    }
  }

  function copyLink() {
    navigator.clipboard
      ?.writeText(lineLink(work, line))
      .then(() => (copied = true))
      .catch(() => {});
  }
</script>

<div class="thread">
  <div class="thread-top">
    <button type="button" class="app-button-quiet" on:click={() => dispatch('back')}
      >← {backLabel}</button
    >
    {#if thread}
      <span class="thread-count"
        >{$t$(replies === 1 ? 'community.repliesOne' : 'community.replies', {
          count: replies
        })}</span
      >
    {/if}
  </div>

  {#if loading}
    <p class="thread-quiet">{$t$('community.loading')}</p>
  {:else if error}
    <p class="thread-quiet" role="alert">{error}</p>
    <button type="button" class="app-button thread-retry" on:click={load}
      >{$t$('community.tryAgain')}</button
    >
  {:else if thread && context}
    <CommunityWork title={thread.title} vol={thread.vol} cover={thread.cover} />
    <figure class="thread-context">
      <blockquote lang="ja" class:thread-context-blurred={hide && root?.spoiler}>
        {context.before}<strong>{context.line}</strong>{context.after}
      </blockquote>
      <figcaption>
        {#if goToLine}
          <button type="button" class="app-button-quiet" on:click={goToLine}
            >{$t$('community.goToLine')}</button
          >
        {:else}
          <a class="app-button-quiet" href={lineLink(work, line)}>{$t$('community.goToLine')}</a>
        {/if}
        <button type="button" class="app-button-quiet" on:click={copyLink}
          >{$t$(copied ? 'community.linkCopied' : 'social.copyLink')}</button
        >
      </figcaption>
    </figure>

    {#if hide && thread.posts.some((post) => post.spoiler)}
      <p class="thread-spoiler">
        <button type="button" class="app-button" on:click={() => (revealed = true)}
          >{$t$('community.showSpoiler')}</button
        >
        <span>{$t$('community.notReached')}</span>
      </p>
    {/if}

    <div class="thread-posts">
      {#each thread.posts as post (post.id)}
        <CommunityPost
          {post}
          hideSpoiler={hide}
          spoilerButton={false}
          on:reply={({ detail }) => reply(detail)}
          on:changed={load}
          on:signUp={() => (signUp = true)}
        />
      {/each}
    </div>

    {#if signUp || !$socialSession$}
      {#if signUp}
        <CommunitySignup box on:close={() => (signUp = false)} />
      {/if}
    {:else if root}
      <form class="thread-reply" on:submit|preventDefault={send}>
        <textarea
          class="app-input"
          rows="2"
          maxlength={bodyLength}
          placeholder={$t$('community.replyTo', {
            name: replyingTo?.author?.name ?? root.author?.name ?? ''
          })}
          aria-label={$t$('community.reply')}
          bind:this={replyBox}
          bind:value={draft}
        />
        <div class="thread-reply-row">
          <label class="thread-reply-spoiler">
            <input type="checkbox" bind:checked={spoiler} />
            {$t$('community.spoiler')}
          </label>
          <span class="thread-reply-count"
            >{[...draft].length} / {bodyLength.toLocaleString('en-US')}</span
          >
          <button
            type="submit"
            class="app-button app-button-primary"
            disabled={sending || !draft.trim()}>{$t$('community.reply')}</button
          >
        </div>
        {#if sendError}<p class="thread-error" role="alert">{sendError}</p>{/if}
      </form>
    {/if}
  {/if}
</div>

<style>
  .thread {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .thread-top {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 1rem;
  }

  .thread-count,
  .thread-quiet {
    color: var(--c-muted, var(--app-muted-fg));
    font-size: var(--type-small);
  }

  .thread-retry {
    align-self: flex-start;
  }

  .thread-context {
    padding: 0.75rem;
    background: var(--c-field, var(--surface-color));
  }

  .thread-context blockquote {
    color: var(--c-muted, var(--app-muted-fg));
    font-size: var(--type-small);
    line-height: 1.7;
    overflow-wrap: anywhere;
  }

  .thread-context strong {
    color: var(--c-ink, var(--font-color));
    font-size: var(--type-body);
  }

  .thread-context-blurred {
    filter: blur(6px);
    user-select: none;
  }

  .thread-spoiler {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 1rem;
    color: var(--c-muted, var(--app-muted-fg));
    font-size: var(--type-small);
  }

  .thread-context figcaption {
    display: flex;
    gap: 1.25rem;
    margin-top: 0.5rem;
  }

  .thread-posts {
    border-top: 1px solid var(--c-rule, var(--border-color));
  }

  .thread-reply {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .thread-reply textarea {
    width: 100%;
    resize: vertical;
  }

  .thread-reply-row {
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .thread-reply-spoiler {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .thread-reply-count {
    margin-left: auto;
    color: var(--c-muted, var(--app-muted-fg));
    font-size: var(--type-small);
    font-variant-numeric: tabular-nums;
  }

  .thread-error {
    color: var(--app-danger-color);
    font-size: var(--type-small);
  }
</style>
