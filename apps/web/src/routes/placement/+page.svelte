<script lang="ts">
  import { browser } from '$app/env';
  import { page } from '$lib/data/page-store';
  import AppHeader from '$lib/components/app-header/app-header.svelte';
  import PlacementTest from '$lib/components/placement/placement-test.svelte';
  import { database } from '$lib/data/store';
  import { map, share } from 'rxjs';

  /**
   * The placement check in the app, from Home's offer and the Words tab; `?mode=hard` is hard
   * mode (a query: adapter-static and GitHub Pages serve only fixed paths). Not part of upstream.
   */

  $: hard = browser && $page.url.searchParams.get('mode') === 'hard';

  const currentBookId$ = database.lastItem$.pipe(
    map((item) => item?.dataId),
    share()
  );
</script>

<AppHeader active="words" currentBookId={$currentBookId$} />

<div class="app-page-shell">
  {#key hard}
    <PlacementTest {hard} />
  {/key}
</div>
