<script lang="ts">
  import RankBadge from '$lib/components/reading-rank/rank-badge.svelte';
  import RoleBadge from '$lib/components/social/role-badge.svelte';
  import SocialAvatar from '$lib/components/social/social-avatar.svelte';
  import CommunityMentions from '$lib/components/community/community-mentions.svelte';
  import CommunityText from '$lib/components/community/community-text.svelte';
  import {
    bodyLength,
    deletePost,
    editPost,
    markHelpful,
    reportPost,
    type CommunityPost
  } from '$lib/data/social/community';
  import { communityErrorKey } from '$lib/data/social/community-book';
  import { relativeTime } from '$lib/functions/format-time';
  import { blockFriend } from '$lib/data/social/social';
  import { socialSession$ } from '$lib/data/social/social-account';
  import { removePost, removeUserPosts } from '$lib/data/social/social-moderation';
  import { t$, uiLanguage$ } from '$lib/i18n';
  import { createEventDispatcher } from 'svelte';

  /**
   * One post of a thread (board 4): avatar, name, rank and words known, the text (plain), and
   * Helpful (replies only) and Reply; ••• has Report and Block, or Edit and Delete on one's own.
   * A deleted post with replies stays as a quiet "This post was deleted." row. A spoiler-marked
   * post's text stays blurred until its own Show spoiler.
   */
  export let post: CommunityPost;
  /** Off in a line's list of feed posts, where "Reply →" opens the post's discussion */
  export let replyable = true;

  const dispatch = createEventDispatcher<{
    reply: CommunityPost;
    changed: void;
    /** Signed out: Reply, Helpful and Report ask to sign up */
    signUp: void;
  }>();

  let menuOpen = false;
  let editing = false;
  let draft = '';
  let draftSpoiler = false;
  let error = '';
  let note = '';
  let busy = false;
  let editBox: HTMLTextAreaElement | undefined;

  $: signedIn = !!$socialSession$;
  /** Hub moderators remove any post here (the hub checks the role) */
  $: dev = $socialSession$?.me.role === 'dev';
  $: author = post.author;
  $: words = author?.level?.wordsKnown;

  async function act(action: () => Promise<unknown>, done?: () => void) {
    if (!signedIn) {
      dispatch('signUp');
      return;
    }
    error = '';
    busy = true;
    try {
      await action();
      done?.();
    } catch (e) {
      error = $t$(communityErrorKey(e));
    } finally {
      busy = false;
      menuOpen = false;
    }
  }

  function startEdit() {
    draft = post.body;
    draftSpoiler = post.spoiler;
    editing = true;
    menuOpen = false;
  }

  const saveEdit = () =>
    act(
      () => editPost(post.id, draft.trim(), draftSpoiler),
      () => {
        editing = false;
        dispatch('changed');
      }
    );

  function remove() {
    if (window.confirm($t$('community.deleteConfirm'))) {
      act(
        () => deletePost(post.id),
        () => dispatch('changed')
      );
    }
  }

  function moderate(
    task: () => Promise<void>,
    confirm: 'community.removeConfirm' | 'community.removeAllConfirm'
  ) {
    if (author && window.confirm($t$(confirm, { name: author.name }))) {
      act(task, () => dispatch('changed'));
    }
  }

  function report() {
    if (window.confirm($t$('community.reportConfirm'))) {
      act(
        () => reportPost(post.id),
        () => (note = $t$('social.reported'))
      );
    }
  }

  function block() {
    if (author && window.confirm($t$('social.blockConfirm', { name: author.name }))) {
      act(
        () => blockFriend(author.id),
        () => dispatch('changed')
      );
    }
  }
</script>

{#if !author}
  <div class="post post-deleted">
    <span class="post-deleted-mark" aria-hidden="true" />
    {$t$('community.deleted')}
  </div>
{:else}
  <article class="post">
    <SocialAvatar avatar={author.avatar} person={author} size={2} />
    <div class="post-main">
      <header class="post-head">
        <span class="post-name">{author.name}</span><RoleBadge role={author.role} />
        <span class="post-when">· {relativeTime(post.at, $uiLanguage$)}</span>
        {#if post.edited}<span class="post-when">· {$t$('community.edited')}</span>{/if}
        {#if post.spoiler}<span class="post-spoiler-tag">{$t$('community.spoiler')}</span>{/if}
        <span class="post-menu">
          <button
            type="button"
            class="post-menu-button"
            aria-label={$t$('community.more')}
            aria-expanded={menuOpen}
            on:click={() => (menuOpen = !menuOpen)}>•••</button
          >
          {#if menuOpen}
            <div class="post-menu-panel app-popover-panel" role="menu">
              {#if post.mine}
                <button type="button" class="app-popover-item" role="menuitem" on:click={startEdit}
                  >{$t$('community.edit')}</button
                >
                <button type="button" class="app-popover-item" role="menuitem" on:click={remove}
                  >{$t$('community.delete')}</button
                >
              {:else}
                <button type="button" class="app-popover-item" role="menuitem" on:click={report}
                  >{$t$('community.report')}</button
                >
                <button type="button" class="app-popover-item" role="menuitem" on:click={block}
                  >{$t$('community.blockName', { name: author.name })}</button
                >
              {/if}
              {#if dev}
                <button
                  type="button"
                  class="app-popover-item post-danger"
                  role="menuitem"
                  on:click={() => moderate(() => removePost(post.id), 'community.removeConfirm')}
                  >{$t$('community.remove')}</button
                >
                <button
                  type="button"
                  class="app-popover-item post-danger"
                  role="menuitem"
                  on:click={() =>
                    author &&
                    moderate(() => removeUserPosts(author.id), 'community.removeAllConfirm')}
                  >{$t$('community.removeAll', { name: author.name })}</button
                >
              {/if}
            </div>
          {/if}
        </span>
      </header>
      {#if author.level?.rank || words}
        <p class="post-level">
          {#if author.level?.rank}<RankBadge
              tier={author.level.rank}
              step={author.level.step}
              small
            />{/if}
          {#if words}<span
              >{$t$('community.wordsKnown', { count: words.toLocaleString('en-US') })}</span
            >{/if}
        </p>
      {/if}

      {#if editing}
        <textarea
          class="app-input post-edit"
          rows="4"
          maxlength={bodyLength}
          aria-label={$t$('community.edit')}
          bind:this={editBox}
          bind:value={draft}
        />
        <CommunityMentions textarea={editBox} />
        <label class="post-edit-spoiler">
          <input type="checkbox" bind:checked={draftSpoiler} />
          {$t$('community.spoiler')}
        </label>
        <div class="post-actions">
          <button
            type="button"
            class="app-button app-button-primary"
            disabled={busy || !draft.trim()}
            on:click={saveEdit}>{$t$('community.save')}</button
          >
          <button type="button" class="app-button" on:click={() => (editing = false)}
            >{$t$('social.cancel')}</button
          >
        </div>
      {:else}
        <CommunityText text={post.body} blur={post.spoiler} on:show />
        <div class="post-actions">
          {#if post.parent && !post.mine}
            <button
              type="button"
              class="post-helpful"
              class:post-helpful-on={post.voted}
              aria-pressed={post.voted}
              disabled={busy}
              on:click={() =>
                act(
                  () => markHelpful(post.id, !post.voted),
                  () => dispatch('changed')
                )}
            >
              {$t$('community.helpful')}{#if post.helpful}&nbsp;{post.helpful}{/if}
            </button>
          {:else if post.parent && post.helpful}
            <span class="post-helpful-count"
              >{$t$('community.helpfulCount', { count: post.helpful })}</span
            >
          {/if}
          {#if replyable}
            <button
              type="button"
              class="app-button-quiet"
              on:click={() => (signedIn ? dispatch('reply', post) : dispatch('signUp'))}
              >{$t$('community.reply')}</button
            >
          {/if}
        </div>
      {/if}
      {#if error}<p class="post-error" role="alert">{error}</p>{/if}
      {#if note}<p class="post-note" role="status">{note}</p>{/if}
    </div>
  </article>
{/if}

<style>
  .post {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 0.75rem;
    padding: 1rem 0;
    border-bottom: 1px solid var(--c-rule, var(--border-color));
  }

  .post-main {
    min-width: 0;
  }

  .post-head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0 0.35rem;
  }

  .post-name {
    font-weight: 700;
  }

  .post-when {
    color: var(--c-muted, var(--app-muted-fg));
    font-size: var(--type-small);
  }

  .post-spoiler-tag {
    padding: 0 0.35em;
    border: 1px solid var(--c-ink, var(--font-color));
    border-radius: 2px;
    font-size: var(--type-label);
    line-height: 1.4;
  }

  .post-menu {
    position: relative;
    margin-left: auto;
  }

  .post-menu-button {
    min-width: 2.75rem;
    min-height: 2rem;
    color: var(--c-muted, var(--app-muted-fg));
    letter-spacing: 0.08em;
  }

  .post-menu-panel {
    position: absolute;
    top: 100%;
    right: 0;
    z-index: 5;
  }

  .post-danger {
    color: var(--app-danger-color);
  }

  .post-level {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    margin-top: 0.2rem;
    color: var(--c-muted, var(--app-muted-fg));
    font-size: var(--type-small);
    font-variant-numeric: tabular-nums;
  }

  .post-actions {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin-top: 0.5rem;
  }

  .post-helpful {
    min-height: 2rem;
    padding: 0 0.6rem;
    border: 1px solid var(--c-ink, var(--font-color));
    border-radius: 2px;
    font-size: var(--type-button);
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  .post-helpful-on {
    border-color: var(--accent-color);
    background: var(--app-spot-tint);
    color: var(--accent-strong-color);
  }

  .post-helpful-count {
    color: var(--accent-strong-color);
    font-size: var(--type-small);
    font-weight: 700;
  }

  .post-edit {
    width: 100%;
    margin-top: 0.5rem;
    resize: vertical;
  }

  .post-edit-spoiler {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-top: 0.5rem;
  }

  .post-error {
    margin-top: 0.4rem;
    color: var(--app-danger-color);
    font-size: var(--type-small);
  }

  .post-note {
    margin-top: 0.4rem;
    color: var(--c-muted, var(--app-muted-fg));
    font-size: var(--type-small);
  }

  .post-deleted {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 1rem 0;
    border-bottom: 1px solid var(--c-rule, var(--border-color));
    color: var(--c-muted, var(--app-muted-fg));
    font-size: var(--type-small);
  }

  .post-deleted-mark {
    width: 1.5rem;
    height: 1.5rem;
    border: 1px solid var(--c-rule, var(--border-color));
    border-radius: 2px;
  }
</style>
