<script lang="ts">
  import { goto } from '$app/navigation';
  import { readerPath } from '$lib/data/reader/reader-route';
  import { database } from '$lib/data/store';
  import { formatPageTitle } from '$lib/functions/format-page-title';
  import { observe } from '$lib/functions/rxjs/use-observable';
  import { map, take, tap } from 'rxjs';

  const autoNavigate$ = database.lastItem$.pipe(
    // Once: a later change of the last item must not navigate again from the page it opened.
    take(1),
    map((lastItem) => (lastItem ? readerPath(lastItem.dataId, lastItem.route) : 'manage')),
    tap((path) => goto(path))
  );
</script>

<svelte:head>
  <title>{formatPageTitle('Home')}</title>
</svelte:head>

<div use:observe={autoNavigate$} />
