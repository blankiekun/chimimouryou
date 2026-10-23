<script lang="ts">
  /** The standalone's empty library (plan S2): import files or a folder, or drop them. */
  import SectionHead from '$lib/components/section-head.svelte';
  import { StorageKey } from '$lib/data/storage/storage-types';
  import { storageSource$ } from '$lib/data/storage/storage-view';
  import { inputAllowDirectory } from '$lib/functions/file-dom/input-allow-directory';
  import { inputFile } from '$lib/functions/file-dom/input-file';
  import { isMobile$ } from '$lib/functions/utils';

  export let onFiles: (files: FileList) => void;

  const places: Partial<Record<StorageKey, string>> = {
    [StorageKey.GDRIVE]: 'Books you import go to your Drive and open offline on this device.',
    [StorageKey.FS]: 'Books you import go to your folder and open offline.'
  };

  let filesInput: HTMLInputElement;
  let folderInput: HTMLInputElement;
</script>

<section class="empty" aria-labelledby="library-empty-title">
  <SectionHead id="library-empty-title" number={1} title="Add your first book" />
  <p class="empty-text">
    {places[$storageSource$] ?? 'Books you import are kept in this browser and open offline.'}
  </p>
  <input
    hidden
    multiple
    type="file"
    accept="application/epub+zip,.epub,.htmlz,plain/text,.txt,.cbz,.zip"
    use:inputFile={onFiles}
    bind:this={filesInput}
  />
  <input
    hidden
    multiple
    type="file"
    use:inputAllowDirectory
    use:inputFile={onFiles}
    bind:this={folderInput}
  />
  <div class="empty-actions">
    <button type="button" class="app-button app-button-primary" on:click={() => filesInput.click()}>
      Import files
    </button>
    {#if !$isMobile$}
      <button type="button" class="app-button" on:click={() => folderInput.click()}>
        Import a folder
      </button>
    {/if}
  </div>
  {#if !$isMobile$}
    <div class="empty-drop" aria-hidden="true">
      <span class="empty-drop-title">Drop files here</span>
      <span class="empty-drop-text">or a folder of books</span>
    </div>
  {/if}
  <p class="empty-formats">
    EPUB and HTMLZ books · CBZ and ZIP manga · visual novels as a ZIP with their script
  </p>
</section>

<style>
  .empty {
    display: flex;
    max-width: 75rem;
    flex-direction: column;
    margin: 0 auto;
    padding-top: 1.25rem;
  }

  .empty-text {
    margin: 1.5rem 0;
    color: var(--font-color);
    font-size: var(--type-body);
    line-height: 1.6;
  }

  .empty-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
  }

  .empty-drop {
    display: flex;
    min-height: 10rem;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.35rem;
    margin-top: 1.5rem;
    border: 1px solid var(--border-color);
    border-radius: 2px;
  }

  .empty-drop-title {
    color: var(--app-muted-fg);
    font-size: var(--type-body);
    font-weight: 700;
  }

  .empty-drop-text,
  .empty-formats {
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }

  .empty-formats {
    margin-top: 1.5rem;
    line-height: 1.6;
  }

  @media (max-width: 639px) {
    .empty {
      padding-top: 0.5rem;
    }

    .empty-actions .app-button {
      width: 100%;
    }
  }
</style>
