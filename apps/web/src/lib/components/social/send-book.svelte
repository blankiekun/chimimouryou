<script lang="ts">
  import TransferRow from '$lib/components/social/transfer-row.svelte';
  import { TransferError } from '$lib/data/book-transfer-channel';
  import { bookToSend, sendBook, transfers$ } from '$lib/data/book-transfer';
  import { friends$, loadFriends } from '$lib/data/social';
  import { HubError, socialSession$ } from '$lib/data/social-account';
  import { t$ } from '$lib/i18n';
  import { activePlugins$ } from '$lib/plugins';

  /**
   * The book page's "Send to a friend": choose a friend, then the book goes from this browser to
   * theirs over WebRTC (book-transfer.ts). Not for visual novels (too big for now).
   */
  export let title: string;
  export let vn = false;

  let open = false;
  let friendId = '';
  let error = '';
  let busy = false;

  $: on = $activePlugins$.some((plugin) => plugin.id === 'social') && !!$socialSession$;
  $: friends =
    on && $friends$?.user === $socialSession$?.me.id ? ($friends$?.list.friends ?? []) : [];
  $: if (!friendId && friends.length) friendId = friends[0].id;
  $: shown = $transfers$.filter((one) => one.direction === 'send' && one.title === title);

  function toggle() {
    open = !open;
    error = '';
    if (open) loadFriends();
  }

  async function send() {
    const friend = friends.find((one) => one.id === friendId);

    if (!friend) return;
    error = '';
    busy = true;
    try {
      // Checked first, so a book that can't go never makes a request on the hub.
      await bookToSend(title);
      open = false;
      sendBook(title, friend).catch(showError);
    } catch (e) {
      showError(e);
    }
    busy = false;
  }

  function showError(e: unknown) {
    const reason =
      e instanceof TransferError
        ? e.reason
        : e instanceof HubError
          ? ({ 409: 'busy', 429: 'limit', 403: 'friend', 413: 'tooBig' } as Record<number, string>)[
              e.status
            ]
          : '';

    error = $t$(`transfer.error.${reason || 'other'}` as 'transfer.error.other', { name: '' });
  }
</script>

{#if on}
  <div class="send-book">
    {#if vn}
      <p class="send-book-note">{$t$('transfer.error.vn')}</p>
    {:else}
      <button type="button" class="app-button" aria-expanded={open} on:click={toggle}>
        {$t$('transfer.send')}
      </button>
      {#if open}
        <div class="send-book-form">
          <p class="send-book-note">{$t$('transfer.sendHint')}</p>
          {#if friends.length}
            <label class="send-book-field">
              <span>{$t$('transfer.friend')}</span>
              <select class="app-input" bind:value={friendId}>
                {#each friends as friend (friend.id)}
                  <option value={friend.id}>{friend.name} (@{friend.username})</option>
                {/each}
              </select>
            </label>
            <button
              type="button"
              class="app-button app-button-primary"
              disabled={busy || !friendId}
              on:click={send}>{$t$('transfer.sendButton')}</button
            >
          {:else}
            <p class="send-book-note">{$t$('transfer.noFriends')}</p>
          {/if}
        </div>
      {/if}
    {/if}
    {#if error}<p class="send-book-error" role="alert">{error}</p>{/if}
    {#each shown as transfer (transfer.id)}
      <TransferRow {transfer} />
    {/each}
  </div>
{/if}

<style>
  .send-book {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding-top: 1rem;
    border-top: 1px solid var(--border-color);
  }

  .send-book > .app-button {
    align-self: flex-start;
  }

  .send-book-form {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .send-book-form .app-button {
    align-self: flex-start;
  }

  .send-book-field {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: var(--type-small);
  }

  .send-book-note {
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }

  .send-book-error {
    color: var(--app-danger-color);
    font-size: var(--type-small);
  }
</style>
