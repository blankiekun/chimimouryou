<script lang="ts">
  /** The standalone header's sync status (plan S3); empty while books stay on this device. */
  import { goto } from '$app/navigation';
  import { pagePath } from '$lib/data/env';
  import { driveSignedIn, signInToDrive } from '$lib/data/standalone-storage';
  import { serverBase, serverConnected } from '$lib/data/server-connect';
  import { StorageKey } from '$lib/data/storage/storage-types';
  import { storageSource$ } from '$lib/data/storage/storage-view';
  import { isOnline$ } from '$lib/data/store';
  import { syncState$, syncView } from '$lib/data/sync-status';
  import { onMount } from 'svelte';

  let now = Date.now();
  onMount(() => {
    const timer = setInterval(() => (now = Date.now()), 15_000);
    return () => clearInterval(timer);
  });

  const settingsHref = `${pagePath}/settings?section=sync`;
  const serverHost = serverBase.replace(/^https:\/\//, '');

  // Tokens aren't observable: checked again on the 15 s tick, after each sync and after signing in here.
  $: signedIn = !!$syncState$ && ($storageSource$ !== StorageKey.GDRIVE || driveSignedIn(now));
  $: view = syncView($syncState$, $storageSource$, $isOnline$, signedIn, now);

  async function signIn() {
    const error = await signInToDrive(window);
    now = Date.now();
    if (error) goto(`${settingsHref}#sync-storage`);
  }
</script>

{#if serverConnected && $storageSource$ === StorageKey.CALIBRE}
  <!-- The Calibre source syncs as you read, without the replicator: name the server instead. -->
  <a href="{settingsHref}#sync-server" class="sync-indicator">{serverHost}</a>
{:else if view.kind === 'syncing'}
  <span class="sync-indicator" role="status">
    {view.text}
    <span class="sync-track" aria-hidden="true">
      <span style:width="{(view.done / view.total) * 100}%" />
    </span>
  </span>
{:else if view.kind === 'signin'}
  <button type="button" class="sync-indicator sync-spot" on:click={signIn}>{view.text}</button>
{:else if view.kind !== 'none'}
  <a href={settingsHref} class="sync-indicator" class:sync-danger={view.kind === 'failed'}
    >{view.text}</a
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
  a.sync-danger:hover {
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
