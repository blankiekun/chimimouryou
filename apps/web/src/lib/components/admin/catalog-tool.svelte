<script lang="ts">
  import { faSpinner } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { rebuildCatalog } from '$lib/data/remote/calibre-import';
  import { loadCalibreCatalog } from '$lib/data/remote/calibre';
  import { serverFetch } from '$lib/data/remote/server-connect';
  import SectionHead from '$lib/components/section-head.svelte';

  let result: { books: number; visualNovels: number } | undefined;
  let busy = false;
  let error = '';

  /** Old sync folders the migration matched to no book (`GET /api/v1/migration`). */
  let orphans: { title: string; account: string }[] = [];

  serverFetch('/api/v1/migration', { cache: 'no-store' })
    .then((response) => (response.ok ? response.json() : {}))
    .then((report: { sources?: { account: string; orphans: string[] }[] }) => {
      orphans = (report.sources || []).flatMap(({ account, orphans: titles }) =>
        titles.map((title) => ({ title, account }))
      );
    })
    .catch(() => {});

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
  Rebuilds on its own when the library changes. Rebuild now after editing files by hand.
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

{#if orphans.length}
  <SectionHead number={1} title="Old sync data" count={orphans.length} level="h3" />
  <p class="tool-text">
    These folders matched no book in the library. They stay on the server until the old sync folders
    are deleted.
  </p>
  <table class="app-table tool-table">
    <thead>
      <tr><th scope="col">Title</th><th scope="col">Account</th></tr>
    </thead>
    <tbody>
      {#each orphans as orphan}
        <tr>
          <td>{orphan.title}</td>
          <td>{orphan.account ? orphan.account.slice(0, 8) : 'Shared'}</td>
        </tr>
      {/each}
    </tbody>
  </table>
{/if}
