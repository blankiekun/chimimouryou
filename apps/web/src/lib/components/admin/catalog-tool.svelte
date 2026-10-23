<script lang="ts">
  import { faSpinner } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { rebuildCatalog } from '$lib/data/calibre-import';
  import { loadCalibreCatalog } from '$lib/data/calibre';

  let result: { books: number; visualNovels: number } | undefined;
  let busy = false;
  let error = '';

  async function run() {
    busy = true;
    error = '';

    try {
      result = await rebuildCatalog();
      // The library lists the new catalog the next time it loads.
      loadCalibreCatalog(true).catch(() => {});
    } catch (e: any) {
      error = e.message;
    } finally {
      busy = false;
    }
  }
</script>

<p class="tool-text">
  The catalog lists the Calibre library and the visual novel folder. It is rebuilt on its own when
  either changes (checked every few minutes); rebuild it now after changing files by hand. A large
  library takes a few minutes.
</p>

{#if result}
  <table class="app-table tool-table">
    <tbody>
      <tr>
        <th scope="row">Rebuilt</th>
        <td>
          {result.books.toLocaleString()} books, of which {result.visualNovels.toLocaleString()} visual
          novels
        </td>
      </tr>
    </tbody>
  </table>
{/if}

<div class="tool-actions">
  <button class="app-button" disabled={busy} on:click={run}>Rebuild catalog</button>
  {#if busy}
    <span class="flex items-center gap-2" role="status"
      ><Fa icon={faSpinner} spin /> Rebuilding...</span
    >
  {/if}
</div>

{#if error}
  <p class="tool-error">{error}</p>
{/if}
