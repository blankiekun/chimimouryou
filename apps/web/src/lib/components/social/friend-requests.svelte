<script lang="ts">
  import SectionHead from '$lib/components/section-head.svelte';
  import RoleBadge from '$lib/components/social/role-badge.svelte';
  import SocialAvatar from '$lib/components/social/social-avatar.svelte';
  import { relativeTime } from '$lib/functions/format-time';
  import { acceptFriend, removeFriend, type FriendsList } from '$lib/data/social/social';
  import { formatCode, hubErrorKey } from '$lib/data/social/social-account';
  import { t$, uiLanguage$ } from '$lib/i18n';

  /** Incoming requests (Accept / Decline) and sent ones (Cancel) */
  export let list: FriendsList;
  export let number: number;

  let error = '';
  let busy = false;

  async function act(action: () => Promise<unknown>) {
    error = '';
    busy = true;
    try {
      await action();
    } catch (e) {
      error = $t$(hubErrorKey(e));
    }
    busy = false;
  }
</script>

{#if list.incoming.length || list.outgoing.length}
  <section class="requests" aria-labelledby="requests-heading">
    <SectionHead
      id="requests-heading"
      {number}
      title={$t$('social.requests')}
      count={list.incoming.length + list.outgoing.length}
    />
    <ul class="requests-rows">
      {#each list.incoming as request (request.id)}
        <li class="requests-row">
          <SocialAvatar avatar={request.avatar} person={request} />
          <span class="requests-text">
            <strong>{request.name}<RoleBadge role={request.role} /></strong>
            <small
              >{$t$('social.wantsFriends', {
                when: relativeTime(request.at, $uiLanguage$)
              })}</small
            >
            <span class="requests-actions">
              <button
                type="button"
                class="app-button app-button-primary"
                disabled={busy}
                on:click={() => act(() => acceptFriend(request.id))}
              >
                {$t$('social.accept')}
              </button>
              <button
                type="button"
                class="app-button"
                disabled={busy}
                on:click={() => act(() => removeFriend(request.id))}
              >
                {$t$('social.decline')}
              </button>
            </span>
          </span>
        </li>
      {/each}
      {#each list.outgoing as request (request.id)}
        <li class="requests-row requests-sent">
          <span class="requests-text">
            <strong class="requests-code"
              >{request.code.startsWith('@') ? request.code : formatCode(request.code)}</strong
            >
            <small
              >{$t$('social.sentWaiting', { when: relativeTime(request.at, $uiLanguage$) })}</small
            >
          </span>
          <button
            type="button"
            class="app-button app-button-quiet"
            disabled={busy}
            on:click={() => act(() => removeFriend(request.id))}
          >
            {$t$('social.cancel')}
          </button>
        </li>
      {/each}
    </ul>
    {#if error}<p class="requests-error" role="alert">{error}</p>{/if}
  </section>
{/if}

<style>
  .requests {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 1rem;
  }

  .requests-rows {
    border-top: 2px solid var(--font-color);
  }

  .requests-row {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    padding: 0.85rem 0;
    border-bottom: 1px solid var(--border-color);
  }

  .requests-sent {
    align-items: center;
    justify-content: space-between;
  }

  .requests-text {
    display: flex;
    min-width: 0;
    flex-direction: column;
  }

  .requests-text small {
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }

  .requests-code {
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.04em;
  }

  .requests-actions {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.5rem;
  }

  .requests-error {
    color: var(--app-danger-color);
    font-size: var(--type-small);
  }
</style>
