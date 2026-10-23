<script lang="ts">
  import SectionHead from '$lib/components/section-head.svelte';
  import SocialAvatar from '$lib/components/social/social-avatar.svelte';
  import { pushState } from '$app/navigation';
  import FriendCover from '$lib/components/social/friend-cover.svelte';
  import {
    blockFriend,
    byLastRead,
    relativeTime,
    removeFriend,
    type Friend
  } from '$lib/data/social';
  import { hubErrorKey } from '$lib/data/social-account';
  import { t$, uiLanguage$ } from '$lib/i18n';

  /** Friends, the one they read last first: avatar, name, when, and the book they are on */
  export let friends: Friend[];
  export let number: number;
  /** Remove and Block on each row (the Friends page) */
  export let manage = false;
  /** Your own covers by book key */
  export let covers: Map<string, { title: string; imagePath: string | Blob }> | undefined =
    undefined;

  let error = '';
  let open = '';

  async function act(action: () => Promise<unknown>) {
    error = '';
    try {
      await action();
    } catch (e) {
      error = $t$(hubErrorKey(e));
    }
  }

  function confirmed(key: 'social.removeConfirm' | 'social.blockConfirm', name: string) {
    return window.confirm($t$(key, { name }));
  }
</script>

<section class="friends" aria-labelledby="friends-heading-{number}">
  <SectionHead
    id="friends-heading-{number}"
    {number}
    title={$t$('social.friends')}
    count={friends.length}
  />
  {#if friends.length}
    <ul class="friends-rows">
      {#each byLastRead(friends) as friend (friend.id)}
        {@const book = friend.books[0]}
        <li class="friends-row" class:friends-row-manage={manage}>
          <SocialAvatar avatar={friend.avatar} />
          <span class="friends-who">
            <button
              type="button"
              class="friends-name"
              on:click={() => pushState('', { profile: friend.username })}>{friend.name}</button
            >
            <small>
              {book
                ? $t$('social.readAgo', { when: relativeTime(book.readAt, $uiLanguage$) })
                : $t$('social.notReading')}
            </small>
          </span>
          {#if book}
            <span class="friends-book">
              <span class="friends-thumb"
                ><FriendCover {book} {covers} avatar={friend.avatar} small /></span
              >
              <span class="friends-book-text">
                <span class="friends-book-title" lang={book.kind === 'hidden' ? undefined : 'ja'}
                  >{book.kind === 'hidden' ? $t$('social.readingSomething') : book.title}</span
                >
                <span class="friends-progress">
                  <span class="friends-track" aria-hidden="true"
                    ><span style:width="{Math.round(book.pct * 100)}%" /></span
                  >
                  {Math.round(book.pct * 100)}%
                </span>
              </span>
            </span>
          {:else}
            <span />
          {/if}
          {#if manage}
            <span class="friends-manage">
              <button
                type="button"
                class="app-button-quiet"
                aria-expanded={open === friend.id}
                on:click={() => (open = open === friend.id ? '' : friend.id)}
              >
                {$t$('social.more')}
              </button>
              {#if open === friend.id}
                <button
                  type="button"
                  class="app-button"
                  on:click={() =>
                    confirmed('social.removeConfirm', friend.name) &&
                    act(() => removeFriend(friend.id))}
                >
                  {$t$('social.remove')}
                </button>
                <button
                  type="button"
                  class="app-button app-button-danger"
                  on:click={() =>
                    confirmed('social.blockConfirm', friend.name) &&
                    act(() => blockFriend(friend.id))}
                >
                  {$t$('social.block')}
                </button>
              {/if}
            </span>
          {/if}
        </li>
      {/each}
    </ul>
    {#if error}<p class="friends-error" role="alert">{error}</p>{/if}
  {:else}
    <p class="friends-empty">{$t$('social.emptyText')}</p>
  {/if}
</section>

<style>
  .friends {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 1rem;
  }

  .friends-rows {
    border-top: 2px solid var(--font-color);
  }

  .friends-row {
    display: grid;
    grid-template-columns: auto minmax(0, 10rem) minmax(0, 1fr);
    align-items: center;
    gap: 0.5rem 1rem;
    padding: 0.85rem 0;
    border-bottom: 1px solid var(--border-color);
  }

  .friends-who {
    display: flex;
    min-width: 0;
    flex-direction: column;
  }

  .friends-name {
    align-self: flex-start;
    max-width: 100%;
    overflow: hidden;
    font-weight: 700;
    text-align: start;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .friends-name:hover {
    color: var(--accent-strong-color);
    text-decoration: underline;
  }

  .friends-who small,
  .friends-empty {
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }

  .friends-book {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 0.75rem;
  }

  .friends-thumb {
    width: 2rem;
    flex: none;
  }

  .friends-book-text {
    display: flex;
    min-width: 0;
    flex: 1 1 auto;
    flex-direction: column;
    gap: 0.25rem;
  }

  .friends-book-title {
    overflow: hidden;
    font-size: var(--type-small);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .friends-progress {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    color: var(--app-muted-fg);
    font-size: var(--type-small);
    font-variant-numeric: tabular-nums;
  }

  .friends-track {
    display: block;
    width: 8rem;
    max-width: 60%;
    height: 3px;
    background: var(--app-progress-track);
  }

  .friends-track > span {
    display: block;
    height: 100%;
    background: var(--app-progress-fill);
  }

  .friends-row-manage {
    grid-template-columns: auto minmax(0, 10rem) minmax(0, 1fr) auto;
  }

  .friends-manage {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: 0.5rem;
  }

  .friends-error {
    color: var(--app-danger-color);
    font-size: var(--type-small);
  }

  @media (max-width: 639px) {
    .friends-row,
    .friends-row-manage {
      grid-template-columns: auto minmax(0, 1fr) auto;
    }

    .friends-book {
      grid-column: 2 / -1;
      grid-row: 2;
    }
  }
</style>
