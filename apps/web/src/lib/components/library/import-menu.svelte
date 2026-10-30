<script lang="ts">
  /** The header's Import menu (files, folders, backup), shared by the library and /words. */
  import { mergeEntries } from '$lib/components/merged-header-icon/merged-entries';
  import Popover from '$lib/components/popover/popover.svelte';
  import { inputAllowDirectory } from '$lib/functions/file-dom/input-allow-directory';
  import { inputFile } from '$lib/functions/file-dom/input-file';
  import { isMobile$ } from '$lib/functions/utils';
  import { t$, type MessageKey } from '$lib/i18n';
  import { goto } from '$app/navigation';
  import { account$, hasPermission } from '$lib/data/account/account';
  import { pagePath, standalone } from '$lib/data/env';
  import {
    faChevronDown,
    faDesktop,
    faFileImport,
    faGlobe
  } from '@fortawesome/free-solid-svg-icons';
  import { createEventDispatcher } from 'svelte';
  import Fa from 'svelte-fa';

  export let disabled = false;
  /** The library offers Windows games (windows-game-dialog.svelte; phones pick a ZIP) */
  export let windowsGames = false;

  const dispatch = createEventDispatcher<{
    filesChange: FileList;
    importBackup: File;
    windowsGame: void;
  }>();
  const windowsGameEntry = { label: 'Windows game', icon: faDesktop };
  // Sources (routes/sources): fetched on the server, so the server edition with import only.
  const sourcesEntry = { label: 'Sources', icon: faGlobe };

  let fileImportElm: HTMLElement;
  let folderImportElm: HTMLElement;
  let backupImportElm: HTMLElement;
  let importMenuElm: Popover;

  // triggerImport tells the entries apart by their English label
  const importLabels: Record<string, MessageKey> = {
    [mergeEntries.FILE_IMPORT.label]: 'library.importFiles',
    [mergeEntries.FOLDER_IMPORT.label]: 'library.importFolders',
    [mergeEntries.BACKUP_IMPORT.label]: 'library.importBackup',
    [windowsGameEntry.label]: 'library.importWindowsGame',
    [sourcesEntry.label]: 'library.importSources'
  };

  $: importMenuItems = [
    mergeEntries.FILE_IMPORT,
    ...($isMobile$ ? [] : [mergeEntries.FOLDER_IMPORT]),
    ...(windowsGames ? [windowsGameEntry] : []),
    ...(!standalone && hasPermission($account$, 'import') ? [sourcesEntry] : []),
    mergeEntries.BACKUP_IMPORT
  ];

  function triggerImport(label: string) {
    switch (label) {
      case mergeEntries.FOLDER_IMPORT.label:
        folderImportElm.click();
        break;

      case mergeEntries.BACKUP_IMPORT.label:
        backupImportElm.click();
        break;

      case windowsGameEntry.label:
        dispatch('windowsGame');
        break;

      case sourcesEntry.label:
        goto(`${pagePath}/sources`);
        break;

      default:
        fileImportElm.click();
        break;
    }

    importMenuElm.toggleOpen();
  }
</script>

<input
  hidden
  multiple
  type="file"
  accept="application/epub+zip,.epub,.htmlz,plain/text,.txt,.cbz,.zip"
  use:inputFile={(fileList) => dispatch('filesChange', fileList)}
  bind:this={fileImportElm}
/>
<input
  hidden
  multiple
  type="file"
  use:inputAllowDirectory
  use:inputFile={(fileList) => dispatch('filesChange', fileList)}
  bind:this={folderImportElm}
/>
<!-- Phones: no accept, Android's picker greys out ZIPs whose provider reports another type. -->
<input
  hidden
  type="file"
  accept={$isMobile$ ? undefined : '.zip,application/zip'}
  use:inputFile={(fileList) => dispatch('importBackup', fileList[0])}
  bind:this={backupImportElm}
/>

<Popover
  placement="bottom-end"
  fallbackPlacements={['bottom', 'bottom-start']}
  yOffset={10}
  panelClasses="app-popover-panel"
  bind:this={importMenuElm}
>
  <button
    slot="icon"
    type="button"
    class="app-header-icon app-header-icon-label"
    title={$t$('library.importBooks')}
    {disabled}
  >
    <Fa icon={faFileImport} />
    <span class="hidden md:inline">{$t$('library.import')}</span>
    <Fa icon={faChevronDown} size="xs" class="hidden opacity-70 md:block" />
  </button>
  <div slot="content" class="flex flex-col">
    {#each importMenuItems as item (item.label)}
      <button type="button" class="app-popover-item" on:click={() => triggerImport(item.label)}>
        <Fa icon={item.icon} fw />
        {$t$(importLabels[item.label])}
      </button>
    {/each}
  </div>
</Popover>
