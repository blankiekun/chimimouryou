<script lang="ts">
  import AppHeader from '$lib/components/app-header/app-header.svelte';
  import ImportMenu from '$lib/components/book-card/import-menu.svelte';
  import { createEventDispatcher } from 'svelte';

  export let currentBookId: number | undefined;
  export let disabled = false;

  const dispatch = createEventDispatcher<{
    filesChange: FileList;
    importBackup: File;
  }>();
</script>

<AppHeader active="library" {currentBookId}>
  <ImportMenu
    {disabled}
    on:filesChange={(ev) => dispatch('filesChange', ev.detail)}
    on:importBackup={(ev) => dispatch('importBackup', ev.detail)}
  />
</AppHeader>
