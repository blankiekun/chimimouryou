<script lang="ts">
  import { cancelTransfer, dismissTransfer, type Transfer } from '$lib/data/sync/book-transfer';
  import { t$ } from '$lib/i18n';

  /** One book transfer, either way: what is happening, a 3px track, Cancel or Dismiss. */
  export let transfer: Transfer;

  const mb = (bytes: number) => `${(bytes / 1024 ** 2).toFixed(1)} MB`;

  $: name = transfer.friend.name;
  $: sending = transfer.direction === 'send';
  $: active = transfer.phase !== 'done' && transfer.phase !== 'failed';
  $: status =
    transfer.phase === 'failed'
      ? $t$(`transfer.error.${transfer.error ?? 'other'}` as 'transfer.error.other', { name })
      : transfer.phase === 'waiting'
        ? $t$('transfer.waiting', { name })
        : transfer.phase === 'connecting'
          ? $t$('transfer.connecting', { name })
          : transfer.phase === 'moving'
            ? $t$(sending ? 'transfer.sending' : 'transfer.receiving', {
                name,
                done: mb(transfer.bytes),
                total: mb(transfer.size)
              })
            : transfer.phase === 'saving'
              ? $t$('transfer.saving')
              : $t$(
                  sending
                    ? 'transfer.sent'
                    : transfer.local
                      ? 'transfer.receivedHere'
                      : 'transfer.received',
                  { name }
                );
</script>

<div class="transfer" class:transfer-failed={transfer.phase === 'failed'}>
  <span class="transfer-text">
    <strong lang="ja">{transfer.title}</strong>
    <small role="status">{status}</small>
    {#if active}<small>{$t$('transfer.keepOpen')}</small>{/if}
  </span>
  {#if active}
    <span class="transfer-track" aria-hidden="true"
      ><span style:width="{Math.round((transfer.bytes / transfer.size) * 100)}%" /></span
    >
  {/if}
  <button
    type="button"
    class="app-button app-button-quiet"
    on:click={() => (active ? cancelTransfer(transfer.id) : dismissTransfer(transfer.id))}
  >
    {$t$(active ? 'transfer.cancel' : 'transfer.dismiss')}
  </button>
</div>

<style>
  .transfer {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.5rem 1rem;
  }

  .transfer-text {
    display: flex;
    min-width: 0;
    flex-direction: column;
  }

  .transfer-text strong {
    overflow: hidden;
    font-weight: 700;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .transfer-text small {
    color: var(--app-muted-fg);
    font-size: var(--type-small);
    font-variant-numeric: tabular-nums;
  }

  .transfer-failed .transfer-text small:first-of-type {
    color: var(--app-danger-color);
  }

  .transfer-track {
    display: block;
    grid-column: 1 / -1;
    grid-row: 2;
    height: 3px;
    background: var(--app-progress-track);
  }

  .transfer-track > span {
    display: block;
    height: 100%;
    background: var(--app-progress-fill);
  }

  .transfer button {
    grid-column: 2;
    grid-row: 1;
  }
</style>
