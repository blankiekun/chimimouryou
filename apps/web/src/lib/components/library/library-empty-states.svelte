<script lang="ts">
  import LibraryEmpty from '$lib/components/standalone/library-empty.svelte';
  import { account$ } from '$lib/data/account';
  import { pagePath, selfHostingGuideUrl, standalone } from '$lib/data/env';
  import { StorageKey } from '$lib/data/storage/storage-types';
  import { storageSource$ } from '$lib/data/storage/storage-view';
  import { libraryBuilding$, libraryOffline$, librarySignInNeeded } from '$lib/data/store';
  import { inputFile } from '$lib/functions/file-dom/input-file';
  import { t$ } from '$lib/i18n';

  /**
   * The library with no books (routes/manage): signed out, server out of reach, standalone's
   * first book, the server's first catalog build, an empty Calibre library (with or without
   * Import) and an empty browser library. .library-empty* styles are the page's (shared with its
   * "No books match" state).
   */

  interface Props {
    /** An empty Calibre library: whether this account may import and the service runs */
    importReady: Promise<boolean>;
    onfiles: (files: FileList | File[]) => void;
    onretry: () => void;
  }

  let { importReady, onfiles, onretry }: Props = $props();
</script>

{#if $storageSource$ === StorageKey.CALIBRE && librarySignInNeeded($account$, $libraryOffline$)}
  <div class="library-signed-out">
    <h1 class="library-signed-out-title">Sign in to see the library</h1>
    <p class="library-empty-text">Ask the server's admin for an account.</p>
    <a
      class="app-button app-button-primary"
      href="{pagePath}/settings?section={standalone
        ? 'sync#sync-server'
        : 'general#general-account'}">Sign in</a
    >
  </div>
{:else if $storageSource$ === StorageKey.CALIBRE && $libraryOffline$}
  <div class="library-signed-out">
    <h1 class="library-signed-out-title">The server can't be reached</h1>
    <p class="library-empty-text">No books downloaded to this browser yet.</p>
    <button type="button" class="app-button" onclick={onretry}>{$t$('home.retry')}</button>
  </div>
{:else if standalone}
  <LibraryEmpty onFiles={onfiles} />
{:else if $storageSource$ === StorageKey.CALIBRE && $libraryBuilding$}
  <div class="library-empty" role="status">
    <span class="library-empty-title">{$t$('library.calibreBuilding')}</span>
    <span class="library-empty-text">{$t$('library.calibreBuildingText')}</span>
  </div>
{:else if $storageSource$ === StorageKey.CALIBRE}
  {#await importReady then ready}
    {#if ready}
      <label class="library-empty library-empty-import">
        <input
          type="file"
          accept="application/epub+zip,.epub,.htmlz,plain/text,.txt,.cbz,.zip"
          multiple
          hidden
          use:inputFile={onfiles}
        />
        <span class="library-empty-title">{$t$('library.calibreEmpty')}</span>
        <span class="library-empty-text">{$t$('library.calibreEmptyImport')}</span>
      </label>
    {:else}
      <div class="library-empty">
        <span class="library-empty-title">{$t$('library.calibreEmpty')}</span>
        <span class="library-empty-text">
          {$t$('library.calibreEmptyNoImport')}
          <a
            class="underline"
            href="{selfHostingGuideUrl}#what-runs"
            target="_blank"
            rel="noreferrer">{$t$('library.calibreProfiles')}</a
          >
        </span>
      </div>
    {/if}
  {/await}
{:else}
  <label class="library-empty library-empty-import">
    <input
      type="file"
      accept="application/epub+zip,.epub,.htmlz,plain/text,.txt,.cbz,.zip,.mokuro"
      multiple
      hidden
      use:inputFile={onfiles}
    />
    <span class="library-empty-title">Your library is empty</span>
    <span class="library-empty-text">Drop EPUB, HTMLZ or TXT files, or click to import</span>
  </label>
{/if}

<style>
  .library-empty-import {
    cursor: pointer;
  }

  .library-signed-out {
    display: flex;
    max-width: 75rem;
    flex-direction: column;
    align-items: flex-start;
    gap: 1rem;
    margin: 0 auto;
    padding-top: 1.5rem;
  }

  .library-signed-out p {
    max-width: 34rem;
  }

  .library-signed-out-title {
    font-size: var(--type-h1);
    font-weight: 700;
  }

  .library-empty-import:focus-visible {
    outline: 2px solid var(--app-focus-ring);
    outline-offset: 2px;
  }
</style>
