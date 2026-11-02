<script lang="ts">
  import { goto } from '$app/navigation';
  import { readerPath } from '$lib/data/reader/reader-route';
  import { database } from '$lib/data/store';
  import { vnStartFailed } from '$lib/data/vn/vn-start-guard';
  import { formatPageTitle } from '$lib/functions/format-page-title';
  import { observe } from '$lib/functions/rxjs/use-observable';
  import { t$ } from '$lib/i18n';
  import { take, tap } from 'rxjs';

  /** A Windows game that didn't finish starting last launch: asked about, not reopened. */
  let failedVn: number | undefined;

  const autoNavigate$ = database.lastItem$.pipe(
    // Once: a later change of the last item must not navigate again from the page it opened.
    take(1),
    tap((lastItem) => {
      if (lastItem?.route === 'v' && vnStartFailed(lastItem.dataId)) {
        failedVn = lastItem.dataId;
        return;
      }
      goto(lastItem ? readerPath(lastItem.dataId, lastItem.route) : 'manage');
    })
  );
</script>

<svelte:head>
  <title>{formatPageTitle('Home')}</title>
</svelte:head>

<div use:observe={autoNavigate$} />

{#if failedVn !== undefined}
  <div class="mx-auto flex max-w-md flex-col gap-4 p-4 pt-16" role="alert">
    <p>{$t$('home.vnStartFailed')}</p>
    <div class="flex flex-wrap gap-2">
      <button
        type="button"
        class="app-button app-button-primary"
        on:click={() => failedVn !== undefined && goto(readerPath(failedVn, 'v'))}
      >
        {$t$('community.tryAgain')}
      </button>
      <button type="button" class="app-button app-button-quiet" on:click={() => goto('manage')}>
        {$t$('nav.library')}
      </button>
    </div>
  </div>
{/if}
