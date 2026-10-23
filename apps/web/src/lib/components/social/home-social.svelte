<script lang="ts">
  import { browser } from '$app/environment';
  import { pushState } from '$app/navigation';
  import { page } from '$app/stores';
  import ActivityFeed from '$lib/components/social/activity-feed.svelte';
  import FriendCover from '$lib/components/social/friend-cover.svelte';
  import ProfileLayer from '$lib/components/social/profile-layer.svelte';
  import type { BookCardProps } from '$lib/components/book-card/book-card-props';
  import CoverCard from '$lib/components/book-card/cover-card.svelte';
  import SectionHead from '$lib/components/section-head.svelte';
  import AddFriend from '$lib/components/social/add-friend.svelte';
  import FriendRequests from '$lib/components/social/friend-requests.svelte';
  import FriendsList from '$lib/components/social/friends-list.svelte';
  import SocialAvatar from '$lib/components/social/social-avatar.svelte';
  import { pagePath } from '$lib/data/env';
  import { bookKey, byLastRead, feed$, friends$, loadFeed, loadFriends } from '$lib/data/social';
  import { hubDown$, socialSession$ } from '$lib/data/social-account';
  import { t$ } from '$lib/i18n';
  import { createEventDispatcher, onDestroy, onMount } from 'svelte';

  /**
   * Home's social part (boards 13 and 14): Now reading (friends' current books), then on larger
   * screens Friends, Requests and Add a friend, on phones one Friends row linking to /friends.
   * Signed out it offers signing up. Hidden while the hub is over its limit.
   */
  export let books: BookCardProps[];
  export let number: number;
  /** How many numbered sections this shows, for the ones after it */
  export let sections = 0;

  const dispatch = createEventDispatcher<{ bookClick: { id: number } }>();
  const phoneQuery = browser ? window.matchMedia?.('(max-width: 639px)') : undefined;
  let phone = !!phoneQuery?.matches;
  const onQuery = (event: MediaQueryListEvent) => (phone = event.matches);

  phoneQuery?.addEventListener('change', onQuery);
  onDestroy(() => phoneQuery?.removeEventListener('change', onQuery));
  onMount(() => {
    loadFriends();
    loadFeed();
  });

  $: list =
    $socialSession$ && $friends$?.user === $socialSession$.me.id ? $friends$.list : undefined;
  $: owned = new Map(books.map((book) => [bookKey(book.title), book]));
  $: covers = new Map(
    books.map((book) => [bookKey(book.title), { title: book.title, imagePath: book.imagePath }])
  );
  $: reading = byLastRead(list?.friends ?? [])
    .flatMap((friend) => friend.books.map((book) => ({ friend, book })))
    .slice(0, 12)
    .map(({ friend, book }, index) => {
      const mine = book.kind === 'hidden' ? undefined : owned.get(book.key);

      return {
        friend,
        mine,
        book,
        card: {
          ...(mine ?? {
            id: -1 - index,
            imagePath: '',
            title: book.kind === 'hidden' ? $t$('social.readingSomething') : book.title,
            characters: 0,
            lastBookModified: 0,
            lastBookOpen: 0,
            lastBookmarkModified: 0,
            isPlaceholder: false
          }),
          progress: book.pct
        } as BookCardProps,
        meta: `${friend.name} · ${Math.round(book.pct * 100)}%`
      };
    });
  $: hidden = $hubDown$ && !list;
  $: requestCount = list ? list.incoming.length : 0;
  $: requestsShown = !!list && list.incoming.length + list.outgoing.length > 0;
  // Now reading, then Friends alone on phones, or Friends, Requests and Add a friend.
  $: sections = hidden
    ? 0
    : !$socialSession$
      ? 1
      : Number(!!reading.length) +
        Number(!!events.length) +
        (phone ? 1 : 2 + Number(requestsShown));
  $: events = $socialSession$ && $feed$?.user === $socialSession$.me.id ? $feed$.events : [];
  $: activityNumber = friendsNumber + 1;
  $: sideNumber = activityNumber + Number(!!events.length);
  $: friendsNumber = number + Number(!!reading.length);
</script>

{#if !hidden}
  {#if !$socialSession$}
    <section class="home-social-start" aria-labelledby="home-social-start">
      <SectionHead id="home-social-start" {number} title={$t$('social.friends')} />
      <p>{$t$('social.homeSignUp')}</p>
      <a class="app-button app-button-primary" href="{pagePath}/friends">
        {$t$('social.signUpOrLogIn')}
      </a>
    </section>
  {:else}
    {#if reading.length}
      <section class="home-social-reading" aria-labelledby="home-social-reading">
        <SectionHead id="home-social-reading" {number} title={$t$('social.nowReading')} />
        <div class="home-social-shelf">
          {#each reading as { friend, mine, book, card, meta } (card.id + friend.id)}
            <CoverCard
              book={card}
              {meta}
              on:open={() =>
                mine
                  ? dispatch('bookClick', { id: mine.id })
                  : pushState('', { profile: friend.username })}
            >
              <svelte:fragment slot="cover">
                <FriendCover {book} {covers} avatar={friend.avatar} />
              </svelte:fragment>
              <span slot="badge" class="home-social-badge">
                <SocialAvatar avatar={friend.avatar} size={1.75} label={friend.name} />
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
              <SocialAvatar avatar={friend.avatar} label={friend.name} />
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
      {#if events.length}
        <ActivityFeed {events} number={activityNumber} limit={5} />
      {/if}
    {:else}
      <div class="home-social-pair">
        <div class="home-social-side">
          <FriendsList friends={list?.friends ?? []} number={friendsNumber} {covers} />
          {#if events.length}
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
{/if}

{#if $page.state.profile}
  <ProfileLayer
    username={$page.state.profile}
    {covers}
    back={$t$('nav.home')}
    on:close={() => history.back()}
  />
{/if}

<style>
  .home-social-start,
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

  .home-social-start p {
    color: var(--app-muted-fg);
  }

  .home-social-start a {
    align-self: flex-start;
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

  .home-social-pair {
    display: grid;
    grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr);
    gap: 3rem;
    align-items: start;
  }

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

  @media (max-width: 1023px) {
    .home-social-pair {
      grid-template-columns: minmax(0, 1fr);
    }
  }

  @media (max-width: 639px) {
    .home-social-shelf {
      gap: 1.5rem;
    }
  }
</style>
