<script lang="ts">
  import { browser } from '$app/env';
  import { goto } from '$app/navigation';
  import AppHeader from '$lib/components/app-header/app-header.svelte';
  import ImportMenu from '$lib/components/library/import-menu.svelte';
  import CommunityPlainComposer from '$lib/components/community/community-plain-composer.svelte';
  import CommunityNotes from '$lib/components/community/community-notes.svelte';
  import CommunitySignup from '$lib/components/community/community-signup.svelte';
  import CommunityText from '$lib/components/community/community-text.svelte';
  import CommunityThread from '$lib/components/community/community-thread.svelte';
  import CommunityWork from '$lib/components/community/community-work.svelte';
  import SocialAvatar from '$lib/components/social/social-avatar.svelte';
  import RoleBadge from '$lib/components/social/role-badge.svelte';
  import { isPlain, loadFeed, loadThread, type FeedPost } from '$lib/data/social/community';
  import { communityErrorKey, splitContext, threadPath } from '$lib/data/social/community-book';
  import { pagePath } from '$lib/data/env';
  import { setPendingImport, type PendingImport } from '$lib/data/library/library-home';
  import { page } from '$lib/data/page-store';
  import { relativeTime } from '$lib/functions/format-time';
  import { socialSession$ } from '$lib/data/social/social-account';
  import { removePost } from '$lib/data/social/social-moderation';
  import { t$, uiLanguage$ } from '$lib/i18n';
  import { activePlugins$ } from '$lib/plugins';
  import { onMount } from 'svelte';

  /**
   * Community (header tab, boards 9, 10, D9): lines readers are sharing, newest first, each with
   * the work's cover, title and volume. Signed out it reads the same feed (anonymous GETs, only
   * from here); a spoiler-marked post's line and text stay blurred until the reader taps Show
   * spoiler, its work's cover, title and volume shown. Signed in, a post box on top makes plain
   * posts (no book line: shown with the poster only). `?work=&line=` shows that line's thread (deep
   * links), `&post=` that feed post's discussion (the feed, Home's replies).
   */

  let posts: FeedPost[] = [];
  let next: string | null = null;
  let loading = false;
  let error = '';
  /** Spoiler posts the reader showed, by id: the quote follows the text's Show spoiler */
  let shown = new Set<string>();
  /** Show context: each row's line page, fetched once from its thread and kept for the page */
  let contexts = new Map<
    string,
    'loading' | 'error' | 'none' | { before: string; after: string }
  >();
  let contextOpen = new Set<string>();

  async function toggleContext(post: FeedPost) {
    const have = contexts.get(post.id);

    if (contextOpen.has(post.id) && have !== 'error') {
      contextOpen = new Set([...contextOpen].filter((id) => id !== post.id));
      return;
    }
    contextOpen = new Set([...contextOpen, post.id]);
    if (have && have !== 'error') return;
    contexts = new Map(contexts).set(post.id, 'loading');
    const value = await loadThread(post.work, post.line).then(
      (thread) => {
        const { before, after } = splitContext(thread.context, post.quote);

        return before || after ? { before, after } : ('none' as const);
      },
      () => 'error' as const
    );
    contexts = new Map(contexts).set(post.id, value);
  }

  $: socialOn = $activePlugins$.some((plugin) => plugin.id === 'social');
  $: work = browser ? ($page.url.searchParams.get('work') ?? '') : '';
  $: line = browser ? ($page.url.searchParams.get('line') ?? '') : '';
  $: focusPost = browser ? ($page.url.searchParams.get('post') ?? undefined) : undefined;

  async function more(first = false) {
    loading = true;
    error = '';
    try {
      const result = await loadFeed(first ? undefined : (next ?? undefined));

      posts = first ? result.posts : [...posts, ...result.posts];
      next = result.next;
    } catch (e) {
      error = $t$(communityErrorKey(e));
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    if (socialOn && !(work && line)) more(true);
  });

  /** Hub moderators remove any post (the hub checks the role) */
  $: dev = socialOn && $socialSession$?.me.role === 'dev';

  async function remove(post: FeedPost) {
    if (!window.confirm($t$('community.removeConfirm'))) return;
    try {
      await removePost(post.id);
      posts = posts.filter((item) => item.id !== post.id);
    } catch (e) {
      error = $t$(communityErrorKey(e));
    }
  }

  const openThread = (post: FeedPost) => goto(threadPath(post.work, post.line, post.id));

  function closeThread() {
    goto(`${pagePath}/community`);
    if (!posts.length) more(true);
  }

  function importOnManage(value: PendingImport) {
    setPendingImport(value);
    goto(`${pagePath}/manage`);
  }
</script>

<svelte:head><title>{$t$('nav.community')}</title></svelte:head>

<AppHeader active="community">
  <ImportMenu
    on:filesChange={(ev) => importOnManage({ files: Array.from(ev.detail) })}
    on:importBackup={(ev) => importOnManage({ backup: ev.detail })}
  />
</AppHeader>

<div class="app-page-shell">
  <main class="community">
    {#if !socialOn}
      <h1 class="community-title">{$t$('nav.community')}</h1>
      <p class="community-lead">{$t$('community.off')}</p>
      <a class="app-button" href="{pagePath}/settings?section=general#general-plugins"
        >{$t$('nav.settings')}</a
      >
    {:else if work && line}
      <div class="community-main">
        <!-- Keyed: the thread loads on mount, so another thread's link needs a fresh one -->
        {#key `${work} ${line} ${focusPost}`}<CommunityThread
            {work}
            {line}
            post={focusPost}
            backLabel={$t$('nav.community')}
            on:back={closeThread}
          />{/key}
      </div>
    {:else}
      <div class="community-main">
        {#if !$socialSession$}<CommunitySignup />{/if}
        <h1 class="community-title">{$t$('nav.community')}</h1>
        {#if $socialSession$}<CommunityPlainComposer onposted={() => more(true)} />{/if}

        <ol class="feed">
          {#each posts as post (post.id)}
            {@const hide = post.spoiler && !shown.has(post.id)}
            <li class="feed-post">
              {#if isPlain(post)}
                {#if post.spoiler}<span class="feed-spoiler">{$t$('community.spoiler')}</span>{/if}
              {:else}
                {@const context = contexts.get(post.id)}
                {@const open = contextOpen.has(post.id)}
                {@const lineContext = open && typeof context === 'object' ? context : undefined}
                <CommunityWork title={post.title} vol={post.vol} cover={post.cover}>
                  {#if post.spoiler}<span class="feed-spoiler">{$t$('community.spoiler')}</span
                    >{/if}
                </CommunityWork>
                <div class="feed-quote">
                  <CommunityText
                    text={post.quote}
                    quote
                    blur={hide}
                    button={false}
                    before={lineContext?.before ?? ''}
                    after={lineContext?.after ?? ''}
                  />
                  {#if open && context === 'none'}
                    <p class="feed-context-note">{$t$('community.contextNone')}</p>
                  {:else if context !== 'none'}
                    <button
                      type="button"
                      class="app-button-quiet feed-context"
                      disabled={context === 'loading'}
                      aria-expanded={!!lineContext}
                      on:click={() => toggleContext(post)}
                      >{$t$(
                        context === 'loading'
                          ? 'community.contextLoading'
                          : open && context === 'error'
                            ? 'community.contextError'
                            : lineContext
                              ? 'community.hideContext'
                              : 'community.showContext'
                      )}</button
                    >
                  {/if}
                </div>
              {/if}
              <CommunityText
                text={post.body}
                blur={post.spoiler}
                on:show={() => (shown = new Set([...shown, post.id]))}
              />
              <div class="feed-foot">
                {#if post.author}
                  <SocialAvatar avatar={post.author.avatar} person={post.author} size={1.5} />
                  <span class="feed-name">{post.author.name}</span><RoleBadge
                    role={post.author.role}
                  />
                {/if}
                <span class="feed-when">· {relativeTime(post.at, $uiLanguage$)}</span>
                {#if dev}
                  <button
                    type="button"
                    class="app-button-quiet feed-remove"
                    on:click={() => remove(post)}>{$t$('community.remove')}</button
                  >
                {/if}
                <button
                  type="button"
                  class="app-button-quiet feed-open"
                  on:click={() => openThread(post)}
                  >{post.replies
                    ? $t$(post.replies === 1 ? 'community.repliesOne' : 'community.replies', {
                        count: post.replies
                      })
                    : $t$('community.reply')}</button
                >
              </div>
            </li>
          {/each}
        </ol>

        {#if loading}
          <p class="community-quiet">{$t$('community.loading')}</p>
        {:else if error}
          <p class="community-quiet" role="alert">{error}</p>
          <button type="button" class="app-button" on:click={() => more(!posts.length)}
            >{$t$('community.tryAgain')}</button
          >
        {:else if !posts.length}
          <p class="community-quiet">{$t$('community.feedEmpty')}</p>
        {:else if next}
          <button type="button" class="app-button" on:click={() => more()}
            >{$t$('community.more')}</button
          >
        {/if}
      </div>
      <aside class="community-side">
        {#if $socialSession$}<CommunityNotes number={1} />{/if}
        <p class="community-quiet">{$t$('community.howToPost')}</p>
      </aside>
    {/if}
  </main>
</div>

<style>
  .community {
    display: grid;
    max-width: 75rem;
    grid-template-columns: minmax(0, 1fr);
    gap: 2.5rem 4rem;
    margin: 0 auto;
    padding: 6rem 1rem calc(5.5rem + env(safe-area-inset-bottom));
  }

  @media (min-width: 768px) {
    .community {
      padding: 6.5rem 2.5rem 4rem;
    }
  }

  @media (min-width: 1024px) {
    .community {
      grid-template-columns: minmax(0, 45rem) minmax(0, 1fr);
    }
  }

  .community-main {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 1rem;
  }

  .community-title {
    font-size: var(--type-display);
    font-weight: 400;
    line-height: 1.2;
  }

  .community-lead {
    margin-top: -0.75rem;
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }

  .community-quiet {
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }

  .community-side {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .feed {
    border-top: 2px solid var(--font-color);
  }

  .feed-post {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding: 1rem 0;
    border-bottom: 1px solid var(--border-color);
  }

  .feed-spoiler {
    align-self: flex-start;
    padding: 0 0.35em;
    border: 1px solid var(--font-color);
    border-radius: 2px;
    font-size: var(--type-label);
    line-height: 1.4;
  }

  .feed-quote {
    padding: 0.75rem;
    background: var(--surface-color);
  }

  .feed-context {
    margin-top: 0.5rem;
    font-size: var(--type-label);
  }

  .feed-context-note {
    margin-top: 0.5rem;
    color: var(--app-muted-fg);
    font-size: var(--type-label);
  }

  .feed-foot {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: var(--type-small);
  }

  .feed-name {
    font-weight: 700;
  }

  .feed-when {
    color: var(--app-muted-fg);
  }

  .feed-remove {
    margin-left: auto;
    color: var(--app-danger-color);
  }

  .feed-remove + .feed-open {
    margin-left: 1rem;
  }

  .feed-open {
    margin-left: auto;
    font-weight: 700;
  }
</style>
