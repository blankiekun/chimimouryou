<script lang="ts">
  /** Settings → Sync, the standalone's replacement for Data (plan S4). */
  import { browser } from '$app/env';
  import { faCaretDown, faCaretRight } from '@fortawesome/free-solid-svg-icons';
  import ButtonToggleGroup from '$lib/components/button-toggle-group/button-toggle-group.svelte';
  import type { ToggleOption } from '$lib/components/button-toggle-group/toggle-option';
  import SettingsItemGroup from '$lib/components/settings/settings-item-group.svelte';
  import SettingsSection from '$lib/components/settings/settings-section.svelte';
  import ServerConnect from '$lib/components/standalone/server-connect.svelte';
  import SettingsStorageSourceList from '$lib/components/settings/settings-storage-source-list.svelte';
  import { exportBackup, libraryHandler, restoreBackup } from '$lib/data/backup';
  import { selfHostingGuideUrl, storageRootName } from '$lib/data/env';
  import {
    chooseStorage,
    driveAvailable,
    driveEmail$,
    driveSignedIn,
    folderAvailable,
    folderChosen,
    pickFolder,
    signInToDrive,
    signOutOfDrive
  } from '$lib/data/standalone-storage';
  import { serverConnected } from '$lib/data/server-connect';
  import { isAppDefault } from '$lib/data/storage/storage-source-manager';
  import { defaultStorageSources, StorageKey } from '$lib/data/storage/storage-types';
  import { isStorageSourceAvailable, storageSource$ } from '$lib/data/storage/storage-view';
  import { autoReplication$, database, isOnline$ } from '$lib/data/store';
  import { formatAgo, syncEnded, syncStarted, syncState$ } from '$lib/data/sync-status';
  import { inputFile } from '$lib/functions/file-dom/input-file';
  import { AutoReplicationType } from '$lib/functions/replication/replication-options';
  import { map } from 'rxjs';
  import { isMobile } from '$lib/functions/utils';
  import Fa from 'svelte-fa';

  const sources: ToggleOption<StorageKey>[] = [
    { id: StorageKey.BROWSER, text: 'This device' },
    ...(serverConnected ? [{ id: StorageKey.CALIBRE, text: 'Server' }] : []),
    ...(browser && driveAvailable(window) ? [{ id: StorageKey.GDRIVE, text: 'Google Drive' }] : []),
    ...(browser && folderAvailable(window) && !isMobile(window)
      ? [{ id: StorageKey.FS, text: 'Folder' }]
      : [])
  ];

  let selected = $storageSource$;
  let signedIn = browser && driveSignedIn();
  let accountError = '';
  let showClient = false;
  let syncing = false;
  let backupMessage = '';
  let backupBusy = false;
  let restoreInput: HTMLInputElement;

  // Only the reader's own pick: a change made elsewhere (connecting a server) must not be undone.
  $: if (browser) onPick(selected);

  function onPick(key: StorageKey) {
    if (key !== storageSource$.getValue()) changeSource(key);
  }

  async function changeSource(key: StorageKey) {
    if (key === StorageKey.FS && !folderChosen()) {
      const name = await pickFolder(window).catch(() => '');
      if (!name) {
        selected = $storageSource$;
        return;
      }
    }
    chooseStorage(window, key);
  }

  async function signIn() {
    accountError = '';
    const error = await signInToDrive(window);
    signedIn = driveSignedIn();
    accountError =
      error === 'blocked'
        ? 'The sign-in window was blocked. Allow pop-ups for this site, then try again.'
        : error;
  }

  function signOut() {
    signOutOfDrive(window);
    signedIn = false;
  }

  let autoSync = $autoReplication$ !== AutoReplicationType.Off;
  $: if (browser && autoSync !== ($autoReplication$ !== AutoReplicationType.Off)) {
    $autoReplication$ = autoSync ? AutoReplicationType.All : AutoReplicationType.Off;
  }

  const toggle: ToggleOption<boolean>[] = [
    { id: false, text: 'Off' },
    { id: true, text: 'On' }
  ];

  /** Lists the library from its source again: checks the connection and brings new books. */
  async function syncNow() {
    syncing = true;
    syncStarted(1);
    const handler = libraryHandler(window, $storageSource$, $storageSource$);
    handler.clearData();
    const error = await handler
      .getBookList()
      .then(() => '')
      .catch((err: any) => err.message || 'Sync failed');
    syncEnded([], error, 'Library');
    database.dataListChanged$.next(handler);
    signedIn = browser && driveSignedIn();
    syncing = false;
  }

  async function runBackup(task: () => Promise<string>, done: string) {
    backupBusy = true;
    backupMessage = '';
    backupMessage = (await task().catch((err: any) => err.message as string)) || done;
    backupBusy = false;
  }

  // The source list holds custom OAuth clients (as in Settings → Data on the server edition).
  const storageSources$ = database.storageSourcesChanged$.pipe(
    map((stored) => [
      ...defaultStorageSources
        .filter((source) => isStorageSourceAvailable(source.type, source.name, window))
        .map((source) => ({
          name: source.name,
          type: source.type,
          storedInManager: false,
          encryptionDisabled: false,
          data: new ArrayBuffer(0),
          lastSourceModified: 0
        })),
      ...stored.filter((source) => !isAppDefault(source.name))
    ])
  );

  $: if (browser && showClient && !$storageSources$) {
    database
      .getStorageSources()
      .then((stored) => database.storageSourcesChanged$.next(stored))
      .catch(() => database.storageSourcesChanged$.next([]));
  }

  $: remote = $storageSource$ !== StorageKey.BROWSER;
  $: waiting = $syncState$.waiting.length;
  $: lastSync = [
    $syncState$.lastSync ? formatAgo(Date.now() - $syncState$.lastSync) : 'Not yet',
    ...($syncState$.lastSync && $syncState$.lastWhat ? [$syncState$.lastWhat] : []),
    waiting ? `${waiting} ${waiting === 1 ? 'change' : 'changes'} waiting` : 'nothing waiting'
  ].join(' · ');

  function when(at: number) {
    const date = new Date(at);
    const time = date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    const days = Math.floor((Date.now() - at) / 86_400_000);
    if (days < 1 && new Date().getDate() === date.getDate()) return `Today ${time}`;
    if (days < 2) return `Yesterday ${time}`;
    return `${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${time}`;
  }
</script>

<SettingsSection id="sync-storage">
  {#if sources.length > 1}
    <SettingsItemGroup title="Storage">
      <ButtonToggleGroup options={sources} bind:selectedOptionId={selected} />
    </SettingsItemGroup>
  {/if}
  {#if $storageSource$ === StorageKey.GDRIVE}
    <div class="account" data-settings-item data-settings-search="Google account sign in out">
      {#if signedIn}
        <span class="account-initial" aria-hidden="true">{($driveEmail$ || 'G').charAt(0)}</span>
        <div class="account-text">
          <p class="account-name">{$driveEmail$ || 'Signed in to Google Drive'}</p>
          <p class="account-detail">Google Drive · {storageRootName} folder</p>
        </div>
        <button type="button" class="app-button" on:click={signOut}>Sign out</button>
      {:else}
        <div class="account-text">
          <p class="account-name">Google Drive</p>
          <p class="account-detail">
            {$isOnline$ ? 'Not signed in.' : 'Needs a connection.'}
          </p>
          {#if accountError}<p class="account-error" role="alert">{accountError}</p>{/if}
        </div>
        <button type="button" class="app-button" disabled={!$isOnline$} on:click={signIn}>
          Sign in
        </button>
      {/if}
    </div>
  {:else if $storageSource$ === StorageKey.FS}
    <SettingsItemGroup title="Folder">
      <button type="button" class="app-button" on:click={() => pickFolder(window)}>
        Change folder
      </button>
    </SettingsItemGroup>
  {/if}
  {#if remote && $storageSource$ !== StorageKey.CALIBRE}
    <SettingsItemGroup title="Sync automatically">
      <ButtonToggleGroup options={toggle} bind:selectedOptionId={autoSync} />
    </SettingsItemGroup>
  {/if}
  {#if sources.some((source) => source.id === StorageKey.GDRIVE)}
    <SettingsItemGroup title="Own Google client ID">
      <button
        type="button"
        class="app-button app-button-quiet"
        aria-expanded={showClient}
        on:click={() => (showClient = !showClient)}
      >
        {showClient ? 'Hide' : 'Show'}
        <Fa icon={showClient ? faCaretDown : faCaretRight} size="xs" />
      </button>
      <svelte:fragment slot="after">
        {#if showClient && $storageSources$}
          <SettingsStorageSourceList storageSources={$storageSources$} />
        {/if}
      </svelte:fragment>
    </SettingsItemGroup>
  {/if}
</SettingsSection>

<SettingsSection id="sync-status">
  {#if remote}
    <SettingsItemGroup title="Last sync" tooltip={lastSync}>
      <button
        type="button"
        class="app-button app-button-quiet"
        disabled={syncing || !$isOnline$}
        on:click={syncNow}
      >
        {syncing ? 'Syncing…' : 'Sync now'}
      </button>
    </SettingsItemGroup>
  {:else}
    <SettingsItemGroup title="Last sync" tooltip="Nothing syncs while books stay on this device." />
  {/if}
  <div class="errors" data-settings-item data-settings-search="Recent errors">
    <h3 class="errors-title">Recent errors</h3>
    {#if $syncState$.errors.length}
      <table class="errors-table">
        <thead>
          <tr><th scope="col">When</th><th scope="col">What</th><th scope="col">Detail</th></tr>
        </thead>
        <tbody>
          {#each $syncState$.errors as error (error.at)}
            <tr>
              <td class="errors-when">{when(error.at)}</td>
              <td lang="ja">{error.what}</td>
              <td class="errors-detail">{error.detail}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {:else}
      <p class="errors-none">None.</p>
    {/if}
  </div>
</SettingsSection>

<SettingsSection id="sync-backup">
  <SettingsItemGroup title="Export a backup">
    <button
      type="button"
      class="app-button"
      disabled={backupBusy}
      on:click={() => runBackup(() => exportBackup(window, $storageSource$), 'Backup saved.')}
    >
      Export
    </button>
  </SettingsItemGroup>
  <SettingsItemGroup title="Restore a backup" tooltip="Newer entries win.">
    <input
      hidden
      type="file"
      accept=".zip,application/zip"
      bind:this={restoreInput}
      use:inputFile={(files) =>
        runBackup(() => restoreBackup(window, $storageSource$, files[0]), 'Backup restored.')}
    />
    <button
      type="button"
      class="app-button"
      disabled={backupBusy}
      on:click={() => restoreInput.click()}
    >
      Choose file
    </button>
  </SettingsItemGroup>
  {#if backupMessage}
    <p class="backup-message" role="status">{backupMessage}</p>
  {/if}
</SettingsSection>

<SettingsSection id="sync-server" keywords="server calibre connect sign in">
  <ServerConnect />
</SettingsSection>

<SettingsSection id="sync-selfhost" keywords="server calibre difficulty install">
  <div class="selfhost" data-settings-item>
    <p>Adds a Calibre library, difficulty estimates, word lists, Read next and accounts.</p>
    <a href={selfHostingGuideUrl} target="_blank" rel="noreferrer">Self-hosting guide →</a>
  </div>
</SettingsSection>

<style>
  .account {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.75rem 1rem;
    padding: 1rem 0;
    border-bottom: 1px solid var(--border-color);
  }

  .account-initial {
    display: inline-flex;
    width: 2.5rem;
    height: 2.5rem;
    flex: none;
    align-items: center;
    justify-content: center;
    border-radius: 9999px;
    background: var(--font-color);
    color: var(--background-color);
    font-weight: 700;
    text-transform: uppercase;
  }

  .account-text {
    flex: 1 1 14rem;
    min-width: 0;
  }

  .account-name {
    overflow: hidden;
    color: var(--font-color);
    font-size: var(--type-body);
    font-weight: 700;
    text-overflow: ellipsis;
  }

  .account-detail {
    margin-top: 0.2rem;
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }

  .account-error {
    margin-top: 0.4rem;
    color: var(--app-danger-color);
    font-size: var(--type-small);
  }

  .errors {
    padding: 1.25rem 0 1rem;
    border-bottom: 1px solid var(--border-color);
  }

  .errors-title {
    padding-bottom: 0.75rem;
    font-size: var(--type-body);
    font-weight: 700;
  }

  .errors-table {
    width: 100%;
    border-top: 2px solid var(--font-color);
    border-collapse: collapse;
    font-size: var(--type-small);
  }

  .errors-table th {
    padding: 0.6rem 1rem 0.6rem 0;
    color: var(--app-muted-fg);
    font-weight: 400;
    text-align: left;
  }

  .errors-table td {
    padding: 0.75rem 1rem 0.75rem 0;
    border-top: 1px solid var(--border-color);
    vertical-align: top;
  }

  .errors-when {
    color: var(--app-muted-fg);
    white-space: nowrap;
  }

  .errors-detail {
    color: var(--app-muted-fg);
    overflow-wrap: anywhere;
  }

  .errors-none {
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }

  .backup-message {
    padding-top: 0.75rem;
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }

  .selfhost {
    display: grid;
    gap: 1rem;
    padding: 1rem 0 1.25rem;
    border-bottom: 1px solid var(--border-color);
  }

  .selfhost p {
    max-width: 36rem;
    font-size: var(--type-body);
    line-height: 1.65;
  }

  .selfhost a {
    color: var(--accent-strong-color);
    font-weight: 700;
  }

  .selfhost a:hover {
    text-decoration: underline;
    text-underline-offset: 0.2em;
  }

  /* Phones: one stacked entry per error (when, what, detail). */
  @media (max-width: 639px) {
    .errors-table thead {
      display: none;
    }

    .errors-table tr {
      display: grid;
      padding: 0.75rem 0;
      border-top: 1px solid var(--border-color);
    }

    .errors-table td {
      padding: 0.1rem 0;
      border-top: 0;
    }
  }
</style>
