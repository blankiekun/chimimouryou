<script lang="ts">
  /**
   * Settings → Sync → Server (plan S7): connect the standalone to a chimimouryou server that
   * allows this app (CORS_ORIGINS), see who is signed in, disconnect.
   */
  import { browser } from '$app/env';
  import { account$ } from '$lib/data/account';
  import { releaseReaderData } from '$lib/data/reader-data-owner';
  import {
    connectServer,
    disconnectServer,
    rememberedServer,
    serverBase,
    serverConnected
  } from '$lib/data/server-connect';
  import { chooseStorage, storageChosen$ } from '$lib/data/standalone-storage';
  import { StorageKey } from '$lib/data/storage/storage-types';
  import { inputClasses } from '$lib/css-classes';

  let address = browser ? rememberedServer() : '';
  let username = '';
  let password = '';
  let busy = false;
  let error = '';

  const host = serverBase.replace(/^https:\/\//, '');

  async function connect() {
    busy = true;
    error = '';
    try {
      await connectServer(address, username, password);
      // The library lists the server's books from now on.
      chooseStorage(window, StorageKey.CALIBRE);
      storageChosen$.next(true);
      window.location.reload();
    } catch (err: any) {
      error = err.message || 'Connecting failed.';
      busy = false;
    }
  }

  async function disconnect() {
    busy = true;
    // While still connected: the server's catalog names the titles whose progress to forget.
    await releaseReaderData(null, true).catch(() => {});
    await disconnectServer();
    chooseStorage(window, StorageKey.BROWSER);
    window.location.reload();
  }
</script>

{#if serverConnected}
  <div class="server-account" data-settings-item data-settings-search="Server connected sign out">
    <div class="server-text">
      <p class="server-name">
        {$account$ ? $account$.username : $account$ === null ? 'Signed out' : 'Checking…'}
      </p>
      <p class="server-detail">{host} · Calibre library</p>
      {#if $account$ === null}
        <p class="server-error" role="alert">
          The server signed this device out. Connect again to read its library.
        </p>
      {/if}
    </div>
    <button type="button" class="app-button" disabled={busy} on:click={disconnect}>
      Disconnect
    </button>
  </div>
{:else}
  <div class="server-connect" data-settings-item data-settings-search="Server connect address">
    <p class="server-intro">
      Read a chimimouryou server's Calibre library here, with your progress and highlights synced to
      your account on it. Its admin must allow this app ({browser
        ? window.location.origin
        : 'this address'}) first. AI keys entered on this device are removed when you connect; enter
      them again afterwards and they sync with your account.
    </p>
    <form class="server-form" on:submit|preventDefault={connect}>
      <label class="server-field">
        <span>Server address</span>
        <input
          type="url"
          inputmode="url"
          autocomplete="url"
          autocapitalize="none"
          spellcheck="false"
          placeholder="https://books.example"
          required
          class={inputClasses}
          bind:value={address}
        />
      </label>
      <label class="server-field">
        <span>Username</span>
        <input
          type="text"
          autocomplete="username"
          autocapitalize="none"
          spellcheck="false"
          required
          class={inputClasses}
          bind:value={username}
        />
      </label>
      <label class="server-field">
        <span>Password</span>
        <input
          type="password"
          autocomplete="current-password"
          required
          class={inputClasses}
          bind:value={password}
        />
      </label>
      <p class="server-submit">
        <button class="app-button app-button-primary" disabled={busy}>
          {busy ? 'Connecting…' : 'Connect'}
        </button>
      </p>
    </form>
    {#if error}<p class="server-error" role="alert">{error}</p>{/if}
  </div>
{/if}

<style>
  .server-account {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.75rem 1rem;
    padding: 1rem 0;
    border-bottom: 1px solid var(--border-color);
  }

  .server-text {
    flex: 1 1 14rem;
    min-width: 0;
  }

  .server-name {
    overflow: hidden;
    color: var(--font-color);
    font-size: var(--type-body);
    font-weight: 700;
    text-overflow: ellipsis;
  }

  .server-detail {
    margin-top: 0.2rem;
    color: var(--app-muted-fg);
    font-size: var(--type-small);
    overflow-wrap: anywhere;
  }

  .server-connect {
    display: grid;
    gap: 1rem;
    padding: 1rem 0 1.25rem;
    border-bottom: 1px solid var(--border-color);
  }

  .server-intro {
    max-width: 36rem;
    font-size: var(--type-body);
    line-height: 1.65;
  }

  .server-form {
    display: grid;
    max-width: 22.5rem;
    gap: 1rem;
  }

  .server-field {
    display: grid;
    min-width: 0;
    gap: 0.3rem;
    color: var(--app-muted-fg);
    font-size: var(--type-label);
  }

  .server-field input {
    width: 100%;
    color: var(--font-color);
  }

  .server-error {
    max-width: 36rem;
    margin-top: 0.4rem;
    color: var(--app-danger-color);
    font-size: var(--type-small);
  }
</style>
