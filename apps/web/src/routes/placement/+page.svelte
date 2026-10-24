<script lang="ts">
  import AppHeader from '$lib/components/app-header/app-header.svelte';
  import PlacementTest from '$lib/components/placement/placement-test.svelte';
  import { database } from '$lib/data/store';
  import { map, share } from 'rxjs';

  /** The placement check in the app, from Home's offer and the Words tab. Not part of upstream. */

  const currentBookId$ = database.lastItem$.pipe(
    map((item) => item?.dataId),
    share()
  );
</script>

<AppHeader active="words" currentBookId={$currentBookId$} />

<div class="app-page-shell">
  <PlacementTest />
</div>
