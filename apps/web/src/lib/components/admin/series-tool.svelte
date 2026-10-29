<script lang="ts">
  import { faSpinner } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { checkSeries, type SeriesReport } from '$lib/data/calibre-import';

  let report: SeriesReport | undefined;
  let busy = '';
  let error = '';

  $: changes = report ? report.assigned + report.merged : 0;

  async function run(apply: boolean) {
    busy = apply ? 'Writing to Calibre...' : 'Checking the library...';
    error = '';

    try {
      report = await checkSeries(apply);
    } catch (e: any) {
      error = e.message;
    } finally {
      busy = '';
    }
  }

  function volumes(numbers: number[]) {
    return numbers.map((n) => n.toLocaleString()).join(', ');
  }
</script>

<p class="tool-text">
  Fills in series from titles and merges near-duplicate series names. Nothing is written until you
  apply.
</p>

{#if report}
  <table class="app-table tool-table">
    <tbody>
      <tr>
        <th scope="row">{report.written ? 'Written' : 'Last check'}</th>
        <td>
          {#if !changes}
            Nothing to change: every series is in order.
          {:else}
            {report.assigned.toLocaleString()} books {report.written ? 'were' : 'would be'} put into
            {report.series.length.toLocaleString()} series, and {report.merged.toLocaleString()} books
            in {report.merges.length.toLocaleString()} duplicate series {report.written
              ? 'were'
              : 'would be'} merged.
          {/if}
        </td>
      </tr>
      {#if report.written}
        <tr>
          <th scope="row">Backup</th>
          <td>
            metadata.db was backed up first ({report.backup}). The library shows the new series once
            the catalog is rebuilt, in a few minutes.
          </td>
        </tr>
      {/if}
    </tbody>
  </table>
  <div class="tool-lists">
    {#if report.merges.length}
      <details>
        <summary>Merged series</summary>
        <ul class="tool-list">
          {#each report.merges as merge}
            <li>{merge.from.join(', ')} → {merge.to} ({merge.books})</li>
          {/each}
        </ul>
      </details>
    {/if}
    {#if report.series.length}
      <details>
        <summary>Series that get books</summary>
        <ul class="tool-list">
          {#each report.series as entry}
            <li>{entry.name}: {volumes(entry.volumes)}</li>
          {/each}
        </ul>
      </details>
    {/if}
    {#if report.warnings.length}
      <details>
        <summary>Worth a look ({report.warnings.length.toLocaleString()})</summary>
        <ul class="tool-list">
          {#each report.warnings as warning}
            <li>{warning}</li>
          {/each}
        </ul>
      </details>
    {/if}
  </div>
{/if}

<div class="tool-actions">
  <button class="app-button" disabled={!!busy} on:click={() => run(false)}>Check library</button>
  {#if report && !report.written && changes}
    <button class="app-button app-button-primary" disabled={!!busy} on:click={() => run(true)}>
      Apply {changes.toLocaleString()} changes
    </button>
  {/if}
  {#if busy}
    <span class="flex items-center gap-2" role="status"><Fa icon={faSpinner} spin /> {busy}</span>
  {/if}
</div>

{#if error}
  <p class="tool-error">{error}</p>
{/if}

<style>
  .tool-lists {
    display: grid;
  }

  .tool-lists details {
    border-bottom: 1px solid var(--border-color);
  }

  .tool-lists summary {
    min-height: 2.5rem;
    padding: 0.6rem 0;
    cursor: pointer;
  }

  .tool-list {
    display: grid;
    max-height: 18rem;
    gap: 0.2rem;
    margin-bottom: 0.75rem;
    overflow-y: auto;
    padding-left: 1.1rem;
    font-size: var(--type-small);
    list-style: disc;
  }
</style>
