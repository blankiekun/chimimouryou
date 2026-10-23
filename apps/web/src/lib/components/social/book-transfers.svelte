<script lang="ts">
  import RoleBadge from '$lib/components/social/role-badge.svelte';
  import SocialAvatar from '$lib/components/social/social-avatar.svelte';
  import TransferRow from '$lib/components/social/transfer-row.svelte';
  import {
    declineTransfer,
    freeTitle,
    incoming$,
    loadIncoming,
    receiveBook,
    titleTaken,
    transfers$,
    type IncomingTransfer
  } from '$lib/data/book-transfer';
  import { socialSession$ } from '$lib/data/social-account';
  import { t$ } from '$lib/i18n';
  import { activePlugins$ } from '$lib/plugins';
  import { onDestroy, onMount } from 'svelte';

  /**
   * Books friends are offering (Accept / Decline) and this tab's transfers with their progress, on
   * Home and /friends. The hub is asked on mount and when the tab comes back, never on a timer.
   */

  /** Titles that are taken here: the new name the book would get instead */
  let renames: Record<string, string> = {};

  $: on = $activePlugins$.some((plugin) => plugin.id === 'social') && !!$socialSession$;
  $: if (on) checkTitles($incoming$);

  async function checkTitles(offers: IncomingTransfer[]) {
    for (const offer of offers) {
      if (offer.id in renames) continue;
      const taken = await titleTaken(offer.title).catch(() => false);

      renames = {
        ...renames,
        [offer.id]: taken ? await freeTitle(offer.title, offer.from.name) : ''
      };
    }
  }

  const visible = () => document.visibilityState === 'visible' && loadIncoming();

  onMount(() => {
    loadIncoming();
    document.addEventListener('visibilitychange', visible);
  });
  onDestroy(() => {
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', visible);
    }
  });

  const mb = (bytes: number) => `${(bytes / 1024 ** 2).toFixed(1)} MB`;
</script>

{#if on && ($incoming$.length || $transfers$.length)}
  <section class="transfers" aria-labelledby="transfers-heading">
    <h2 id="transfers-heading" class="transfers-title">{$t$('transfer.title')}</h2>
    <ul class="transfers-rows">
      {#each $incoming$ as offer (offer.id)}
        <li class="transfers-row">
          <SocialAvatar avatar={offer.from.avatar} person={offer.from} />
          <span class="transfers-text">
            <strong>{offer.from.name}<RoleBadge role={offer.from.role} /></strong>
            <span>{$t$('transfer.offers', { title: offer.title, size: mb(offer.size) })}</span>
            {#if renames[offer.id]}
              <small
                >{$t$('transfer.exists', {
                  title: offer.title,
                  newTitle: renames[offer.id]
                })}</small
              >
            {/if}
            <small>{$t$('transfer.acceptHint')}</small>
            <span class="transfers-actions">
              <button
                type="button"
                class="app-button app-button-primary"
                disabled={!(offer.id in renames)}
                on:click={() => receiveBook(offer, renames[offer.id] || offer.title)}
                >{$t$('transfer.accept')}</button
              >
              <button type="button" class="app-button" on:click={() => declineTransfer(offer.id)}
                >{$t$('transfer.decline')}</button
              >
            </span>
          </span>
        </li>
      {/each}
      {#each $transfers$ as transfer (transfer.id)}
        <li class="transfers-row"><TransferRow {transfer} /></li>
      {/each}
    </ul>
  </section>
{/if}

<style>
  .transfers {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 0.5rem;
  }

  .transfers-title {
    color: var(--app-muted-fg);
    font-size: var(--type-small);
    font-weight: 400;
  }

  .transfers-rows {
    border-top: 2px solid var(--font-color);
  }

  .transfers-row {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    padding: 0.85rem 0;
    border-bottom: 1px solid var(--border-color);
  }

  .transfers-row > :global(.transfer) {
    flex: 1;
  }

  .transfers-text {
    display: flex;
    min-width: 0;
    flex-direction: column;
  }

  .transfers-text small {
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }

  .transfers-actions {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.5rem;
  }
</style>
