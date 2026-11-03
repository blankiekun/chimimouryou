<script lang="ts">
  /** The header's sync status (plan S3); empty while books stay on this device. */
  import { goto } from '$app/navigation';
  import MessageDialog from '$lib/components/message-dialog.svelte';
  import { dialogManager } from '$lib/data/dialog-manager';
  import { pagePath, standalone } from '$lib/data/env';
  import { cloudSignedIn, signInToCloud } from '$lib/data/standalone/standalone-storage';
  import { serverBase, serverConnected } from '$lib/data/remote/server-connect';
  import { getStorageHandler } from '$lib/data/storage/storage-handler-factory';
  import { StorageKey } from '$lib/data/storage/storage-types';
  import { storageSource$ } from '$lib/data/storage/storage-view';
  import { database, isOnline$, libraryOffline$ } from '$lib/data/store';
  import { syncState$, syncView } from '$lib/data/sync/sync-status';
  import { onMount } from 'svelte';

  let now = Date.now();
  onMount(() => {
    const timer = setInterval(() => (now = Date.now()), 15_000);
    return () => clearInterval(timer);
  });

  const settingsHref = `${pagePath}/settings?section=${standalone ? 'sync' : 'data-sync'}`;
  const serverHost = serverBase.replace(/^https:\/\//, '');

  // Tokens aren't observable: checked again on the 15 s tick, after each sync and after signing in here.
  $: signedIn = !!$syncState$ && cloudSignedIn($storageSource$, now);
  // The library just found the sign-in dead: say so now, not on the next tick.
  $: if ($libraryOffline$) now = Date.now();
  $: view = syncView($syncState$, $storageSource$, $isOnline$, signedIn, now);
  $: connected = serverConnected && $storageSource$ === StorageKey.CALIBRE;
  // A failure on the server is mostly an expired sign-in.
  $: failedHref =
    $storageSource$ !== StorageKey.CALIBRE
      ? settingsHref
      : `${pagePath}/settings?section=${standalone ? 'sync#sync-server' : 'general#general-account'}`;

  async function signIn() {
    const error = await signInToCloud(window, $storageSource$);
    now = Date.now();
    if (error) {
      goto(`${settingsHref}#sync-storage`);
    } else if ($libraryOffline$) {
      // A library kept while signed out (database.service) lists its books now.
      libraryOffline$.next(false);
      database.dataListChanged$.next(getStorageHandler(window, $storageSource$, ''));
    }
  }

  // The reason in words a phone can show too: it has no hover for the title.
  function showFailure() {
    dialogManager.dialogs$.next([
      {
        component: MessageDialog,
        props: {
          title: 'Sync failed',
          message: $syncState$.errors[0]?.detail ?? '',
          link: { href: failedHref, text: 'Open settings' }
        }
      }
    ]);
  }
</script>

{#if connected && view.kind === 'none'}
  <!-- Connected to a server, and nothing to say yet: name it. -->
  <a href="{settingsHref}#sync-server" class="sync-indicator sync-host" title={serverHost}
    >{serverHost}</a
  >
{:else if view.kind === 'syncing'}
  <span class="sync-indicator" role="status">
    {view.text}
    <span class="sync-track" aria-hidden="true">
      <span style:width="{(view.done / view.total) * 100}%" />
    </span>
  </span>
{:else if view.kind === 'signin'}
  <button type="button" class="sync-indicator sync-spot" on:click={signIn}>{view.text}</button>
{:else if view.kind === 'failed'}
  <button
    type="button"
    class="sync-indicator sync-danger"
    title={$syncState$.errors[0]?.detail}
    on:click={showFailure}>{view.text}</button
  >
{:else if view.kind !== 'none'}
  <a
    href={connected ? `${settingsHref}#sync-server` : settingsHref}
    class="sync-indicator"
    title={connected ? serverHost : undefined}>{view.text}</a
  >
{/if}

<style>
  .sync-indicator {
    display: inline-flex;
    min-height: var(--app-control-height);
    flex-direction: column;
    align-items: flex-end;
    justify-content: center;
    gap: 0.3rem;
    padding: 0 0.25rem;
    color: var(--app-muted-fg);
    font-size: var(--type-small);
    white-space: nowrap;
  }

  /* Two short lines on a phone: "Offline · 2 changes waiting" would push the avatar off the bar */
  @media (max-width: 639px) {
    .sync-indicator {
      min-width: 0;
      line-height: 1.2;
      text-align: right;
      white-space: normal;
    }
  }

  /* Shrinks with an ellipsis, so a long host never pushes the avatar off a phone's bar */
  .sync-host {
    display: block;
    min-width: 0;
    overflow: hidden;
    line-height: var(--app-control-height);
    text-overflow: ellipsis;
  }

  a.sync-indicator:hover {
    color: var(--font-color);
  }

  .sync-spot {
    color: var(--accent-strong-color);
    font-weight: 700;
  }

  .sync-spot:hover {
    text-decoration: underline;
    text-underline-offset: 0.2em;
  }

  .sync-danger,
  .sync-danger:hover {
    color: var(--app-danger-color);
    font-weight: 700;
  }

  .sync-track {
    display: block;
    width: 100%;
    height: 3px;
    background: var(--border-color);
  }

  .sync-track span {
    display: block;
    height: 100%;
    background: var(--accent-color);
    transition: width 0.2s var(--app-ease);
  }
</style>
