<script lang="ts">
  import { browser } from '$app/environment';
  import ButtonToggleGroup from '$lib/components/button-toggle-group/button-toggle-group.svelte';
  import type { ToggleOption } from '$lib/components/button-toggle-group/toggle-option';
  import LogReportDialog from '$lib/components/log-report-dialog.svelte';
  import SettingsItemGroup from '$lib/components/settings/settings-item-group.svelte';
  import { dialogManager } from '$lib/data/dialog-manager';
  import { getStorageHandler } from '$lib/data/storage/storage-handler-factory';
  import { StorageKey } from '$lib/data/storage/storage-types';
  import {
    browserSourceAvailable,
    calibreSourceAvailable,
    isStorageSourceAvailable,
    storageSource$
  } from '$lib/data/storage/storage-view';
  import {
    cacheStorageData$,
    fsStorageSource$,
    gDriveStorageSource$,
    isOnline$,
    oneDriveStorageSource$
  } from '$lib/data/store';
  import { t$ } from '$lib/i18n';

  // The library's source, moved here from the library header; only shown when there is a choice
  let sources: (ToggleOption<StorageKey> & { online: boolean })[];
  $: sources = browser
    ? [
        ...(calibreSourceAvailable
          ? [{ id: StorageKey.CALIBRE, text: 'Calibre', online: false }]
          : []),
        ...(browserSourceAvailable
          ? [{ id: StorageKey.BROWSER, text: $t$('library.sourceBrowser'), online: false }]
          : []),
        ...(isStorageSourceAvailable(StorageKey.GDRIVE, $gDriveStorageSource$, window)
          ? [{ id: StorageKey.GDRIVE, text: 'GDrive', online: true }]
          : []),
        ...(isStorageSourceAvailable(StorageKey.ONEDRIVE, $oneDriveStorageSource$, window)
          ? [{ id: StorageKey.ONEDRIVE, text: 'OneDrive', online: true }]
          : []),
        ...(isStorageSourceAvailable(StorageKey.FS, $fsStorageSource$, window)
          ? [{ id: StorageKey.FS, text: $t$('library.sourceFilesystem'), online: false }]
          : [])
      ].filter((source) => !source.online || $isOnline$ || source.id === $storageSource$)
    : [];

  let selected = $storageSource$;
  $: selected = $storageSource$;
  $: if (browser && selected !== $storageSource$) {
    if (!$cacheStorageData$) {
      getStorageHandler(window, selected).clearData();
    }
    storageSource$.next(selected);
  }

  function reportIssue() {
    dialogManager.dialogs$.next([
      {
        component: LogReportDialog,
        props: {
          title: 'Bug Report',
          message: 'Please include the attached file for your report'
        }
      }
    ]);
  }
</script>

{#if sources.length > 1}
  <SettingsItemGroup title={$t$('library.storageSource')}>
    <ButtonToggleGroup options={sources} bind:selectedOptionId={selected} />
  </SettingsItemGroup>
{/if}
<SettingsItemGroup title={$t$('library.reportIssue')}>
  <button type="button" class="app-button" on:click={reportIssue}>
    {$t$('library.reportIssueButton')}
  </button>
</SettingsItemGroup>
