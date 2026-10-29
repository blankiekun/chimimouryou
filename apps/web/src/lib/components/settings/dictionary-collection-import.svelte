<script lang="ts">
  /**
   * Settings → Dictionary lookups → Backup: imports a Yomitan dictionary collection export
   * (lib/data/dictionary.ts importDictionaryCollection), with its progress and Cancel. Not part
   * of upstream.
   */
  import SettingsItemGroup from '$lib/components/settings/settings-item-group.svelte';
  import {
    cancelDictionaryCollectionImport,
    importDictionaryCollection
  } from '$lib/data/dictionary';
  import { inputFile } from '$lib/functions/file-dom/input-file';

  let progress: { read: number; total: number } | undefined;
  let cancelling = false;
  let message = '';
  let error = '';

  const gb = (bytes: number) => `${(bytes / 1e9).toFixed(bytes < 1e9 ? 2 : 1)} GB`;

  async function importFile(files: FileList) {
    const file = files[0];
    message = '';
    error = '';
    cancelling = false;
    progress = { read: 0, total: file.size };
    try {
      const { imported, skipped } = await importDictionaryCollection(file, (read, total) => {
        progress = { read, total };
      });
      const parts = [
        `Imported ${imported.length} ${imported.length === 1 ? 'dictionary' : 'dictionaries'}.`
      ];
      if (skipped.length) parts.push(`Already installed, skipped: ${skipped.join(', ')}.`);
      message = parts.join(' ');
    } catch (e: any) {
      error =
        e.message === 'Import cancelled'
          ? 'Import cancelled. None of its dictionaries were kept.'
          : `The collection couldn't be imported: ${e.message} None of its dictionaries were kept.`;
    }
    progress = undefined;
  }

  function cancel() {
    cancelling = true;
    cancelDictionaryCollectionImport();
  }
</script>

<SettingsItemGroup
  title="Import dictionary collection"
  tooltip="From Yomitan → Backup → Export Dictionary Collection. Keep this tab open while it imports."
>
  {#if progress}
    <button type="button" class="app-button" disabled={cancelling} on:click={cancel}>
      {cancelling ? 'Cancelling…' : 'Cancel'}
    </button>
  {:else}
    <label class="app-button collection-file">
      <input type="file" accept="application/json,.json" hidden use:inputFile={importFile} />
      Choose file
    </label>
  {/if}
  <svelte:fragment slot="after">
    {#if progress}
      <div
        class="collection-track"
        role="progressbar"
        aria-label="Importing the dictionary collection"
        aria-valuemin={0}
        aria-valuemax={progress.total}
        aria-valuenow={progress.read}
      >
        <div
          class="collection-fill"
          style:width="{progress.total ? (progress.read / progress.total) * 100 : 0}%"
        />
      </div>
      <p class="collection-note" role="status">
        Importing: {gb(progress.read)} of {gb(progress.total)} read
      </p>
    {/if}
    {#if message}<p class="collection-note" role="status">{message}</p>{/if}
    {#if error}<p class="collection-error" role="alert">{error}</p>{/if}
  </svelte:fragment>
</SettingsItemGroup>

<style>
  .collection-file {
    cursor: pointer;
  }

  .collection-track {
    width: 100%;
    height: 3px;
    margin-top: 0.5rem;
    background: var(--app-progress-track);
  }

  .collection-fill {
    height: 100%;
    background: var(--app-progress-fill);
  }

  .collection-note {
    color: var(--app-muted-fg);
    font-size: var(--type-small);
    line-height: 1.5;
  }

  .collection-error {
    color: var(--app-danger-color);
    font-size: var(--type-small);
    line-height: 1.5;
  }
</style>
