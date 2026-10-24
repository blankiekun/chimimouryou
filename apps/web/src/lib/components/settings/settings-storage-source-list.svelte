<script lang="ts">
  import { browser } from '$app/env';
  import { faSpinner } from '@fortawesome/free-solid-svg-icons';
  import MessageDialog from '$lib/components/message-dialog.svelte';
  import SettingsStorageSource from '$lib/components/settings/settings-storage-source.svelte';
  import type { BooksDbStorageSource } from '$lib/data/database/books-db/versions/books-db';
  import { dialogManager } from '$lib/data/dialog-manager';
  import { gDriveRevokeEndpoint } from '$lib/data/env';
  import { StorageOAuthManager, storageOAuthTokens } from '$lib/data/storage/storage-oauth-manager';
  import {
    isAppDefault,
    setStorageSourceDefault,
    type FsHandle,
    type StorageSourceSaveResult,
    type StorageUnlockAction,
    type RemoteContext,
    unlockStorageData
  } from '$lib/data/storage/storage-source-manager';
  import { StorageKey } from '$lib/data/storage/storage-types';
  import {
    autoReplication$,
    database,
    fsStorageSource$,
    gDriveStorageSource$,
    isOnline$,
    oneDriveStorageSource$,
    syncTarget$
  } from '$lib/data/store';
  import { AutoReplicationType } from '$lib/functions/replication/replication-options';
  import { t$ } from '$lib/i18n';
  import Fa from 'svelte-fa';

  export let storageSources: BooksDbStorageSource[];

  let listLoading = true;

  $: if (storageSources) {
    listLoading = false;
  }

  $: fileSystemAvailable = browser && 'showDirectoryPicker' in window;

  $: listTooltip = $t$(fileSystemAvailable ? 'prefs.sourcesHintFs' : 'prefs.sourcesHint');

  function isSyncTarget(name: string, referenceName: string) {
    return name === referenceName;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  function isStorageSourceDefault(name: string, type: StorageKey, _sources: string[] = []) {
    let configuredIsSourceDefault = false;

    switch (type) {
      case StorageKey.GDRIVE:
        configuredIsSourceDefault = name === $gDriveStorageSource$;
        break;
      case StorageKey.ONEDRIVE:
        configuredIsSourceDefault = name === $oneDriveStorageSource$;
        break;
      case StorageKey.FS:
        configuredIsSourceDefault = name === $fsStorageSource$;
        break;
      default:
        break;
    }

    return configuredIsSourceDefault;
  }

  async function modifyStorageSource(storageSource?: BooksDbStorageSource) {
    let configuredRemoteData: StorageUnlockAction | undefined;
    let configuredFSData: FsHandle | undefined;

    if (storageSource && storageSource.type !== StorageKey.FS) {
      const unlockResult = await unlockStorageData(
        storageSource,
        'You are trying to access protected data',
        {
          action: `Enter the correct password for ${storageSource.name} to proceed`,
          encryptedData: storageSource.data
        }
      );

      if (!unlockResult) {
        return;
      }

      configuredRemoteData = unlockResult;
    } else if (storageSource && isFSHandle(storageSource.type, storageSource.data)) {
      configuredFSData = {
        directoryHandle: storageSource.data.directoryHandle,
        fsPath: storageSource.data.fsPath
      };
    }

    const saveResult = await new Promise<StorageSourceSaveResult>((resolver) => {
      dialogManager.dialogs$.next([
        {
          component: SettingsStorageSource,
          props: {
            configuredName: storageSource?.name,
            configuredType: storageSource?.type,
            configuredIsSyncTarget: storageSource ? $syncTarget$ === storageSource.name : false,
            configuredIsStorageSourceDefault: storageSource
              ? isStorageSourceDefault(storageSource.name, storageSource.type)
              : false,
            configuredFSData,
            configuredRemoteData,
            configuredStoredInManager: storageSource?.storedInManager,
            configuredEncryptionDisabled: storageSource?.encryptionDisabled,
            resolver
          },
          disableCloseOnClick: true
        }
      ]);
    });

    if (!saveResult) {
      return;
    }

    if (saveResult.old) {
      const oldToken = storageOAuthTokens.get(saveResult.old);

      storageOAuthTokens.delete(saveResult.old);

      if (oldToken && saveResult.new.type === storageSource?.type) {
        storageOAuthTokens.set(saveResult.new.name, oldToken);
      }

      database.storageSourcesChanged$.next(
        storageSources.map((entry) => (entry.name === saveResult.old ? saveResult.new : entry))
      );
    } else {
      database.storageSourcesChanged$.next([...storageSources, saveResult.new]);
    }
  }

  function isFSHandle(
    type: StorageKey,
    data: FsHandle | ArrayBuffer | RemoteContext
  ): data is FsHandle {
    return data && type === StorageKey.FS;
  }

  async function deleteStorageSource(
    storageSource: BooksDbStorageSource,
    wasSyncTarget: boolean,
    wasSourceDefault: boolean
  ) {
    const unlockResult = await unlockStorageData(
      storageSource,
      storageSource.type === StorageKey.FS
        ? 'You are trying to delete data'
        : 'You are trying to delete protected data',
      {
        action:
          storageSource.type === StorageKey.FS
            ? `Please confirm to proceed with deleting ${storageSource.name}`
            : `Enter the correct password for ${storageSource.name} to proceed`,
        requiresSecret: storageSource.type !== StorageKey.FS,
        showCancel: true,
        encryptedData: storageSource.type !== StorageKey.FS ? storageSource.data : undefined
      }
    );

    if (!unlockResult) {
      return;
    }

    const invalidateToken = storageSource.type === StorageKey.GDRIVE && unlockResult.refreshToken;

    if (invalidateToken && !$isOnline$) {
      dialogManager.dialogs$.next([
        {
          component: MessageDialog,
          props: {
            title: 'Error',
            message: 'You need to be online to delete this storage source'
          },
          disableCloseOnClick: true
        }
      ]);
      return;
    }

    await database.deleteStorageSource(storageSource, wasSyncTarget, wasSourceDefault);

    storageOAuthTokens.delete(storageSource.name);

    if (invalidateToken && unlockResult.refreshToken) {
      StorageOAuthManager.revokeToken(gDriveRevokeEndpoint, unlockResult.refreshToken);
    }

    database.storageSourcesChanged$.next(
      storageSources.filter((source) => source.name !== storageSource.name)
    );
  }
</script>

<div class="sources">
  <div class="sources-head">
    <p class="sources-hint">
      {listTooltip}
      {#if $autoReplication$ !== AutoReplicationType.Off && !$syncTarget$}
        <span class="sources-warn">{$t$('prefs.sourcesNoTarget')}</span>
      {/if}
    </p>
    <button
      class="app-button"
      disabled={!storageSources}
      on:click={() => {
        modifyStorageSource();
      }}
    >
      {$t$('prefs.add')}
    </button>
  </div>
  {#if !listLoading && storageSources}
    {#if storageSources.length}
      <table class="app-table">
        <tbody>
          {#each storageSources as storageSource (storageSource.name)}
            {@const isDefault = isAppDefault(storageSource.name)}
            {@const storageSourceIsSyncTarget = isSyncTarget(storageSource.name, $syncTarget$)}
            {@const storageSourceIsSourceDefault = isStorageSourceDefault(
              storageSource.name,
              storageSource.type,
              [$gDriveStorageSource$, $oneDriveStorageSource$, $fsStorageSource$]
            )}
            <tr>
              <th scope="row">{storageSource.name}</th>
              <td>
                <div class="sources-actions">
                  <button
                    class="app-button app-button-quiet"
                    title={$t$('prefs.sourceSyncTarget')}
                    aria-pressed={storageSourceIsSyncTarget}
                    on:click={() =>
                      syncTarget$.next(
                        $syncTarget$ === storageSource.name ? '' : storageSource.name
                      )}
                  >
                    {$t$('prefs.sourceTargetShort')}
                  </button>
                  <button
                    class="app-button app-button-quiet"
                    title={$t$('prefs.sourceDefault')}
                    aria-pressed={storageSourceIsSourceDefault}
                    on:click={() =>
                      setStorageSourceDefault(
                        storageSourceIsSourceDefault ? '' : storageSource.name,
                        storageSource.type
                      )}
                  >
                    {$t$('prefs.sourceDefaultShort')}
                  </button>
                  {#if !isDefault}
                    <button
                      class="app-button app-button-quiet"
                      title={$t$('prefs.sourceEdit')}
                      on:click={() => modifyStorageSource(storageSource)}
                    >
                      {$t$('prefs.sourceEditShort')}
                    </button>
                    <button
                      class="app-button app-button-quiet"
                      title={$t$('prefs.sourceDelete')}
                      on:click={() =>
                        deleteStorageSource(
                          storageSource,
                          storageSourceIsSyncTarget,
                          storageSourceIsSourceDefault
                        )}
                    >
                      {$t$('prefs.sourceDeleteShort')}
                    </button>
                  {/if}
                </div>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {:else}
      <p class="sources-hint">{$t$('prefs.sourcesNone')}</p>
    {/if}
  {:else}
    <Fa icon={faSpinner} spin />
  {/if}
</div>

<style>
  .sources {
    display: grid;
    gap: 1rem;
  }

  .sources-head {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.75rem 1.5rem;
  }

  .sources-hint {
    max-width: 40rem;
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }

  .sources-warn {
    display: block;
    margin-top: 0.25rem;
    color: var(--font-color);
  }

  .sources th {
    font-weight: 700;
    overflow-wrap: anywhere;
  }

  .sources-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 0 0.5rem;
  }

  /* Sync target and Default are toggles: off reads muted, on in the spot colour */
  .sources-actions [aria-pressed='false'] {
    color: var(--app-muted-fg);
  }
</style>
