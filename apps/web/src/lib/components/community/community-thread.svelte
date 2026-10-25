<script lang="ts">
  import CommunityPost from '$lib/components/community/community-post.svelte';
  import CommunitySignup from '$lib/components/community/community-signup.svelte';
  import CommunityWork from '$lib/components/community/community-work.svelte';
  import SectionHead from '$lib/components/section-head.svelte';
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
    splitContext,
    splitThread
  } from '$lib/data/community-book';
  import { socialSession$ } from '$lib/data/social-account';
  import { t$ } from '$lib/i18n';
  import { createEventDispatcher, onMount } from 'svelte';

  /**
   * One line's thread (board 4): the work, the line in its page with Go to line and Copy link, then
   * the line's own comments ("This line only") with their replies, and the feed posts on it, each
   * opening its own discussion (the post and its replies). A reply box (with its own Spoiler mark)
   * at the end. Outside the book, spoiler-marked posts stay blurred until the reader passed the
   * line or taps Show spoiler.
   */
  export let work: string;
  export let line: string;
  /** A feed post to open on (the feed, replies to it): its discussion rather than the line */
  export let post: string | undefined = undefined;
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

  let focus = post;
  $: parts = thread ? splitThread(thread.posts) : undefined;
  /** The feed post whose discussion is shown (a line comment's post opens the line) */
  $: focused = parts?.feed.find((group) => group.root.id === focus);
  $: comments = parts?.comments ?? [];
  $: root = focused?.root ?? comments.find((one) => !one.parent);
  // On the line, replies go to its comments; a hidden first comment leaves its replies' parent.
  $: target = replyingTo?.parent ?? replyingTo?.id ?? root?.id ?? comments[0]?.parent;
  $: context = thread ? splitContext(thread.context, thread.quote) : undefined;
  let revealed = false;

  $: hide = outside && !passed && !revealed;

  async function load() {
    error = '';
    try {
      thread = await loadThread(work, line);
      for (const post of thread.posts) if (!post.parent && post.mine) markNotesSeen(post.id);
    } catch (e) {
      error = $t$(communityErrorKey(e));
    } finally {
      loading = false;
    }
  }

  onMount(load);

  function reply(post: Post) {
    // Replying to a feed post opens its discussion
    if (parts?.feed.some((group) => group.root.id === (post.parent ?? post.id))) {
      focus = post.parent ?? post.id;
    }
    replyingTo = post;
    replyBox?.focus();
  }

  async function send() {
    const parent = target;

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
    {#if focused && focus !== post}
      <button
        type="button"
        class="app-button-quiet"
        on:click={() => ((focus = undefined), (replyingTo = undefined))}
        >← {$t$('community.thisLine')}</button
      >
    {:else}
      <button type="button" class="app-button-quiet" on:click={() => dispatch('back')}
        >← {backLabel}</button
      >
    {/if}
    {#if focused}
      <span class="thread-count"
        >{$t$(focused.replies.length === 1 ? 'community.repliesOne' : 'community.replies', {
          count: focused.replies.length
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

    {#if focused}
      <div class="thread-posts">
        {#each [focused.root, ...focused.replies] as one (one.id)}
          <CommunityPost
            post={one}
            hideSpoiler={hide}
            spoilerButton={false}
            on:reply={({ detail }) => reply(detail)}
            on:changed={load}
            on:signUp={() => (signUp = true)}
          />
        {/each}
      </div>
    {:else if parts}
      {#if comments.length}
        <section class="thread-section">
          <SectionHead
            number={1}
            level="h3"
            title={$t$('community.lineComments')}
            count={comments.length}
          />
          <div class="thread-posts">
            {#each comments as one (one.id)}
              <CommunityPost
                post={one}
                hideSpoiler={hide}
                spoilerButton={false}
                on:reply={({ detail }) => reply(detail)}
                on:changed={load}
                on:signUp={() => (signUp = true)}
              />
            {/each}
          </div>
        </section>
      {/if}
      {#if parts.feed.length}
        <section class="thread-section">
          <SectionHead
            number={comments.length ? 2 : 1}
            level="h3"
            title={$t$('community.feedPosts')}
            count={parts.feed.length}
          />
          <div class="thread-posts">
            {#each parts.feed as group (group.root.id)}
              <div class="thread-feed-post">
                <CommunityPost
                  post={group.root}
                  hideSpoiler={hide}
                  spoilerButton={false}
                  on:reply={({ detail }) => reply(detail)}
                  on:changed={load}
                  on:signUp={() => (signUp = true)}
                />
                <button
                  type="button"
                  class="app-button-quiet thread-open"
                  on:click={() => ((focus = group.root.id), (replyingTo = undefined))}
                  >{group.replies.length
                    ? $t$(
                        group.replies.length === 1 ? 'community.repliesOne' : 'community.replies',
                        { count: group.replies.length }
                      )
                    : $t$('community.reply')} →</button
                >
              </div>
            {/each}
          </div>
        </section>
      {/if}
    {/if}

    {#if signUp || !$socialSession$}
      {#if signUp}
        <CommunitySignup box on:close={() => (signUp = false)} />
      {/if}
    {:else if target}
      <form class="thread-reply" on:submit|preventDefault={send}>
        <textarea
          class="app-input"
          rows="2"
          maxlength={bodyLength}
          placeholder={$t$('community.replyTo', {
            name: replyingTo?.author?.name ?? root?.author?.name ?? ''
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

  .thread-section {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .thread-section .thread-posts {
    border-top: none;
  }

  .thread-feed-post {
    display: flex;
    flex-direction: column;
    padding-bottom: 0.75rem;
    border-bottom: 1px solid var(--c-rule, var(--border-color));
  }

  .thread-feed-post :global(.post) {
    padding-bottom: 0.25rem;
    border-bottom: none;
  }

  .thread-open {
    align-self: flex-start;
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
