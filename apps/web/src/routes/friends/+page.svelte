<script lang="ts">
  import { browser } from '$app/environment';
  import { page } from '$app/stores';
  import AppHeader from '$lib/components/app-header/app-header.svelte';
  import ActivityFeed from '$lib/components/social/activity-feed.svelte';
  import AddFriend from '$lib/components/social/add-friend.svelte';
  import FriendRequests from '$lib/components/social/friend-requests.svelte';
  import FriendsList from '$lib/components/social/friends-list.svelte';
  import ProfileLayer from '$lib/components/social/profile-layer.svelte';
  import SocialAccountForm from '$lib/components/social/social-account-form.svelte';
  import { pushState } from '$app/navigation';
  import { pagePath } from '$lib/data/env';
  import { libraryTab$ } from '$lib/data/library-home';
  import {
    feed$,
    friends$,
    loadFeed,
    loadFriends,
    localCovers,
    requestByUsername
  } from '$lib/data/social';
  import { hubDown$, hubErrorKey, socialSession$ } from '$lib/data/social-account';
  import { t$ } from '$lib/i18n';
  import { activePlugins$ } from '$lib/plugins';
  import { onMount } from 'svelte';

  /**
   * Friends, a drill-in from Home's Social section (Home stays the lit tab): sign up or log in
   * on first open, then friends, activity, requests and Add a friend. /friends?add=CODE fills
   * in the code; /friends?user=NAME (Add friend on a public profile) offers that request.
   */

  // Kept while the form shows the recovery code, which comes after the session.
  let onboarding = false;
  let covers: Map<string, { title: string; imagePath: string | Blob }> | undefined;
  let userNote = '';

  $: socialOn = $activePlugins$.some((plugin) => plugin.id === 'social');
  $: addCode = browser ? ($page.url.searchParams.get('add') ?? '') : '';
  $: addUser = browser ? ($page.url.searchParams.get('user') ?? '') : '';
  $: mode = (browser && $page.url.searchParams.get('mode') === 'login' ? 'login' : 'signup') as
    | 'login'
    | 'signup';
  $: if (!$socialSession$) onboarding = true;
  $: if ($socialSession$ && !onboarding) {
    loadFriends();
    loadFeed();
  }
  $: list =
    $socialSession$ && $friends$?.user === $socialSession$.me.id ? $friends$.list : undefined;
  $: events = $socialSession$ && $feed$?.user === $socialSession$.me.id ? $feed$.events : [];
  $: empty = !!list && !list.friends.length && !list.incoming.length && !list.outgoing.length;
  $: requestsShown = !!list && list.incoming.length + list.outgoing.length > 0;
  $: sideNumber = empty ? 1 : 2 + Number(!!events.length);

  onMount(() => {
    $libraryTab$ = 'home';
    localCovers().then(
      (found) => (covers = found),
      () => {}
    );
  });

  async function sendToUser() {
    userNote = '';
    try {
      await requestByUsername(addUser);
      userNote = $t$('social.requestSentTo', { name: `@${addUser}` });
    } catch (e) {
      userNote = $t$(hubErrorKey(e));
    }
  }
</script>

<AppHeader active="library" />

<div class="app-page-shell">
  <main class="friends-page">
    <a class="app-button-quiet friends-back" href="{pagePath}/manage">← {$t$('nav.home')}</a>

    {#if !socialOn}
      <h1 class="friends-title">{$t$('social.friends')}</h1>
      <p class="friends-lead">{$t$('social.offText')}</p>
      <a
        class="app-button friends-settings"
        href="{pagePath}/settings?section=general#general-plugins">{$t$('nav.settings')}</a
      >
    {:else if !$socialSession$ || onboarding}
      <SocialAccountForm {mode} on:done={() => (onboarding = false)} />
    {:else}
      <header class="friends-header">
        <div>
          <h1 class="friends-title">{$t$('social.friends')}</h1>
          <p class="friends-lead">{$t$(empty ? 'social.emptyLead' : 'social.lead')}</p>
        </div>
        <button
          type="button"
          class="app-button"
          on:click={() => pushState('', { profile: $socialSession$?.me.username })}
          >{$t$('social.yourProfile')}</button
        >
      </header>
      {#if $hubDown$}
        <p class="friends-note" role="status">{$t$('social.hubDown')}</p>
      {/if}
      {#if addUser && addUser.toLowerCase() !== $socialSession$.me.username.toLowerCase()}
        <p class="friends-user">
          <button type="button" class="app-button app-button-primary" on:click={sendToUser}
            >{$t$('social.sendRequestTo', { name: `@${addUser}` })}</button
          >
          {#if userNote}<span role="status">{userNote}</span>{/if}
        </p>
      {/if}
      <div class="friends-columns">
        {#if !empty}
          <div class="friends-main">
            <FriendsList friends={list?.friends ?? []} number={1} manage {covers} />
            {#if events.length}
              <ActivityFeed {events} number={2} />
            {/if}
          </div>
        {/if}
        <div class="friends-side">
          {#if list && requestsShown}
            <FriendRequests {list} number={sideNumber} />
          {/if}
          <AddFriend number={sideNumber + Number(requestsShown)} initialCode={addCode} />
        </div>
      </div>
    {/if}
  </main>
</div>

{#if $page.state.profile && $socialSession$}
  <ProfileLayer
    username={$page.state.profile}
    {covers}
    back={$t$('social.friends')}
    on:close={() => history.back()}
  />
{/if}

<style>
  .friends-page {
    display: flex;
    max-width: 75rem;
    flex-direction: column;
    gap: 2rem;
    margin: 0 auto;
    padding: 5.5rem 1rem calc(5.5rem + env(safe-area-inset-bottom));
  }

  @media (min-width: 768px) {
    .friends-page {
      padding: 6rem 2.5rem 4rem;
    }
  }

  .friends-back,
  .friends-settings {
    align-self: flex-start;
  }

  .friends-title {
    font-size: var(--type-display);
    font-weight: 400;
    line-height: 1.2;
  }

  .friends-lead {
    max-width: 36rem;
    margin-top: 0.25rem;
    color: var(--app-muted-fg);
  }

  .friends-note {
    padding: 0.75rem 1rem;
    background: var(--surface-color);
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }

  .friends-columns {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 2.5rem 3rem;
    align-items: start;
  }

  .friends-header {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    justify-content: space-between;
    gap: 1rem;
  }

  .friends-user {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 1rem;
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }

  .friends-main,
  .friends-side {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 2.5rem;
  }

  @media (min-width: 1024px) {
    .friends-columns {
      grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr);
    }

    .friends-side:only-child {
      max-width: 30rem;
    }
  }
</style>
