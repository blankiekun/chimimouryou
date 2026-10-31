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
    // A block, not `=> (progress = next)`: the bridge clones a callback's answer, and a state proxy can't be.
    return host.onProgress((next) => {
      progress = next;
    });
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
        <span class="app-tag">On</span>
        <button
          type="button"
          class="app-button app-button-quiet"
          disabled={busy}
          onclick={() => run(host.removeJava)}>{busy ? 'Removing…' : 'Remove'}</button
        >
      </div>
    {:else if status}
      <p class="mh-warning">
        An extension is code from its repository, and it runs with this computer’s rights. <strong
          >Add only repositories you trust.</strong
        >
      </p>
      <div class="mh-actions">
        <button
          type="button"
          class="app-button app-button-primary"
          disabled={busy}
          onclick={() => run(host.installJava)}
          >{progress && progress.total && progress.received >= progress.total
            ? 'Checking…'
            : progress
              ? `Downloading… ${mb(progress.received)}${progress.total ? ` of ${mb(progress.total)}` : ''}`
              : busy
                ? 'Starting…'
                : 'Turn on'}</button
        >
      </div>
      {#if progress?.total}
        <progress
          class="mh-progress"
          aria-label="Java runtime download"
          max={progress.total}
          value={progress.received}
        ></progress>
      {/if}
    {/if}
    {#if error}
      <p class="mh-error" role="alert">{error}</p>
    {/if}
  </SettingsItemGroup>
</SettingsSection>

<style>
  .mh-note {
    color: var(--app-muted-fg);
    font-size: var(--type-small);
  }

  /* The trust warning is read before Turn on: ink, not muted, with its rule in bold. */
  .mh-warning {
    max-width: 65ch;
    margin-bottom: 0.75rem;
    font-size: var(--type-small);
  }

  .mh-warning strong {
    font-weight: 700;
  }

  /* Study Book's 3px progress track, square, no native bevel */
  .mh-progress {
    display: block;
    width: 100%;
    height: 3px;
    margin-top: 0.75rem;
    border: 0;
    appearance: none;
    background: var(--app-progress-track);
  }

  .mh-progress::-webkit-progress-bar {
    background: var(--app-progress-track);
  }

  .mh-progress::-webkit-progress-value {
    background: var(--app-progress-fill);
  }

  .mh-progress::-moz-progress-bar {
    background: var(--app-progress-fill);
  }

  .mh-error {
    margin-top: 0.5rem;
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
