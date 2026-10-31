<script lang="ts">
  /**
   * Settings → Mihon extensions (desktop app only): turning them on downloads the pinned Java
   * runtime the app's extension host runs on (apps/desktop/mihon.js), with progress; Remove
   * deletes it. The warning says what an extension is: code from its repository, run with this
   * computer's rights. Repositories themselves are added under Sources → Add a source.
   */
  import SettingsItemGroup from '$lib/components/settings/settings-item-group.svelte';
  import SettingsSection from '$lib/components/settings/settings-section.svelte';
  import { mihonHost } from '$lib/data/sources/mihon-runtime';
  import { onMount } from 'svelte';

  const host = mihonHost()!;
  let status = $state<Awaited<ReturnType<typeof host.status>>>();
  let progress = $state<{ received: number; total: number } | null>(null);
  let error = $state('');
  let busy = $state(false);

  const mb = (bytes: number) => `${Math.round(bytes / 1024 / 1024)} MB`;

  onMount(() => {
    host.status().then((next) => {
      status = next;
      progress = next.downloading;
    });
    return host.onProgress((next) => (progress = next));
  });

  async function run(action: () => Promise<unknown>) {
    error = '';
    busy = true;
    try {
      await action();
    } catch (failure) {
      error = String((failure as Error).message).replace(/^.*?Error: /, '');
    } finally {
      busy = false;
      progress = null;
      status = await host.status();
    }
  }
</script>

<SettingsSection
  id="general-mihon"
  keywords="mihon tachiyomi keiyoushi extensions java jre manga sources"
>
  <SettingsItemGroup
    title="Java runtime"
    tooltip="Mihon extensions are Java programs: the app runs them in its own host on Temurin 21 (about 50 MB to download, 160 MB on disk)."
  >
    {#if status && !status.supported}
      <p class="mh-note">Mihon extensions can’t run on this kind of computer.</p>
    {:else if status && !status.host}
      <p class="mh-note">This build of the app has no Mihon host.</p>
    {:else if status?.jre}
      <div class="mh-actions">
        <span class="mh-state">On</span>
        <button
          type="button"
          class="app-button app-button-quiet"
          disabled={busy}
          onclick={() => run(host.removeJava)}>Remove</button
        >
      </div>
    {:else if status}
      <p class="mh-warning">
        An extension is code from its repository, and it runs with this computer’s rights. Add only
        repositories you trust.
      </p>
      <div class="mh-actions">
        <button
          type="button"
          class="app-button app-button-primary"
          disabled={busy}
          onclick={() => run(host.installJava)}
          >{progress
            ? `Downloading… ${mb(progress.received)}${progress.total ? ` of ${mb(progress.total)}` : ''}`
            : 'Turn on'}</button
        >
      </div>
      {#if progress?.total}
        <progress class="w-full" max={progress.total} value={progress.received}></progress>
      {/if}
    {/if}
    {#if error}
      <p class="mh-error" role="alert">{error}</p>
    {/if}
  </SettingsItemGroup>
</SettingsSection>

<style>
  .mh-note,
  .mh-warning {
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }

  .mh-error {
    color: var(--app-danger-color);
    font-size: var(--type-small);
  }

  .mh-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
  }
</style>
