<script lang="ts">
  import RoleBadge from '$lib/components/social/role-badge.svelte';
  import SocialAvatar from '$lib/components/social/social-avatar.svelte';
  import {
    bookKey,
    friends$,
    friendsWithBook,
    hiddenBooks$,
    monthName,
    setBookHidden
  } from '$lib/data/social';
  import { socialSession$ } from '$lib/data/social-account';
  import { t$, uiLanguage$ } from '$lib/i18n';
  import { activePlugins$ } from '$lib/plugins';

  /**
   * The book page's social parts (board 15), from the cached friends list (no fetch):
   * `friends` is the Friends row under the progress ("Aki · 62%", "Ren · finished in March"),
   * `hide` the "Hide from friends" switch under the buttons.
   */
  export let title: string;
  export let part: 'friends' | 'hide';

  $: on = $activePlugins$.some((plugin) => plugin.id === 'social') && !!$socialSession$;
  $: list = on && $friends$?.user === $socialSession$?.me.id ? $friends$?.list : undefined;
  $: rows = list ? friendsWithBook(list.friends, title) : [];
  $: hidden = $hiddenBooks$.includes(bookKey(title));
</script>

{#if on && part === 'friends' && rows.length}
  <div class="book-friends">
    <h2 class="book-friends-title">{$t$('social.friends')}</h2>
    <ul>
      {#each rows.slice(0, 5) as { friend, pct, month } (friend.id)}
        <li>
          <SocialAvatar avatar={friend.avatar} person={friend} size={1.5} />
          <span>
            {friend.name}<RoleBadge role={friend.role} /> ·
            {month
              ? $t$('social.finishedMonth', { month: monthName(month, $uiLanguage$) })
              : `${Math.round(pct * 100)}%`}
          </span>
        </li>
      {/each}
    </ul>
  </div>
{:else if on && part === 'hide'}
  <div class="book-hide">
    <span class="book-hide-text">
      <span id="book-hide-label">{$t$('social.hideFromFriends')}</span>
      <small>{$t$('social.hideFromFriendsHint')}</small>
    </span>
    <button
      type="button"
      role="switch"
      class="app-switch"
      aria-checked={hidden}
      aria-labelledby="book-hide-label"
      on:click={() => setBookHidden(title, !hidden)}
    >
      <span class="app-switch-thumb" />
      <span class="app-switch-text">{$t$(hidden ? 'settings.on' : 'settings.off')}</span>
    </button>
  </div>
{/if}

<style>
  .book-friends {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .book-friends-title {
    color: var(--app-muted-fg);
    font-size: var(--type-small);
    font-weight: 400;
  }

  .book-friends ul {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .book-friends li {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: var(--type-small);
    font-variant-numeric: tabular-nums;
  }

  .book-hide {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding-top: 1rem;
    border-top: 1px solid var(--border-color);
  }

  .book-hide-text {
    display: flex;
    flex-direction: column;
  }

  .book-hide-text small {
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }
</style>
