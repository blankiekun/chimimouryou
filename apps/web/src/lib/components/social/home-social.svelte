<script lang="ts">
  import { browser } from '$app/env';
  import { pushState } from '$app/navigation';
  import { page } from '$lib/data/page-store';
  import ActivityFeed from '$lib/components/social/activity-feed.svelte';
  import FriendCover from '$lib/components/social/friend-cover.svelte';
  import ProfileLayer from '$lib/components/social/profile-layer.svelte';
  import type { BookCardProps } from '$lib/components/book-card/book-card-props';
  import CoverCard from '$lib/components/library/cover-card.svelte';
  import SectionHead from '$lib/components/section-head.svelte';
  import AddFriend from '$lib/components/social/add-friend.svelte';
  import BookTransfers from '$lib/components/social/book-transfers.svelte';
  import FriendRequests from '$lib/components/social/friend-requests.svelte';
  import FriendsList from '$lib/components/social/friends-list.svelte';
  import SocialAvatar from '$lib/components/social/social-avatar.svelte';
  import { pagePath } from '$lib/data/env';
  import {
    byLastRead,
    feed$,
    friends$,
    loadFeed,
    loadFriends,
    localCovers
  } from '$lib/data/social/social';
  import { hubDown$, socialSession$ } from '$lib/data/social/social-account';
  import { t$ } from '$lib/i18n';
  import { onDestroy, onMount } from 'svelte';

  /**
   * Community's friends part (its side column; once Home's, boards 13 and 14): Now reading
   * (friends' current books), Friends, activity, Requests and Add a friend, on phones one Friends
   * row linking to /friends. Signed in only (Community has its own sign-up). Hidden while the hub is over its
   * limit. New replies are the page's own section (community-notes.svelte).
   */
  export let number: number;

  const phoneQuery = browser ? window.matchMedia?.('(max-width: 639px)') : undefined;
  let phone = !!phoneQuery?.matches;
  const onQuery = (event: MediaQueryListEvent) => (phone = event.matches);

  phoneQuery?.addEventListener('change', onQuery);
  onDestroy(() => phoneQuery?.removeEventListener('change', onQuery));
  let covers: Map<string, { title: string; imagePath: string | Blob }> | undefined;

  onMount(() => {
    loadFriends();
    loadFeed();
    localCovers().then(
      (found) => (covers = found),
      () => {}
    );
  });

  $: list =
    $socialSession$ && $friends$?.user === $socialSession$.me.id ? $friends$.list : undefined;
  $: reading = byLastRead(list?.friends ?? [])
    .flatMap((friend) => friend.books.map((book) => ({ friend, book })))
    .slice(0, 12)
    .map(({ friend, book }, index) => ({
      friend,
      book,
      card: {
        id: -1 - index,
        imagePath: '',
        title: book.kind === 'hidden' ? $t$('social.readingSomething') : book.title,
        characters: 0,
        lastBookModified: 0,
        lastBookOpen: 0,
        lastBookmarkModified: 0,
        isPlaceholder: false,
        progress: book.pct
      } as BookCardProps,
      meta: `${friend.name} · ${Math.round(book.pct * 100)}%`
    }));
  $: hidden = $hubDown$ && !list;
  $: requestCount = list ? list.incoming.length : 0;
  $: requestsShown = !!list && list.incoming.length + list.outgoing.length > 0;
  $: events = $socialSession$ && $feed$?.user === $socialSession$.me.id ? $feed$.events : [];
  $: activityShown = events.length > 0;
  $: activityNumber = friendsNumber + 1;
  $: sideNumber = activityNumber + Number(activityShown);
  $: friendsNumber = number + Number(!!reading.length);
</script>

{#if !hidden && $socialSession$}
  <BookTransfers />
  {#if reading.length}
    <section class="home-social-reading" aria-labelledby="home-social-reading">
      <SectionHead id="home-social-reading" {number} title={$t$('social.nowReading')} />
      <div class="home-social-shelf">
        {#each reading as { friend, book, card, meta } (card.id + friend.id)}
          <CoverCard book={card} {meta} on:open={() => pushState('', { profile: friend.username })}>
            <svelte:fragment slot="cover">
              <FriendCover {book} {covers} avatar={friend.avatar} />
            </svelte:fragment>
            <span slot="badge" class="home-social-badge">
              <SocialAvatar
                avatar={friend.avatar}
                person={friend}
                size={1.75}
                label={friend.name}
              />
            </span>
          </CoverCard>
        {/each}
      </div>
    </section>
  {/if}

  {#if phone}
    <section class="home-social-compact" aria-labelledby="home-social-friends">
      <SectionHead
        id="home-social-friends"
        number={friendsNumber}
        title={$t$('social.friends')}
        count={list?.friends.length ?? 0}
      />
      {#if list?.friends.length}
        <span class="home-social-avatars">
          {#each byLastRead(list.friends).slice(0, 5) as friend (friend.id)}
            <SocialAvatar avatar={friend.avatar} person={friend} label={friend.name} />
          {/each}
          {#if list.friends.length > 5}
            <span class="home-social-more">+{list.friends.length - 5}</span>
          {/if}
        </span>
      {/if}
      <span class="home-social-links">
        {#if requestCount}
          <a class="app-button-quiet" href="{pagePath}/friends"
            >{$t$(requestCount === 1 ? 'social.requestCountOne' : 'social.requestCount', {
              count: requestCount
            })}</a
          >
          ·
        {/if}
        <a class="app-button-quiet" href="{pagePath}/friends#add-friend-heading"
          >{$t$('social.addFriend')}</a
        >
        ·
        <a class="app-button-quiet" href="{pagePath}/friends">{$t$('social.allFriends')} →</a>
      </span>
    </section>
    {#if activityShown}
      <ActivityFeed {events} number={activityNumber} limit={5} />
    {/if}
  {:else}
    <div class="home-social-pair">
      <div class="home-social-side">
        <FriendsList friends={list?.friends ?? []} number={friendsNumber} {covers} />
        {#if activityShown}
          <ActivityFeed {events} number={activityNumber} limit={8} />
        {/if}
      </div>
      <div class="home-social-side">
        {#if list && requestsShown}
          <FriendRequests {list} number={sideNumber} />
        {/if}
        <AddFriend number={sideNumber + Number(requestsShown)} />
      </div>
    </div>
  {/if}
{/if}

{#if $page.state.profile}
  <ProfileLayer
    username={$page.state.profile}
    {covers}
    back={$t$('nav.community')}
    on:close={() => history.back()}
  />
{/if}

<style>
  .home-social-reading,
  .home-social-compact {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 1rem;
  }

  .home-social-reading {
    gap: 1.5rem;
  }

  .home-social-shelf {
    display: grid;
    grid-auto-columns: var(--shelf-cover-width, 8.75rem);
    grid-auto-flow: column;
    gap: 2rem;
    overflow-x: auto;
    padding: 4px 4px 0.5rem;
    margin: -4px;
  }

  .home-social-badge {
    position: absolute;
    right: 0.4rem;
    bottom: 0.4rem;
    display: flex;
    border: 2px solid var(--background-color);
    border-radius: 50%;
  }

  /* Stacked: Community's side column is narrow */
  .home-social-pair,
  .home-social-side {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 2.5rem;
  }

  .home-social-avatars {
    display: flex;
    gap: 0.5rem;
  }

  .home-social-more {
    display: inline-flex;
    width: 2.5rem;
    height: 2.5rem;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--accent-color);
    border-radius: 50%;
    color: var(--accent-strong-color);
    font-size: var(--type-small);
    font-variant-numeric: tabular-nums;
  }

  .home-social-links {
    color: var(--app-muted-fg);
  }

  @media (max-width: 639px) {
    .home-social-shelf {
      gap: 1.5rem;
    }
  }
</style>
