<script lang="ts">
  /**
   * First run → "Coming from ッツ Reader?": how to bring books over with ッツ Reader's Zip File
   * export and Import Backup here (the same backup format, upstream-backup-import.test.ts).
   */
  import DialogTemplate from '$lib/components/dialog-template.svelte';
  import { dialogManager } from '$lib/data/dialog-manager';
  import { storageRootName } from '$lib/data/env';
  import { t$ } from '$lib/i18n';
</script>

<DialogTemplate>
  <svelte:fragment slot="header">{$t$('migrate.title')}</svelte:fragment>
  <ol slot="content" class="migrate-steps">
    <li>{$t$('migrate.export')}</li>
    <li>{$t$('migrate.import')}</li>
    <li>{$t$('migrate.what')}</li>
    <li>{$t$('migrate.drive', { folder: storageRootName })}</li>
  </ol>
  <button
    slot="footer"
    type="button"
    class="app-button app-button-primary"
    onclick={() => dialogManager.dialogs$.next([])}
  >
    {$t$('migrate.close')}
  </button>
</DialogTemplate>

<style>
  .migrate-steps {
    display: grid;
    max-width: 34rem;
    gap: 0.75rem;
    padding-left: 1.25rem;
    list-style: decimal;
    font-size: var(--type-body);
    line-height: 1.6;
  }
</style>
